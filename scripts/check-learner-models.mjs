import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import ts from "typescript"
await mkdir("_agent", { recursive: true })
const output = await mkdtemp(join(process.cwd(), "_agent/model-selection-"))
const oldModels = process.env.LEARNER_MODELS
const oldDefault = process.env.OPENAI_MODEL
try {
  for (const [name, path] of Object.entries({
    config: "lib/learner-models.ts",
    binary: "lib/puzzle/model-learner.ts",
    game: "lib/battle-ground-ui/model-learner.ts",
    binaryRoute: "app/api/learner/route.ts",
    gameRoute: "app/api/game-learner/route.ts",
    modelsRoute: "app/api/learner-models/route.ts",
  })) {
    const source = await readFile(path, "utf8")
    const js = ts
      .transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ES2022,
        },
      })
      .outputText.replaceAll('"@/lib/learner-models"', '"./config.js"')
      .replaceAll('"@/lib/puzzle/model-learner"', '"./binary.js"')
      .replaceAll('"@/lib/battle-ground-ui/model-learner"', '"./game.js"')
      .replaceAll('"../puzzle/model-learner"', '"./binary.js"')
    await writeFile(join(output, `${name}.js`), js)
  }
  const { learnerModelConfig, allowedLearnerModel } = await import(
    join(output, "config.js")
  )
  assert.deepEqual(
    learnerModelConfig({}).models.map((model) => model.id),
    ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"]
  )
  const restricted = learnerModelConfig({
    LEARNER_MODELS: "gpt-6-luna, gpt-6-luna",
    OPENAI_MODEL: "gpt-6-astra",
  })
  assert.equal(restricted.defaultModel, "gpt-6-luna")
  assert.equal(allowedLearnerModel("gpt-6-astra", restricted), null)
  assert.equal(allowedLearnerModel(undefined, restricted), "gpt-6-luna")
  process.env.LEARNER_MODELS = "gpt-6-astra,gpt-6-luna"
  process.env.OPENAI_MODEL = "gpt-6-astra"
  const { POST: binaryPost } = await import(join(output, "binaryRoute.js"))
  const { POST: gamePost } = await import(join(output, "gameRoute.js"))
  const { GET } = await import(join(output, "modelsRoute.js"))
  const publicConfig = GET()
  assert.equal(publicConfig.headers.get("cache-control"), "no-store")
  assert.deepEqual(await publicConfig.json(), learnerModelConfig())
  const observation = {
    seed: 1,
    n: 4,
    mode: "FORCED-CHAIN",
    rulesPostcard: ["Fill the board."],
    cells: Array(16).fill(null),
    given: Array(16).fill(false),
    selectedCell: null,
    actions: 0,
    remainingActions: 300,
    remainingMs: 60_000,
    status: "playing",
  }
  const board = {
    seed: 1,
    n: 4,
    category: "lights_toggle",
    mode: "FORCED-CHAIN",
    postcard: { goal: "All off.", rules: ["Toggle a cross."] },
    clues: { neighborhood: "orthogonal-cross" },
    actionSurface: {
      actions: ["selectCell", "cycle", "undo", "clear"],
      cycleValues: [0, 1],
      effect: "toggle-cross",
    },
    cells: Array.from({ length: 16 }, (_, index) => ({
      index,
      row: Math.floor(index / 4),
      column: index % 4,
      value: index === 0 ? 1 : 0,
      visible: true,
      locked: false,
      selected: false,
    })),
    actions: 0,
    remainingActions: 300,
    remainingMs: 60_000,
    status: "playing",
    readOnly: true,
    hints: "practice-only",
  }
  let providerCalls = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    providerCalls++
    throw new Error("No model call allowed in boundary test")
  }
  try {
    for (const [post, field, view] of [
      [binaryPost, "observation", observation],
      [gamePost, "board", board],
    ]) {
      const send = (body) =>
        post(
          new Request("http://localhost/api/learner", {
            method: "POST",
            body: JSON.stringify(body),
          })
        )
      assert.equal(
        (await send({ [field]: view, priorClaims: [], model: "not-allowed" }))
          .status,
        400
      )
      assert.equal(
        (await send({ [field]: view, priorClaims: [], model: "gpt-6.1-sol" }))
          .status,
        400
      )
      const allowed = await send({
        [field]: { ...view, status: "finished" },
        priorClaims: [],
        model: "gpt-6-luna",
      })
      assert.equal(allowed.status, 200)
      assert.equal((await allowed.json()).reason, "inactive")
      assert.equal(
        (
          await send({
            [field]: { ...view, status: "finished" },
            priorClaims: [],
          })
        ).status,
        200
      )
    }
    assert.equal(
      providerCalls,
      0,
      "Disallowed model must fail before provider call"
    )
  } finally {
    globalThis.fetch = originalFetch
  }
  const { createGameLearnerRunner } = await import(join(output, "game.js"))
  let model = "gpt-6-astra",
    resolve,
    signal
  let controls = 0
  const runner = createGameLearnerRunner({
    observe: () => board,
    api: {
      selectCell: () => controls++,
      cycle: () => controls++,
      undo: () => controls++,
      clear: () => controls++,
    },
    memory: { claims: [], currentClaim: null },
    model: () => model,
    decide: async (input, s) => {
      assert.equal(input.model, model)
      signal = s
      return new Promise((done) => {
        resolve = done
      })
    },
  })
  const pending = runner.step()
  model = "gpt-6-luna"
  runner.sync()
  assert.equal(signal.aborted, true)
  resolve({ action: { type: "selectCell", cell: 0 }, state: "decision" })
  assert.equal(await pending, false)
  assert.equal(controls, 0)
  runner.dispose()
  console.log(
    "Model allowlists, both route rejection boundaries, public catalogue, legacy defaults, and model-change cancellation passed."
  )
} finally {
  if (oldModels === undefined) delete process.env.LEARNER_MODELS
  else process.env.LEARNER_MODELS = oldModels
  if (oldDefault === undefined) delete process.env.OPENAI_MODEL
  else process.env.OPENAI_MODEL = oldDefault
  await rm(output, { recursive: true, force: true })
}

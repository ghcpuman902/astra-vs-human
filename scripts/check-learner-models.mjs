import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { transpileGraph } from "./transpile-ts.mjs"
await mkdir("_agent", { recursive: true })
const output = await mkdtemp(join(process.cwd(), "_agent/model-selection-"))
const oldModels = process.env.LEARNER_MODELS
const oldDefault = process.env.OPENAI_MODEL
try {
  const modules = {
    config: "lib/learner-models.ts",
    binary: "lib/puzzle/model-learner.ts",
    game: "lib/battle-ground-ui/model-learner.ts",
    binaryRoute: "app/api/learner/route.ts",
    gameRoute: "app/api/game-learner/route.ts",
    modelsRoute: "app/api/learner-models/route.ts",
  }
  const load = await transpileGraph(Object.values(modules), output)
  const { learnerModelConfig, allowedLearnerModel } = await load(modules.config)
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
  const { POST: binaryPost } = await load(modules.binaryRoute)
  const { POST: gamePost } = await load(modules.gameRoute)
  const { GET } = await load(modules.modelsRoute)
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
      role: "open",
    })),
    affordances: {
      cells: Array.from({ length: 16 }, (_, index) => ({
        index,
        role: "open",
        value: index === 0 ? 1 : 0,
        selected: false,
        options: [0, 1],
      })),
      controls: {
        selectCell: Array.from({ length: 16 }, (_, index) => index),
        cycle: false,
        undo: false,
        clear: false,
      },
      cycle: { alphabet: [0, 1], effect: "Toggle the cell and its cross." },
      intents: "setCell",
    },
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
  const { createGameLearnerRunner } = await load(modules.game)
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

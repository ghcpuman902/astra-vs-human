import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import ts from "typescript"
const external =
  process.argv[2] ??
  "/Users/manglekuo/Downloads/927cd1f1-9e21-4ecd-86a5-cab3f3acb3fb/src/lib/puzzle"
await mkdir("_agent", { recursive: true })
const output = await mkdtemp(join(process.cwd(), "_agent/stage-learner-"))
try {
  for (const [folder, base, files] of [
    ["export", external, ["stage", "battle", "match", "types", "verifier"]],
    [
      "public",
      "lib/puzzle",
      [
        "stage-learner",
        "stage-observation",
        "model-learner",
        "learner",
        "types",
      ],
    ],
  ]) {
    await mkdir(join(output, folder))
    for (const name of files) {
      const source = await readFile(join(base, `${name}.ts`), "utf8")
      const js = ts
        .transpileModule(source, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ES2022,
          },
        })
        .outputText.replace(/from "(\.[^"\n]+)"/g, 'from "$1.js"')
      await writeFile(join(output, folder, `${name}.js`), js)
    }
  }
  const { createStage, STAGE_MS } = await import(
    join(output, "export/stage.js")
  )
  const { observeStage } = await import(
    join(output, "public/stage-observation.js")
  )
  const { createStageLearner } = await import(
    join(output, "public/stage-learner.js")
  )
  const { learnerRequestSchema } = await import(
    join(output, "public/model-learner.js")
  )
  const pack = {
    seed: 1,
    n: 4,
    mode: "FORCED-CHAIN",
    rulesPostcard: ["Put 0 in the open cell."],
    cells: [null, ...Array(15).fill(0)],
    constraints: [{ kind: "quota", cells: [0], ones: 0 }],
    verifierSpec: { version: 1, alphabet: [0, 1], empty: null },
  }
  const publicMarks = { quotas: [{ cells: [0], count: 0 }], friends: [] }
  let clock = 0,
    calls = 0
  const stage = createStage(pack, () => clock)
  const memory = { claims: [], currentClaim: null }
  const session = createStageLearner({
    stage,
    pack,
    publicMarks,
    memory,
    decide: async (input) => {
      calls++
      assert.equal(learnerRequestSchema.safeParse(input).success, true)
      assert.equal("constraints" in input.observation, false)
      return { action: { type: "selectCell", cell: 0 }, state: "decision" }
    },
  })
  await session.step()
  assert.equal(calls, 0, "No inference before human start")
  assert.equal(stage.match.getSnapshot().players.learner.actions, 0)
  stage.start()
  await session.step()
  assert.equal(calls, 1)
  assert.equal(stage.match.getSnapshot().players.learner.actions, 1)
  assert.equal(stage.match.getSnapshot().players.human.actions, 0)
  session.dispose()
  let resolve, signal
  const stale = createStageLearner({
    stage,
    pack,
    publicMarks,
    memory,
    decide: async (_, received) => {
      signal = received
      return new Promise((done) => {
        resolve = done
      })
    },
  })
  const pending = stale.step()
  stage.actions("learner").cycle() // test-only fixture completion; no policy solving
  stage.match.tick() // exported stage respawns its learner attempt
  assert.equal(signal.aborted, true)
  assert.equal(stage.match.getSnapshot().players.learner.actions, 0)
  resolve({ action: { type: "selectCell", cell: 0 }, state: "decision" })
  await pending
  assert.equal(
    stage.match.getSnapshot().players.learner.actions,
    0,
    "Stale pre-respawn result must not tap new attempt"
  )
  assert.equal(memory.claims.length, 1)
  stale.dispose()
  let endResolve, endSignal
  const ending = createStageLearner({
    stage,
    pack,
    publicMarks,
    memory,
    decide: async (_, received) => {
      endSignal = received
      return new Promise((done) => {
        endResolve = done
      })
    },
  })
  const endPending = ending.step()
  clock = STAGE_MS
  stage.match.tick()
  assert.equal(endSignal.aborted, true)
  endResolve({ action: { type: "selectCell", cell: 0 }, state: "decision" })
  await endPending
  assert.equal(ending.getSnapshot().status, "finished")
  assert.equal(stage.match.getSnapshot().players.learner.actions, 0)
  assert.equal(observeStage(stage, pack, publicMarks).remainingMs, 0)
  ending.dispose()
  console.log(
    "Actual exported Lovable stage: no inference before start, strict public observation, counted Learner-only moves, respawn cancellation, claim retention and stage deadline passed."
  )
} finally {
  await rm(output, { recursive: true, force: true })
}

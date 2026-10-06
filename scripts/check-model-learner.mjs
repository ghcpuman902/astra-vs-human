import assert from "node:assert/strict"
import { readFile, writeFile, rm } from "node:fs/promises"
import ts from "typescript"

// Keep compiled files beside dependencies; never load environment credentials.
const artifact = new URL("../_agent/check-model-learner.mjs", import.meta.url)
const routeArtifact = new URL(
  "../_agent/check-learner-route.mjs",
  import.meta.url
)
const matchArtifact = new URL(
  "../_agent/check-learner-match.mjs",
  import.meta.url
)
const verifierArtifact = new URL(
  "../_agent/check-learner-verifier.mjs",
  import.meta.url
)
const configArtifact = new URL(
  "../_agent/check-learner-config.mjs",
  import.meta.url
)
try {
  const configSource = await readFile(
    new URL("../lib/learner-models.ts", import.meta.url),
    "utf8"
  )
  await writeFile(
    configArtifact,
    ts.transpileModule(configSource, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    }).outputText
  )
  const source = await readFile(
    new URL("../lib/puzzle/model-learner.ts", import.meta.url),
    "utf8"
  )
  await writeFile(
    artifact,
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    }).outputText
  )
  const { learnerRequestSchema, decideWithModel, createModelLearnerRunner } =
    await import(artifact.href)
  const view = {
    seed: 1,
    n: 4,
    mode: "FORCED-CHAIN",
    rulesPostcard: ["No three equal adjacent cells."],
    cells: Array(16).fill(null),
    given: Array(16).fill(false),
    selectedCell: null,
    actions: 0,
    remainingActions: 100,
    remainingMs: 60_000,
    status: "playing",
  }
  const input = {
    observation: view,
    priorClaims: ["ABA may force the middle friend."],
  }
  for (const [file, target] of [
    ["match", matchArtifact],
    ["verifier", verifierArtifact],
  ]) {
    const moduleSource = await readFile(
      new URL(`../lib/puzzle/${file}.ts`, import.meta.url),
      "utf8"
    )
    await writeFile(
      target,
      ts
        .transpileModule(moduleSource, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ES2022,
          },
        })
        .outputText.replace('"./verifier"', '"./check-learner-verifier.mjs"')
    )
  }
  const { createMatch } = await import(matchArtifact.href)
  const cached = JSON.parse(
    await readFile(
      new URL("../lib/puzzle/packs-cache.json", import.meta.url),
      "utf8"
    )
  )
  for (const pack of cached) {
    const match = createMatch([pack], {
      now: () => 0,
      actionCap: 300,
      timeCapMs: 60_000,
    })
    assert.equal(
      learnerRequestSchema.safeParse({
        observation: match.observe("learner"),
        priorClaims: [],
      }).success,
      true,
      `Cached pack ${pack.seed} must reach the live Learner`
    )
    const learnerMarks = match.observe("learner").publicMarks
    assert.deepEqual(learnerMarks, match.observe("human").publicMarks)
    assert.deepEqual(learnerMarks, {
      quotas: pack.constraints
        .filter((rule) => rule.kind === "quota")
        .map((rule) => ({ cells: rule.cells, count: rule.ones })),
      friends: pack.constraints
        .filter((rule) => rule.kind === "friend")
        .map((rule) => ({ cells: rule.cells, relation: rule.relation })),
    })
  }
  for (const publicMarks of [
    { quotas: [{ cells: [0, 1], count: 3 }], friends: [] },
    { quotas: [], friends: [{ cells: [0, 35], relation: "=" }] },
    { quotas: [], friends: [], verifierSpec: {} },
  ])
    assert.equal(
      learnerRequestSchema.safeParse({
        ...input,
        observation: { ...view, publicMarks },
      }).success,
      false
    )
  assert.equal(
    learnerRequestSchema.safeParse({
      ...input,
      observation: {
        ...view,
        rulesPostcard: ["x".repeat(1000), "y".repeat(1000)],
      },
    }).success,
    false
  )
  for (const bad of [
    { ...input, answer: [] },
    { ...input, observation: { ...view, constraints: [] } },
    { ...input, observation: { ...view, cells: [] } },
    { ...input, observation: { ...view, n: 9 } },
  ])
    assert.equal(learnerRequestSchema.safeParse(bad).success, false)
  assert.equal(
    (
      await decideWithModel(input, async (visible) => {
        assert.deepEqual(Object.keys(visible).sort(), [
          "observation",
          "priorClaims",
        ])
        assert.equal("constraints" in visible.observation, false)
        return {
          action: { type: "selectCell", cell: 2 },
          patternClaim: "Two equal neighbours force a flip.",
        }
      })
    ).action.cell,
    2
  )
  assert.equal(
    (
      await decideWithModel(input, async () => ({
        action: { type: "selectCell", cell: 25 },
        patternClaim: null,
      }))
    ).reason,
    "invalid-decision"
  )
  assert.equal(
    (
      await decideWithModel(input, async () => {
        throw new Error("secret provider detail")
      })
    ).reason,
    "unavailable"
  )
  let aborted = false
  const timeout = await decideWithModel(
    input,
    async (_, signal) => {
      signal.addEventListener("abort", () => {
        aborted = true
      })
      return new Promise(() => {})
    },
    undefined,
    5
  )
  assert.equal(timeout.reason, "deadline")
  assert.equal(aborted, true)
  let calls = 0
  assert.equal(
    (
      await decideWithModel(
        { ...input, observation: { ...view, status: "finished" } },
        async () => {
          calls++
        }
      )
    ).reason,
    "inactive"
  )
  assert.equal(calls, 0)

  let live = { ...view }
  let resolve
  let receivedSignal
  const taps = []
  const runner = createModelLearnerRunner({
    observe: () => live,
    api: {
      selectCell: (cell) => taps.push(cell),
      cycle: () => taps.push("cycle"),
      undo: () => {},
      clear: () => {},
    },
    memory: { claims: [], currentClaim: null },
    decide: async (_, signal) => {
      receivedSignal = signal
      return new Promise((done) => {
        resolve = done
      })
    },
  })
  const pending = runner.step()
  assert.equal(await runner.step(), false, "No parallel model calls")
  live = { ...live, actions: 1 }
  runner.sync()
  assert.equal(receivedSignal.aborted, true)
  resolve({ action: { type: "selectCell", cell: 2 }, state: "decision" })
  assert.equal(await pending, false)
  assert.deepEqual(taps, [])
  const valid = runner.step()
  resolve({ action: { type: "selectCell", cell: 2 }, state: "decision" })
  assert.equal(await valid, true)
  assert.deepEqual(taps, [2])
  const afterDispose = runner.step()
  runner.dispose()
  resolve({ action: { type: "cycle" }, state: "decision" })
  assert.equal(await afterDispose, false)
  assert.equal(await runner.step(), false)
  const malformedRunner = createModelLearnerRunner({
    observe: () => ({ ...view, n: 9 }),
    api: {
      selectCell: () => {},
      cycle: () => {},
      undo: () => {},
      clear: () => {},
    },
    memory: { claims: [], currentClaim: null },
  })
  assert.equal(
    await malformedRunner.step(),
    false,
    "Malformed view waits without throwing into UI"
  )
  const routeSource = await readFile(
    new URL("../app/api/learner/route.ts", import.meta.url),
    "utf8"
  )
  await writeFile(
    routeArtifact,
    ts
      .transpileModule(routeSource, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ES2022,
        },
      })
      .outputText.replace(
        '"@/lib/learner-models"',
        '"./check-learner-config.mjs"'
      )
      .replace('"@/lib/puzzle/model-learner"', '"./check-model-learner.mjs"')
  )
  const { POST } = await import(routeArtifact.href)
  const send = (body) =>
    POST(
      new Request("http://localhost/api/learner", {
        method: "POST",
        body: JSON.stringify(body),
      })
    )
  assert.equal((await send({ ...input, solution: [] })).status, 400)
  assert.equal(
    (await send({ ...input, observation: { ...view, verifierSpec: {} } }))
      .status,
    400
  )
  const inactive = await send({
    ...input,
    observation: { ...view, status: "finished" },
  })
  assert.equal(inactive.status, 200)
  assert.equal((await inactive.json()).reason, "inactive")
  assert.equal(inactive.headers.get("cache-control"), "no-store")
  // No Content-Length header: limit actual UTF-8 bytes while reading the stream.
  assert.equal(
    (
      await POST(
        new Request("http://localhost/api/learner", {
          method: "POST",
          body: "é".repeat(17_000),
        })
      )
    ).status,
    413
  )
  console.log(
    "L0 visible boundary, legal actions, deadline, failure, stale cancellation, and serial runner checks passed."
  )
} finally {
  await rm(artifact, { force: true })
  await rm(routeArtifact, { force: true })
  await rm(matchArtifact, { force: true })
  await rm(verifierArtifact, { force: true })
  await rm(configArtifact, { force: true })
}

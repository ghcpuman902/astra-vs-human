import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import ts from "typescript"
await mkdir("_agent", { recursive: true })
const output = await mkdtemp(join(process.cwd(), "_agent/game-learner-"))
try {
  for (const [folder, files] of Object.entries({
    puzzle: ["author", "types", "verifier", "model-learner"],
    "mini-game-rules": ["schema", "runtime", "verifier", "assembler"],
    "battle-ground-ui": ["controller", "learner-mix", "model-learner"],
  })) {
    await mkdir(join(output, folder))
    for (const file of files) {
      const source = await readFile(`lib/${folder}/${file}.ts`, "utf8")
      const js = ts
        .transpileModule(source, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ES2022,
          },
        })
        .outputText.replace(/from "(\.[^"\n]+)"/g, 'from "$1.js"')
      await writeFile(join(output, folder, `${file}.js`), js)
    }
  }
  const { assembleGamePack } = await import(
    join(output, "mini-game-rules/assembler.js")
  )
  const { createBattleGround } = await import(
    join(output, "battle-ground-ui/controller.js")
  )
  const {
    gameLearnerRequestSchema,
    decideGameLearner,
    createGameLearnerRunner,
    jevActionRequest,
    layaActionRequest,
    openAIDecisionsRequest,
    assertLearnerBackendWired,
  } = await import(join(output, "battle-ground-ui/model-learner.js"))
  const {
    expandPlacements,
    jevCommitBody,
    layaCommitBody,
    layaSystemOneTarget,
    readJevCommit,
    applyCommit,
  } = await import(join(output, "battle-ground-ui/learner-mix.js"))
  for (const category of [
    "binary_fill",
    "crown",
    "path_cover",
    "tile_rotate_connect",
    "lights_toggle",
  ]) {
    const { pack } = assembleGamePack({ category, seed: 700, n: 4 })
    const battle = createBattleGround([pack], { now: () => 0 })
    const board = battle.boardProps("learner")
    const input = { board, priorClaims: [] }
    assert.equal(
      gameLearnerRequestSchema.safeParse(input).success,
      true,
      category
    )
    for (const field of ["transfer", "audit", "solution", "winPredicate"])
      assert.equal(
        gameLearnerRequestSchema.safeParse({
          ...input,
          board: { ...board, [field]: {} },
        }).success,
        false
      )
    const cell = board.cells.find((cell) => !cell.locked && cell.visible).index
    const decision = await decideGameLearner(input, async (visible) => {
      assert.equal("transfer" in visible.board, false)
      assert.equal("audit" in visible.board, false)
      assert.deepEqual(visible.board.clues, battle.boardProps("human").clues)
      return {
        action: { type: "selectCell", cell },
        patternClaim: "A local neighbour can settle the next move.",
      }
    })
    assert.equal(decision.action.cell, cell)
    assert.equal(
      (
        await decideGameLearner(input, async () => ({
          action: { type: "cycle" },
          patternClaim: null,
        }))
      ).reason,
      "invalid-decision"
    )
    assert.equal(
      (
        await decideGameLearner(
          input,
          async () => new Promise(() => {}),
          undefined,
          2
        )
      ).reason,
      "deadline"
    )
    let resolve, signal
    const runner = createGameLearnerRunner({
      observe: () => battle.boardProps("learner"),
      api: battle.actions("learner"),
      memory: { claims: [], currentClaim: null },
      decide: async (_, received) => {
        signal = received
        return new Promise((done) => {
          resolve = done
        })
      },
    })
    const pending = runner.step()
    assert.equal(await runner.step(), false)
    battle.actions("learner").selectCell(cell)
    runner.sync()
    assert.equal(signal.aborted, true)
    resolve({ action: { type: "cycle" }, state: "decision" })
    assert.equal(await pending, false)
    const valid = runner.step()
    resolve({ action: { type: "cycle" }, state: "decision" })
    assert.equal(await valid, true)
    assert.equal(battle.boardProps("learner").actions, 2)
    runner.dispose()
    assert.equal(await runner.step(), false)
    const hidden = structuredClone(board)
    hidden.cells[cell] = {
      ...hidden.cells[cell],
      visible: false,
      value: 1,
      locked: false,
      selected: false,
    }
    assert.equal(
      gameLearnerRequestSchema.safeParse({ ...input, board: hidden }).success,
      false
    )
    assert.equal(
      (
        await decideGameLearner(input, async () => {
          throw new Error("Provider details must stay private")
        })
      ).reason,
      "unavailable"
    )
    const jev = jevActionRequest(board, ["A local neighbour settles the next cell."])
    const decisions = openAIDecisionsRequest(board, [])
    const laya = layaActionRequest(board, [])
    assert.equal(jev.model, "typesafe/jev-1.13")
    assert.equal(laya.model, "convaiinnovations/laya")
    assert.equal(decisions.model, "gpt-6-luna")
    assert.equal(JSON.parse(jev.state).seed, board.seed)
    assert.equal("transfer" in JSON.parse(jev.state), false)
    assert.equal("solution" in JSON.parse(decisions.input), false)
    assert.throws(
      () => assertLearnerBackendWired("typesafe-jev", {}),
      /No request was sent/
    )
    assert.doesNotThrow(() =>
      assertLearnerBackendWired("typesafe-jev", { TYPESAFE_API_KEY: "present" })
    )
    assert.throws(
      () => assertLearnerBackendWired("convai-laya", {}),
      /No request was sent/
    )
    assert.throws(
      () =>
        assertLearnerBackendWired("convai-laya", {
          AI_GATEWAY_API_KEY: "present",
        }),
      /No request was sent/
    )
    assert.doesNotThrow(() =>
      assertLearnerBackendWired("convai-laya", { LAYA_API_KEY: "present" })
    )
    assert.doesNotThrow(() =>
      assertLearnerBackendWired("convai-laya", { IMPOSSIBL_API_KEY: "present" })
    )
    assert.doesNotThrow(() =>
      assertLearnerBackendWired("convai-laya", {
        LAYA_BASE_URL: "http://127.0.0.1:8787",
      })
    )
    assert.throws(
      () =>
        assertLearnerBackendWired("openai-decisions", {
          LAYA_API_KEY: "present",
          OPENAI_API_KEY: "present",
        }),
      /No request was sent/
    )
    const commit = jevCommitBody("public board only")
    const layaCommit = layaCommitBody("public board only")
    assert.equal(commit.model, "jev-1.13.0")
    assert.equal(layaCommit.model, "convaiinnovations/laya")
    assert.equal(layaCommit.questions.commit.type, "choice")
    assert.equal(
      layaSystemOneTarget({ LAYA_API_KEY: "laya-key" })?.url,
      "https://api.laya.studio/v1/systemone"
    )
    assert.equal(
      layaSystemOneTarget({ IMPOSSIBL_API_KEY: "imp-key" })?.url,
      "https://api.impossibl.com/v1/systemone"
    )
    assert.equal(
      layaSystemOneTarget({
        LAYA_API_KEY: "laya-key",
        LAYA_BASE_URL: "https://api.impossibl.com/v1",
      })?.authorization,
      "Bearer laya-key"
    )
    assert.equal(
      layaSystemOneTarget({
        IMPOSSIBL_API_KEY: "imp-key",
        LAYA_BASE_URL: "https://api.impossibl.com",
      })?.authorization,
      "Bearer imp-key"
    )
    assert.equal(layaSystemOneTarget({}), null)
    assert.equal(commit.state.includes("solution"), false)
    assert.equal(readJevCommit({ answers: { commit: { choice: "one" } } }), "one")
    assert.equal(applyCommit([1, 2, 3], "one").length, 1)
    assert.equal(applyCommit([1, 2], "wait").length, 0)
    assert.equal(applyCommit([1, 2], null).length, 2)
    const expanded = expandPlacements(
      [{ cell, cycles: 1 }],
      board.cells.map((entry) => ({
        visible: entry.visible,
        locked: entry.locked,
      }))
    )
    assert.deepEqual(expanded, [
      { type: "selectCell", cell },
      { type: "cycle" },
    ])
    const batch = createBattleGround([pack], { now: () => 0 })
    const batchRunner = createGameLearnerRunner({
      observe: () => batch.boardProps("learner"),
      api: batch.actions("learner"),
      memory: { claims: [], currentClaim: null },
      decide: async () => ({
        action: null,
        patternClaim: null,
        state: "decision",
        placements: [{ cell, cycles: 1 }],
      }),
    })
    assert.equal(await batchRunner.step(), true)
    assert.equal(batch.boardProps("learner").actions, 2)
    batchRunner.dispose()
    assert.throws(
      () => assertLearnerBackendWired("openai-decisions"),
      /No request was sent/
    )
    assertLearnerBackendWired("openai-generate-text")
  }
  console.log(
    "All five public board contracts, hidden-field rejection, deadlines, failure waits, stale cancellation and shared counted actions passed."
  )
} finally {
  await rm(output, { recursive: true, force: true })
}

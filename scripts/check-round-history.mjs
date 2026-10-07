import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { transpileGraph } from "./transpile-ts.mjs"

await mkdir("_agent", { recursive: true })
const output = await mkdtemp(join(process.cwd(), "_agent/round-history-"))
try {
  const load = await transpileGraph(
    [
      "lib/battle-ground-ui/controller.ts",
      "lib/battle-ground-ui/match-deck.ts",
      "lib/battle-ground-ui/round-tape.ts",
      "lib/match-memory.ts",
    ],
    output
  )
  const { createBattleGround } = await load(
    "lib/battle-ground-ui/controller.ts"
  )
  const { dealMatch } = await load("lib/battle-ground-ui/match-deck.ts")
  const { cellsAt, appendStep, TAPE_LIMIT } = await load(
    "lib/battle-ground-ui/round-tape.ts"
  )

  let t = 0
  const deal = dealMatch("deep")
  const options = {
    timeCapMs: 60_000,
    clock: "side",
    roundsPerGame: deal.roundsPerGame,
    limitHumanTaps: false,
    startPaused: true,
    now: () => t,
  }
  const battle = createBattleGround(deal.packs, options)
  const seed = deal.packs[0].seed
  const key = String(seed)
  const start = deal.packs[0].cells.map((cell) => cell.value)
  const open = battle
    .boardProps("human")
    .cells.filter((cell) => cell.role === "open")
    .map((cell) => cell.index)
  assert.ok(open.length >= 2, "first round has two open cells")
  const [a, b] = open
  const human = battle.actions("human")
  const tape = () => battle.getSnapshot().tapes.human[key] ?? []

  // Paused: nothing is played, nothing is taped.
  human.selectCell(a)
  human.cycle()
  assert.equal(tape().length, 0)
  battle.start()

  // A tap (select + cycle) is one step at the time it landed.
  t = 1_000
  human.selectCell(a)
  assert.equal(tape().length, 0, "selection alone is not a step")
  human.cycle()
  assert.equal(tape().length, 1)
  assert.equal(tape()[0].kind, "tap")
  assert.equal(tape()[0].cell, a)
  assert.equal(tape()[0].at, 1_000)
  assert.equal(tape()[0].taps, 2)
  // More cycles on the same selection fold into that step (agent placements, path drags).
  t = 1_200
  human.cycle()
  assert.equal(tape().length, 1)
  assert.equal(tape()[0].taps, 3)
  // Selecting again starts a new step, even on the same cell.
  human.selectCell(a)
  human.cycle()
  assert.equal(tape().length, 2)
  human.selectCell(b)
  human.cycle()
  assert.equal(tape().length, 3)
  assert.equal(tape()[2].cell, b)
  human.undo()
  assert.equal(tape().at(-1).kind, "undo")
  assert.equal(tape().at(-1).cell, null)
  human.selectCell(b)
  human.cycle()
  const beforeClear = tape().length
  human.clear()
  assert.equal(tape().length, beforeClear + 1)
  assert.equal(tape().at(-1).kind, "clear")
  // A clear (or undo) that changes nothing is not a step.
  human.clear()
  assert.equal(tape().length, beforeClear + 1)
  human.selectCell(b)
  human.cycle()
  // Replaying every step lands on the live board; any prefix is a real past board.
  const live = battle.getSnapshot().attempts.human.state.cells
  assert.deepEqual(cellsAt(start, tape(), tape().length), live)
  assert.deepEqual(cellsAt(start, tape(), 0), start)
  assert.equal(cellsAt(start, tape(), tape().length - 1)[b], start[b])
  // The agent keeps its own tape; the human's is untouched by it.
  battle.actions("learner").selectCell(a)
  battle.actions("learner").cycle()
  assert.equal(battle.getSnapshot().tapes.learner[key].length, 1)
  assert.equal(tape().at(-1).cell, b)

  // Overtime steps are marked, and never fold into a scored step.
  t = 61_000
  battle.tick()
  assert.equal(battle.getSnapshot().attempts.human.status, "time-cap")
  const scored = tape().length
  assert.equal(battle.keepPlaying("human"), true)
  human.selectCell(b)
  human.cycle()
  assert.equal(tape().length, scored + 1)
  assert.equal(tape().at(-1).overtime, true)
  assert.equal(tape()[scored - 1].overtime, undefined)

  // Read-only boards for any dealt round; unknown seeds and wrong sizes are refused.
  const replay = battle.replayProps(seed, start, a, "finished")
  assert.equal(replay.readOnly, true)
  assert.equal(replay.cells[a].selected, true)
  assert.equal(replay.seed, seed)
  assert.equal(battle.replayProps(-1, start, null, "finished"), null)
  assert.equal(battle.replayProps(seed, [0], null, "finished"), null)

  // Reload: tapes survive dump → JSON → saved match → restore, and keep growing.
  const store = new Map()
  globalThis.localStorage = {
    getItem: (name) => store.get(name) ?? null,
    setItem: (name, value) => store.set(name, String(value)),
    removeItem: (name) => store.delete(name),
  }
  const { saveMatch, readMatch } = await load("lib/match-memory.ts")
  saveMatch({
    finished: false,
    setup: {
      arena: "play",
      leftMix: "astra",
      rightMix: "astra",
      length: "deep",
      marks: { played: [], disliked: [] },
      practice: false,
    },
    dealt: deal,
    source: "check",
    rulesShown: true,
    started: true,
    model: null,
    rivalModel: null,
    battle: JSON.parse(JSON.stringify(battle.dump())),
    traces: { human: null, learner: null },
  })
  const saved = readMatch()
  assert.ok(saved, "a match with round history passes the saved-match schema")
  assert.deepEqual(saved.battle.tapes.human[key], tape())
  const back = createBattleGround(deal.packs, {
    ...options,
    restore: saved.battle,
  })
  assert.deepEqual(back.getSnapshot().tapes.human[key], tape())
  back.start()
  // Still in overtime after the reload: the next step lands on the same tape.
  back.actions("human").selectCell(a)
  back.actions("human").cycle()
  const resumed = back.getSnapshot().tapes.human[key]
  assert.equal(resumed.length, tape().length + 1)
  assert.equal(resumed.at(-1).overtime, true)
  // Matches saved before round history still load.
  const { tapes: dropped, ...legacy } = JSON.parse(JSON.stringify(back.dump()))
  assert.equal(dropped.human[key].length, resumed.length)
  const old = createBattleGround(deal.packs, { ...options, restore: legacy })
  assert.deepEqual(old.getSnapshot().tapes, { human: {}, learner: {} })

  // A runaway round stops taping at the limit instead of growing the save forever.
  let long = []
  for (let step = 0; step < TAPE_LIMIT + 5; step++)
    long = appendStep(
      long,
      { at: step, kind: "tap", cell: step % 2, changes: [[0, 1]], taps: step },
      false
    )
  assert.equal(long.length, TAPE_LIMIT)

  console.log(
    "Round history verified: taps fold per selection, undo/clear/overtime steps, replay lands on the live board, read-only replay boards, saved-match round trip and legacy saves."
  )
} finally {
  await rm(output, { recursive: true, force: true })
}

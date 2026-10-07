import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { loadGameRuntime } from "./load-game-runtime.mjs"

const categories = [
  "binary_fill",
  "crown",
  "path_cover",
  "tile_rotate_connect",
  "lights_toggle",
  "lamp_rays",
  "mosaic_count",
  "tower_sight",
]

const runtime = await loadGameRuntime("game-validity")
const {
  assembleGamePack,
  describeBoard,
  reachableOptions,
  compileBoardIntent,
  initialGameState,
  createBattleGround,
  bareControlQuestions,
  plannedControlQuestions,
  learnerBoardPayload,
  packSchema,
  verifyGame,
  applyGameAction,
  cleanup,
} = runtime

const choiceKeys = (questions) =>
  Object.keys(questions.control.criteria)
    .filter((key) => key.startsWith("cell-"))
    .map((key) => Number(key.slice(5)))

const assertSurface = (pack, label) => {
  assert.equal(packSchema.safeParse(pack).success, true, `${label} schema`)
  const state = initialGameState(pack)
  const affordances = describeBoard(pack, state)
  const open = affordances.cells
    .filter((cell) => cell.role === "open")
    .map((cell) => cell.index)
  assert.deepEqual(affordances.controls.selectCell, open, `${label} open cells`)
  assert.ok(open.length > 0, `${label} has an open cell`)
  for (const cell of affordances.cells) {
    if (cell.role !== "open")
      assert.equal(cell.options.length, 0, `${label} cell ${cell.index} hidden options`)
    else if (pack.category !== "path_cover")
      assert.ok(cell.options.length > 0, `${label} cell ${cell.index} options`)
    if (cell.role !== "open") continue
    assert.deepEqual(
      cell.options,
      reachableOptions(pack, state.cells, cell.index),
      `${label} cell ${cell.index} cycle options`
    )
    for (const value of cell.options) {
      const compiled = compileBoardIntent(
        {
          n: pack.n,
          category: pack.category,
          clues: pack.rules,
          actionSurface: pack.actionSurface,
          affordances,
          cells: pack.cells.map((item, index) => ({
            index,
            value: state.cells[index],
            locked: item.locked,
            role: affordances.cells[index].role,
            visible: true,
          })),
        },
        { cell: cell.index, value }
      )
      assert.equal(compiled.ok, true, `${label} compile ${cell.index}`)
    }
    const alien = cell.options.includes(36) ? null : 36
    if (!cell.options.includes(alien)) {
      const rejected = compileBoardIntent(
        {
          n: pack.n,
          category: pack.category,
          clues: pack.rules,
          actionSurface: pack.actionSurface,
          affordances,
          cells: pack.cells.map((item, index) => ({
            index,
            value: state.cells[index],
            locked: item.locked,
            role: affordances.cells[index].role,
            visible: true,
          })),
        },
        { cell: cell.index, value: alien }
      )
      assert.equal(rejected.ok, false, `${label} rejects alien value`)
    }
  }
  const battle = createBattleGround([pack], { now: () => 0 })
  const board = battle.boardProps("learner")
  const controls = board.affordances.controls
  const bare = bareControlQuestions(controls.selectCell, controls)
  const planned = plannedControlQuestions(controls.selectCell, {}, null, controls)
  assert.deepEqual(choiceKeys(bare), controls.selectCell, `${label} bare cells`)
  assert.deepEqual(choiceKeys(planned), controls.selectCell, `${label} planned cells`)
  assert.equal(
    choiceKeys(bare).length,
    open.length,
    `${label} agent cell count matches human`
  )
  if (controls.cycle) assert.equal("cycle" in bare.control.criteria, true)
  else assert.equal("cycle" in bare.control.criteria, false)
  const payload = learnerBoardPayload(board)
  for (const key of ["category", "mode", "solution", "audit", "transfer"])
    assert.equal(key in payload, false, `${label} payload ${key}`)
  const played = applyGameAction(pack, state, {
    type: "selectCell",
    cell: open[0],
  })
  assert.equal(played.ok, true, `${label} human select`)
  const after = describeBoard(pack, played.state)
  const moved = after.cells[open[0]]
  assert.deepEqual(
    moved.options,
    reachableOptions(pack, played.state.cells, open[0]),
    `${label} options after select`
  )
}

try {
  const { games } = JSON.parse(
    await readFile("fixtures/agent-games/index.json", "utf8")
  )
  assert.equal(games.length, 25)
  for (const game of games) {
    assert.equal(verifyGame(game.pack, game.solution).complete, true, game.id)
    const start = game.pack.cells.map((cell) => cell.value)
    assert.equal(verifyGame(game.pack, start).complete, false, `${game.id} trivial`)
    assert.ok(
      start.some((value, index) => value !== game.solution[index]),
      `${game.id} differs from the solution`
    )
    assertSurface(game.pack, game.id)
    if (game.presses) {
      let cells = start.map((value) => (value === 1 ? 1 : 0))
      const n = game.n
      const touch = (cell) => {
        const row = Math.floor(cell / n)
        const col = cell % n
        const ids = [cell]
        if (row > 0) ids.push(cell - n)
        if (col < n - 1) ids.push(cell + 1)
        if (row < n - 1) ids.push(cell + n)
        if (col > 0) ids.push(cell - 1)
        return ids
      }
      for (const cell of game.presses)
        for (const id of touch(cell)) cells[id] = cells[id] === 1 ? 0 : 1
      assert.ok(
        cells.every((value) => value === 0),
        `${game.id} presses solve the lights`
      )
    }
  }

  for (const category of categories) {
    for (const seed of [1, 2, 3]) {
      const { pack, audit } = assembleGamePack({ category, seed, n: 4 })
      assert.equal(audit.certified, true, `${category} ${seed}`)
      assert.equal(verifyGame(pack, audit.solution).complete, true, `${category} ${seed}`)
      const start = pack.cells.map((cell) => cell.value)
      assert.equal(
        verifyGame(pack, start).complete,
        false,
        `${category} ${seed} starts solved`
      )
      assertSurface(pack, `${category} seed ${seed}`)
    }
  }
  console.log("game validity ok")
} finally {
  await cleanup()
}

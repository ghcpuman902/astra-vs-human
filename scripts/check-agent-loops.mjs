import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { loadGameRuntime } from "./load-game-runtime.mjs"

const runtime = await loadGameRuntime("agent-loops")
const {
  createBattleGround,
  decideGameLearner,
  createGameLearnerRunner,
  learnerMixIds,
  interpretPolicy,
  dispatchMix,
  cleanup,
} = runtime

const fingerprint = (board) =>
  board.cells.map((cell) => `${cell.value}:${cell.selected ? 1 : 0}`).join("|")

const firstOpen = (board) => board.affordances.controls.selectCell[0]

const placementFor = (board, cell, solution) => {
  const target = solution[cell]
  const current = board.cells[cell]?.value
  if (current === target) return null
  return { cell, value: target }
}

function oracleProviders(game) {
  const presses = game.presses ? [...game.presses] : null
  const take = (board, limit) => {
    if (presses) {
      const batch = []
      while (presses.length && batch.length < limit) {
        const cell = presses.shift()
        const live = board.cells[cell]?.value
        batch.push({ cell, value: live === 1 ? 0 : 1 })
      }
      return batch
    }
    const batch = []
    for (const cell of board.affordances.controls.selectCell) {
      const compiled = runtime.compileBoardIntent(board, {
        cell,
        value: game.solution[cell],
      })
      if (!compiled.ok || !compiled.actions.length) continue
      const placement = placementFor(board, cell, game.solution)
      if (!placement) continue
      batch.push(placement)
      if (batch.length >= limit) break
    }
    return batch
  }
  return {
    bare: async (input) => {
      const board = input.board
      const selected = board.cells.find((cell) => cell.selected)
      if (presses?.length) {
        const cell = presses[0]
        if (selected?.index === cell) {
          presses.shift()
          return { type: "cycle" }
        }
        return { type: "selectCell", cell }
      }
      const toward = (cell) => {
        if (board.cells[cell]?.value === game.solution[cell]) return false
        const compiled = runtime.compileBoardIntent(board, {
          cell,
          value: game.solution[cell],
        })
        return compiled.ok && compiled.actions.length > 0
      }
      if (selected && toward(selected.index) && board.affordances.controls.cycle)
        return { type: "cycle" }
      const cell = board.affordances.controls.selectCell.find(toward)
      if (cell === undefined) return "wait"
      return { type: "selectCell", cell }
    },
    plan: async (input) => ({
      placements: take(input.board, 6),
      patternClaim: "Place the next forced cells.",
    }),
    decisions: async (input) => {
      const [placement] = take(input.board, 1)
      if (!placement)
        return { action: null, patternClaim: null, status: "wait" }
      return {
        action: { type: "selectCell", cell: placement.cell },
        placements: [placement],
        patternClaim: "Place the next forced cell.",
        status: "ok",
      }
    },
    policy: async (input) => {
      const [placement] = take(input.board, 1)
      if (!placement)
        return { rule: "named-cells", cells: [], value: null, note: null }
      return {
        rule: "named-cells",
        cells: [placement.cell],
        value: placement.value,
        note: "Place the next forced cell.",
      }
    },
  }
}

function adversarialProviders(mode) {
  const memory = new Map()
  const remembered = (board, build) => {
    const key = fingerprint(board)
    if (!memory.has(key)) memory.set(key, build(board))
    return memory.get(key)
  }
  const firstPlacement = (board) => {
    const cell = firstOpen(board)
    if (cell === undefined) return []
    const value =
      board.affordances.cells[cell]?.options[0] ?? board.cells[cell]?.value ?? null
    return [{ cell, value }]
  }
  let flip = 0
  const bareChoice = (board) => {
    if (mode === "wait") return "wait"
    if (mode === "cycle") return { type: "cycle" }
    if (mode === "ping") {
      flip += 1
      return flip % 2 ? { type: "undo" } : { type: "clear" }
    }
    if (mode === "invalid") return { type: "selectCell", cell: 35 }
    if (mode === "stateless")
      return remembered(board, (live) => {
        const cell = firstOpen(live)
        return cell === undefined ? "wait" : { type: "selectCell", cell }
      })
    const cell = firstOpen(board)
    return cell === undefined ? "wait" : { type: "selectCell", cell }
  }
  const planChoice = (board) => {
    if (mode === "stateless") return remembered(board, firstPlacement)
    if (mode === "wait" || mode === "cycle" || mode === "ping" || mode === "invalid")
      return []
    return firstPlacement(board)
  }
  return {
    bare: async (input) => bareChoice(input.board),
    plan: async (input) => ({
      placements: planChoice(input.board),
      patternClaim: null,
    }),
    decisions: async (input) => {
      if (mode === "cycle")
        return { action: { type: "cycle" }, patternClaim: null, status: "ok" }
      if (mode === "ping") {
        flip += 1
        return {
          action: flip % 2 ? { type: "undo" } : { type: "clear" },
          patternClaim: null,
          status: "ok",
        }
      }
      if (mode === "invalid")
        return {
          action: { type: "selectCell", cell: 35 },
          patternClaim: null,
          status: "ok",
        }
      if (mode === "wait")
        return { action: null, patternClaim: null, status: "wait" }
      const [placement] = planChoice(input.board)
      if (!placement)
        return { action: null, patternClaim: null, status: "wait" }
      return {
        action: { type: "selectCell", cell: placement.cell },
        placements: [placement],
        patternClaim: null,
        status: "ok",
      }
    },
    policy: async (input) => {
      const [placement] = planChoice(input.board)
      if (!placement)
        return { rule: "named-cells", cells: [], value: null, note: null }
      return {
        rule: "named-cells",
        cells: [placement.cell],
        value: placement.value,
        note: null,
      }
    },
  }
}

function harness(pack, mix, providers) {
  const battle = createBattleGround([pack], { now: () => 0 })
  const played = []
  const api = battle.actions("learner")
  const tally = { calls: 0, requests: [], visits: new Map() }
  const runner = createGameLearnerRunner({
    observe: () => battle.boardProps("learner"),
    api: {
      selectCell: (cell) => {
        played.push(`select:${cell}`)
        api.selectCell(cell)
      },
      cycle: () => {
        played.push("cycle")
        api.cycle()
      },
      undo: () => {
        played.push("undo")
        api.undo()
      },
      clear: () => {
        played.push("clear")
        api.clear()
      },
    },
    memory: { claims: [], currentClaim: null },
    mix,
    decide: async (request, signal) => {
      tally.calls += 1
      tally.requests.push(request)
      const key = fingerprint(request.board)
      tally.visits.set(key, (tally.visits.get(key) ?? 0) + 1)
      const raw = await dispatchMix(mix, request, providers, signal, {})
      const decision = await decideGameLearner(request, async () => raw, signal)
      if (!decision.policy) return decision
      return {
        ...decision,
        steps: interpretPolicy(decision.policy, request.board),
      }
    },
  })
  return { battle, runner, played, tally }
}

const pingPong = (played) => {
  const kinds = played.map((action) => action.split(":")[0])
  for (let i = 0; i < kinds.length - 2; i++) {
    const slice = kinds.slice(i, i + 3).join(",")
    if (slice === "undo,clear,undo" || slice === "clear,undo,clear") return true
  }
  return false
}

try {
  const { games } = JSON.parse(
    await readFile("fixtures/agent-games/index.json", "utf8")
  )
  assert.equal(games.length, 25)
  assert.ok(games.some((game) => game.id === "summer-moons"))

  for (const game of games) {
    for (const mix of learnerMixIds) {
      const oracle = harness(game.pack, mix, oracleProviders(game))
      for (
        let step = 0;
        step < 280 &&
        oracle.battle.boardProps("learner").status === "playing" &&
        (oracle.runner.reason?.() ?? null) !== "stuck";
        step++
      )
        await oracle.runner.step()
      assert.equal(
        oracle.battle.boardProps("learner").status,
        "finished",
        `oracle ${game.id} ${mix}`
      )
      assert.equal(
        oracle.runner.reason?.() ?? null,
        null,
        `oracle stuck ${game.id} ${mix}`
      )
    }
  }

  const attacks = ["first", "cycle", "wait", "ping", "invalid", "stateless"]
  for (const game of games) {
    for (const mix of learnerMixIds) {
      for (const mode of attacks) {
        const run = harness(game.pack, mix, adversarialProviders(mode))
        for (
          let step = 0;
          step < 36 &&
          run.battle.boardProps("learner").status === "playing" &&
          (run.runner.reason?.() ?? null) !== "stuck";
          step++
        )
          await run.runner.step()
        const label = `${mode} ${game.id} ${mix}`
        assert.equal(run.runner.reason?.() ?? null, "stuck", label)
        assert.ok(run.tally.calls <= 24, `${label} calls ${run.tally.calls}`)
        assert.ok(
          Math.max(...run.tally.visits.values()) <= 3,
          `${label} repeated a board`
        )
        assert.equal(pingPong(run.played), false, label)
        assert.ok(
          run.battle.boardProps("learner").actions < 80,
          `${label} taps ${run.battle.boardProps("learner").actions}`
        )
      }
    }
  }

  const summer = games.find((game) => game.id === "summer-moons")
  const jev = harness(
    summer.pack,
    "jev-bare",
    adversarialProviders("stateless")
  )
  for (
    let step = 0;
    step < 36 && (jev.runner.reason?.() ?? null) !== "stuck";
    step++
  )
    await jev.runner.step()
  assert.equal(jev.runner.reason?.() ?? null, "stuck", "summer moons jev")
  assert.ok(
    jev.tally.requests.some((request) => request.recent?.length),
    "bare mix saw prior taps"
  )
  const repeated = jev.tally.requests.find((request, index) => {
    if (!index) return false
    const cell = firstOpen(jev.tally.requests[0].board)
    return (
      cell !== undefined &&
      !request.board.affordances.controls.selectCell.includes(cell)
    )
  })
  assert.ok(repeated, "repeated first cell was dropped from the next question")
  console.log(`agent loops ok (${games.length} games, ${learnerMixIds.length} mixes)`)
} finally {
  await cleanup()
}

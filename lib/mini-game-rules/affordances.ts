import {
  pathCandidates,
  rotatePorts,
  type GameState,
} from "./runtime"
import type { GameAction, GamePack } from "./schema"

/** How a cell participates in play. Engine-authored; UI and solver must not re-derive. */
export type CellRole = "open" | "given" | "inert"

export type AffordanceCell = {
  index: number
  role: CellRole
  value: number | null
  selected: boolean
  /** Values this open cell can legally become via counted cycles. Empty for given/inert. */
  options: (number | null)[]
}

export type BoardAffordances = {
  cells: AffordanceCell[]
  controls: {
    selectCell: number[]
    cycle: boolean
    undo: boolean
    clear: boolean
  }
  cycle: {
    alphabet: (number | null)[]
    effect: string
  }
  /** Solver may request setCell intents compiled into counted taps. */
  intents: "setCell"
}

export type CellIntent = {
  cell: number
  value: number | null
}

export type CompileResult =
  | { ok: true; actions: GameAction[] }
  | { ok: false; reason: string }

const CYCLE_EFFECT: Record<GamePack["category"], string> = {
  binary_fill:
    "Cycle visits empty, 0, then 1 on the selected open cell.",
  crown: "Cycle visits empty, mark, then crown on the selected open cell.",
  path_cover:
    "Cycle places the next ascending order one step from an orthogonal numbered neighbour that no other cell holds, then empty.",
  tile_rotate_connect:
    "Cycle turns the tile one distinct orientation clockwise. Symmetric duplicates are skipped.",
  lights_toggle:
    "Cycle flips the selected cell and its orthogonal neighbours.",
  lamp_rays:
    "Cycle visits empty, × pencil, then lamp on the selected open cell. Walls block light.",
  mosaic_count:
    "Cycle visits empty, × pencil, then shaded on the selected cell. Numbered cells can be shaded.",
  tower_sight:
    "Cycle visits empty, then heights 1 up to n, then empty, on the selected open cell.",
}

const isVisible = (pack: GamePack, index: number) =>
  pack.visibility.kind === "full" ||
  pack.visibility.visibleCells.includes(index)

/** True when the pack treats this cell as not part of play (blocked, wall, empty ports). */
export function cellInert(pack: GamePack, index: number): boolean {
  if (pack.category === "crown") return pack.rules.blocked.includes(index)
  if (pack.category === "path_cover") return !pack.rules.active.includes(index)
  if (pack.category === "tile_rotate_connect")
    return pack.rules.ports[index] === 0
  if (pack.category === "lamp_rays") return pack.rules.walls.includes(index)
  return false
}

/** Distinct orientations for a rotate-ports cell, in cycle order. */
export function tileCycleValues(pack: GamePack, cell: number): number[] {
  if (pack.category !== "tile_rotate_connect") return []
  const values = pack.actionSurface.cycleValues.filter(
    (value): value is number => value !== null
  )
  const seen = new Set<number>()
  return values.filter((value) => {
    const mask = rotatePorts(pack.rules.ports[cell], value)
    if (seen.has(mask)) return false
    seen.add(mask)
    return true
  })
}

/**
 * Values reachable from the current value by cycling this cell alone.
 * Order matches the engine reducer. Does not include the current value unless
 * the cycle wraps back to it (then it appears only as a later step).
 */
export function reachableOptions(
  pack: GamePack,
  cells: readonly (number | null)[],
  cell: number
): (number | null)[] {
  if (pack.cells[cell].locked || cellInert(pack, cell)) return []
  if (pack.category === "lights_toggle") {
    const current = cells[cell]
    if (current !== 0 && current !== 1) return [0, 1]
    return [current === 1 ? 0 : 1]
  }
  if (pack.category === "path_cover") {
    const length = pack.actionSurface.cycleValues.length - 1
    const found: (number | null)[] = []
    const sim = [...cells]
    let current = sim[cell]
    for (let step = 0; step < 8; step++) {
      const options = pathCandidates(
        pack.n,
        sim,
        cell,
        length,
        pack.rules.walls
      )
      const next =
        current === null
          ? (options[0] ?? null)
          : (options.find((value) => value > current!) ?? null)
      if (next === current) break
      sim[cell] = next
      current = next
      if (!found.includes(next)) found.push(next)
      if (next === null && found.length > 1) break
    }
    return found
  }
  if (pack.category === "tile_rotate_connect") {
    const unique = tileCycleValues(pack, cell)
    const current = cells[cell]
    if (!unique.length) return []
    const start = unique.indexOf(current ?? unique[0])
    if (start < 0) return [...unique]
    const found: number[] = []
    for (let i = 1; i <= unique.length; i++) {
      const next = unique[(start + i) % unique.length]
      if (!found.includes(next)) found.push(next)
    }
    return found
  }
  const values = pack.actionSurface.cycleValues
  const start = values.indexOf(cells[cell])
  if (start < 0) return [...values]
  const found: (number | null)[] = []
  for (let i = 1; i <= values.length; i++) {
    const next = values[(start + i) % values.length]
    if (!found.includes(next)) found.push(next)
  }
  return found
}

/**
 * Path-only: cycles needed under the ±1 cycle. Used by Zip drag and compileIntent.
 */
export function pathCyclesTo(
  n: number,
  cells: readonly (number | null)[],
  cell: number,
  want: number | null,
  length: number,
  walls?: readonly (readonly [number, number])[]
): number | null {
  if (cells[cell] === want) return 0
  const sim = [...cells]
  for (let cycles = 1; cycles <= 12; cycles++) {
    const current = sim[cell]
    const options = pathCandidates(n, sim, cell, length, walls)
    const next =
      current === null
        ? (options[0] ?? null)
        : (options.find((value) => value > current) ?? null)
    if (next === current) return null
    sim[cell] = next
    if (next === want) return cycles
  }
  return null
}

/**
 * Cycles needed to turn `cell` into `want` under the engine reducer, or null
 * when the value is unreachable in a short bounded walk.
 */
export function cyclesToValue(
  pack: GamePack,
  cells: readonly (number | null)[],
  cell: number,
  want: number | null
): number | null {
  if (cells[cell] === want) return 0
  if (pack.cells[cell].locked || cellInert(pack, cell)) return null
  if (pack.category === "lights_toggle") {
    const current = cells[cell]
    if (want !== 0 && want !== 1) return null
    if (current === want) return 0
    return 1
  }
  if (pack.category === "path_cover")
    return pathCyclesTo(
      pack.n,
      cells,
      cell,
      want,
      pack.actionSurface.cycleValues.length - 1,
      pack.rules.walls
    )
  const sim = [...cells]
  for (let cycles = 1; cycles <= 12; cycles++) {
    if (pack.category === "tile_rotate_connect") {
      const unique = tileCycleValues(pack, cell)
      if (!unique.length) return null
      const at = unique.indexOf(sim[cell] ?? unique[0])
      sim[cell] = unique[(Math.max(0, at) + 1) % unique.length]
    } else {
      const values = pack.actionSurface.cycleValues
      const at = values.indexOf(sim[cell])
      if (at < 0) return null
      sim[cell] = values[(at + 1) % values.length]
    }
    if (sim[cell] === want) return cycles
  }
  return null
}

/** Single authority for what the UI and solver may offer on this board. */
export function describeBoard(
  pack: GamePack,
  state: GameState
): BoardAffordances {
  const cells: AffordanceCell[] = pack.cells.map((cell, index) => {
    const visible = isVisible(pack, index)
    const inert = !visible || cellInert(pack, index)
    const given = visible && cell.locked && !inert
    const role: CellRole = inert ? "inert" : given ? "given" : "open"
    const value = visible ? state.cells[index] : null
    const options =
      role === "open" ? reachableOptions(pack, state.cells, index) : []
    return {
      index,
      role,
      value,
      selected: visible && state.selectedCell === index,
      options,
    }
  })
  const selectCell = cells
    .filter((cell) => cell.role === "open")
    .map((cell) => cell.index)
  const selected = state.selectedCell
  const canCycle =
    selected !== null &&
    isVisible(pack, selected) &&
    !pack.cells[selected].locked &&
    !cellInert(pack, selected) &&
    (pack.category !== "path_cover" ||
      reachableOptions(pack, state.cells, selected).length > 0 ||
      state.cells[selected] !== null)
  const start = pack.cells.map((cell) => cell.value)
  const dirty = state.cells.some((value, index) => value !== start[index])
  return {
    cells,
    controls: {
      selectCell,
      cycle: canCycle,
      undo: state.history.length > 0,
      clear: dirty,
    },
    cycle: {
      alphabet: [...pack.actionSurface.cycleValues],
      effect: CYCLE_EFFECT[pack.category],
    },
    intents: "setCell",
  }
}

/**
 * Compile a solver intent into the same counted select+cycle taps a human
 * would need. Does not search for a solution — only maps a requested value.
 */
export function compileIntent(
  pack: GamePack,
  state: GameState,
  intent: CellIntent
): CompileResult {
  const { cell, value } = intent
  if (!Number.isInteger(cell) || cell < 0 || cell >= pack.n ** 2)
    return { ok: false, reason: "Cell outside board" }
  if (!isVisible(pack, cell))
    return { ok: false, reason: "Hidden cell" }
  if (pack.cells[cell].locked || cellInert(pack, cell))
    return { ok: false, reason: "Cell is not open" }
  const cycles = cyclesToValue(pack, state.cells, cell, value)
  if (cycles === null)
    return { ok: false, reason: "Value unreachable by cycling" }
  if (cycles === 0) return { ok: true, actions: [] }
  const actions: GameAction[] = [{ type: "selectCell", cell }]
  for (let step = 0; step < cycles; step++) actions.push({ type: "cycle" })
  return { ok: true, actions }
}

/** Whether a counted action is offered by the current affordances. */
export function controlAllows(
  affordances: BoardAffordances,
  action: GameAction
): boolean {
  if (action.type === "selectCell")
    return affordances.controls.selectCell.includes(action.cell)
  if (action.type === "cycle") return affordances.controls.cycle
  if (action.type === "undo") return affordances.controls.undo
  return affordances.controls.clear
}

/**
 * Public board slice the learner and UI share. Enough to compile intents
 * without the host-only pack (solution, audit, transfer).
 */
export type BoardView = {
  n: number
  category: GamePack["category"]
  clues: GamePack["rules"]
  actionSurface: GamePack["actionSurface"]
  affordances: BoardAffordances
  cells: readonly {
    index: number
    value: number | null
    locked: boolean
    role: CellRole
    visible: boolean
  }[]
}

/** Compile a setCell intent from the public board the Learner already sees. */
export function compileBoardIntent(
  board: BoardView,
  intent: CellIntent
): CompileResult {
  const { cell, value } = intent
  const target = board.cells[cell]
  if (!target?.visible || target.role !== "open")
    return { ok: false, reason: "Cell is not open" }
  if (!board.affordances.controls.selectCell.includes(cell))
    return { ok: false, reason: "Cell is not selectable" }
  if (target.value === value) return { ok: true, actions: [] }
  const option = board.affordances.cells[cell]?.options
  if (!option?.includes(value))
    return { ok: false, reason: "Value unreachable by cycling" }
  const values = [...board.cells.map((item) => item.value)]
  if (board.category === "lights_toggle") {
    if (value !== 0 && value !== 1)
      return { ok: false, reason: "Value unreachable by cycling" }
    return {
      ok: true,
      actions: [{ type: "selectCell", cell }, { type: "cycle" }],
    }
  }
  if (board.category === "path_cover") {
    const walls = "active" in board.clues ? board.clues.walls : undefined
    const cycles = pathCyclesTo(
      board.n,
      values,
      cell,
      value,
      board.actionSurface.cycleValues.length - 1,
      walls
    )
    if (cycles === null || cycles === 0)
      return cycles === 0
        ? { ok: true, actions: [] }
        : { ok: false, reason: "Value unreachable by cycling" }
    const actions: GameAction[] = [{ type: "selectCell", cell }]
    for (let step = 0; step < cycles; step++) actions.push({ type: "cycle" })
    return { ok: true, actions }
  }
  if (board.category === "tile_rotate_connect") {
    if (!("ports" in board.clues))
      return { ok: false, reason: "Missing ports" }
    const ports = board.clues.ports
    const alphabet = board.actionSurface.cycleValues.filter(
      (item): item is number => item !== null
    )
    const seen = new Set<number>()
    const unique = alphabet.filter((item) => {
      const mask = rotatePorts(ports[cell], item)
      if (seen.has(mask)) return false
      seen.add(mask)
      return true
    })
    const start = unique.indexOf(values[cell] ?? unique[0])
    if (start < 0 || value === null || !unique.includes(value))
      return { ok: false, reason: "Value unreachable by cycling" }
    let cycles = 0
    let at = start
    for (let step = 1; step <= unique.length; step++) {
      at = (at + 1) % unique.length
      cycles++
      if (unique[at] === value) {
        const actions: GameAction[] = [{ type: "selectCell", cell }]
        for (let i = 0; i < cycles; i++) actions.push({ type: "cycle" })
        return { ok: true, actions }
      }
    }
    return { ok: false, reason: "Value unreachable by cycling" }
  }
  const alphabet = board.actionSurface.cycleValues
  const start = alphabet.indexOf(values[cell])
  if (start < 0 || !alphabet.includes(value))
    return { ok: false, reason: "Value unreachable by cycling" }
  let cycles = 0
  let at = start
  for (let step = 1; step <= alphabet.length; step++) {
    at = (at + 1) % alphabet.length
    cycles++
    if (alphabet[at] === value) {
      const actions: GameAction[] = [{ type: "selectCell", cell }]
      for (let i = 0; i < cycles; i++) actions.push({ type: "cycle" })
      return { ok: true, actions }
    }
  }
  return { ok: false, reason: "Value unreachable by cycling" }
}

import type { GameAction, GamePack } from "./schema"

export type GameState = {
  cells: (number | null)[]
  selectedCell: number | null
  history: (number | null)[][]
  actions: number
}
export function initialGameState(pack: GamePack): GameState {
  return {
    cells: pack.cells.map((cell) => cell.value),
    selectedCell: null,
    history: [],
    actions: 0,
  }
}
export function neighbors(cell: number, n: number) {
  const row = Math.floor(cell / n),
    col = cell % n
  return [
    row > 0 ? cell - n : -1,
    col < n - 1 ? cell + 1 : -1,
    row < n - 1 ? cell + n : -1,
    col > 0 ? cell - 1 : -1,
  ].filter((id) => id >= 0)
}
export type Walls = readonly (readonly [number, number])[]
/** True when a wall stands between these two cells. */
export function walled(walls: Walls | undefined, a: number, b: number) {
  return !!walls?.some(
    ([x, y]) => (x === a && y === b) || (x === b && y === a)
  )
}
/**
 * Zip cycle alphabet for one path cell: values one step from an orthogonal
 * numbered neighbour, not across a wall, that no other cell already holds, ascending.
 */
export function pathCandidates(
  n: number,
  cells: readonly (number | null)[],
  cell: number,
  length: number,
  walls?: Walls
) {
  const used = new Set(cells)
  const options = new Set<number>()
  for (const id of neighbors(cell, n)) {
    if (walled(walls, cell, id)) continue
    const value = cells[id]
    if (value === null) continue
    for (const next of [value - 1, value + 1])
      if (next >= 1 && next <= length && !used.has(next)) options.add(next)
  }
  return [...options].sort((a, b) => a - b)
}
/**
 * Lamplight rays: for each open cell, the open cells it sees along its row
 * and column until a wall or the edge, itself first. Walls see nothing.
 */
export function lampSight(n: number, walls: readonly number[]) {
  const wall = new Set(walls)
  return Array.from({ length: n * n }, (_, cell) => {
    if (wall.has(cell)) return []
    const seen = [cell]
    const row = Math.floor(cell / n),
      col = cell % n
    for (const [dr, dc] of [
      [-1, 0],
      [0, 1],
      [1, 0],
      [0, -1],
    ])
      for (
        let r = row + dr, c = col + dc;
        r >= 0 && r < n && c >= 0 && c < n && !wall.has(r * n + c);
        r += dr, c += dc
      )
        seen.push(r * n + c)
    return seen
  })
}
/** Open cells lit by a lamp (value 1) somewhere along their rays. */
export function litCells(
  n: number,
  walls: readonly number[],
  cells: readonly (number | null)[]
) {
  const lit = new Set<number>()
  lampSight(n, walls).forEach((seen, cell) => {
    if (cells[cell] === 1) for (const id of seen) lit.add(id)
  })
  return lit
}
export function rotatePorts(mask: number, turns: number) {
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++)
    mask = ((mask << 1) & 15) | (mask >> 3)
  return mask
}
export type ApplyResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: string; state: GameState }

const reject = (state: GameState, reason: string): ApplyResult => ({
  ok: false,
  reason,
  state,
})

/** Pure shared action reducer. Human and Learner must dispatch through this same reducer. */
export function applyGameAction(
  pack: GamePack,
  state: GameState,
  action: GameAction
): ApplyResult {
  if (action.type === "selectCell") {
    if (
      !Number.isInteger(action.cell) ||
      action.cell < 0 ||
      action.cell >= pack.n ** 2
    )
      return reject(state, "Cell outside board")
    if (
      pack.visibility.kind === "partial" &&
      !pack.visibility.visibleCells.includes(action.cell)
    )
      return reject(state, "Hidden cell")
    if (pack.cells[action.cell].locked)
      return reject(state, "Cell is locked")
    if (
      pack.category === "crown" &&
      pack.rules.blocked.includes(action.cell)
    )
      return reject(state, "Blocked cell")
    if (
      pack.category === "path_cover" &&
      !pack.rules.active.includes(action.cell)
    )
      return reject(state, "Inactive path cell")
    if (
      pack.category === "tile_rotate_connect" &&
      pack.rules.ports[action.cell] === 0
    )
      return reject(state, "Empty tile")
    if (
      pack.category === "lamp_rays" &&
      pack.rules.walls.includes(action.cell)
    )
      return reject(state, "Wall cell")
    return {
      ok: true,
      state: {
        ...state,
        selectedCell: action.cell,
        actions: state.actions + 1,
      },
    }
  }
  if (action.type === "undo") {
    const previous = state.history.at(-1)
    if (!previous) return reject(state, "Nothing to undo")
    return {
      ok: true,
      state: {
        ...state,
        cells: [...previous],
        history: state.history.slice(0, -1),
        actions: state.actions + 1,
      },
    }
  }
  if (action.type === "clear") {
    const start = pack.cells.map((cell) => cell.value)
    const dirty = state.cells.some((value, index) => value !== start[index])
    if (!dirty) return reject(state, "Board already clear")
    // Reset wipes the undo stack so clear↔undo cannot ping-pong as counted taps.
    return {
      ok: true,
      state: {
        ...state,
        cells: start,
        history: [],
        selectedCell: null,
        actions: state.actions + 1,
      },
    }
  }
  const cell = state.selectedCell
  if (cell === null) return reject(state, "No cell selected")
  if (pack.cells[cell].locked) return reject(state, "Selected cell is locked")
  if (
    pack.category === "crown" &&
    pack.rules.blocked.includes(cell)
  )
    return reject(state, "Blocked cell")
  if (
    pack.category === "path_cover" &&
    !pack.rules.active.includes(cell)
  )
    return reject(state, "Inactive path cell")
  if (
    pack.category === "tile_rotate_connect" &&
    pack.rules.ports[cell] === 0
  )
    return reject(state, "Empty tile")
  if (
    pack.category === "lamp_rays" &&
    pack.rules.walls.includes(cell)
  )
    return reject(state, "Wall cell")
  const cells = [...state.cells]
  if (pack.category === "lights_toggle")
    for (const id of [cell, ...neighbors(cell, pack.n)])
      cells[id] = cells[id] === 1 ? 0 : 1
  else {
    const values = pack.actionSurface.cycleValues
    let next = (values.indexOf(cells[cell]) + 1) % values.length
    if (pack.category === "tile_rotate_connect") {
      const seen = new Set<number>()
      const unique = values.filter((value) => {
        const mask = rotatePorts(pack.rules.ports[cell], value ?? 0)
        if (seen.has(mask)) return false
        seen.add(mask)
        return true
      })
      next = (unique.indexOf(cells[cell]) + 1) % unique.length
      cells[cell] = unique[next]
    } else if (pack.category === "path_cover") {
      // ±1 only: never steps through unrelated orders or steals a placed one.
      const current = cells[cell]
      const options = pathCandidates(
        pack.n,
        cells,
        cell,
        values.length - 1,
        pack.rules.walls
      )
      cells[cell] =
        current === null
          ? (options[0] ?? null)
          : (options.find((value) => value > current) ?? null)
      if (cells[cell] === current)
        return reject(state, "No path cycle available")
    } else cells[cell] = values[next]
  }
  return {
    ok: true,
    state: {
      ...state,
      cells,
      history: [...state.history, [...state.cells]],
      actions: state.actions + 1,
    },
  }
}

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
export function rotatePorts(mask: number, turns: number) {
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++)
    mask = ((mask << 1) & 15) | (mask >> 3)
  return mask
}
/** Pure shared action reducer. Human and Learner must dispatch through this same reducer. */
export function applyGameAction(
  pack: GamePack,
  state: GameState,
  action: GameAction
): GameState {
  if (action.type === "selectCell") {
    if (
      !Number.isInteger(action.cell) ||
      action.cell < 0 ||
      action.cell >= pack.n ** 2
    )
      return state
    if (
      pack.visibility.kind === "partial" &&
      !pack.visibility.visibleCells.includes(action.cell)
    )
      return state
    return { ...state, selectedCell: action.cell, actions: state.actions + 1 }
  }
  if (action.type === "undo") {
    const previous = state.history.at(-1)
    return previous
      ? {
          ...state,
          cells: [...previous],
          history: state.history.slice(0, -1),
          actions: state.actions + 1,
        }
      : state
  }
  if (action.type === "clear")
    return {
      ...state,
      cells: pack.cells.map((cell) => cell.value),
      history: [...state.history, [...state.cells]],
      actions: state.actions + 1,
    }
  const cell = state.selectedCell
  if (cell === null || pack.cells[cell].locked) return state
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
      if (cells[cell] === current) return state
    } else cells[cell] = values[next]
  }
  return {
    ...state,
    cells,
    history: [...state.history, [...state.cells]],
    actions: state.actions + 1,
  }
}

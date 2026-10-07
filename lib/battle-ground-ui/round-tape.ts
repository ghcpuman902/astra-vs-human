/**
 * Round history. Every counted change one side made to one board, in order,
 * so the board can be stepped from its starting cells to where it ended.
 * Selection alone is not a step; a select followed by cycles on that cell is
 * one step, so a human tap and an agent's compiled placement each read as one.
 */
export type TapeStep = {
  /** Milliseconds into this side's attempt at the round. */
  at: number
  kind: "tap" | "undo" | "clear"
  /** The cell a tap changed. Null for undo and clear. */
  cell: number | null
  /** Cells this step changed, as [cell, value after the step]. */
  changes: [number, number | null][]
  /** Counted taps on the round after this step. */
  taps: number
  /** Played after the round had already run out of time. */
  overtime?: true
}

/** Steps per side, keyed by round seed. Plain JSON, saved with the match. */
export type RoundTapes = Record<string, readonly TapeStep[]>

/** Past this many steps a round stops recording; the board itself plays on. */
export const TAPE_LIMIT = 600

export const tapeKey = (seed: number) => String(seed)

/** Cells that differ between two boards, as [cell, value in `after`]. */
export function diffCells(
  before: readonly (number | null)[],
  after: readonly (number | null)[]
): [number, number | null][] {
  const changes: [number, number | null][] = []
  for (let cell = 0; cell < after.length; cell++)
    if (before[cell] !== after[cell]) changes.push([cell, after[cell]])
  return changes
}

/** The board after the first `count` steps, starting from `start`. */
export function cellsAt(
  start: readonly (number | null)[],
  steps: readonly TapeStep[],
  count: number
): (number | null)[] {
  const cells = [...start]
  for (const step of steps.slice(0, Math.max(0, count)))
    for (const [cell, value] of step.changes) cells[cell] = value
  return cells
}

/**
 * Add one counted change to a tape. A cycle on the same selected cell as the
 * previous step folds into it, so one tap never replays as flicker.
 */
export function appendStep(
  steps: readonly TapeStep[],
  step: TapeStep,
  foldIntoLast: boolean
): readonly TapeStep[] {
  const last = steps.at(-1)
  if (
    foldIntoLast &&
    last &&
    last.kind === "tap" &&
    step.kind === "tap" &&
    last.cell === step.cell &&
    Boolean(last.overtime) === Boolean(step.overtime)
  ) {
    const merged = new Map(last.changes)
    for (const [cell, value] of step.changes) merged.set(cell, value)
    return [...steps.slice(0, -1), { ...step, changes: [...merged.entries()] }]
  }
  if (steps.length >= TAPE_LIMIT) return steps
  return [...steps, step]
}

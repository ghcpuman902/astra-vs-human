/**
 * Cell F1 against the authored board.
 * Locked givens are skipped. An empty cell is a miss (recall only).
 * A wrong fill is a miss for both precision and recall.
 * Counts add across boards, then F1 is taken once — micro over cells.
 */

export type CellCounts = {
  tp: number
  fp: number
  fn: number
  open: number
}

export type CellRates = {
  precision: number | null
  recall: number | null
  f1: number | null
}

const EMPTY: CellCounts = { tp: 0, fp: 0, fn: 0, open: 0 }

export function countCells(
  gold: readonly (number | null)[],
  pred: readonly (number | null)[],
  locked: readonly boolean[]
): CellCounts {
  const counts = { ...EMPTY }
  const n = Math.min(gold.length, pred.length, locked.length)
  for (let index = 0; index < n; index++) {
    if (locked[index]) continue
    const truth = gold[index]
    if (truth == null) continue
    counts.open += 1
    const guess = pred[index]
    if (guess === truth) counts.tp += 1
    else {
      counts.fn += 1
      if (guess != null) counts.fp += 1
    }
  }
  return counts
}

export function addCounts(left: CellCounts, right: CellCounts): CellCounts {
  return {
    tp: left.tp + right.tp,
    fp: left.fp + right.fp,
    fn: left.fn + right.fn,
    open: left.open + right.open,
  }
}

export function rates(counts: CellCounts): CellRates {
  const precision =
    counts.tp + counts.fp === 0 ? null : counts.tp / (counts.tp + counts.fp)
  const recall =
    counts.tp + counts.fn === 0 ? null : counts.tp / (counts.tp + counts.fn)
  if (precision == null || recall == null)
    return { precision, recall, f1: null }
  const total = precision + recall
  return {
    precision,
    recall,
    f1: total === 0 ? 0 : (2 * precision * recall) / total,
  }
}

export function scoreBoards(
  boards: readonly {
    gold: readonly (number | null)[] | undefined
    pred: readonly (number | null)[] | undefined
    locked: readonly boolean[]
  }[]
): CellRates & { scored: number; open: number } {
  let counts = EMPTY
  let scored = 0
  for (const board of boards) {
    if (!board.gold || !board.pred) continue
    if (board.gold.length !== board.pred.length) continue
    counts = addCounts(counts, countCells(board.gold, board.pred, board.locked))
    scored += 1
  }
  return { ...rates(counts), scored, open: counts.open }
}

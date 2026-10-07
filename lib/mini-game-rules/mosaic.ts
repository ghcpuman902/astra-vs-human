// Author-only Mosaic (Fill-a-Pix spirit). A number counts shaded cells in its
// 3×3 block, itself included. Numbers are carved while two human techniques
// still finish the board, then certified by an independent count.

export type MosaicClue = { cell: number; shaded: number }
export type MosaicTechnique = "full-block" | "overlap"
export type MosaicStep = {
  cell: number
  value: 0 | 1
  technique: MosaicTechnique
}
type Mark = 0 | 1 | null

/** The cell and its up-to-eight neighbours, ascending. */
export function mosaicWindow(n: number, cell: number) {
  const row = Math.floor(cell / n),
    col = cell % n
  const ids: number[] = []
  for (let r = row - 1; r <= row + 1; r++)
    for (let c = col - 1; c <= col + 1; c++)
      if (r >= 0 && r < n && c >= 0 && c < n) ids.push(r * n + c)
  return ids
}

/**
 * Human solve: a full or met block decides its unknowns; two overlapping
 * blocks bound their shared cells and decide the cells only one of them owns.
 * Every step is forced, so `solved` also proves the answer is unique.
 */
export function deduceMosaic(
  n: number,
  clues: readonly MosaicClue[],
  start?: readonly Mark[]
) {
  const cells: Mark[] = start
    ? [...start]
    : Array.from({ length: n * n }, () => null)
  const blocks = clues.map((clue) => ({
    ...clue,
    window: mosaicWindow(n, clue.cell),
  }))
  const pairs = blocks.flatMap((a, i) =>
    blocks
      .slice(i + 1)
      .filter((b) => a.window.some((id) => b.window.includes(id)))
      .map((b) => [a, b] as const)
  )
  const steps: MosaicStep[] = []
  let broken = false
  const set = (ids: number[], value: 0 | 1, technique: MosaicTechnique) => {
    let changed = false
    for (const id of ids) {
      if (cells[id] === value) continue
      if (cells[id] !== null) broken = true
      else {
        cells[id] = value
        steps.push({ cell: id, value, technique })
        changed = true
      }
    }
    return changed
  }
  const need = (block: (typeof blocks)[number]) =>
    block.shaded - block.window.filter((id) => cells[id] === 1).length
  const free = (ids: number[]) => ids.filter((id) => cells[id] === null)
  for (let changed = true; changed && !broken; ) {
    changed = false
    for (const block of blocks) {
      const open = free(block.window)
      const left = need(block)
      if (left < 0 || left > open.length) broken = true
      else if (open.length && left === 0) changed = set(open, 0, "full-block")
      else if (open.length && left === open.length)
        changed = set(open, 1, "full-block")
      if (changed || broken) break
    }
    if (changed || broken) continue
    for (const [a, b] of pairs) {
      const openA = free(a.window),
        openB = free(b.window)
      const shared = openA.filter((id) => openB.includes(id))
      const onlyA = openA.filter((id) => !shared.includes(id))
      const onlyB = openB.filter((id) => !shared.includes(id))
      const needA = need(a),
        needB = need(b)
      // Shaded cells in the overlap fit both counts at once.
      const low = Math.max(0, needA - onlyA.length, needB - onlyB.length)
      const high = Math.min(shared.length, needA, needB)
      if (low > high) {
        broken = true
        break
      }
      for (const [only, left] of [
        [onlyA, needA],
        [onlyB, needB],
      ] as const) {
        if (!only.length) continue
        if (left - low === 0) changed = set(only, 0, "overlap") || changed
        else if (left - high === only.length)
          changed = set(only, 1, "overlap") || changed
      }
      if (changed || broken) break
    }
  }
  const solved = !broken && cells.every((value) => value !== null)
  return {
    solved,
    steps,
    solution: cells.map((value) => (value === 1 ? 1 : 0)),
  }
}

/** Plain backtracking over every cell. Stops at `cap` answers. */
export function countMosaicSolutions(
  n: number,
  clues: readonly MosaicClue[],
  cap = 2,
  checkpoint: () => void = () => {}
) {
  const count = n * n
  const blocks = clues.map((clue) => {
    const window = mosaicWindow(n, clue.cell)
    return { shaded: clue.shaded, window, last: Math.max(...window) }
  })
  const touching = Array.from({ length: count }, (_, id) =>
    blocks.filter((block) => block.window.includes(id))
  )
  const cells: Mark[] = Array.from({ length: count }, () => null)
  let found = 0
  const visit = (cell: number) => {
    checkpoint()
    if (found >= cap) return
    if (cell === count) {
      found++
      return
    }
    for (const value of [0, 1] as const) {
      cells[cell] = value
      if (
        touching[cell].every((block) => {
          const shaded = block.window.filter((id) => cells[id] === 1).length
          const open = block.window.filter((id) => cells[id] === null).length
          return (
            shaded <= block.shaded &&
            shaded + open >= block.shaded &&
            (block.last !== cell || shaded === block.shaded)
          )
        })
      )
        visit(cell + 1)
      cells[cell] = null
    }
  }
  visit(0)
  return found
}

function shuffle<T>(values: T[], rng: () => number) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[values[i], values[j]] = [values[j], values[i]]
  }
  return values
}

/**
 * Random shading, every cell numbered, then numbers carved while the human
 * techniques still finish. Boards where overlap barely fires are dealt again,
 * so subtraction does the work rather than full blocks.
 */
export function authorMosaic(
  n: number,
  rng: () => number,
  checkpoint: () => void
) {
  const count = n * n
  const minOverlap = n >= 6 ? 6 : n === 5 ? 4 : 2
  for (let attempt = 0; attempt < 60; attempt++) {
    checkpoint()
    const share = 0.4 + rng() * 0.2
    const shade = Array.from({ length: count }, () => (rng() < share ? 1 : 0))
    let clues: MosaicClue[] = shade.map((_, cell) => ({
      cell,
      shaded: mosaicWindow(n, cell).filter((id) => shade[id]).length,
    }))
    if (!deduceMosaic(n, clues).solved) continue
    for (const clue of shuffle([...clues], rng)) {
      const fewer = clues.filter((item) => item !== clue)
      if (deduceMosaic(n, fewer).solved) clues = fewer
    }
    const solve = deduceMosaic(n, clues)
    const overlap = solve.steps.filter(
      (step) => step.technique === "overlap"
    ).length
    if (overlap < minOverlap) continue
    const first = solve.steps[0]
    if (!first) continue
    if (countMosaicSolutions(n, clues, 2, checkpoint) !== 1) continue
    return {
      clues: clues.sort((a, b) => a.cell - b.cell),
      solution: solve.solution,
      foothold: first,
      stats: { overlap, clues: clues.length, steps: solve.steps.length },
    }
  }
  throw new Error("No Mosaic board within budget")
}

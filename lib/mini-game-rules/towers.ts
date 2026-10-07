// Author-only Skyline (Towers spirit). Heights 1..n, once per row and column.
// An edge number counts the towers seen from that side: taller ones hide
// shorter ones behind them. Clues are carved while human techniques still
// finish the board, then certified by an independent count.

export type SightClues = {
  top: (number | null)[]
  bottom: (number | null)[]
  left: (number | null)[]
  right: (number | null)[]
}
export type SightSide = keyof SightClues
export type SightTechnique = "edge" | "last-height" | "line"
export type SightStep = { cell: number; value: number; technique: SightTechnique }

/** Towers seen from the front of a line: each new record height counts. */
export function towersSeen(heights: readonly (number | null)[]) {
  let tallest = 0,
    seen = 0
  for (const height of heights) {
    if (height === null) return null
    if (height > tallest) {
      tallest = height
      seen++
    }
  }
  return seen
}

/** Cells of the line a side clue looks along, nearest the clue first. */
export function sightLine(n: number, side: SightSide, index: number) {
  return Array.from({ length: n }, (_, step) =>
    side === "top"
      ? step * n + index
      : side === "bottom"
        ? (n - 1 - step) * n + index
        : side === "left"
          ? index * n + step
          : index * n + (n - 1 - step)
  )
}

const SIDES: SightSide[] = ["top", "bottom", "left", "right"]

/** Every permutation of 1..n, for the line technique. Small n only. */
function permutations(n: number) {
  const out: number[][] = []
  const visit = (line: number[]) => {
    if (line.length === n) out.push(line)
    else
      for (let v = 1; v <= n; v++) if (!line.includes(v)) visit([...line, v])
  }
  visit([])
  return out
}

/**
 * Human solve on candidate sets. Edge: a clue k keeps heights above
 * n − k + 1 + d out of the cell d steps in, and a 1 puts n beside it.
 * Last height: a cell with one candidate, or a height with one place in its
 * line. Line: keep only heights some full arrangement of that line allows.
 */
export function deduceTowers(
  n: number,
  clues: SightClues,
  givens: readonly (number | null)[],
  allowLine = true
) {
  const all = Array.from({ length: n }, (_, i) => i + 1)
  const options = givens.map((value) => (value === null ? [...all] : [value]))
  const placed: (number | null)[] = givens.map((value) => value)
  const steps: SightStep[] = []
  let broken = false
  const lines = [
    ...all.map((_, r) => all.map((__, c) => r * n + c)),
    ...all.map((_, c) => all.map((__, r) => r * n + c)),
  ]
  const peerList = Array.from({ length: n * n }, (_, cell) =>
    lines
      .filter((line) => line.includes(cell))
      .flat()
      .filter((id) => id !== cell)
  )
  const peers = (cell: number) => peerList[cell]
  const place = (cell: number, value: number, technique: SightTechnique) => {
    if (placed[cell] !== null) return false
    placed[cell] = value
    options[cell] = [value]
    steps.push({ cell, value, technique })
    return true
  }
  const remove = (cell: number, keep: (value: number) => boolean) => {
    const before = options[cell].length
    options[cell] = options[cell].filter(keep)
    if (!options[cell].length) broken = true
    return options[cell].length < before
  }
  // Edge rules hold from the start; apply them once.
  for (const side of SIDES)
    clues[side].forEach((k, index) => {
      if (k === null) return
      sightLine(n, side, index).forEach((cell, d) => {
        if (k === 1 && d === 0) remove(cell, (v) => v === n)
        else remove(cell, (v) => v <= n - k + 1 + d)
      })
    })
  const perms = allowLine ? permutations(n) : []
  // A single left by an elimination is credited to the move that made it.
  let cause: SightTechnique = "edge"
  for (let changed = true; changed && !broken; ) {
    changed = false
    // Bookkeeping: placed heights leave their peers.
    for (let cell = 0; cell < n * n; cell++)
      if (placed[cell] !== null)
        for (const peer of peers(cell))
          if (remove(peer, (v) => v !== placed[cell])) changed = true
    for (let cell = 0; cell < n * n && !broken; cell++)
      if (placed[cell] === null && options[cell].length === 1)
        changed = place(cell, options[cell][0], cause) || changed
    if (changed || broken) continue
    for (const line of lines) {
      for (const value of all) {
        const spots = line.filter((cell) => options[cell].includes(value))
        if (!spots.length) broken = true
        else if (spots.length === 1 && placed[spots[0]] === null)
          changed = place(spots[0], value, "last-height") || changed
      }
      if (changed || broken) break
    }
    if (changed) cause = "last-height"
    if (changed || broken || !allowLine) continue
    for (const side of ["top", "left"] as const)
      for (let index = 0; index < n && !changed; index++) {
        const line = sightLine(n, side, index)
        const front = clues[side][index]
        const back = clues[side === "top" ? "bottom" : "right"][index]
        const fits = perms.filter(
          (perm) =>
            perm.every((v, i) => options[line[i]].includes(v)) &&
            (front === null || towersSeen(perm) === front) &&
            (back === null || towersSeen([...perm].reverse()) === back)
        )
        if (!fits.length) broken = true
        line.forEach((cell, i) => {
          if (remove(cell, (v) => fits.some((perm) => perm[i] === v)))
            changed = true
        })
        if (changed) cause = "line"
      }
  }
  const solved = !broken && placed.every((value) => value !== null)
  return { solved, steps, solution: placed }
}

/**
 * Independent count: rows are whole permutations that already satisfy their
 * own left and right clues and givens; columns are checked as rows stack up.
 */
export function countTowersSolutions(
  n: number,
  clues: SightClues,
  givens: readonly (number | null)[],
  cap = 2,
  checkpoint: () => void = () => {}
) {
  // Any clue k caps the height d steps in at n − k + 1 + d; a 1 needs n.
  const most = Array.from({ length: n * n }, () => n)
  const least = Array.from({ length: n * n }, () => 1)
  for (const side of SIDES)
    clues[side].forEach((k, index) => {
      if (k === null) return
      sightLine(n, side, index).forEach((cell, d) => {
        most[cell] = Math.min(most[cell], n - k + 1 + d)
        if (k === 1 && d === 0) least[cell] = n
      })
    })
  const rows = Array.from({ length: n }, (_, row) =>
    permutations(n).filter(
      (perm) =>
        perm.every(
          (v, col) =>
            (givens[row * n + col] === null || givens[row * n + col] === v) &&
            v <= most[row * n + col] &&
            v >= least[row * n + col]
        ) &&
        (clues.left[row] === null || towersSeen(perm) === clues.left[row]) &&
        (clues.right[row] === null ||
          towersSeen([...perm].reverse()) === clues.right[row])
    )
  )
  const stack: number[][] = []
  let found = 0
  // A column's top clue can be checked on every prefix: never more towers
  // than the clue, and once the tallest is in, the count is final.
  const columnOk = (col: number, done: boolean) => {
    const heights = stack.map((perm) => perm[col])
    if (new Set(heights).size !== heights.length) return false
    const top = clues.top[col]
    if (top !== null) {
      const seen = towersSeen(heights)!
      if (seen > top || (heights.includes(n) && seen !== top)) return false
    }
    const bottom = clues.bottom[col]
    return !done || bottom === null || towersSeen([...heights].reverse()) === bottom
  }
  let nodes = 0
  const visit = () => {
    // Rows are whole permutations, so nodes are cheap; tick the budget lightly.
    if (++nodes % 64 === 0) checkpoint()
    if (found >= cap) return
    if (stack.length === n) {
      found++
      return
    }
    for (const perm of rows[stack.length]) {
      stack.push(perm)
      const done = stack.length === n
      let ok = true
      for (let col = 0; col < n && ok; col++) ok = columnOk(col, done)
      if (ok) visit()
      stack.pop()
    }
  }
  visit()
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
 * A random Latin square, every edge clue shown, then clues carved while the
 * human techniques still finish with no given heights. A board solved by
 * last-height steps alone never reached for the edge, so it is dealt again.
 */
export function authorTowers(
  n: number,
  rng: () => number,
  checkpoint: () => void
) {
  const count = n * n
  for (let attempt = 0; attempt < 40; attempt++) {
    checkpoint()
    const grid: number[] = []
    const fill = (cell: number): boolean => {
      checkpoint()
      if (cell === count) return true
      const row = Math.floor(cell / n),
        col = cell % n
      for (const v of shuffle(
        Array.from({ length: n }, (_, i) => i + 1),
        rng
      )) {
        let clash = false
        for (let i = 0; i < col && !clash; i++) clash = grid[row * n + i] === v
        for (let i = 0; i < row && !clash; i++) clash = grid[i * n + col] === v
        if (clash) continue
        grid[cell] = v
        if (fill(cell + 1)) return true
      }
      return false
    }
    if (!fill(0)) continue
    const clues: SightClues = { top: [], bottom: [], left: [], right: [] }
    for (const side of SIDES)
      for (let index = 0; index < n; index++)
        clues[side][index] = towersSeen(
          sightLine(n, side, index).map((id) => grid[id])
        )
    // Whole-line reasoning is human-sized up to five cells. Past that, the
    // board leans on the edge rule plus a few given heights instead.
    const allowLine = n <= 5
    const givens = Array.from({ length: count }, () => null as number | null)
    const solves = () => deduceTowers(n, clues, givens, allowLine).solved
    if (allowLine && !solves()) continue
    for (const cell of shuffle(
      Array.from({ length: count }, (_, i) => i),
      rng
    )) {
      if (solves()) break
      givens[cell] = grid[cell]
    }
    for (let cell = 0; cell < count; cell++) {
      const keep = givens[cell]
      if (keep === null) continue
      givens[cell] = null
      if (!solves()) givens[cell] = keep
    }
    const slots = shuffle(
      SIDES.flatMap((side) =>
        Array.from({ length: n }, (_, index) => ({ side, index }))
      ),
      rng
    )
    for (const { side, index } of slots) {
      const keep = clues[side][index]
      clues[side][index] = null
      if (!solves()) clues[side][index] = keep
    }
    const solve = deduceTowers(n, clues, givens, allowLine)
    const edgeSteps = solve.steps.filter((step) => step.technique !== "last-height")
    if (!edgeSteps.length) continue
    if (countTowersSolutions(n, clues, givens, 2, checkpoint) !== 1) continue
    const first = solve.steps[0]
    if (!first) continue
    return {
      clues,
      givens,
      solution: grid,
      foothold: first,
      stats: {
        clues: SIDES.reduce(
          (sum, side) => sum + clues[side].filter((k) => k !== null).length,
          0
        ),
        givens: givens.filter((value) => value !== null).length,
        edge: edgeSteps.length,
        steps: solve.steps.length,
      },
    }
  }
  throw new Error("No Skyline board within budget")
}

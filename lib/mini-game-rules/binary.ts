// Author-only binary boards. A seeded random solution, then clues carved away
// while single-rule moves (pair, gap, square, marker, count) still finish it.
import { certify, forcedChain } from "../puzzle/author"
import type { Bit, Cell, Constraint, RulePack } from "../puzzle/types"
import type { BinaryRule } from "./schema"

export type BinaryBoard = {
  constraints: Constraint[]
  cells: Cell[]
  solution: Bit[]
  foothold: { cell: number; value: Bit }
}

function shuffle<T>(values: T[], rng: () => number) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[values[i], values[j]] = [values[j], values[i]]
  }
  return values
}

const linesOf = (n: number) =>
  [0, 1].flatMap((axis) =>
    Array.from({ length: n }, (_, line) =>
      Array.from({ length: n }, (_, i) =>
        axis === 0 ? line * n + i : i * n + line
      )
    )
  )

/** Seeded backtracking over the rule's local bans; balance is checked as it fills. */
function randomSolution(
  n: number,
  rule: BinaryRule,
  rng: () => number
): Bit[] | null {
  const cells: (Bit | null)[] = Array.from({ length: n * n }, () => null)
  const half = n / 2
  const balance = rule !== "tally"
  const fits = (id: number) => {
    const row = Math.floor(id / n),
      col = id % n,
      value = cells[id]
    if (rule === "garden") {
      if (
        row > 0 &&
        col > 0 &&
        cells[id - 1] === value &&
        cells[id - n] === value &&
        cells[id - n - 1] === value
      )
        return false
    } else {
      if (col >= 2 && cells[id - 1] === value && cells[id - 2] === value)
        return false
      if (row >= 2 && cells[id - n] === value && cells[id - 2 * n] === value)
        return false
    }
    if (!balance) return true
    let inRow = 0,
      inCol = 0
    for (let i = 0; i <= col; i++) if (cells[row * n + i] === value) inRow++
    for (let i = 0; i <= row; i++) if (cells[i * n + col] === value) inCol++
    return inRow <= half && inCol <= half
  }
  let budget = 50_000
  const fill = (id: number): boolean => {
    if (id === n * n) return true
    if (--budget < 0) return false
    const first: Bit = rng() < 0.5 ? 0 : 1
    for (const value of [first, (1 - first) as Bit]) {
      cells[id] = value
      if (fits(id) && fill(id + 1)) return true
    }
    cells[id] = null
    return false
  }
  return fill(0) ? (cells as Bit[]) : null
}

export function authorBinary(
  seed: number,
  n: 4 | 5 | 6,
  rule: BinaryRule,
  rng: () => number,
  checkpoint: () => void = () => {}
): BinaryBoard {
  if (rule !== "tally" && n % 2)
    throw new Error(`${rule} needs an even board`)
  const solution = randomSolution(n, rule, rng)
  if (!solution) throw new Error("No binary solution for this seed")
  checkpoint()
  const base: Constraint[] = []
  const lines = linesOf(n)
  for (const cells of lines) {
    if (rule !== "garden")
      for (let i = 0; i < n - 2; i++)
        base.push({
          kind: "no-three",
          cells: [cells[i], cells[i + 1], cells[i + 2]],
        })
    if (rule !== "tally") base.push({ kind: "balance", cells })
  }
  if (rule === "garden")
    for (let row = 0; row < n - 1; row++)
      for (let col = 0; col < n - 1; col++) {
        const id = row * n + col
        base.push({ kind: "no-square", cells: [id, id + 1, id + n, id + n + 1] })
      }
  if (rule === "tally")
    // A count only where it earns its chip: two to four lines, not all of them.
    for (const cells of shuffle([...lines], rng).slice(
      0,
      2 + Math.floor(rng() * 3)
    ))
      base.push({
        kind: "quota",
        cells,
        ones: cells.reduce((sum, id) => sum + solution[id], 0),
      })
  // Markers on any edge, both directions, not only the cell to the right.
  const edges = shuffle(
    Array.from({ length: n * n }, (_, id) => [
      ...(id % n < n - 1 ? [[id, id + 1] as const] : []),
      ...(id + n < n * n ? [[id, id + n] as const] : []),
    ]).flat(),
    rng
  )
  let friends: Constraint[] = edges
    .slice(0, Math.round(n * n * 0.4))
    .map(([a, b]) => ({
      kind: "friend",
      cells: [a, b],
      relation: solution[a] === solution[b] ? "=" : "×",
    }))
  const cells: Cell[] = [...solution]
  const pack = (): RulePack => ({
    seed,
    n,
    mode: "FORCED-CHAIN",
    rulesPostcard: [],
    cells,
    constraints: [...base, ...friends],
    verifierSpec: { version: 1, alphabet: [0, 1], empty: null },
  })
  const solves = () => forcedChain(pack(), checkpoint).complete
  // Givens first, so most of the board is read from markers and rules.
  for (const id of shuffle(
    Array.from({ length: n * n }, (_, i) => i),
    rng
  )) {
    const value = cells[id]
    cells[id] = null
    if (!solves()) cells[id] = value
  }
  for (const friend of shuffle([...friends], rng)) {
    const kept = friends
    friends = friends.filter((item) => item !== friend)
    if (!solves()) friends = kept
  }
  const certificate = certify(pack(), 200_000, checkpoint)
  if (!certificate.unique || !certificate.foothold || !certificate.forcedComplete)
    throw new Error("Binary board failed certification")
  return {
    constraints: [...base, ...friends],
    cells: [...cells],
    solution,
    foothold: certificate.foothold,
  }
}

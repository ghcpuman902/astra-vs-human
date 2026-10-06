// Author-only tools. Never pass this module or its output certificates to L0.
import type { Bit, Cell, Constraint, RulePack } from "./types"
import { constraintPossible, packErrors, verify } from "./verifier"

export type ForcedStep = { cell: number; value: Bit; constraint: number }

export function forcedStep(
  pack: RulePack,
  cells: readonly Cell[]
): ForcedStep | null {
  for (const [constraint, rule] of pack.constraints.entries()) {
    for (const cell of rule.cells) {
      if (cells[cell] !== null) continue
      const possible = ([0, 1] as const).filter((value) => {
        const candidate = [...cells]
        candidate[cell] = value
        return constraintPossible(rule, candidate)
      })
      if (possible.length === 1) return { cell, value: possible[0], constraint }
    }
  }
  return null
}

export function forcedChain(pack: RulePack, checkpoint: () => void = () => {}) {
  const cells = [...pack.cells]
  const steps: ForcedStep[] = []
  let step: ForcedStep | null
  while ((step = forcedStep(pack, cells))) {
    checkpoint()
    cells[step.cell] = step.value
    steps.push(step)
  }
  return { steps, complete: verify(pack, cells).complete }
}

/** Exhaustive author search, bounded at two solutions and a node budget. */
export function certify(
  pack: RulePack,
  nodeCap = 200_000,
  checkpoint: () => void = () => {}
) {
  if (packErrors(pack).length) throw new Error("Invalid pack")
  let nodes = 0
  let solutions = 0
  let exhausted = false
  const visit = (cells: Cell[]) => {
    checkpoint()
    if (solutions >= 2 || exhausted) return
    if (++nodes > nodeCap) {
      exhausted = true
      return
    }
    if (!verify(pack, cells).valid) return
    let step: ForcedStep | null
    while ((step = forcedStep(pack, cells))) {
      checkpoint()
      cells[step.cell] = step.value
      if (!verify(pack, cells).valid) return
    }
    const cell = cells.indexOf(null)
    if (cell < 0) {
      solutions++
      return
    }
    for (const value of [0, 1] as const) {
      const next = [...cells]
      next[cell] = value
      visit(next)
    }
  }
  visit([...pack.cells])
  const chain = forcedChain(pack, checkpoint)
  return {
    unique: !exhausted && solutions === 1,
    solutions,
    exhausted,
    nodes,
    foothold: chain.steps[0] ?? null,
    chainLength: chain.steps.length,
    forcedComplete: chain.complete,
  }
}

function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

/** Seeded Family A recombination. All postcard rules describe visible constraints. */
export function authorPack(
  seed: number,
  n: 4 | 5 | 6,
  checkpoint: () => void = () => {},
  mutation = 0
): RulePack {
  checkpoint()
  const rng = random(seed + Math.imul(mutation, 2654435761))
  const flip = rng() < 0.5 ? 0 : 1
  const reverseRows = rng() < 0.5
  const reverseCols = rng() < 0.5
  const solution: Bit[] = Array.from({ length: n * n }, (_, index) => {
    const r = reverseRows
      ? n - 1 - Math.floor(index / n)
      : Math.floor(index / n)
    const c = reverseCols ? n - 1 - (index % n) : index % n
    return ((Math.floor(r / 2) + Math.floor(c / 2) + r + c + flip) % 2) as Bit
  })
  const constraints: Constraint[] = []
  const rulesPostcard = [
    "Use 0 or 1. No three consecutive equal cells in any row or column.",
    "Cycle: empty → 0 → 1 → empty. Givens are locked.",
  ]
  for (let axis = 0; axis < 2; axis++) {
    for (let line = 0; line < n; line++) {
      const cells = Array.from({ length: n }, (_, i) =>
        axis === 0 ? line * n + i : i * n + line
      )
      for (let i = 0; i < n - 2; i++)
        constraints.push({
          kind: "no-three",
          cells: [cells[i], cells[i + 1], cells[i + 2]],
        })
      const ones = cells.reduce((sum, cell) => sum + solution[cell], 0)
      constraints.push({ kind: "quota", cells, ones })
      rulesPostcard.push(
        `${axis === 0 ? "Row" : "Column"} ${line + 1}: exactly ${ones} ones.`
      )
    }
  }
  for (let cell = 0; cell < n * n; cell++) {
    const neighbor = cell % n < n - 1 ? cell + 1 : cell + n
    if (neighbor >= n * n || rng() > 0.24) continue
    const relation = solution[cell] === solution[neighbor] ? "=" : "×"
    constraints.push({ kind: "friend", cells: [cell, neighbor], relation })
    rulesPostcard.push(
      `Friend ${cell + 1} ${relation} ${neighbor + 1}: ${relation === "=" ? "equal" : "different"}.`
    )
  }
  const pack: RulePack = {
    seed,
    n,
    mode: "FORCED-CHAIN",
    rulesPostcard,
    cells: [...solution],
    constraints,
    verifierSpec: { version: 1, alphabet: [0, 1], empty: null },
  }
  const order = Array.from({ length: n * n }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const cells = [...solution] as Cell[]
  for (const cell of order) {
    checkpoint()
    const value = cells[cell]
    cells[cell] = null
    if (!forcedChain({ ...pack, cells }, checkpoint).complete)
      cells[cell] = value
  }
  const result = { ...pack, cells }
  const certificate = certify(result, 200_000, checkpoint)
  if (
    !certificate.unique ||
    !certificate.foothold ||
    !certificate.forcedComplete
  )
    throw new Error("Pack failed certification")
  return result
}

// Author-only Lamplight (Light Up spirit). Walls block light; numbered walls
// count the lamps on their four sides. Boards are carved while three human
// techniques still finish them, then certified by an independent count.
import { lampSight, neighbors } from "./runtime"

export type LampNumber = { cell: number; lamps: number }
export type LampTechnique = "full-number" | "lonely-viewer" | "lamp-shadow"
export type LampStep = { cell: number; value: 0 | 1; technique: LampTechnique }
type Mark = 0 | 1 | null

/**
 * Human solve: lamp shadow, full number, lonely viewer, to a fixpoint.
 * Every step is forced, so `solved` also proves the answer is unique.
 */
export function deduceLamps(
  n: number,
  walls: readonly number[],
  numbers: readonly LampNumber[],
  start?: readonly Mark[]
) {
  const sight = lampSight(n, walls)
  const wall = new Set(walls)
  const open = sight.flatMap((seen, id) => (seen.length ? [id] : []))
  const sides = numbers.map((clue) => ({
    ...clue,
    around: neighbors(clue.cell, n).filter((id) => !wall.has(id)),
  }))
  const cells: Mark[] = start
    ? [...start]
    : Array.from({ length: n * n }, () => null)
  const steps: LampStep[] = []
  let broken = false
  const set = (cell: number, value: 0 | 1, technique: LampTechnique) => {
    if (cells[cell] === value) return false
    if (cells[cell] !== null) {
      broken = true
      return false
    }
    cells[cell] = value
    steps.push({ cell, value, technique })
    return true
  }
  const lit = (cell: number) => sight[cell].some((id) => cells[id] === 1)
  for (let changed = true; changed && !broken; ) {
    changed = false
    for (const cell of open)
      if (cells[cell] === 1)
        for (const id of sight[cell].slice(1)) {
          if (cells[id] === 1) broken = true
          else changed = set(id, 0, "lamp-shadow") || changed
        }
    if (changed || broken) continue
    for (const clue of sides) {
      const lamps = clue.around.filter((id) => cells[id] === 1).length
      const free = clue.around.filter((id) => cells[id] === null)
      if (lamps > clue.lamps || lamps + free.length < clue.lamps) broken = true
      else if (free.length && lamps === clue.lamps)
        for (const id of free) changed = set(id, 0, "full-number") || changed
      else if (free.length && lamps + free.length === clue.lamps)
        for (const id of free) changed = set(id, 1, "full-number") || changed
      if (changed) break
    }
    if (changed || broken) continue
    for (const cell of open) {
      if (lit(cell)) continue
      const viewers = sight[cell].filter((id) => cells[id] === null)
      if (!viewers.length) broken = true
      else if (viewers.length === 1)
        changed = set(viewers[0], 1, "lonely-viewer") || changed
      if (changed || broken) break
    }
  }
  const solved =
    !broken &&
    open.every(lit) &&
    sides.every(
      (clue) =>
        clue.around.filter((id) => cells[id] === 1).length === clue.lamps
    )
  return {
    solved,
    broken,
    steps,
    solution: cells.map((value, id) =>
      wall.has(id) ? null : value === 1 ? 1 : 0
    ),
  }
}

/** Plain backtracking over open cells. Stops at `cap` answers. */
export function countLampSolutions(
  n: number,
  walls: readonly number[],
  numbers: readonly LampNumber[],
  cap = 2,
  checkpoint: () => void = () => {}
) {
  const sight = lampSight(n, walls)
  const wall = new Set(walls)
  const open = sight.flatMap((seen, id) => (seen.length ? [id] : []))
  const order = new Map(open.map((id, at) => [id, at]))
  // A cell's light and a number's count are final once their last cell is set.
  const lastSeen = open.map((id) =>
    Math.max(...sight[id].map((other) => order.get(other)!))
  )
  const clues = numbers.map((clue) => {
    const around = neighbors(clue.cell, n).filter((id) => !wall.has(id))
    return {
      lamps: clue.lamps,
      around,
      last: around.length ? Math.max(...around.map((id) => order.get(id)!)) : -1,
    }
  })
  if (clues.some((clue) => clue.last < 0 && clue.lamps > 0)) return 0
  const cells: Mark[] = Array.from({ length: n * n }, () => null)
  let found = 0
  const visit = (at: number) => {
    checkpoint()
    if (found >= cap) return
    if (at === open.length) {
      found++
      return
    }
    const cell = open[at]
    for (const value of [1, 0] as const) {
      if (value === 1 && sight[cell].some((id) => cells[id] === 1)) continue
      cells[cell] = value
      const ok =
        clues.every((clue) => {
          if (!clue.around.includes(cell)) return true
          const lamps = clue.around.filter((id) => cells[id] === 1).length
          const free = clue.around.filter((id) => cells[id] === null).length
          return lamps <= clue.lamps && lamps + free >= clue.lamps
        }) &&
        open.every(
          (id, index) =>
            lastSeen[index] !== at || sight[id].some((other) => cells[other] === 1)
        )
      if (ok) visit(at + 1)
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
 * Symmetric walls, a lamp for every dark cell, every wall numbered, then
 * numbers carved while the human techniques still finish. Boards where the
 * lonely viewer barely fires are dealt again, so rays do the work.
 */
export function authorLamp(
  n: number,
  rng: () => number,
  checkpoint: () => void
) {
  const count = n * n
  const minLonely = n >= 6 ? 3 : n === 5 ? 2 : 1
  for (let attempt = 0; attempt < 80; attempt++) {
    checkpoint()
    const target = Math.round(count * (0.2 + rng() * 0.1))
    const wallSet = new Set<number>()
    while (wallSet.size < target) {
      const cell = Math.floor(rng() * count)
      wallSet.add(cell)
      wallSet.add(count - 1 - cell)
    }
    const walls = [...wallSet].sort((a, b) => a - b)
    const sight = lampSight(n, walls)
    const lamps = new Set<number>()
    const lit = new Set<number>()
    for (const cell of shuffle(
      sight.flatMap((seen, id) => (seen.length ? [id] : [])),
      rng
    )) {
      if (lit.has(cell)) continue
      // Any dark cell in view can take the lamp; a dark cell sees no lamp.
      const dark = sight[cell].filter((id) => !lit.has(id))
      const lamp = dark[Math.floor(rng() * dark.length)]
      lamps.add(lamp)
      for (const id of sight[lamp]) lit.add(id)
    }
    let numbers: LampNumber[] = walls.map((cell) => ({
      cell,
      lamps: neighbors(cell, n).filter((id) => lamps.has(id)).length,
    }))
    if (!deduceLamps(n, walls, numbers).solved) continue
    for (const clue of shuffle([...numbers], rng)) {
      const fewer = numbers.filter((item) => item !== clue)
      if (deduceLamps(n, walls, fewer).solved) numbers = fewer
    }
    const solve = deduceLamps(n, walls, numbers)
    const lonely = solve.steps.filter(
      (step) => step.technique === "lonely-viewer"
    ).length
    if (lonely < minLonely) continue
    // The foothold is a move the untouched board already forces.
    const first = solve.steps[0]
    if (!first || first.technique === "lamp-shadow") continue
    if (countLampSolutions(n, walls, numbers, 2, checkpoint) !== 1) continue
    return {
      walls,
      numbers: numbers.sort((a, b) => a.cell - b.cell),
      solution: solve.solution,
      foothold: first,
      stats: {
        lonely,
        numbers: numbers.length,
        walls: walls.length,
        steps: solve.steps.length,
      },
    }
  }
  throw new Error("No Lamplight board within budget")
}

// Author-only assembly. Never include PackAudit in a Learner observation or public response.
import { certify } from "../puzzle/author"
import { authorBinary } from "./binary"
import { authorLamp } from "./lamp"
import { neighbors, rotatePorts, walled } from "./runtime"
import {
  assemblyRequestSchema,
  packSchema,
  type AssemblyRequest,
  type GamePack,
  type PackAudit,
} from "./schema"
import { verifyGame } from "./verifier"

export type AssemblyOptions = { deadlineMs?: number; nodeCap?: number }
function random(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0
    return value / 2 ** 32
  }
}
function shuffle<T>(values: T[], rng: () => number) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[values[i], values[j]] = [values[j], values[i]]
  }
  return values
}

/** Invents from seed and bounded knobs; no atlas or generated executable code. */
export function assembleGamePack(
  input: AssemblyRequest,
  options: AssemblyOptions = {}
): { pack: GamePack; audit: PackAudit } {
  const request = assemblyRequestSchema.parse(input)
  if (request.preferences?.visibility === "partial")
    throw new Error(
      "Partial visibility is typed but not certified by these initial assemblers"
    )
  const { n, seed, category } = request,
    rng = random(seed),
    count = n * n
  const deadline = options.deadlineMs ?? Date.now() + 1500,
    nodeCap = options.nodeCap ?? 100_000
  let nodes = 0
  const checkpoint = () => {
    if (Date.now() >= deadline) throw new Error("Assembly deadline exceeded")
    if (++nodes > nodeCap) throw new Error("Assembly node budget exceeded")
  }
  checkpoint()
  const common = {
    version: 1 as const,
    seed,
    n,
    mode: "FORCED-CHAIN" as const,
    visibility: { kind: "full" as const },
    cells: Array.from({ length: count }, () => ({
      value: null as number | null,
      locked: false,
    })),
    actionSurface: {
      actions: ["selectCell", "cycle", "undo", "clear"] as [
        "selectCell",
        "cycle",
        "undo",
        "clear",
      ],
      cycleValues: [null, 0, 1] as (number | null)[],
      effect: "set-cell" as "set-cell" | "rotate-ports" | "toggle-cross",
    },
    transfer: {
      family: category,
      variant: request.variant ?? `seed-${seed}`,
      friendPatterns: ["Carry a local deduction to the next board."],
      minimumRounds: 3 as const,
    },
    session: {
      targetSeconds: request.preferences?.targetSeconds ?? 60,
      stretchSeconds: 600 as const,
      hints: "practice-only" as const,
    },
  }
  let pack: GamePack, audit: PackAudit
  if (category === "binary_fill") {
    // Tango on even boards; odd boards cannot balance, so they count a few lines.
    const rule = request.preferences?.binaryRule ?? (n % 2 ? "tally" : "tango")
    const authored = authorBinary(seed, n, rule, rng, checkpoint)
    const solution = authored.solution as number[]
    // Carving leaves the minimum; an explicit density adds easy givens back.
    const density = request.preferences?.clueDensity ?? 0
    const cells = authored.cells.map((value, id) => {
      if (value === null && rng() < density / 2) value = solution[id] as 0 | 1
      return { value, locked: value !== null }
    })
    const line =
      rule === "garden"
        ? "No 2×2 block of four equal cells."
        : "No three equal cells side by side in a row or column."
    pack = {
      ...common,
      category,
      rules: {
        constraints: authored.constraints.map((rule) => ({
          ...rule,
          cells: [...rule.cells],
        })),
      } as Extract<GamePack, { category: "binary_fill" }>["rules"],
      cells,
      winPredicate: "satisfy-binary-constraints",
      postcard: {
        goal: "Fill every cell with 0 or 1.",
        rules: [
          line,
          rule === "tally"
            ? "A number beside a line gives its count of ones."
            : "Every row and column holds as many 0s as 1s.",
          "= joins equal neighbours. × joins different ones.",
          "Cycle empty → 0 → 1 → empty. Givens stay fixed.",
        ],
      },
      transfer: {
        ...common.transfer,
        family: `binary-${rule}`,
        friendPatterns:
          rule === "garden"
            ? [
                "Three equal corners of a square force the fourth.",
                "A marker carries a known cell across.",
                "A line with its half filled forces the rest.",
              ]
            : [
                "AA_ forces the other bit.",
                "A_A forces the other bit.",
                rule === "tally"
                  ? "A filled count forces all remaining cells."
                  : "A line with its half filled forces the rest.",
              ],
      },
    }
    const certificate = certify(
      {
        seed,
        n,
        mode: "FORCED-CHAIN",
        rulesPostcard: [],
        constraints: authored.constraints,
        cells: cells.map((cell) => cell.value as 0 | 1 | null),
        verifierSpec: { version: 1, alphabet: [0, 1], empty: null },
      },
      nodeCap,
      checkpoint
    )
    if (!certificate.unique || !certificate.foothold)
      throw new Error("Binary pack lacks a certified foothold")
    audit = {
      certified: true,
      solutionCount: 1,
      solutionMeaning: "Completed binary assignments",
      unique: true,
      nodes,
      foothold: {
        ...certificate.foothold,
        reason: "One visible local constraint allows only this value.",
      },
      solution,
    }
  } else if (category === "crown") {
    const paintRegions = request.preferences?.regions ?? false
    const noDiagonalTouch =
      paintRegions || (request.preferences?.noDiagonalTouch ?? true)
    const permutations: number[][] = []
    const enumerate = (columns: number[]) => {
      checkpoint()
      if (columns.length === n) {
        permutations.push(columns)
        return
      }
      for (const col of shuffle(
        Array.from({ length: n }, (_, i) => i),
        rng
      )) {
        if (
          columns.includes(col) ||
          (noDiagonalTouch &&
            columns.length > 0 &&
            Math.abs(columns.at(-1)! - col) === 1)
        )
          continue
        enumerate([...columns, col])
      }
    }
    enumerate([])
    const chosen = permutations[Math.floor(rng() * permutations.length)]
    if (!chosen) throw new Error("No crown placement")
    const solution = Array.from({ length: count }, (_, id) =>
      chosen[Math.floor(id / n)] === id % n ? 1 : 0
    )
    // Queens: grow one region from each crown, keeping the layout with the
    // fewest answers. Uneven appetites leave small regions that decide first.
    const regions = paintRegions
      ? (() => {
          let best: { owner: number[]; fits: number } | null = null
          for (let attempt = 0; attempt < 48; attempt++) {
            checkpoint()
            const owner = Array.from({ length: count }, () => -1)
            chosen.forEach((col, row) => (owner[row * n + col] = row))
            const appetite = chosen.map(() => 0.25 + rng() * 1.5)
            for (let left = count - n; left > 0; left--) {
              const options = owner.flatMap((region, id) =>
                region < 0
                  ? []
                  : neighbors(id, n)
                      .filter((other) => owner[other] < 0)
                      .map((other) => ({ other, region }))
              )
              let pick = rng() * options.reduce((sum, o) => sum + appetite[o.region], 0)
              const hit =
                options.find((o) => (pick -= appetite[o.region]) <= 0) ??
                options.at(-1)!
              owner[hit.other] = hit.region
            }
            const fits = permutations.filter(
              (cols) =>
                new Set(cols.map((col, row) => owner[row * n + col])).size === n
            ).length
            if (!best || fits < best.fits) best = { owner, fits }
            if (fits === 1) break
          }
          return best!.owner
        })()
      : null
    const blocked = regions
      ? []
      : Array.from({ length: count }, (_, id) => id).filter(
          (id) =>
            solution[id] === 0 &&
            rng() < (request.preferences?.clueDensity ?? 0.4)
        )
    const cells = common.cells.map((cell, id) =>
      blocked.includes(id) ? { value: 0, locked: true } : cell
    )
    let legal = permutations.filter(
      (cols) =>
        cols.every((col, row) => !blocked.includes(row * n + col)) &&
        (!regions ||
          new Set(cols.map((col, row) => regions[row * n + col])).size === n)
    )
    for (const row of shuffle(
      Array.from({ length: n }, (_, i) => i),
      rng
    )) {
      if (legal.length === 1) break
      const id = row * n + chosen[row]
      cells[id] = { value: 1, locked: true }
      legal = legal.filter((cols) => cols[row] === chosen[row])
    }
    // A row, column or region left with one legal cell is the visible foothold.
    const placed = cells.flatMap((cell, id) =>
      cell.locked && cell.value === 1 ? [id] : []
    )
    const rowOf = (id: number) => Math.floor(id / n)
    const colOf = (id: number) => id % n
    const free = Array.from({ length: count }, (_, id) => id).filter(
      (id) =>
        !blocked.includes(id) &&
        !placed.some(
          (crown) =>
            rowOf(crown) === rowOf(id) ||
            colOf(crown) === colOf(id) ||
            (regions && regions[crown] === regions[id]) ||
            (noDiagonalTouch &&
              Math.abs(rowOf(crown) - rowOf(id)) === 1 &&
              Math.abs(colOf(crown) - colOf(id)) === 1)
        )
    )
    const groups = [
      ...Array.from({ length: n }, (_, line) => ({
        name: "row",
        has: (id: number) => rowOf(id) === line,
      })),
      ...Array.from({ length: n }, (_, line) => ({
        name: "column",
        has: (id: number) => colOf(id) === line,
      })),
      ...(regions
        ? Array.from({ length: n }, (_, region) => ({
            name: "region",
            has: (id: number) => regions[id] === region,
          }))
        : []),
    ]
    const lone = groups
      .filter((group) => !placed.some(group.has))
      .map((group) => ({ group, spots: free.filter(group.has) }))
      .find((item) => item.spots.length === 1)
    const forced = !!lone
    const foothold = lone && {
      cell: lone.spots[0],
      value: 1,
      reason: `Only one cell remains legal in this ${lone.group.name} after blocked cells and placed crowns.`,
    }
    pack = {
      ...common,
      category,
      mode: forced ? "FORCED-CHAIN" : "BRANCHY",
      cells,
      rules: { blocked, noDiagonalTouch, ...(regions ? { regions } : {}) },
      winPredicate: "one-crown-per-row-column",
      postcard: regions
        ? {
            goal: "Place one crown in every row, column and colour region.",
            rules: [
              "Crowns cannot touch, not even diagonally.",
              "Cycle empty → mark empty → crown → empty. Givens stay fixed.",
            ],
          }
        : {
            goal: "Place one crown in every row and column.",
            rules: [
              "Blocked cells cannot hold crowns.",
              ...(noDiagonalTouch ? ["Crowns cannot touch diagonally."] : []),
              "Cycle empty → mark empty → crown → empty. Givens stay fixed.",
            ],
          },
      transfer: {
        ...common.transfer,
        family: regions
          ? "crown-regions"
          : noDiagonalTouch
            ? "crown-nontouch"
            : "crown-columns",
        friendPatterns: regions
          ? [
              "A region squeezed into one row claims that row.",
              "A crown removes the eight cells around it.",
              "The smallest region decides first.",
            ]
          : [
              "A placed crown removes its column from every other row.",
              ...(noDiagonalTouch
                ? ["A crown removes the two diagonal neighbor cells."]
                : []),
              "A row with one legal spot forces a crown.",
            ],
      },
    }
    audit = {
      certified: true,
      solutionCount: legal.length,
      solutionMeaning: "Crown placements; empty pencil marks are ignored",
      unique: legal.length === 1,
      nodes,
      foothold: foothold || null,
      solution,
    }
  } else if (category === "path_cover") {
    const requested = request.preferences?.pathLength
    // Zip: a seeded route covers the whole board unless a shorter corridor is asked for.
    const walk = () => {
      const path = [Math.floor(rng() * count)]
      while (path.length < requested!) {
        checkpoint()
        const next = shuffle(
          neighbors(path.at(-1)!, n).filter((id) => !path.includes(id)),
          rng
        )[0]
        if (next === undefined) break
        path.push(next)
      }
      return path
    }
    const holes = requested ? 0 : (request.preferences?.holes ?? 0)
    const wallBudget = requested ? 0 : (request.preferences?.walls ?? 0)
    // Backbite: seeded end rewires of a serpentine, near-uniform over covering
    // routes (Warnsdorff hugged walls and folded into hairpins). Holes are
    // bitten off the tail between rounds of mixing, so they land anywhere.
    const tour = () => {
      let path = Array.from({ length: count }, (_, i) => {
        const row = Math.floor(i / n),
          col = i % n
        return row * n + (row % 2 ? n - 1 - col : col)
      })
      const alive = new Set(path)
      const mix = (moves: number) => {
        for (let move = 0; move < moves; move++) {
          if (move % 64 === 0) checkpoint()
          if (rng() < 0.5) path.reverse()
          const tail = path.at(-1)!
          const choices = neighbors(tail, n).filter(
            (id) => alive.has(id) && id !== path.at(-2)
          )
          if (!choices.length) continue
          const at = path.indexOf(choices[Math.floor(rng() * choices.length)])
          path = [...path.slice(0, at + 1), ...path.slice(at + 1).reverse()]
        }
      }
      mix(count * 20)
      for (let hole = 0; hole < holes; hole++) {
        alive.delete(path.pop()!)
        mix(count * 4)
      }
      return path
    }
    const route = requested ? walk() : tour()
    const walls: [number, number][] = []
    const steps = new Set(
      route.slice(1).map((id, i) => `${Math.min(id, route[i])}:${Math.max(id, route[i])}`)
    )
    // Sorted: route order here would hand the answer to anyone reading the clues.
    const active = [...route].sort((a, b) => a - b),
      open = new Set(active),
      start = route[0],
      end = route.at(-1)!,
      checkpoints = [
        { cell: start, order: 1 },
        { cell: end, order: route.length },
      ]
    const distance = (a: number, b: number) =>
      Math.abs(Math.floor(a / n) - Math.floor(b / n)) +
      Math.abs((a % n) - (b % n))
    const exits = (id: number) =>
      neighbors(id, n).filter(
        (other) => open.has(other) && !walled(walls, id, other)
      )
    // Up to two routes through the public clues; prunes on reach and connectivity.
    const findSolutions = () => {
      const found: number[][] = []
      const orderAt = new Map(
        checkpoints.map((point) => [point.cell, point.order])
      )
      const cellFor = new Map(
        checkpoints.map((point) => [point.order, point.cell])
      )
      const path = [start],
        used = new Set(path)
      const connected = () => {
        const head = path.at(-1)!
        const left = active.length - path.length
        if (!left) return true
        const seen = new Set<number>()
        const pending = exits(head).filter((id) => !used.has(id))
        if (!pending.length) return false
        while (pending.length) {
          const id = pending.pop()!
          if (seen.has(id)) continue
          seen.add(id)
          for (const other of exits(id))
            if (!used.has(other) && !seen.has(other)) pending.push(other)
        }
        return seen.size === left
      }
      const reachable = () => {
        const head = path.at(-1)!
        for (const [order, cell] of cellFor)
          if (order > path.length && distance(head, cell) > order - path.length)
            return false
        return true
      }
      const visit = () => {
        checkpoint()
        if (found.length >= 2) return
        if (path.length === active.length) {
          if (path.at(-1) === end) found.push([...path])
          return
        }
        const order = path.length + 1
        const pinned = cellFor.get(order)
        for (const other of exits(path.at(-1)!)) {
          if (used.has(other)) continue
          if (pinned !== undefined ? other !== pinned : orderAt.has(other))
            continue
          path.push(other)
          used.add(other)
          if (reachable() && connected()) visit()
          path.pop()
          used.delete(other)
        }
      }
      visit()
      return found
    }
    // Cut each rival route until only ours remains. A walled family spends its
    // walls first, on a step the rival takes and ours does not. Pins go where
    // the rival differs, as far in order from other pins as possible, so
    // landmarks spread over the whole route instead of bunching near 1.
    let solutions = findSolutions()
    while (solutions.length > 1) {
      const rival = solutions.find((path) =>
        path.some((id, index) => id !== route[index])
      )!
      const cuts = rival
        .slice(1)
        .map((id, i) => [Math.min(id, rival[i]), Math.max(id, rival[i])] as [number, number])
        .filter(([a, b]) => !steps.has(`${a}:${b}`))
      if (walls.length < wallBudget && cuts.length) {
        walls.push(cuts[Math.floor(rng() * cuts.length)])
      } else {
        const orders = checkpoints.map((point) => point.order)
        const fork = rival
          .map((id, index) => (id !== route[index] ? index : -1))
          .filter((index) => index > 0)
          .reduce(
            (best, index) => {
              const gap = Math.min(
                ...orders.map((order) => Math.abs(order - (index + 1)))
              )
              return gap > best.gap ? { index, gap } : best
            },
            { index: -1, gap: -1 }
          ).index
        checkpoints.push({ cell: route[fork], order: fork + 1 })
      }
      solutions = findSolutions()
    }
    // Keep a visible one-step foothold when a branch remains beside the start.
    // Full-cover boards stay sparse; only corridors get the extra pins.
    const second = route[1]
    const startChoices = () =>
      exits(start).filter(
        (id) =>
          !checkpoints.some((point) => point.cell === id && point.order !== 2)
      )
    if (requested && startChoices().length !== 1) {
      for (const cell of startChoices().filter((id) => id !== second)) {
        if (!checkpoints.some((point) => point.cell === cell))
          checkpoints.push({ cell, order: route.indexOf(cell) + 1 })
      }
    }
    checkpoints.sort((a, b) => a.order - b.order)
    const cells = common.cells.map((cell, id) => {
      const point = checkpoints.find((p) => p.cell === id)
      return point
        ? { value: point.order, locked: true }
        : active.includes(id)
          ? cell
          : { value: null, locked: true }
    })
    const solution = Array.from({ length: count }, (_, id) =>
      active.includes(id) ? route.indexOf(id) + 1 : null
    )
    pack = {
      ...common,
      category,
      cells,
      actionSurface: {
        ...common.actionSurface,
        cycleValues: [
          null,
          ...Array.from({ length: route.length }, (_, i) => i + 1),
        ],
      },
      rules: {
        active,
        start,
        end,
        checkpoints,
        ...(walls.length ? { walls } : {}),
      },
      winPredicate: "orthogonal-numbered-path-cover",
      postcard: {
        goal: `Draw one path from 1 to ${route.length} through every open cell.`,
        rules: [
          walls.length
            ? "Each step moves to an edge neighbour, never through a wall."
            : "Each step moves to an edge neighbour.",
          "Pass the numbered checkpoints in order.",
          requested || holes
            ? "Blocked cells stay empty."
            : "Cover every cell exactly once.",
          "Drag from a number, or tap a cell beside one to add the next.",
        ],
      },
      transfer: {
        ...common.transfer,
        family: walls.length
          ? "path-walls"
          : holes
            ? "path-holes"
            : "path-checkpoints",
        friendPatterns: [
          walls.length
            ? "A cell walled on two sides is a corridor: it links its two open sides."
            : "A corner with only two open neighbors must connect both.",
          "A checkpoint reserves its place in the sequence.",
          holes
            ? "A cell beside holes with one way in must be an endpoint."
            : "A dead end must be a path endpoint.",
        ],
      },
    }
    const forced = !cells[second].locked && startChoices().length === 1
    audit = {
      certified: true,
      solutionCount: 1,
      solutionMeaning: "Ordered paths over the open cells",
      unique: true,
      nodes,
      foothold: forced
        ? {
            cell: second,
            value: 2,
            reason: "Only this neighbor of 1 can carry 2.",
          }
        : null,
      solution,
    }
    if (!forced) pack = { ...pack, mode: "BRANCHY" }
  } else if (category === "tile_rotate_connect") {
    // An induced corridor has no hidden answer clues and a provably unique port arrangement.
    const route = [Math.floor(rng() * count)]
    while (route.length < Math.min(12, count)) {
      checkpoint()
      const choices = shuffle(
        neighbors(route.at(-1)!, n).filter(
          (id) =>
            !route.includes(id) &&
            neighbors(id, n).filter((other) => route.includes(other)).length ===
              1
        ),
        rng
      )
      if (!choices.length) break
      route.push(choices[0])
    }
    const solvedMasks = Array.from({ length: count }, () => 0)
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i],
        b = route[i + 1],
        direction = b === a - n ? 0 : b === a + 1 ? 1 : b === a + n ? 2 : 3
      solvedMasks[a] |= 1 << direction
      solvedMasks[b] |= 1 << ((direction + 2) % 4)
    }
    const rotations = Array.from({ length: count }, () => Math.floor(rng() * 4))
    const ports = solvedMasks.map((mask, id) =>
      rotatePorts(mask, rotations[id])
    )
    const solution = ports.map((mask, id) => {
      for (let value = 0; value < 4; value++)
        if (rotatePorts(mask, value) === solvedMasks[id]) return value
      return 0
    })
    const cells = ports.map((mask) => ({ value: 0, locked: mask === 0 }))
    if (
      cells.every(
        (cell, id) => rotatePorts(ports[id], cell.value) === solvedMasks[id]
      )
    ) {
      const id = route[0]
      ports[id] = rotatePorts(ports[id], 1)
      solution[id] = (solution[id] + 3) % 4
    }
    pack = {
      ...common,
      category,
      cells,
      actionSurface: {
        ...common.actionSurface,
        cycleValues: [0, 1, 2, 3],
        effect: "rotate-ports",
      },
      rules: { ports },
      winPredicate: "all-ports-match-connected",
      postcard: {
        goal: "Rotate the pieces into one connected pipe.",
        rules: [
          "Every port must meet a matching port across an edge.",
          "Ports cannot point into blank cells or outside the board.",
          "Tap cycles the distinct orientations of that tile.",
        ],
      },
      transfer: {
        ...common.transfer,
        family: "pipe-boundaries",
        friendPatterns: [
          "An endpoint beside one pipe must face that neighbor.",
          "Boundary ports point inward.",
          "A matched neighbor fixes the turn of a corner.",
        ],
      },
    }
    audit = {
      certified: true,
      solutionCount: 1,
      solutionMeaning:
        "Physical port configurations; equivalent rotations of straight pieces count once",
      unique: true,
      nodes,
      foothold: {
        cell: route[0],
        value: solution[route[0]],
        reason: "The endpoint has exactly one neighboring pipe tile.",
      },
      solution,
    }
  } else if (category === "lamp_rays") {
    const authored = authorLamp(n, rng, checkpoint)
    const walls = new Set(authored.walls)
    const { foothold } = authored
    pack = {
      ...common,
      category,
      cells: common.cells.map((cell, id) =>
        walls.has(id) ? { value: null, locked: true } : cell
      ),
      rules: { walls: authored.walls, numbers: authored.numbers },
      winPredicate: "every-cell-lit",
      postcard: {
        goal: "Place lamps until every open cell is lit.",
        rules: [
          "A lamp lights its row and column until a wall.",
          "Lamps never light each other.",
          "A number on a wall counts the lamps on its four sides.",
          "Cycle empty → mark empty → lamp → empty. Walls stay fixed.",
        ],
      },
      transfer: {
        ...common.transfer,
        family: "lamp-rays",
        friendPatterns: [
          "A dark cell only one open cell can see takes the lamp there.",
          "A number with exactly as many open sides as it needs fills them all.",
          "A lamp rules out every cell it lights.",
        ],
      },
    }
    audit = {
      certified: true,
      solutionCount: 1,
      solutionMeaning: "Lamp placements; × pencil marks are ignored",
      unique: true,
      nodes,
      foothold: {
        cell: foothold.cell,
        value: foothold.value,
        reason:
          foothold.technique === "lonely-viewer"
            ? "Only this cell can still light a dark cell in its view."
            : foothold.value === 1
              ? "This number needs a lamp on every open side."
              : "This number is already met, so its other sides stay dark.",
      },
      solution: authored.solution,
    }
  } else {
    const initial = Array.from({ length: count }, () => 0),
      presses = shuffle(
        Array.from({ length: count }, (_, i) => i),
        rng
      ).slice(0, request.preferences?.presses ?? Math.max(2, Math.floor(n / 2)))
    for (const cell of presses)
      for (const id of [cell, ...neighbors(cell, n)]) initial[id] ^= 1
    if (initial.every((value) => value === 0))
      for (const id of [0, ...neighbors(0, n)]) initial[id] ^= 1
    // Rank over GF(2). Invertible and nullspace cases are reported separately.
    const matrix = Array.from({ length: count }, (_, row) =>
      Array.from({ length: count }, (_, col) =>
        Number(row === col || neighbors(col, n).includes(row))
      )
    )
    let rank = 0
    for (let col = 0; col < count; col++) {
      checkpoint()
      const pivot = matrix.findIndex((row, id) => id >= rank && row[col] === 1)
      if (pivot < 0) continue
      ;[matrix[rank], matrix[pivot]] = [matrix[pivot], matrix[rank]]
      for (let row = 0; row < count; row++)
        if (row !== rank && matrix[row][col])
          for (let j = col; j < count; j++) matrix[row][j] ^= matrix[rank][j]
      rank++
    }
    const solutionCount = 2 ** (count - rank)
    pack = {
      ...common,
      category,
      mode: solutionCount > 1 ? "MULTI" : "BRANCHY",
      cells: initial.map((value) => ({ value, locked: false })),
      actionSurface: {
        ...common.actionSurface,
        cycleValues: [0, 1],
        effect: "toggle-cross",
      },
      rules: { neighborhood: "orthogonal-cross" },
      winPredicate: "all-lights-off",
      postcard: {
        goal: "Switch every light off.",
        rules: [
          "Tap flips this light and its edge neighbors.",
          "Pressing the same cell twice cancels both presses.",
          "Undo reverses your last tap. Clear restores the starting lights.",
        ],
      },
      transfer: {
        ...common.transfer,
        family: "lights-cross-cancellation",
        friendPatterns: [
          "Two taps on one cell cancel.",
          "Shared neighbors flip twice and cancel.",
          "Corner taps affect three lights; interior taps affect five.",
        ],
      },
    }
    audit = {
      certified: true,
      solutionCount,
      solutionMeaning:
        "Press-parity vectors over GF(2); move order and repeated cancelling taps are ignored. The all-off terminal board is unique.",
      unique: solutionCount === 1,
      nodes,
      foothold: null,
      solution: Array.from({ length: count }, () => 0),
    }
  }
  checkpoint()
  pack = packSchema.parse(pack)
  if (!verifyGame(pack, audit.solution).complete)
    throw new Error("Author solution failed public verifier")
  if (!audit.unique && pack.mode !== "MULTI")
    throw new Error("Multiple solutions require MULTI mode")
  if (pack.mode === "FORCED-CHAIN" && !audit.foothold)
    throw new Error("Forced pack lacks local foothold")
  return { pack, audit: { ...audit, nodes } }
}

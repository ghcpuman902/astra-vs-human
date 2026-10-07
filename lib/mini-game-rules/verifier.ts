import { constraintPossible } from "../puzzle/verifier"
import { lampSight, neighbors, rotatePorts, walled } from "./runtime"
import { mosaicWindow } from "./mosaic"
import { packSchema, type GamePack } from "./schema"
import { sightLine, towersSeen } from "./towers"

export type Verification = {
  valid: boolean
  complete: boolean
  errors: string[]
}
/** Uses public rules only. No saved solution or author certificate is required. */
export function verifyGame(
  pack: GamePack,
  cells: readonly (number | null)[]
): Verification {
  const errors: string[] = []
  if (!packSchema.safeParse(pack).success || cells.length !== pack.n ** 2)
    return {
      valid: false,
      complete: false,
      errors: ["Invalid pack or cell count"],
    }
  if (
    cells.some(
      (value, id) => pack.cells[id].locked && value !== pack.cells[id].value
    )
  )
    errors.push("A locked cell changed")
  if (cells.some((value) => !pack.actionSurface.cycleValues.includes(value)))
    errors.push("Value outside action alphabet")
  if (errors.length) return { valid: false, complete: false, errors }
  let complete = false
  if (pack.category === "binary_fill") {
    if (
      pack.rules.constraints.some(
        (rule) => !constraintPossible(rule, cells as (0 | 1 | null)[])
      )
    )
      errors.push("A binary constraint is broken")
    complete = !cells.includes(null)
  } else if (pack.category === "crown") {
    const crowns = cells.flatMap((value, id) => (value === 1 ? [id] : []))
    if (crowns.some((id) => pack.rules.blocked.includes(id)))
      errors.push("Crown on a blocked cell")
    for (let line = 0; line < pack.n; line++)
      if (
        crowns.filter((id) => Math.floor(id / pack.n) === line).length > 1 ||
        crowns.filter((id) => id % pack.n === line).length > 1
      )
        errors.push("Two crowns share a row or column")
    const regions = pack.rules.regions
    if (
      regions &&
      new Set(crowns.map((id) => regions[id])).size !== crowns.length
    )
      errors.push("Two crowns share a region")
    if (
      pack.rules.noDiagonalTouch &&
      crowns.some((a, i) =>
        crowns
          .slice(i + 1)
          .some(
            (b) =>
              Math.abs(Math.floor(a / pack.n) - Math.floor(b / pack.n)) === 1 &&
              Math.abs((a % pack.n) - (b % pack.n)) === 1
          )
      )
    )
      errors.push("Crowns touch diagonally")
    complete = crowns.length === pack.n
  } else if (pack.category === "path_cover") {
    const { active, start, end, checkpoints } = pack.rules
    if (cells.some((value, id) => !active.includes(id) && value !== null))
      errors.push("Blocked path cell changed")
    const occupied = active.filter((id) => cells[id] !== null)
    const orders = occupied.map((id) => cells[id])
    if (new Set(orders).size !== orders.length)
      errors.push("Path orders repeat")
    if (
      orders.some(
        (value) => value === null || value < 1 || value > active.length
      )
    )
      errors.push("Invalid path order")
    for (const id of occupied) {
      const next = occupied.find(
        (other) => cells[other] === Number(cells[id]) + 1
      )
      if (next !== undefined && !neighbors(id, pack.n).includes(next))
        errors.push("Consecutive path cells must share an edge")
      else if (next !== undefined && walled(pack.rules.walls, id, next))
        errors.push("The path crosses a wall")
    }
    if (
      cells[start] !== 1 ||
      cells[end] !== active.length ||
      checkpoints.some((point) => cells[point.cell] !== point.order)
    )
      errors.push("Path checkpoint changed")
    complete = occupied.length === active.length
  } else if (pack.category === "tile_rotate_connect") {
    const masks = cells.map((value, id) =>
      value === null ? null : rotatePorts(pack.rules.ports[id], value)
    )
    for (let id = 0; id < masks.length; id++) {
      const mask = masks[id]
      if (mask === null) continue
      for (let direction = 0; direction < 4; direction++) {
        const bit = 1 << direction,
          row = Math.floor(id / pack.n),
          col = id % pack.n
        const other =
          direction === 0
            ? row > 0
              ? id - pack.n
              : -1
            : direction === 1
              ? col < pack.n - 1
                ? id + 1
                : -1
              : direction === 2
                ? row < pack.n - 1
                  ? id + pack.n
                  : -1
                : col > 0
                  ? id - 1
                  : -1
        if (other < 0) {
          if (mask & bit) errors.push("Port points outside board")
        } else if (
          masks[other] !== null &&
          Boolean(mask & bit) !==
            Boolean(Number(masks[other]) & (1 << ((direction + 2) % 4)))
        )
          errors.push("Ports do not match")
      }
    }
    const active = masks.flatMap((mask, id) => (mask ? [id] : [])),
      seen = new Set<number>(),
      pending = active.length ? [active[0]] : []
    while (pending.length) {
      const id = pending.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      for (const other of neighbors(id, pack.n)) {
        const direction =
          other === id - pack.n
            ? 0
            : other === id + 1
              ? 1
              : other === id + pack.n
                ? 2
                : 3
        if (Number(masks[id]) & (1 << direction)) pending.push(other)
      }
    }
    complete = !cells.includes(null) && seen.size === active.length
  } else if (pack.category === "lamp_rays") {
    // × marks are pencil only; lamps decide every rule.
    const sight = lampSight(pack.n, pack.rules.walls)
    const lamp = (id: number) => cells[id] === 1
    if (
      sight.some(
        (seen, id) => lamp(id) && seen.slice(1).some((other) => lamp(other))
      )
    )
      errors.push("Two lamps light each other")
    const counts = pack.rules.numbers.map(
      (clue) => neighbors(clue.cell, pack.n).filter(lamp).length - clue.lamps
    )
    if (counts.some((extra) => extra > 0))
      errors.push("A number has too many lamps")
    complete =
      counts.every((extra) => extra === 0) &&
      sight.every((seen) => !seen.length || seen.some(lamp))
  } else if (pack.category === "mosaic_count") {
    // × marks are pencil only; shaded cells decide every count.
    const extra = pack.rules.clues.map(
      (clue) =>
        mosaicWindow(pack.n, clue.cell).filter((id) => cells[id] === 1).length -
        clue.shaded
    )
    if (extra.some((over) => over > 0))
      errors.push("A number has too many shaded cells")
    complete = extra.every((over) => over === 0)
  } else if (pack.category === "tower_sight") {
    const { n } = pack
    for (let line = 0; line < n; line++) {
      const row = cells.slice(line * n, line * n + n).filter((v) => v !== null)
      const col = Array.from({ length: n }, (_, r) => cells[r * n + line]).filter(
        (v) => v !== null
      )
      if (new Set(row).size !== row.length || new Set(col).size !== col.length)
        errors.push("A height repeats in a row or column")
    }
    for (const side of ["top", "bottom", "left", "right"] as const)
      pack.rules[side].forEach((k, index) => {
        const seen = towersSeen(sightLine(n, side, index).map((id) => cells[id]))
        if (k !== null && seen !== null && seen !== k)
          errors.push("An edge number sees the wrong count")
      })
    complete = !cells.includes(null)
  } else complete = cells.every((value) => value === 0)
  return {
    valid: errors.length === 0,
    complete: errors.length === 0 && complete,
    errors,
  }
}

"use client"

import { useRef, useState, type CSSProperties, type PointerEvent } from "react"

import { cellFill, cellGlyph } from "@/components/lovable/marks"
import type { BoardProps } from "@/lib/battle-ground-ui/controller"
import {
  neighbors,
  pathCandidates,
  rotatePorts,
  walled,
  type Walls,
} from "@/lib/mini-game-rules/runtime"

/** Queens paint: one craft hue per region, washed toward the canvas. */
export const REGION_FILLS = [
  "var(--cat-1)",
  "var(--cat-2)",
  "var(--cat-3)",
  "var(--cat-4)",
  "var(--cat-5)",
  "var(--cat-6)",
] as const

type PaperBoardProps = {
  board: BoardProps
  interactive: boolean
  invalidIndex: number | null
  label: string
  onTap: (cell: number) => void
  /** Zip only: select `cell`, then cycle it `cycles` times. Counted like taps. */
  onPathStep?: (cell: number, cycles: number) => void
}

type Trace = {
  pointerId: number
  head: number
  /** +1 draws upward orders, -1 downward. 0 until the first step. */
  direction: 1 | -1 | 0
  cells: (number | null)[]
  moved: boolean
}

const quotaFor = (board: BoardProps, line: number, axis: "row" | "column") => {
  if (!("constraints" in board.clues)) return undefined
  const rule = board.clues.constraints.find(
    (item) =>
      item.kind === "quota" &&
      item.cells.length === board.n &&
      item.cells.every((index) =>
        axis === "row"
          ? Math.floor(index / board.n) === line
          : index % board.n === line
      )
  )
  return rule?.kind === "quota" ? rule.ones : undefined
}

/** Cycles needed to turn `cell` into `want` under the ±1 path cycle, or null. */
function cyclesTo(
  n: number,
  cells: readonly (number | null)[],
  cell: number,
  want: number | null,
  length: number,
  walls?: Walls
) {
  const sim = [...cells]
  for (let cycles = 1; cycles <= 6; cycles++) {
    const current = sim[cell]
    const options = pathCandidates(n, sim, cell, length, walls)
    const next =
      current === null
        ? (options[0] ?? null)
        : (options.find((value) => value > current) ?? null)
    if (next === current) return null
    sim[cell] = next
    if (next === want) return cycles
  }
  return null
}

export const PaperBoard = ({
  board,
  interactive,
  invalidIndex,
  label,
  onTap,
  onPathStep,
}: PaperBoardProps) => {
  const grid = useRef<HTMLDivElement>(null)
  const trace = useRef<Trace | null>(null)
  const swallowClick = useRef(false)
  const [rejected, setRejected] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const [head, setHead] = useState<number | null>(null)
  const n = board.n
  const blocked =
    "blocked" in board.clues ? new Set(board.clues.blocked) : new Set<number>()
  const active = "active" in board.clues ? new Set(board.clues.active) : null
  const walls = "active" in board.clues ? board.clues.walls : undefined
  const regions = "blocked" in board.clues ? board.clues.regions : undefined
  // Heavy edges: region borders for Queens, walls for Zip.
  const fences: Walls = regions
    ? board.cells.flatMap((cell) =>
        [cell.index + 1, cell.index + n]
          .filter(
            (other) =>
              other < n * n &&
              (other === cell.index + n || other % n !== 0) &&
              regions[other] !== regions[cell.index]
          )
          .map((other) => [cell.index, other] as const)
      )
    : (walls ?? [])
  const quotas =
    "constraints" in board.clues
      ? board.clues.constraints.some((rule) => rule.kind === "quota")
      : false
  const friends =
    "constraints" in board.clues
      ? board.clues.constraints.filter((rule) => rule.kind === "friend")
      : []
  const selected = board.cells.find((cell) => cell.selected) ?? null
  const zip = board.category === "path_cover"
  const pathLength = board.actionSurface.cycleValues.length - 1
  const tracing = zip && interactive && !board.readOnly && !!onPathStep
  const segments = zip
    ? board.cells.flatMap((cell) => {
        if (!cell.visible || cell.value === null) return []
        const next = board.cells.find(
          (other) => other.visible && other.value === cell.value! + 1
        )
        if (
          !next ||
          Math.abs(cell.row - next.row) +
            Math.abs(cell.column - next.column) !==
            1
        )
          return []
        return [[cell.index, next.index] as const]
      })
    : []

  const isBlocked = (index: number) => {
    if (blocked.has(index)) return true
    if (active && !active.has(index)) return true
    if (
      board.category === "tile_rotate_connect" &&
      "ports" in board.clues &&
      board.clues.ports[index] === 0
    )
      return true
    return !board.cells[index]?.visible
  }

  const explicit = hover ?? focus
  const lightsPreview = (() => {
    if (board.category !== "lights_toggle") return null
    if (explicit !== null) return isBlocked(explicit) ? null : explicit
    if (selected && !selected.locked && !isBlocked(selected.index))
      return selected.index
    return null
  })()
  const cross =
    lightsPreview !== null
      ? new Set([lightsPreview, ...neighbors(lightsPreview, n)])
      : null

  const maskFor = (index: number, value: number | null) => {
    if (board.category !== "tile_rotate_connect" || !("ports" in board.clues))
      return 0
    return rotatePorts(board.clues.ports[index], value ?? 0)
  }

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: n,
      ArrowUp: -n,
    }
    const delta = step[event.key]
    if (delta === undefined) return
    event.preventDefault()
    const next = index + delta
    if (
      next < 0 ||
      next >= n * n ||
      (Math.abs(delta) === 1 && Math.floor(next / n) !== Math.floor(index / n))
    )
      return
    grid.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus()
  }

  const cellAt = (x: number, y: number) => {
    const rect = grid.current?.getBoundingClientRect()
    if (!rect) return null
    const column = Math.floor(((x - rect.left) / rect.width) * n)
    const row = Math.floor(((y - rect.top) / rect.height) * n)
    if (column < 0 || row < 0 || column >= n || row >= n) return null
    return row * n + column
  }

  const editable = (index: number) =>
    !isBlocked(index) && !board.cells[index].locked

  /** One orthogonal move of the trace head. False stops the drag there. */
  const stepTo = (current: Trace, to: number) => {
    const value = current.cells[current.head]
    const there = current.cells[to]
    if (value === null || isBlocked(to) || walled(walls, current.head, to))
      return false
    const send = (cell: number, want: number | null) => {
      const cycles = cyclesTo(n, current.cells, cell, want, pathLength, walls)
      if (cycles === null) return false
      onPathStep?.(cell, cycles)
      current.cells[cell] = want
      current.moved = true
      return true
    }
    if (there !== null) {
      const delta = there - value
      if (Math.abs(delta) !== 1) return false
      // Pulling off the tip of a chain erases it, as in Zip.
      if (
        current.direction === 0 &&
        editable(current.head) &&
        !neighbors(current.head, n).some(
          (id) =>
            current.cells[id] === value - delta &&
            !walled(walls, current.head, id)
        )
      )
        current.direction = -delta as 1 | -1
      // Back along the line erases the cell being left; forward just follows it.
      if (current.direction !== 0 && delta === -current.direction) {
        if (editable(current.head) && !send(current.head, null)) return false
      } else current.direction = delta as 1 | -1
      current.head = to
      current.moved = true
      return true
    }
    if (!editable(to)) return false
    const used = new Set(current.cells)
    const direction =
      current.direction ||
      (value + 1 <= pathLength && !used.has(value + 1)
        ? 1
        : value - 1 >= 1 && !used.has(value - 1)
          ? -1
          : 0)
    if (!direction || used.has(value + direction)) return false
    if (!send(to, value + direction)) return false
    current.direction = direction
    current.head = to
    return true
  }

  const traceHandlers = tracing
    ? {
        onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
          swallowClick.current = false
          if (trace.current || event.button !== 0) return
          const cell = cellAt(event.clientX, event.clientY)
          if (cell === null || board.cells[cell].value === null) return
          trace.current = {
            pointerId: event.pointerId,
            head: cell,
            direction: 0,
            cells: board.cells.map((item) => item.value),
            moved: false,
          }
          setHead(cell)
        },
        onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
          const current = trace.current
          if (!current || event.pointerId !== current.pointerId) return
          const target = cellAt(event.clientX, event.clientY)
          if (target === null || target === current.head) return
          if (!current.moved) grid.current?.setPointerCapture?.(event.pointerId)
          // Fast swipes skip cells; walk there one edge at a time.
          for (
            let guard = 0;
            guard < n * 2 && current.head !== target;
            guard++
          ) {
            const dr = Math.floor(target / n) - Math.floor(current.head / n)
            const dc = (target % n) - (current.head % n)
            const to =
              Math.abs(dc) >= Math.abs(dr)
                ? current.head + Math.sign(dc)
                : current.head + Math.sign(dr) * n
            if (!stepTo(current, to)) {
              setRejected(to)
              break
            }
          }
          setHead(current.head)
        },
        onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
          const current = trace.current
          if (!current || event.pointerId !== current.pointerId) return
          swallowClick.current = current.moved
          trace.current = null
          setHead(null)
        },
        onPointerCancel: () => {
          trace.current = null
          setHead(null)
        },
      }
    : {}

  return (
    <div
      className="clue-board"
      data-quotas={quotas ? "true" : "false"}
      style={{ "--n": n } as CSSProperties}
    >
      {quotas ? (
        <div className="column-clues" aria-hidden="true">
          {Array.from({ length: n }, (_, line) => (
            <span key={line}>{quotaFor(board, line, "column") ?? ""}</span>
          ))}
        </div>
      ) : null}
      <div
        ref={grid}
        className={`puzzle-grid mg-grid mg-${board.category}`}
        role="group"
        aria-label={label}
        data-tracing={head !== null || undefined}
        data-trace={tracing || undefined}
        onMouseLeave={() => setHover(null)}
        {...traceHandlers}
      >
        {board.cells.map((cell) => {
          const blockedCell = isBlocked(cell.index)
          const fixed = cell.locked && !blockedCell
          return (
            <button
              key={cell.index}
              type="button"
              tabIndex={interactive ? 0 : -1}
              className={`game-cell puzzle-cell mg-cell ${cellFill(board.category, blockedCell ? null : cell.value, blockedCell)}`}
              data-fixed={fixed || undefined}
              data-invalid={
                invalidIndex === cell.index &&
                board.category !== "tile_rotate_connect" &&
                board.category !== "lights_toggle"
                  ? true
                  : undefined
              }
              data-cross={cross?.has(cell.index) || undefined}
              data-selected={(!zip && cell.selected) || undefined}
              data-head={head === cell.index || undefined}
              data-rejected={rejected === cell.index || undefined}
              style={
                regions && cell.value !== 1
                  ? {
                      background: `color-mix(in oklab, ${REGION_FILLS[regions[cell.index] % REGION_FILLS.length]} 34%, var(--canvas))`,
                    }
                  : undefined
              }
              aria-label={`Row ${cell.row + 1}, column ${cell.column + 1}${zip && cell.value !== null ? `, ${cell.value}` : ""}${blockedCell ? ", blocked" : ""}${fixed ? ", fixed" : ""}${cell.selected ? ", selected" : ""}`}
              aria-pressed={cell.selected}
              disabled={!interactive || board.readOnly}
              onAnimationEnd={() => setRejected(null)}
              onMouseEnter={() => setHover(cell.index)}
              onFocus={() => setFocus(cell.index)}
              onBlur={() =>
                setFocus((current) => (current === cell.index ? null : current))
              }
              onClick={() => {
                if (swallowClick.current) {
                  swallowClick.current = false
                  return
                }
                if (!interactive || board.readOnly) return
                if (fixed || blockedCell) {
                  setRejected(cell.index)
                  return
                }
                if (
                  zip &&
                  cell.value === null &&
                  !pathCandidates(
                    n,
                    board.cells.map((item) => item.value),
                    cell.index,
                    pathLength,
                    walls
                  ).length
                ) {
                  // Nothing to number yet: no counted tap, just say so.
                  setRejected(cell.index)
                  return
                }
                onTap(cell.index)
              }}
              onKeyDown={(event) =>
                interactive && handleKeyDown(event, cell.index)
              }
            >
              {zip && !blockedCell ? (
                cell.value !== null ? (
                  <span className={fixed ? "path-gate" : "path-number"}>
                    {cell.value}
                  </span>
                ) : null
              ) : (
                cellGlyph(
                  board.category,
                  cell.value,
                  blockedCell,
                  maskFor(cell.index, cell.value)
                )
              )}
            </button>
          )
        })}
        {friends.map((friend, index) => {
          const [a, b] = friend.cells
          return (
            <span
              key={index}
              className="friend-clue"
              role="img"
              aria-label={
                friend.relation === "="
                  ? "These neighbours match"
                  : "These neighbours differ"
              }
              style={
                {
                  "--cx": ((a % n) + (b % n)) / 2 + 0.5,
                  "--cy": (Math.floor(a / n) + Math.floor(b / n)) / 2 + 0.5,
                } as CSSProperties
              }
            >
              {friend.relation}
            </span>
          )
        })}
        {segments.length > 0 ? (
          <svg
            className="path-lines"
            viewBox={`0 0 ${n} ${n}`}
            aria-hidden="true"
          >
            {segments.map(([from, to]) => (
              <line
                key={`${from}-${to}`}
                x1={(from % n) + 0.5}
                y1={Math.floor(from / n) + 0.5}
                x2={(to % n) + 0.5}
                y2={Math.floor(to / n) + 0.5}
              />
            ))}
          </svg>
        ) : null}
        {fences.length > 0 ? (
          <svg
            className="fence-lines"
            viewBox={`0 0 ${n} ${n}`}
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 2,
              width: "100%",
              height: "100%",
              overflow: "visible",
              pointerEvents: "none",
              stroke: "var(--ink)",
              // Region borders are firm lines; walls read heavier, with round ends.
              strokeWidth: regions ? 0.06 : 0.12,
              strokeLinecap: regions ? "square" : "round",
            }}
          >
            {fences.map(([a, b]) => {
              // The shared edge of two neighbours: vertical if they sit in one row.
              const row = Math.max(Math.floor(a / n), Math.floor(b / n))
              const col = Math.max(a % n, b % n)
              const across = Math.floor(a / n) === Math.floor(b / n)
              return (
                <line
                  key={`${a}-${b}`}
                  x1={col}
                  y1={across ? Math.floor(a / n) : row}
                  x2={across ? col : col + 1}
                  y2={across ? Math.floor(a / n) + 1 : row}
                />
              )
            })}
          </svg>
        ) : null}
      </div>
      {quotas ? (
        <div className="row-clues" aria-hidden="true">
          {Array.from({ length: n }, (_, line) => (
            <span key={line}>{quotaFor(board, line, "row") ?? ""}</span>
          ))}
        </div>
      ) : null}
      {selected && interactive && !zip && !selected.locked ? (
        <span className="sr-only">
          Selected row {selected.row + 1}, column {selected.column + 1}
        </span>
      ) : null}
    </div>
  )
}

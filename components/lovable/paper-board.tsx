"use client"

import { useRef, useState, type CSSProperties } from "react"

import { cellFill, cellGlyph } from "@/components/lovable/marks"
import type { BoardProps } from "@/lib/battle-ground-ui/controller"
import { neighbors, rotatePorts } from "@/lib/mini-game-rules/runtime"

type PaperBoardProps = {
  board: BoardProps
  interactive: boolean
  invalidIndex: number | null
  label: string
  onTap: (cell: number) => void
}

const quotaFor = (
  board: BoardProps,
  line: number,
  axis: "row" | "column"
) => {
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

export const PaperBoard = ({
  board,
  interactive,
  invalidIndex,
  label,
  onTap,
}: PaperBoardProps) => {
  const grid = useRef<HTMLDivElement>(null)
  const [rejected, setRejected] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const n = board.n
  const blocked =
    "blocked" in board.clues ? new Set(board.clues.blocked) : new Set<number>()
  const active = "active" in board.clues ? new Set(board.clues.active) : null
  const quotas =
    "constraints" in board.clues
      ? board.clues.constraints.some((rule) => rule.kind === "quota")
      : false
  const friends =
    "constraints" in board.clues
      ? board.clues.constraints.filter((rule) => rule.kind === "friend")
      : []
  const selected = board.cells.find((cell) => cell.selected) ?? null
  const cross =
    board.category === "lights_toggle" && hover !== null
      ? new Set([hover, ...neighbors(hover, n)])
      : null
  const pathOrder = active?.size ?? 0
  const segments =
    board.category === "path_cover"
      ? board.cells.flatMap((cell) => {
          if (!cell.visible || cell.value === null) return []
          const next = board.cells.find(
            (other) => other.visible && other.value === cell.value! + 1
          )
          if (
            !next ||
            Math.abs(cell.row - next.row) + Math.abs(cell.column - next.column) !==
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
        onMouseLeave={() => setHover(null)}
      >
        {board.cells.map((cell) => {
          const blockedCell = isBlocked(cell.index)
          const fixed = cell.locked && !blockedCell
          const showNext =
            interactive &&
            board.category === "path_cover" &&
            cell.selected &&
            !cell.locked
          const nextLabel =
            cell.value === null
              ? 1
              : cell.value >= pathOrder
                ? "·"
                : cell.value + 1
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
              data-selected={cell.selected || undefined}
              data-rejected={rejected === cell.index || undefined}
              aria-label={`Row ${cell.row + 1}, column ${cell.column + 1}${blockedCell ? ", blocked" : ""}${fixed ? ", fixed" : ""}${cell.selected ? ", selected" : ""}`}
              aria-pressed={cell.selected}
              disabled={!interactive || board.readOnly}
              onAnimationEnd={() => setRejected(null)}
              onMouseEnter={() => setHover(fixed || blockedCell ? null : cell.index)}
              onClick={() => {
                if (!interactive || board.readOnly) return
                if (fixed || blockedCell) {
                  setRejected(cell.index)
                  return
                }
                onTap(cell.index)
              }}
              onKeyDown={(event) =>
                interactive && handleKeyDown(event, cell.index)
              }
            >
              {board.category === "path_cover" && !blockedCell ? (
                <span className="path-number">
                  {cell.value ?? ""}
                  {showNext ? (
                    <small className="next-value">→{nextLabel}</small>
                  ) : null}
                </span>
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
                  "--cy":
                    (Math.floor(a / n) + Math.floor(b / n)) / 2 + 0.5,
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
      </div>
      {quotas ? (
        <div className="row-clues" aria-hidden="true">
          {Array.from({ length: n }, (_, line) => (
            <span key={line}>{quotaFor(board, line, "row") ?? ""}</span>
          ))}
        </div>
      ) : null}
      {selected &&
      interactive &&
      board.category !== "path_cover" &&
      !selected.locked ? (
        <span className="sr-only">
          Selected row {selected.row + 1}, column {selected.column + 1}
        </span>
      ) : null}
    </div>
  )
}

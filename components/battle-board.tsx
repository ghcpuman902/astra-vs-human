"use client"

import type { CSSProperties, ReactNode } from "react"
import type { BoardProps } from "@/lib/battle-ground-ui/controller"
import { rotatePorts } from "@/lib/mini-game-rules/runtime"

type BattleBoardProps = {
  board: BoardProps
  onSelectCycle: (cell: number) => void
}

const ink = "oklch(0.27 0.028 260)"
const blue = "oklch(0.53 0.15 255)"
const gold = "oklch(0.77 0.13 80)"
const directions = ["north", "east", "south", "west"]

function CrownMark() {
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
      <path
        d="M5 10l6 5 5-9 5 9 6-5-3 14H8z"
        fill={gold}
        stroke={ink}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M8 27h16" stroke={ink} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function BinaryMark({ value }: { value: number }) {
  return value === 1 ? (
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
      <circle cx="16" cy="16" r="6" fill={gold} stroke={gold} />
      <path
        d="M16 3v4m0 18v4M3 16h4m18 0h4M7 7l3 3m12 12 3 3M7 25l3-3m12-12 3-3"
        stroke={gold}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
      <path d="M23 22A11 11 0 0110 6a11 11 0 1013 16z" fill={blue} />
    </svg>
  )
}

function PipeMark({ mask }: { mask: number }) {
  return (
    <svg viewBox="0 0 40 40" className="h-full w-full" aria-hidden="true">
      {[1, 2, 4, 8].map((bit, direction) =>
        mask & bit ? (
          <line
            key={bit}
            x1="20"
            y1="20"
            x2={[20, 40, 20, 0][direction]}
            y2={[0, 20, 40, 20][direction]}
            stroke={blue}
            strokeWidth="7"
          />
        ) : null
      )}
      <circle cx="20" cy="20" r="3.5" fill={blue} />
    </svg>
  )
}

function valueDescription(
  board: BoardProps,
  cell: BoardProps["cells"][number]
) {
  if (!cell.visible) return "hidden"
  if (board.category === "lights_toggle")
    return cell.value === 1 ? "light on" : "light off"
  if (board.category === "crown")
    return cell.value === 1
      ? "crown"
      : cell.value === 0
        ? "marked empty"
        : "undecided"
  if (board.category === "tile_rotate_connect" && "ports" in board.clues) {
    const mask = rotatePorts(board.clues.ports[cell.index], cell.value ?? 0)
    return mask === 0
      ? "blank tile"
      : `pipe facing ${directions.filter((_, index) => mask & (1 << index)).join(" and ")}`
  }
  return cell.value === null ? "empty" : String(cell.value)
}

/** Category-specific marks inside the same public board and shared action contract. */
export function BattleBoard({ board, onSelectCycle }: BattleBoardProps) {
  const constraints =
    "constraints" in board.clues ? board.clues.constraints : []
  const quotas = constraints.filter((rule) => rule.kind === "quota")
  const friends = constraints.filter((rule) => rule.kind === "friend")
  const active = "active" in board.clues ? new Set(board.clues.active) : null
  const blocked = "blocked" in board.clues ? new Set(board.clues.blocked) : null
  const selected = board.cells.find((cell) => cell.selected)
  const lightCross =
    board.category === "lights_toggle" && selected
      ? new Set(
          board.cells
            .filter(
              (cell) =>
                Math.abs(cell.row - selected.row) +
                  Math.abs(cell.column - selected.column) <=
                1
            )
            .map((cell) => cell.index)
        )
      : null
  const quotaFor = (line: number, axis: "row" | "column") =>
    quotas.find(
      (rule) =>
        rule.cells.length === board.n &&
        rule.cells.every((index) =>
          axis === "row"
            ? Math.floor(index / board.n) === line
            : index % board.n === line
        )
    )?.ones
  const hasQuotas = quotas.length > 0
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${board.n}, minmax(44px, 1fr))`,
  }
  const pathSegments =
    board.category === "path_cover"
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
          return [{ from: cell, to: next }]
        })
      : []

  return (
    <div className="w-full overflow-x-auto py-2">
      <div
        className="mx-auto w-full max-w-[380px]"
        style={{
          minWidth: board.n * 44 + 4 + (hasQuotas ? 24 : 0),
        }}
      >
        {hasQuotas ? (
          <div
            className="mb-2 grid pr-6 text-center font-mono text-xs text-muted-foreground"
            style={gridStyle}
            aria-label="Column quotas, exact number of ones"
          >
            {Array.from({ length: board.n }, (_, line) => (
              <span
                key={line}
                aria-label={`Column ${line + 1}: ${quotaFor(line, "column")} ones`}
              >
                {quotaFor(line, "column")}
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex items-stretch gap-2">
          <div
            className="relative grid flex-1 border-2"
            style={{ ...gridStyle, borderColor: ink }}
            role="group"
            aria-label={`${board.n} by ${board.n} ${board.category.replaceAll("_", " ")} board`}
          >
            {pathSegments.length > 0 ? (
              <svg
                viewBox="0 0 100 100"
                className="pointer-events-none absolute inset-0 z-10 h-full w-full"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {pathSegments.map(({ from, to }) => (
                  <line
                    key={from.index}
                    x1={((from.column + 0.5) / board.n) * 100}
                    y1={((from.row + 0.5) / board.n) * 100}
                    x2={((to.column + 0.5) / board.n) * 100}
                    y2={((to.row + 0.5) / board.n) * 100}
                    stroke="oklch(0.86 0.06 255)"
                    strokeWidth="2.5"
                  />
                ))}
              </svg>
            ) : null}
            {board.cells.map((cell) => {
              const isBlocked =
                !cell.visible ||
                blocked?.has(cell.index) ||
                (active !== null && !active.has(cell.index)) ||
                (board.category === "tile_rotate_connect" &&
                  "ports" in board.clues &&
                  board.clues.ports[cell.index] === 0)
              const isLit =
                board.category === "lights_toggle" && cell.value === 1
              const fixed = cell.locked && !isBlocked
              let mark: ReactNode = null
              if (!isBlocked && cell.value !== null) {
                if (board.category === "binary_fill")
                  mark = <BinaryMark value={cell.value} />
                else if (board.category === "crown")
                  mark =
                    cell.value === 1 ? (
                      <CrownMark />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                    )
                else if (board.category === "path_cover")
                  mark = (
                    <span
                      className="relative z-20 flex h-8 w-8 items-center justify-center rounded-full bg-background font-mono text-lg font-medium"
                      style={{ color: blue }}
                    >
                      {cell.value}
                    </span>
                  )
                else if (
                  board.category === "tile_rotate_connect" &&
                  "ports" in board.clues
                )
                  mark = (
                    <PipeMark
                      mask={rotatePorts(
                        board.clues.ports[cell.index],
                        cell.value
                      )}
                    />
                  )
                else
                  mark = (
                    <span
                      className={`rounded-full ${isLit ? "h-6 w-6 border-[5px]" : "h-3.5 w-3.5 border-2"}`}
                      style={{
                        borderColor: isLit ? gold : "oklch(0.68 0.018 260)",
                        background: isLit
                          ? "oklch(0.96 0.055 90)"
                          : "transparent",
                      }}
                    />
                  )
              }
              const style: CSSProperties = {
                color: ink,
                background: isBlocked
                  ? "oklch(0.955 0.004 260)"
                  : isLit
                    ? "oklch(0.97 0.035 90)"
                    : lightCross?.has(cell.index)
                      ? "oklch(0.98 0.02 90)"
                      : fixed
                        ? "oklch(0.975 0.008 260)"
                        : "oklch(1 0 0)",
                borderColor: ink,
                borderWidth: 0,
                borderRightWidth: cell.column < board.n - 1 ? 1 : 0,
                borderBottomWidth: cell.row < board.n - 1 ? 1 : 0,
                backgroundImage:
                  isBlocked && board.category === "crown"
                    ? "repeating-linear-gradient(135deg, transparent 0px, transparent 5px, oklch(0.3 0.01 260 / 0.1) 5px, oklch(0.3 0.01 260 / 0.1) 6px)"
                    : undefined,
                boxShadow: cell.selected
                  ? `inset 0 0 0 2px ${blue}`
                  : undefined,
              }
              return (
                <button
                  key={cell.index}
                  type="button"
                  disabled={board.readOnly || cell.locked || !cell.visible}
                  onClick={() => onSelectCycle(cell.index)}
                  aria-label={`Row ${cell.row + 1}, column ${cell.column + 1}: ${isBlocked ? "blocked" : valueDescription(board, cell)}${fixed ? ", locked given" : ""}`}
                  aria-pressed={cell.selected}
                  className="relative flex aspect-square min-h-11 min-w-11 items-center justify-center overflow-hidden rounded-none border outline-none focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-foreground disabled:cursor-default"
                  style={style}
                >
                  {mark}
                  {fixed ? (
                    <span
                      aria-hidden="true"
                      className="absolute top-1 right-1 h-1 w-1 rounded-full bg-muted-foreground/60"
                    />
                  ) : null}
                  {!cell.visible ? (
                    <span
                      aria-hidden="true"
                      className="text-sm text-muted-foreground"
                    >
                      ?
                    </span>
                  ) : null}
                </button>
              )
            })}
            {friends.map((friend, index) => {
              const [a, b] = friend.cells
              return (
                <span
                  key={index}
                  role="img"
                  aria-label={`Cells ${a + 1} and ${b + 1} ${friend.relation === "=" ? "match" : "differ"}`}
                  className="pointer-events-none absolute z-30 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-background font-mono text-xs font-semibold"
                  style={{
                    color: ink,
                    left: `${((((a % board.n) + (b % board.n)) / 2 + 0.5) / board.n) * 100}%`,
                    top: `${(((Math.floor(a / board.n) + Math.floor(b / board.n)) / 2 + 0.5) / board.n) * 100}%`,
                  }}
                >
                  {friend.relation}
                </span>
              )
            })}
          </div>
          {hasQuotas ? (
            <div
              className="grid w-4 shrink-0 text-center font-mono text-xs text-muted-foreground"
              style={{ gridTemplateRows: `repeat(${board.n}, 1fr)` }}
              aria-label="Row quotas, exact number of ones"
            >
              {Array.from({ length: board.n }, (_, line) => (
                <span
                  key={line}
                  className="flex items-center justify-center"
                  aria-label={`Row ${line + 1}: ${quotaFor(line, "row")} ones`}
                >
                  {quotaFor(line, "row")}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {board.category === "binary_fill" ? (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            0 = moon · 1 = sun · edge numbers count suns
          </p>
        ) : null}
        {board.category === "crown" ? (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Dot = marked empty · crown = 1 · hatch = blocked
          </p>
        ) : null}
        {board.category === "lights_toggle" ? (
          <p className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className="h-3 w-3 rounded-full border-[3px]"
              style={{ borderColor: gold }}
            />{" "}
            Bright ring = on
            <span
              aria-hidden="true"
              className="ml-2 h-2.5 w-2.5 rounded-full border"
              style={{ borderColor: ink }}
            />{" "}
            Small ring = off
          </p>
        ) : null}
        {board.category === "path_cover" && selected && !selected.locked ? (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Next tap:{" "}
            {board.actionSurface.cycleValues[
              (board.actionSurface.cycleValues.indexOf(selected.value) + 1) %
                board.actionSurface.cycleValues.length
            ] ?? "empty"}
          </p>
        ) : null}
      </div>
    </div>
  )
}

import { REGION_FILLS } from "@/components/lovable/paper-board"
import { cellInert } from "@/lib/mini-game-rules/affordances"
import { rotatePorts } from "@/lib/mini-game-rules/runtime"
import type { GamePack } from "@/lib/mini-game-rules/schema"

const ARMS = [
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
  [0, 0.5],
] as const

/** Read-only SVG thumbnail of a fresh board: givens only, same craft tokens. */
export function MiniBoard({ pack }: { pack: GamePack }) {
  const n = pack.n
  const lampWalls =
    pack.category === "lamp_rays" ? new Set(pack.rules.walls) : null
  const lampNumbers =
    pack.category === "lamp_rays"
      ? new Map(pack.rules.numbers.map((clue) => [clue.cell, clue.lamps]))
      : null
  const mosaicNumbers =
    pack.category === "mosaic_count"
      ? new Map(pack.rules.clues.map((clue) => [clue.cell, clue.shaded]))
      : null
  const fill = (id: number) => {
    const value = pack.cells[id].value
    if (lampWalls?.has(id)) return "var(--wall)"
    if (pack.category === "tower_sight" && pack.cells[id].locked)
      return "color-mix(in oklab, var(--ink) 9%, var(--canvas))"
    if (cellInert(pack, id)) return "var(--mini-blocked)"
    if (pack.category === "binary_fill" && value !== null)
      return value === 0 ? "var(--cat-2)" : "var(--cat-5)"
    if (pack.category === "lights_toggle" && value === 1) return "var(--cat-2)"
    if (pack.category === "crown" && pack.rules.regions)
      return REGION_FILLS[pack.rules.regions[id] % REGION_FILLS.length]
    return "var(--canvas)"
  }
  const walls = pack.category === "path_cover" ? (pack.rules.walls ?? []) : []
  return (
    <svg
      className="mini-board"
      viewBox={`-0.06 -0.06 ${n + 0.12} ${n + 0.12}`}
      role="img"
      aria-label={`${n} by ${n} board preview`}
    >
      {pack.cells.map((cell, id) => {
        const x = id % n
        const y = Math.floor(id / n)
        const mask =
          pack.category === "tile_rotate_connect"
            ? rotatePorts(pack.rules.ports[id], cell.value ?? 0)
            : 0
        const order =
          pack.category === "path_cover" && cell.locked && cell.value !== null
            ? cell.value
            : null
        return (
          <g key={id} transform={`translate(${x} ${y})`}>
            <rect width={1} height={1} fill={fill(id)} className="mini-cell" />
            {ARMS.map(([ax, ay], bit) =>
              mask & (1 << bit) ? (
                <line
                  key={bit}
                  x1={0.5}
                  y1={0.5}
                  x2={ax}
                  y2={ay}
                  className="mini-pipe"
                />
              ) : null
            )}
            {pack.category === "binary_fill" && cell.value !== null ? (
              <circle
                cx={0.5}
                cy={0.5}
                r={0.28}
                className={cell.value === 0 ? "mini-sun" : "mini-moon"}
              />
            ) : null}
            {pack.category === "lights_toggle" && cell.value === 1 ? (
              <circle cx={0.5} cy={0.5} r={0.2} className="mini-lamp" />
            ) : null}
            {pack.category === "crown" && cell.value === 1 ? (
              <path
                d="M0.22 0.7 0.28 0.4 0.42 0.54 0.5 0.28 0.58 0.54 0.72 0.4 0.78 0.7Z"
                className="mini-crown"
              />
            ) : null}
            {lampNumbers?.has(id) ? (
              <text x={0.5} y={0.5} className="mini-order">
                {lampNumbers.get(id)}
              </text>
            ) : null}
            {mosaicNumbers?.has(id) ? (
              <text x={0.5} y={0.5} className="mini-order mini-count">
                {mosaicNumbers.get(id)}
              </text>
            ) : null}
            {pack.category === "tower_sight" && cell.value !== null ? (
              <text x={0.5} y={0.5} className="mini-order mini-count">
                {cell.value}
              </text>
            ) : null}
            {order !== null ? (
              <>
                <circle cx={0.5} cy={0.5} r={0.3} className="mini-gate" />
                <text x={0.5} y={0.5} className="mini-order">
                  {order}
                </text>
              </>
            ) : null}
          </g>
        )
      })}
      {walls.map(([a, b]) => {
        const across = Math.floor(a / n) === Math.floor(b / n)
        const row = Math.max(Math.floor(a / n), Math.floor(b / n))
        const col = Math.max(a % n, b % n)
        return (
          <line
            key={`${a}-${b}`}
            x1={col}
            y1={across ? Math.floor(a / n) : row}
            x2={across ? col : col + 1}
            y2={across ? Math.floor(a / n) + 1 : row}
            className="mini-frame"
          />
        )
      })}
      <rect
        x={0}
        y={0}
        width={n}
        height={n}
        fill="none"
        className="mini-frame"
      />
    </svg>
  )
}

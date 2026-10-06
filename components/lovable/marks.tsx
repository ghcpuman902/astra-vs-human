import type { CSSProperties, ReactNode } from "react"
import { Crown, Lightbulb, Moon, Sun } from "lucide-react"

import type { GamePack } from "@/lib/mini-game-rules/schema"

type Category = GamePack["category"]
type Mini = {
  v: number | null
  blocked?: boolean
  wrong?: boolean
  mask?: number
  cross?: boolean
}

export const cellGlyph = (
  category: Category,
  value: number | null,
  blocked: boolean,
  mask = 0
) => {
  if (blocked) return null
  if (category === "binary_fill") {
    if (value === null) return null
    return value === 0 ? (
      <Sun className="cell-symbol" />
    ) : (
      <Moon className="cell-symbol" />
    )
  }
  if (category === "crown") {
    if (value === 1) return <Crown className="cell-symbol" />
    if (value === 0) return <span className="pencil-dot" />
    return null
  }
  if (category === "path_cover")
    return <span className="path-number">{value ?? ""}</span>
  if (category === "tile_rotate_connect")
    return mask ? <PipeGlyph mask={mask} /> : null
  return value === 1 ? (
    <Lightbulb className="cell-symbol" />
  ) : (
    <span className="light-off" />
  )
}

export const cellFill = (
  category: Category,
  value: number | null,
  blocked: boolean
) => {
  if (blocked) return "blocked"
  if (category === "binary_fill")
    return value === 0 ? "cat-2" : value === 1 ? "cat-5" : ""
  if (category === "crown") return value === 1 ? "cat-6" : ""
  if (category === "path_cover") return value !== null ? "cat-4" : ""
  if (category === "lights_toggle") return value === 1 ? "cat-2" : ""
  return ""
}

const Strip = ({
  category,
  cells,
  cols,
  ok,
}: {
  category: Category
  cells: Mini[]
  cols?: number
  ok?: boolean
}) => (
  <span
    className="rule-strip"
    style={{ "--cols": cols ?? cells.length } as CSSProperties}
    data-ok={ok || undefined}
  >
    {cells.map((cell, index) => (
      <span
        key={index}
        className={`game-cell mg-cell ${cellFill(category, cell.v, !!cell.blocked)}`}
        data-invalid={cell.wrong || undefined}
        data-cross={cell.cross || undefined}
      >
        {cellGlyph(category, cell.v, !!cell.blocked, cell.mask)}
      </span>
    ))}
  </span>
)

const sun = { v: 0 }
const moon = { v: 1 }
const empty = { v: null }

/** Picture postcards from the newer Lovable gallery. Text only where a strip cannot say it. */
export const postcards: Record<
  Category,
  { goal: ReactNode; rules: ReactNode[] }
> = {
  binary_fill: {
    goal: (
      <>
        Fill every cell <Strip category="binary_fill" cells={[sun]} />{" "}
        <Strip category="binary_fill" cells={[moon]} />
      </>
    ),
    rules: [
      <>
        <Strip
          category="binary_fill"
          cells={[sun, sun, { v: 0, wrong: true }]}
        />{" "}
        never three in a line
      </>,
      <>
        <b className="rule-num">2</b> beside a line counts moons in it
      </>,
      <>
        <Strip category="binary_fill" cells={[sun, sun]} /> <b>=</b>{" "}
        <Strip category="binary_fill" cells={[sun, moon]} /> <b>×</b>
      </>,
    ],
  },
  crown: {
    goal: (
      <>
        One <Strip category="crown" cells={[{ v: 1 }]} /> per row and column
      </>
    ),
    rules: [
      <>
        <Strip category="crown" cells={[{ v: null, blocked: true }]} /> holds
        none
      </>,
      <>
        <Strip
          category="crown"
          cols={2}
          cells={[{ v: 1 }, empty, empty, { v: 1, wrong: true }]}
        />{" "}
        never touching, even corners
      </>,
      <>
        <Strip category="crown" cells={[{ v: 0 }]} /> rules a cell out
      </>,
    ],
  },
  path_cover: {
    goal: <>Number every open cell into one path</>,
    rules: [
      <>
        <Strip category="path_cover" cells={[{ v: 1 }, { v: 2 }, { v: 3 }]} />{" "}
        each next number touches the last
      </>,
      <>
        <Strip category="path_cover" cells={[{ v: null, blocked: true }]} />{" "}
        stays empty
      </>,
    ],
  },
  tile_rotate_connect: {
    goal: (
      <>
        Tap to turn{" "}
        <Strip category="tile_rotate_connect" cells={[{ v: 0, mask: 6 }]} />{" "}
        into one pipe
      </>
    ),
    rules: [
      <>
        <Strip
          category="tile_rotate_connect"
          cells={[
            { v: 0, mask: 2 },
            { v: 0, mask: 10 },
            { v: 0, mask: 8 },
          ]}
          ok
        />{" "}
        every end meets an end
      </>,
      <>
        <Strip
          category="tile_rotate_connect"
          cells={[{ v: 0, mask: 2 }, { v: null, blocked: true }]}
        />{" "}
        no end into a blank or the edge
      </>,
    ],
  },
  lights_toggle: {
    goal: (
      <>
        Turn every <Strip category="lights_toggle" cells={[moon]} /> into{" "}
        <Strip category="lights_toggle" cells={[sun]} />
      </>
    ),
    rules: [
      <>
        <Strip
          category="lights_toggle"
          cols={3}
          cells={[
            sun,
            { v: 1, cross: true },
            sun,
            { v: 1, cross: true },
            { v: 1, cross: true },
            { v: 1, cross: true },
            sun,
            { v: 1, cross: true },
            sun,
          ]}
        />{" "}
        a tap flips the cross
      </>,
    ],
  },
}

const PipeGlyph = ({ mask }: { mask: number }) => {
  const arms = [
    [50, 0],
    [100, 50],
    [50, 100],
    [0, 50],
  ] as const
  return (
    <svg viewBox="0 0 100 100" className="pipe-glyph" aria-hidden="true">
      {arms.map(([x, y], bit) =>
        mask & (1 << bit) ? (
          <line key={bit} x1={50} y1={50} x2={x} y2={y} />
        ) : null
      )}
      {[1, 2, 4, 8].includes(mask) ? <circle cx={50} cy={50} r={14} /> : null}
    </svg>
  )
}

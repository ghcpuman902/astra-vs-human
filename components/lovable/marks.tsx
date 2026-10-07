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
  /** Lamplight: a numbered wall, or an open cell in a lamp's light. Mosaic: a clue on an open cell. */
  num?: number
  lit?: boolean
}

export const cellGlyph = (
  category: Category,
  value: number | null,
  blocked: boolean,
  mask = 0,
  /** Skyline: the tallest height, for the bar under each number. */
  tallest = 5
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
  if (category === "lamp_rays") {
    if (value === 1) return <Lightbulb className="cell-symbol" />
    if (value === 0) return <span className="pencil-dot" />
    return null
  }
  if (category === "mosaic_count")
    return value === 0 ? <span className="pencil-dot" /> : null
  if (category === "tower_sight")
    return value === null ? null : (
      <span className="tower-height">
        {value}
        <i
          className="tower-bar"
          style={{ "--h": value / tallest } as CSSProperties}
        />
      </span>
    )
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
  if (category === "path_cover") return ""
  if (category === "lights_toggle") return value === 1 ? "cat-2" : ""
  if (category === "lamp_rays") return value === 1 ? "cat-2" : ""
  if (category === "mosaic_count") return value === 1 ? "cat-5" : ""
  return ""
}

const Strip = ({
  category,
  cells,
  cols,
  ok,
  tallest,
}: {
  category: Category
  cells: Mini[]
  cols?: number
  ok?: boolean
  tallest?: number
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
        data-lit={cell.lit || undefined}
        data-wall={category === "lamp_rays" && cell.blocked ? true : undefined}
      >
        {cell.num !== undefined ? (
          <span
            className={
              category === "mosaic_count" ? "mosaic-number" : "lamp-number"
            }
          >
            {cell.num}
          </span>
        ) : (
          cellGlyph(category, cell.v, !!cell.blocked, cell.mask, tallest)
        )}
      </span>
    ))}
  </span>
)

const sun = { v: 0 }
const moon = { v: 1 }
const empty = { v: null }

/** 1 → 2 → 3 on a highlighter band, the way the board draws it. */
const ZipStrip = () => (
  <span
    className="rule-strip zip-strip"
    style={{ "--cols": 3 } as CSSProperties}
  >
    <svg className="path-lines" viewBox="0 0 3 1" aria-hidden="true">
      <line x1={0.5} y1={0.5} x2={2.5} y2={0.5} />
    </svg>
    {[1, 2, 3].map((value) => (
      <span key={value} className="game-cell mg-cell">
        <span className={value === 2 ? "path-number" : "path-gate"}>
          {value}
        </span>
      </span>
    ))}
  </span>
)

const lamp = { v: 1 }
const lit = { v: null, lit: true }
const wall = (num?: number) => ({ v: null, blocked: true, num })
const shade = { v: 1 }
const clue = (num: number, v: number | null = null) => ({ v, num })
const tower = (v: number | null) => ({ v })

/** An edge number, then the short row of towers it looks along. */
const SightStrip = ({
  edge,
  heights,
  tallest,
}: {
  edge: number
  heights: (number | null)[]
  tallest: number
}) => (
  <span className="sight-edge">
    <b className="rule-num">{edge}</b>
    <Strip
      category="tower_sight"
      cells={heights.map(tower)}
      tallest={tallest}
    />
  </span>
)

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
    goal: <>Draw one path through every cell</>,
    rules: [
      <>
        <ZipStrip /> pass the numbers in order
      </>,
      <>Drag from a number. Drag back to erase.</>,
      <>Or tap a cell beside a number to add the next one.</>,
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
          cells={[
            { v: 0, mask: 2 },
            { v: null, blocked: true },
          ]}
        />{" "}
        no end into a blank or the edge
      </>,
    ],
  },
  lamp_rays: {
    goal: (
      <>
        Light every open cell with{" "}
        <Strip category="lamp_rays" cells={[lamp]} />
      </>
    ),
    rules: [
      <>
        <Strip category="lamp_rays" cells={[lamp, lit, lit, wall(), empty]} />{" "}
        light runs to the next wall
      </>,
      <>
        <Strip
          category="lamp_rays"
          cells={[lamp, lit, { v: 1, wrong: true }]}
        />{" "}
        lamps never light each other
      </>,
      <>
        <Strip category="lamp_rays" cells={[lamp, wall(2), lamp]} /> a number
        counts the lamps beside it
      </>,
    ],
  },
  mosaic_count: {
    goal: <>Shade cells until every number is right</>,
    rules: [
      <>
        <Strip
          category="mosaic_count"
          cols={3}
          cells={[
            shade,
            empty,
            shade,
            shade,
            clue(4),
            empty,
            empty,
            shade,
            empty,
          ]}
          ok
        />{" "}
        a number counts shade in its 3×3
      </>,
      <>
        <Strip category="mosaic_count" cells={[clue(1, 1)]} /> numbered cells
        can be shaded too
      </>,
      <>
        <Strip category="mosaic_count" cells={[{ v: 0 }]} /> rules a cell out
      </>,
    ],
  },
  tower_sight: {
    goal: <>Heights 1–5, once per row and column</>,
    rules: [
      <>
        <SightStrip edge={3} heights={[1, 3, 2, 4]} tallest={4} /> edge number counts
        towers seen
      </>,
      <>
        <SightStrip edge={1} heights={[4, null, null, null]} tallest={4} />{" "}
        taller hides shorter
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

/** The picture card for this board's own rule set, so siblings read differently. */
export function postcardFor(pack: GamePack): {
  goal: ReactNode
  rules: ReactNode[]
} {
  const card = postcards[pack.category]
  if (pack.category === "binary_fill") {
    const kinds = new Set(pack.rules.constraints.map((rule) => rule.kind))
    const [line, count, markers] = card.rules
    return {
      goal: card.goal,
      rules: [
        kinds.has("no-square") ? (
          <>
            <Strip
              category="binary_fill"
              cols={2}
              cells={[sun, sun, sun, { v: 0, wrong: true }]}
            />{" "}
            never a 2×2 of one kind
          </>
        ) : (
          line
        ),
        kinds.has("quota") ? (
          count
        ) : (
          <>
            every line is half <Strip category="binary_fill" cells={[sun]} />{" "}
            half <Strip category="binary_fill" cells={[moon]} />
          </>
        ),
        markers,
      ],
    }
  }
  if (pack.category === "crown" && pack.rules.regions)
    return {
      goal: (
        <>
          One <Strip category="crown" cells={[{ v: 1 }]} /> per row, column and
          colour
        </>
      ),
      rules: card.rules.slice(1),
    }
  if (pack.category === "path_cover") {
    const holes = pack.rules.active.length < pack.n ** 2
    const walls = !!pack.rules.walls?.length
    if (!holes && !walls) return card
    return {
      goal: holes ? <>Draw one path through every open cell</> : card.goal,
      rules: [
        card.rules[0],
        walls ? (
          <>
            <b>Thick lines</b> are walls. The path never crosses one.
          </>
        ) : (
          <>
            <Strip category="path_cover" cells={[{ v: null, blocked: true }]} />{" "}
            holes stay empty
          </>
        ),
        ...card.rules.slice(1),
      ],
    }
  }
  if (pack.category === "tower_sight")
    return {
      goal: <>Heights 1–{pack.n}, once per row and column</>,
      rules: card.rules,
    }
  return card
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

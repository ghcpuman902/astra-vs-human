import type { AssemblyRequest, GameCategory } from "../mini-game-rules/schema"

/** Assembly knobs a family passes on. Siblings differ here, not only in name. */
export type FamilyKnobs = Omit<
  NonNullable<AssemblyRequest["preferences"]>,
  "mode" | "visibility" | "targetSeconds"
>

/** Creative friend-pattern packs. LinkedIn-spirit framing OK; pipe demoted. */
export type FamilyDef = {
  id: string
  category: GameCategory
  label: string
  pattern: string
  /** Board size for this shelf. */
  n: 4 | 5 | 6
  knobs?: FamilyKnobs
  /** Lucide / emoji hint for setup cards. */
  icon: "sun-moon" | "crown" | "path" | "pipe" | "lights" | "islands" | "sparse" | "cascade" | "lamp"
  /**
   * Round-ribbon fills. One color paints the square. Two split it into
   * diagonal halves, first color on the top-left triangle.
   */
  paint: readonly [string] | readonly [string, string]
  spirit?: "Tango" | "Queens" | "Zip" | "Lights Out" | "Akari" | "Friend"
  /** Soft-demote in ranking (boring pipe etc.). */
  demote?: boolean
}

export const FAMILY_DEFS: readonly FamilyDef[] = [
  {
    id: "summer-moons",
    category: "binary_fill",
    label: "Summer Moons",
    pattern:
      "Two alike push the next cell over; a gap between twins takes the other. Every line is half and half.",
    n: 6,
    knobs: { binaryRule: "tango" },
    icon: "sun-moon",
    paint: ["var(--cat-2)", "var(--cat-5)"],
    spirit: "Tango",
  },
  {
    id: "moon-garden",
    category: "binary_fill",
    label: "Moon garden",
    pattern:
      "No 2×2 patch of one kind: three matching corners force the fourth.",
    n: 6,
    knobs: { binaryRule: "garden" },
    icon: "sun-moon",
    paint: ["var(--cat-5)", "var(--cat-3)"],
    spirit: "Friend",
  },
  {
    // Id kept so saved marks still match. Counts now sit on a few lines only.
    id: "quota-islands",
    category: "binary_fill",
    label: "Sparse tally",
    pattern:
      "Only a few lines are counted. Finish a counted line, then let pairs and gaps spread.",
    n: 5,
    knobs: { binaryRule: "tally" },
    icon: "islands",
    paint: ["var(--cat-3)"],
    spirit: "Friend",
  },
  {
    id: "crown-seats",
    category: "crown",
    label: "Crown seats",
    pattern:
      "One crown per colour region. The smallest region decides first.",
    n: 6,
    knobs: { regions: true },
    icon: "crown",
    paint: ["var(--cat-6)"],
    spirit: "Queens",
  },
  {
    id: "sparse-crowns",
    category: "crown",
    label: "Sparse crowns",
    pattern:
      "Blocked lanes shrink the board; a row with one open seat takes the crown.",
    n: 6,
    knobs: { clueDensity: 0.5 },
    icon: "sparse",
    paint: ["var(--cat-6)", "var(--cat-1)"],
    spirit: "Queens",
  },
  {
    id: "number-trail",
    category: "path_cover",
    label: "Number trail",
    pattern:
      "Drag one line through every cell. A corner has two exits, so the line turns there.",
    n: 6,
    icon: "path",
    paint: ["var(--cat-4)"],
    spirit: "Zip",
  },
  {
    // Id kept so saved marks still match. Walls now do the work pins did.
    id: "checkpoint-snake",
    category: "path_cover",
    label: "Walled trail",
    pattern:
      "Walls fence the line. A cell walled on two sides is a corridor.",
    n: 6,
    knobs: { walls: 6 },
    icon: "path",
    paint: ["var(--cat-4)", "var(--cat-3)"],
    spirit: "Zip",
  },
  {
    id: "odd-shapes",
    category: "path_cover",
    label: "Odd shapes",
    pattern:
      "Holes bend the board. A cell with one way in is where the line ends.",
    n: 6,
    knobs: { holes: 4 },
    icon: "path",
    paint: ["var(--cat-4)", "var(--cat-1)"],
    spirit: "Friend",
  },
  {
    // E8: the first family whose rule travels. See docs/e8-new-mechanic.md.
    id: "lamplight",
    category: "lamp_rays",
    label: "Lamplight",
    pattern:
      "Light runs to the next wall. A dark cell only one open cell can see takes the lamp.",
    n: 6,
    icon: "lamp",
    paint: ["var(--cat-2)", "var(--cat-6)"],
    spirit: "Akari",
  },
  {
    id: "cross-lights",
    category: "lights_toggle",
    label: "Cross lights",
    pattern:
      "Two presses cancel; shared neighbors flip twice and stay unchanged.",
    n: 4,
    knobs: { presses: 2 },
    icon: "lights",
    paint: ["var(--cat-2)"],
    spirit: "Lights Out",
  },
  {
    id: "cascade-taps",
    category: "lights_toggle",
    label: "Cascade taps",
    pattern:
      "Four crosses overlap. Find a cross whose five lights are all on, then peel the next.",
    n: 5,
    knobs: { presses: 4 },
    icon: "cascade",
    paint: ["var(--cat-1)", "var(--cat-2)"],
    spirit: "Lights Out",
  },
  {
    id: "pipe-boundaries",
    category: "tile_rotate_connect",
    label: "Pipe turn",
    pattern:
      "A boundary rejects outward ports; a fixed neighbor forces the matching port.",
    n: 5,
    icon: "pipe",
    paint: ["var(--cat-1)"],
    demote: true,
  },
] as const


export type MatchFamily = {
  id: string
  category: GameCategory
  label: string
  pattern: string
  n: 4 | 5 | 6
  icon: FamilyDef["icon"]
  spirit?: FamilyDef["spirit"]
  demote?: boolean
}

export type FamilyMarks = {
  played: readonly string[]
  disliked: readonly string[]
  /** Families dealt lately, oldest first. Ties go to the one least recently dealt. */
  recent?: readonly string[]
}

/** One row per creative pack, catalogue order with pipe last. */
export function matchFamilies(): readonly MatchFamily[] {
  return FAMILY_DEFS.map((def) => ({
    id: def.id,
    category: def.category,
    label: def.label,
    pattern: def.pattern,
    n: def.n,
    icon: def.icon,
    spirit: def.spirit,
    demote: def.demote,
  }))
}

/**
 * Novel families first, disliked and demoted later.
 * Every catalogue family stays in the list. Marks never empty the match.
 */
export function rankMatchFamilies(
  marks: FamilyMarks = { played: [], disliked: [] }
): readonly MatchFamily[] {
  const played = new Set(marks.played)
  const disliked = new Set(marks.disliked)
  const recent = marks.recent ?? []
  return matchFamilies()
    .map((family, index) => {
      const novel = !played.has(family.id)
      const avoid = disliked.has(family.id) || family.demote
      const score = (novel ? 2 : 0) - (avoid ? 3 : 0)
      return { family, index, score, last: recent.lastIndexOf(family.id) }
    })
    .sort((a, b) => b.score - a.score || a.last - b.last || a.index - b.index)
    .map((item) => item.family)
}

const CATEGORY_PAINT: Record<
  GameCategory,
  FamilyDef["paint"]
> = {
  binary_fill: ["var(--cat-2)", "var(--cat-5)"],
  crown: ["var(--cat-6)"],
  path_cover: ["var(--cat-4)"],
  lights_toggle: ["var(--cat-2)"],
  tile_rotate_connect: ["var(--cat-1)"],
  lamp_rays: ["var(--cat-2)", "var(--cat-6)"],
}

/** Ribbon color for a dealt board. Unknown ids fall back to the mechanic. */
export function familyPaint(
  id: string,
  category?: GameCategory
): FamilyDef["paint"] {
  const hit = FAMILY_DEFS.find((def) => def.id === id)
  if (hit) return hit.paint
  if (category) return CATEGORY_PAINT[category]
  return ["var(--ink-secondary)"]
}

export function orderByFamily<T extends { category: GameCategory }>(
  games: readonly T[],
  marks: FamilyMarks
): T[] {
  const ranked = rankMatchFamilies(marks)
  const byCategory = new Map(games.map((game) => [game.category, game]))
  const used = new Set<GameCategory>()
  const ordered: T[] = []
  for (const family of ranked) {
    const game = byCategory.get(family.category)
    if (!game || used.has(game.category)) continue
    used.add(game.category)
    ordered.push(game)
  }
  for (const game of games) {
    if (used.has(game.category)) continue
    ordered.push(game)
  }
  return ordered
}

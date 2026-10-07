import type { GameCategory } from "../mini-game-rules/schema"

/** Creative friend-pattern packs. LinkedIn-spirit framing OK; pipe demoted. */
export type FamilyDef = {
  id: string
  category: GameCategory
  label: string
  pattern: string
  /** Board size for this shelf. */
  n: 4 | 5 | 6
  /** Lucide / emoji hint for setup cards. */
  icon: "sun-moon" | "crown" | "path" | "pipe" | "lights" | "islands" | "sparse" | "cascade"
  spirit?: "Tango" | "Queens" | "Zip" | "Lights Out" | "Friend"
  /** Soft-demote in ranking (boring pipe etc.). */
  demote?: boolean
}

export const FAMILY_DEFS: readonly FamilyDef[] = [
  {
    id: "summer-moons",
    category: "binary_fill",
    label: "Summer Moons",
    pattern:
      "Two matching ends force the middle; a completed quota fixes the remaining cells.",
    n: 4,
    icon: "sun-moon",
    spirit: "Tango",
  },
  {
    id: "quota-islands",
    category: "binary_fill",
    label: "Quota islands",
    pattern: "Equal friends and quotas carve small islands — count before you place.",
    n: 5,
    icon: "islands",
    spirit: "Tango",
  },
  {
    id: "crown-seats",
    category: "crown",
    label: "Crown seats",
    pattern:
      "A forced seat removes its column and neighboring diagonal seats.",
    n: 5,
    icon: "crown",
    spirit: "Queens",
  },
  {
    id: "sparse-crowns",
    category: "crown",
    label: "Sparse crowns",
    pattern: "Blocked lanes shrink the board; place one crown per row and column still.",
    n: 5,
    icon: "sparse",
    spirit: "Queens",
  },
  {
    id: "number-trail",
    category: "path_cover",
    label: "Number trail",
    pattern:
      "Drag one line through every cell. A corner has two exits, so the line turns there.",
    n: 4,
    icon: "path",
    spirit: "Zip",
  },
  {
    id: "checkpoint-snake",
    category: "path_cover",
    label: "Checkpoint snake",
    pattern: "Numbered gates pin the order. Never leave a pocket the line cannot get back out of.",
    n: 5,
    icon: "path",
    spirit: "Zip",
  },
  {
    id: "cross-lights",
    category: "lights_toggle",
    label: "Cross lights",
    pattern:
      "Two presses cancel; shared neighbors flip twice and stay unchanged.",
    n: 4,
    icon: "lights",
    spirit: "Lights Out",
  },
  {
    id: "cascade-taps",
    category: "lights_toggle",
    label: "Cascade taps",
    pattern: "A larger cross network — plan cancel pairs before you tap.",
    n: 5,
    icon: "cascade",
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

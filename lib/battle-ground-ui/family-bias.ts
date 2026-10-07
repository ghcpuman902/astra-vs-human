import { gameLandscape } from "../mini-game-rules/catalogue"
import type { GameCategory } from "../mini-game-rules/schema"

/** Certified transfer families. Ids match the assembler, copy comes from the catalogue. */
const FAMILY_ID: Record<GameCategory, string> = {
  binary_fill: "binary-friends",
  crown: "crown-nontouch",
  path_cover: "path-checkpoints",
  tile_rotate_connect: "pipe-boundaries",
  lights_toggle: "lights-cross-cancellation",
}

const LABEL: Record<GameCategory, string> = {
  binary_fill: "Sun & moon",
  crown: "Crown seats",
  path_cover: "Number trail",
  tile_rotate_connect: "Pipe turn",
  lights_toggle: "Cross lights",
}

export type MatchFamily = {
  id: string
  category: GameCategory
  label: string
  pattern: string
}

export type FamilyMarks = {
  played: readonly string[]
  disliked: readonly string[]
}

/** One row per assemblable category, in catalogue order. */
export function matchFamilies(): readonly MatchFamily[] {
  const seen = new Set<GameCategory>()
  const families: MatchFamily[] = []
  for (const idea of gameLandscape()) {
    if (idea.status !== "assemblable" || seen.has(idea.category)) continue
    seen.add(idea.category)
    families.push({
      id: FAMILY_ID[idea.category],
      category: idea.category,
      label: LABEL[idea.category],
      pattern: idea.localPattern,
    })
  }
  return families
}

/**
 * Novel families first, disliked families later.
 * Every catalogue family stays in the list. Marks never empty the match.
 */
export function rankMatchFamilies(
  marks: FamilyMarks = { played: [], disliked: [] }
): readonly MatchFamily[] {
  const played = new Set(marks.played)
  const disliked = new Set(marks.disliked)
  return matchFamilies()
    .map((family, index) => {
      const novel = !played.has(family.id)
      const avoid = disliked.has(family.id)
      const score = (novel ? 2 : 0) - (avoid ? 3 : 0)
      return { family, index, score }
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
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

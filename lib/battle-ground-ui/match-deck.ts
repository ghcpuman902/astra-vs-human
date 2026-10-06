import { assembleGamePack } from "../mini-game-rules/assembler"
import type { GameCategory, GamePack } from "../mini-game-rules/schema"
import { transferGroup } from "./controller"
import {
  matchFamilies,
  rankMatchFamilies,
  type FamilyMarks,
  type MatchFamily,
} from "./family-bias"

export const MATCH_GAME_COUNT = 5
export const ROUNDS_PER_GAME = 3
/** Distinct boards kept for one family. Deep plays all of them. */
export const FAMILY_PACKS = 5
export const MATCH_LENGTHS = ["deep", "tour", "blitz"] as const
export type MatchLength = (typeof MATCH_LENGTHS)[number]
export const DEFAULT_MATCH_LENGTH: MatchLength = "deep"
/** Each side's Blitz clock. It does not reset when that side advances. */
export const BLITZ_MATCH_MS = 180_000

/** One game per category. Three rounds stay in that transfer family. */
export const MATCH_CATEGORIES = [
  "binary_fill",
  "crown",
  "path_cover",
  "tile_rotate_connect",
  "lights_toggle",
] as const satisfies readonly GameCategory[]

export type MatchGame = {
  index: number
  category: GameCategory
  transferGroup: string
  packs: readonly [GamePack, GamePack, GamePack]
}

export type MatchDeck = {
  gameCount: typeof MATCH_GAME_COUNT
  roundsPerGame: typeof ROUNDS_PER_GAME
  games: readonly MatchGame[]
  packs: readonly GamePack[]
}

export type FamilyShelf = {
  category: GameCategory
  transferGroup: string
  packs: readonly GamePack[]
}

export type DealtMatch = {
  length: MatchLength
  packs: readonly GamePack[]
  gameCount: number
  roundsPerGame: number
  clock: "attempt" | "side"
  /** Set for Blitz. Deep and Tour keep the attempt cap from the session. */
  timeCapMs: number | null
  category: GameCategory | null
  familyId: string | null
}

const fingerprint = (pack: GamePack) =>
  JSON.stringify({
    category: pack.category,
    rules: pack.rules,
    cells: pack.cells,
  })

function assembleDistinct(
  category: GameCategory,
  game: number,
  round: number,
  usedSeeds: Set<number>,
  usedBoards: Set<string>
): GamePack {
  for (let step = 0; step < 80; step++) {
    const seed = 8_200_000 + game * 1_000 + round * 40 + step
    if (usedSeeds.has(seed)) continue
    let pack: GamePack
    try {
      pack = assembleGamePack({
        category,
        seed,
        n: 4,
        variant: `match-g${game + 1}-r${round + 1}`,
      }).pack
    } catch {
      continue
    }
    const board = fingerprint(pack)
    const cells = JSON.stringify(pack.cells)
    if (usedSeeds.has(pack.seed) || usedBoards.has(board) || usedBoards.has(cells))
      continue
    usedSeeds.add(pack.seed)
    usedBoards.add(board)
    usedBoards.add(cells)
    return pack
  }
  throw new Error(
    `No distinct ${category} pack for game ${game + 1} round ${round + 1}`
  )
}

let shelves: readonly FamilyShelf[] | null = null

function familyShelves(): readonly FamilyShelf[] {
  if (shelves) return shelves
  const usedSeeds = new Set<number>()
  shelves = MATCH_CATEGORIES.map((category, index) => {
    const usedBoards = new Set<string>()
    const packs = Array.from({ length: FAMILY_PACKS }, (_, round) =>
      assembleDistinct(category, index, round, usedSeeds, usedBoards)
    )
    const group = transferGroup(packs[0])
    if (packs.some((pack) => transferGroup(pack) !== group))
      throw new Error(`${category} rounds left their transfer family`)
    if (new Set(packs.map((pack) => pack.seed)).size !== packs.length)
      throw new Error(`${category} repeated a seed`)
    return { category, transferGroup: group, packs }
  })
  return shelves
}

/**
 * Novel families first, and a Less mark waits behind them.
 * With no marks, this is the first family in the deck.
 */
export function pickDeepFamily(
  marks: FamilyMarks = { played: [], disliked: [] }
): MatchFamily {
  const families = matchFamilies()
  const played = new Set(marks.played)
  const less = new Set(marks.disliked)
  const novel = families.filter((family) => !played.has(family.id))
  const pool = novel.length > 0 ? novel : families
  const open = pool.filter((family) => !less.has(family.id))
  return open[0] ?? pool[0] ?? families[0]
}

export function buildFamilyLibrary(): readonly FamilyShelf[] {
  return familyShelves()
}

function shelfFor(
  category: GameCategory,
  source: readonly FamilyShelf[]
): FamilyShelf {
  const shelf = source.find((item) => item.category === category)
  if (!shelf) throw new Error(`No packs for ${category}`)
  return shelf
}

function rankShelves(
  marks: FamilyMarks,
  source: readonly FamilyShelf[]
): FamilyShelf[] {
  const byCategory = new Map(source.map((shelf) => [shelf.category, shelf]))
  return rankMatchFamilies(marks).flatMap((family) => {
    const shelf = byCategory.get(family.category)
    return shelf ? [shelf] : []
  })
}

/** Five games × three boards. Kept for clock checks. Not a setup choice. */
export function buildMatchDeck(): MatchDeck {
  const games = familyShelves().map((shelf, index) => {
    const packs = shelf.packs.slice(0, ROUNDS_PER_GAME) as [
      GamePack,
      GamePack,
      GamePack,
    ]
    return {
      index,
      category: shelf.category,
      transferGroup: shelf.transferGroup,
      packs,
    }
  })
  return {
    gameCount: MATCH_GAME_COUNT,
    roundsPerGame: ROUNDS_PER_GAME,
    games,
    packs: games.flatMap((game) => [...game.packs]),
  }
}

/** Deep, Tour, or Blitz. Deep is the demo default. */
export function dealMatch(
  length: MatchLength = DEFAULT_MATCH_LENGTH,
  marks: FamilyMarks = { played: [], disliked: [] },
  source: readonly FamilyShelf[] = familyShelves()
): DealtMatch {
  if (length === "deep") {
    const family = pickDeepFamily(marks)
    const packs = shelfFor(family.category, source).packs.slice(0, FAMILY_PACKS)
    return {
      length,
      packs,
      gameCount: 1,
      roundsPerGame: packs.length,
      clock: "attempt",
      timeCapMs: null,
      category: family.category,
      familyId: family.id,
    }
  }
  if (length === "tour") {
    const packs = rankShelves(marks, source).map((shelf) => shelf.packs[0])
    return {
      length,
      packs,
      gameCount: packs.length,
      roundsPerGame: 1,
      clock: "attempt",
      timeCapMs: null,
      category: null,
      familyId: null,
    }
  }
  const ordered = rankShelves(marks, source)
  const packs: GamePack[] = []
  for (let round = 0; round < FAMILY_PACKS; round++) {
    for (const shelf of ordered) packs.push(shelf.packs[round])
  }
  return {
    length: "blitz",
    packs,
    gameCount: 1,
    roundsPerGame: packs.length,
    clock: "side",
    timeCapMs: BLITZ_MATCH_MS,
    category: null,
    familyId: null,
  }
}

import { assembleGamePack } from "../mini-game-rules/assembler"
import type { GameCategory, GamePack } from "../mini-game-rules/schema"
import { transferGroup } from "./controller"

export const MATCH_GAME_COUNT = 5
export const ROUNDS_PER_GAME = 3

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
  for (let step = 0; step < 30; step++) {
    const seed = 8_200_000 + game * 100 + round * 30 + step
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
    if (usedSeeds.has(pack.seed) || usedBoards.has(board)) continue
    usedSeeds.add(pack.seed)
    usedBoards.add(board)
    return pack
  }
  throw new Error(
    `No distinct ${category} pack for game ${game + 1} round ${round + 1}`
  )
}

let cached: MatchDeck | null = null

/** Five games × three different boards. Rounds in a game are not the same seed. */
export function buildMatchDeck(): MatchDeck {
  if (cached) return cached
  const usedSeeds = new Set<number>()
  const games = MATCH_CATEGORIES.map((category, index) => {
    const usedBoards = new Set<string>()
    const packs = [0, 1, 2].map((round) =>
      assembleDistinct(category, index, round, usedSeeds, usedBoards)
    ) as [GamePack, GamePack, GamePack]
    const group = transferGroup(packs[0])
    if (packs.some((pack) => transferGroup(pack) !== group))
      throw new Error(`${category} rounds left their transfer family`)
    if (new Set(packs.map((pack) => pack.seed)).size !== packs.length)
      throw new Error(`${category} repeated a seed`)
    return { index, category, transferGroup: group, packs }
  })
  cached = {
    gameCount: MATCH_GAME_COUNT,
    roundsPerGame: ROUNDS_PER_GAME,
    games,
    packs: games.flatMap((game) => [...game.packs]),
  }
  return cached
}

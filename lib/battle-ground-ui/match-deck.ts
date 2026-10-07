import { assembleGamePack } from "../mini-game-rules/assembler"
import type {
  AssemblyRequest,
  GameCategory,
  GamePack,
} from "../mini-game-rules/schema"
import { transferGroup } from "./controller"
import {
  FAMILY_DEFS,
  type FamilyDef,
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

/** @deprecated Prefer FAMILY_DEFS — kept for clock-check scripts. */
export const MATCH_CATEGORIES = [
  "binary_fill",
  "crown",
  "path_cover",
  "tile_rotate_connect",
  "lights_toggle",
  "lamp_rays",
  "mosaic_count",
  "tower_sight",
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
  familyId: string
  category: GameCategory
  label: string
  transferGroup: string
  packs: readonly GamePack[]
  /** Authored boards, keyed by seed. Host scoring only. */
  solutions: Readonly<Record<string, readonly (number | null)[]>>
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
  /**
   * Authored boards keyed by seed. Used to score cell F1 after a round.
   * Never part of the learner observation. Absent on matches saved earlier.
   */
  solutions?: Readonly<Record<string, readonly (number | null)[]>>
}

const fingerprint = (pack: GamePack) =>
  JSON.stringify({
    category: pack.category,
    rules: pack.rules,
    cells: pack.cells,
  })

/** Short stable id for a board, so a browser can skip boards it has already dealt. */
export function boardId(pack: GamePack): string {
  let hash = 0x811c9dc5
  for (const char of fingerprint(pack)) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/** Fresh salt each library build so Summer Moons is not identical every load. */
function librarySalt(): number {
  const entropy =
    typeof crypto !== "undefined" && "getRandomValues" in crypto
      ? crypto.getRandomValues(new Uint32Array(1))[0]!
      : (Date.now() ^ (Math.floor(Math.random() * 0xffffffff) >>> 0)) >>> 0
  return entropy >>> 0
}

/** The assembly request for one round of a family: its size and its knobs. */
export function familyRequest(
  def: FamilyDef,
  seed: number,
  round: number
): AssemblyRequest {
  return {
    category: def.category,
    seed,
    n: def.n,
    variant: `${def.id}-r${round + 1}`,
    preferences: {
      ...def.knobs,
      visibility: "full",
      targetSeconds: def.n <= 4 ? 60 : def.n === 5 ? 75 : 90,
    },
  }
}

/**
 * The answer up to the eight square symmetries (and route reversal for
 * paths). Two deals that differ only in givens or orientation share it.
 */
export function solutionShape(
  category: GameCategory,
  n: number,
  solution: readonly (number | null)[]
): string {
  const length = Math.max(0, ...solution.map((value) => value ?? 0))
  const variants = [solution]
  if (category === "path_cover")
    variants.push(
      solution.map((value) => (value === null ? null : length + 1 - value))
    )
  if (category === "binary_fill")
    variants.push(
      solution.map((value) => (value === null ? null : 1 - value))
    )
  const at = (cells: readonly (number | null)[], row: number, col: number) =>
    cells[row * n + col]
  let best = ""
  for (const cells of variants)
    for (let turn = 0; turn < 8; turn++) {
      const key = Array.from({ length: n * n }, (_, id) => {
        let row = Math.floor(id / n),
          col = id % n
        if (turn & 4) col = n - 1 - col
        for (let i = 0; i < (turn & 3); i++) [row, col] = [col, n - 1 - row]
        return at(cells, row, col) ?? "."
      }).join(",")
      if (!best || key < best) best = key
    }
  return `${category}:${n}:${best}`
}

function assembleDistinct(
  def: FamilyDef,
  game: number,
  round: number,
  salt: number,
  usedSeeds: Set<number>,
  usedBoards: Set<string>,
  avoid: ReadonlySet<string>
): { pack: GamePack; solution: readonly (number | null)[] } {
  const { category, id: familyId } = def
  for (let step = 0; step < 120; step++) {
    const seed =
      (salt + game * 17_777 + round * 1_031 + step * 97 + familyId.length * 13) >>>
      0
    if (usedSeeds.has(seed)) continue
    let pack: GamePack
    let solution: readonly (number | null)[]
    try {
      const built = assembleGamePack(familyRequest(def, seed, round))
      pack = built.pack
      solution = built.audit.solution
    } catch {
      continue
    }
    // Stamp transfer family so shelves stay distinct across same category.
    pack = {
      ...pack,
      transfer: {
        ...pack.transfer,
        family: familyId,
        variant: `${familyId}-r${round + 1}`,
      },
    }
    const board = fingerprint(pack)
    // A blank start (Queens regions) says nothing; the rules carry that board.
    const cells = pack.cells.some((cell) => cell.locked || cell.value !== null)
      ? JSON.stringify(pack.cells)
      : board
    // Same answer in a new orientation reads as the same board to a player.
    const shape = solutionShape(category, pack.n, solution)
    if (
      usedSeeds.has(pack.seed) ||
      usedBoards.has(board) ||
      usedBoards.has(cells) ||
      (step < 90 && usedBoards.has(shape)) ||
      (step < 60 && avoid.has(boardId(pack)))
    )
      continue
    usedSeeds.add(pack.seed)
    usedBoards.add(board)
    usedBoards.add(cells)
    usedBoards.add(shape)
    return { pack, solution }
  }
  throw new Error(
    `No distinct ${category} pack for ${familyId} round ${round + 1}`
  )
}

let shelves: readonly FamilyShelf[] | null = null
let shelvesSalt = 0

function assembleShelves(
  defs: readonly (typeof FAMILY_DEFS)[number][],
  salt: number,
  avoid: ReadonlySet<string>
): FamilyShelf[] {
  const usedSeeds = new Set<number>()
  return defs.map((def) => {
    const index = FAMILY_DEFS.indexOf(def)
    const usedBoards = new Set<string>()
    const built = Array.from({ length: FAMILY_PACKS }, (_, round) =>
      assembleDistinct(
        def,
        index,
        round,
        salt,
        usedSeeds,
        usedBoards,
        avoid
      )
    )
    const packs = built.map((item) => item.pack)
    const solutions = Object.fromEntries(
      built.map((item) => [String(item.pack.seed), item.solution])
    )
    const group = transferGroup(packs[0])
    if (packs.some((pack) => pack.transfer.family !== def.id))
      throw new Error(`${def.id} rounds left their transfer family`)
    if (new Set(packs.map((pack) => pack.seed)).size !== packs.length)
      throw new Error(`${def.id} repeated a seed`)
    return {
      familyId: def.id,
      category: def.category,
      label: def.label,
      transferGroup: group,
      packs,
      solutions,
    }
  })
}

function familyShelves(
  forceSalt?: number,
  avoid: ReadonlySet<string> = new Set()
): readonly FamilyShelf[] {
  const salt = forceSalt ?? (shelvesSalt || librarySalt())
  if (shelves && shelvesSalt === salt) return shelves
  shelvesSalt = salt
  shelves = assembleShelves(FAMILY_DEFS, salt, avoid)
  return shelves
}

/**
 * Novel families first, and a Less mark waits behind them.
 * With no marks, this is the first non-demoted family in the deck.
 */
export function pickDeepFamily(
  marks: FamilyMarks = { played: [], disliked: [] }
): MatchFamily {
  const ranked = rankMatchFamilies(marks)
  return ranked[0] ?? matchFamilies()[0]
}

/**
 * Build (or rebuild) the family library. Pass refresh to force new boards,
 * and avoid to skip board ids this browser has already been dealt.
 */
export function buildFamilyLibrary(options?: {
  refresh?: boolean
  avoid?: ReadonlySet<string>
}): readonly FamilyShelf[] {
  if (options?.refresh) {
    shelves = null
    shelvesSalt = librarySalt()
  }
  return familyShelves(undefined, options?.avoid)
}

/** Same spec, new boards. Every Start, Rematch and Respawn goes through here. */
export function freshDeal(
  length: MatchLength,
  marks: FamilyMarks,
  options: { familyId?: string | null; avoid?: ReadonlySet<string> } = {}
): DealtMatch {
  const avoid = options.avoid ?? new Set<string>()
  if (length === "deep") {
    // Deep needs one shelf; skip assembling the other eight.
    const familyId = options.familyId ?? pickDeepFamily(marks).id
    const def = FAMILY_DEFS.find((item) => item.id === familyId)
    if (!def) throw new Error(`No family ${familyId}`)
    const [shelf] = assembleShelves([def], librarySalt(), avoid)
    return {
      length,
      packs: shelf.packs,
      gameCount: 1,
      roundsPerGame: shelf.packs.length,
      clock: "attempt",
      timeCapMs: null,
      category: def.category,
      familyId,
      solutions: shelf.solutions,
    }
  }
  return dealMatch(
    length,
    marks,
    assembleShelves(FAMILY_DEFS, librarySalt(), avoid)
  )
}

function shelfFor(
  familyId: string,
  source: readonly FamilyShelf[]
): FamilyShelf {
  const shelf = source.find((item) => item.familyId === familyId)
  if (!shelf) throw new Error(`No packs for ${familyId}`)
  return shelf
}

/** Gold boards for these packs. Host scoring only — not a learner input. */
function solutionsFor(
  packs: readonly GamePack[],
  source: readonly FamilyShelf[]
): Record<string, readonly (number | null)[]> {
  const bySeed = new Map<string, readonly (number | null)[]>()
  for (const shelf of source)
    for (const [seed, cells] of Object.entries(shelf.solutions))
      bySeed.set(seed, cells)
  const out: Record<string, readonly (number | null)[]> = {}
  for (const pack of packs) {
    const cells = bySeed.get(String(pack.seed))
    if (!cells) throw new Error(`No authored board for seed ${pack.seed}`)
    out[String(pack.seed)] = cells
  }
  return out
}

function uniqueCategoryShelves(
  marks: FamilyMarks,
  source: readonly FamilyShelf[]
): FamilyShelf[] {
  const seen = new Set<GameCategory>()
  const out: FamilyShelf[] = []
  for (const shelf of rankShelves(marks, source)) {
    if (seen.has(shelf.category)) continue
    seen.add(shelf.category)
    out.push(shelf)
    if (out.length >= MATCH_GAME_COUNT) break
  }
  return out
}

function rankShelves(
  marks: FamilyMarks,
  source: readonly FamilyShelf[]
): FamilyShelf[] {
  const byId = new Map(source.map((shelf) => [shelf.familyId, shelf]))
  return rankMatchFamilies(marks).flatMap((family) => {
    const shelf = byId.get(family.id)
    return shelf ? [shelf] : []
  })
}

/** Five games × three boards. Kept for clock checks. Not a setup choice. */
export function buildMatchDeck(): MatchDeck {
  const uniqueCategories = [
    ...new Map(
      familyShelves().map((shelf) => [shelf.category, shelf] as const)
    ).values(),
  ].slice(0, MATCH_GAME_COUNT)
  const games = uniqueCategories.map((shelf, index) => {
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
    const packs = shelfFor(family.id, source).packs.slice(0, FAMILY_PACKS)
    return {
      length,
      packs,
      gameCount: 1,
      roundsPerGame: packs.length,
      clock: "attempt",
      timeCapMs: null,
      category: family.category,
      familyId: family.id,
      solutions: solutionsFor(packs, source),
    }
  }
  if (length === "tour") {
    // One board from each mechanic (pipe demoted). Setup lists creative packs.
    const packs = uniqueCategoryShelves(marks, source).map(
      (shelf) => shelf.packs[0]
    )
    return {
      length,
      packs,
      gameCount: packs.length,
      roundsPerGame: 1,
      clock: "attempt",
      timeCapMs: null,
      category: null,
      familyId: null,
      solutions: solutionsFor(packs, source),
    }
  }
  const ordered = uniqueCategoryShelves(marks, source)
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
    solutions: solutionsFor(packs, source),
  }
}

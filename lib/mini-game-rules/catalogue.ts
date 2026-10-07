import type { GameCategory, Mode } from "./schema"

export type GamePreferences = {
  categories?: GameCategory[]
  mode?: Mode
  visibility?: "full" | "partial"
  targetSeconds?: number
  vibe?: "calm" | "spatial" | "tactile"
}

export type LandscapeIdea = {
  id: string
  category: GameCategory
  mode: Mode
  visibility: "full" | "partial"
  vibe: "calm" | "spatial" | "tactile"
  niche: string
  localPattern: string
  knobs: string[]
  neighbors: string[]
  status: "assemblable" | "research"
  limitation?: string
}

const families: Record<
  GameCategory,
  {
    niches: string[]
    localPattern: string
    knobs: string[]
    neighbors: string[]
  }
> = {
  binary_fill: {
    niches: [
      "paired colors and interrupted triples",
      "quota islands with equal friends",
      "zigzag opposite friends",
    ],
    localPattern:
      "Two matching ends force the middle; a completed quota fixes the remaining cells.",
    knobs: [
      "clueDensity",
      "equal/opposite edge arrangement",
      "no-three + quota + friends",
    ],
    neighbors: ["Tango", "Sudoku"],
  },
  crown: {
    niches: [
      "last safe seat in a row",
      "blocked lanes and touching crowns",
      "sparse placement islands",
    ],
    localPattern:
      "A forced seat removes its column and neighboring diagonal seats.",
    knobs: ["noDiagonalTouch", "blocked-cell pattern", "clue density"],
    neighbors: ["Queens"],
  },
  path_cover: {
    niches: [
      "short corridor with numbered gates",
      "corner mouths and dead ends",
      "snake with a checkpoint rhythm",
    ],
    localPattern:
      "An endpoint with one exit fixes the next step; a dead end must be an endpoint.",
    knobs: ["pathLength", "checkpoint spacing", "corridor shape"],
    neighbors: ["Zip", "path puzzles"],
  },
  tile_rotate_connect: {
    niches: [
      "corner ports and inward elbows",
      "edge rails with rotating bends",
      "small pipe network",
    ],
    localPattern:
      "A boundary rejects outward ports; a fixed neighbor forces the matching port.",
    knobs: ["network shape", "rotation scramble", "locked orientation"],
    neighbors: ["pipe toys", "rotation puzzles"],
  },
  lights_toggle: {
    niches: [
      "cross taps and canceling neighbors",
      "edge lamps and overlap parity",
      "small toggle cascade",
    ],
    localPattern:
      "Two presses cancel; shared neighbors flip twice and stay unchanged.",
    knobs: ["scramble depth", "press-parity rank", "grid size"],
    neighbors: ["Lights Out", "2048 tactile rounds"],
  },
  lamp_rays: {
    niches: [
      "dark corners with one viewer",
      "numbered walls around a courtyard",
      "long halls split by pillars",
    ],
    localPattern:
      "A dark cell only one open cell can see takes the lamp; a full number fills its sides.",
    knobs: ["wall share", "number carving", "symmetric walls"],
    neighbors: ["Light Up", "Akari"],
  },
  mosaic_count: {
    niches: [
      "overlapping blocks that differ by one",
      "zeros and nines that clear or fill",
      "edge numbers with small blocks",
    ],
    localPattern:
      "Two overlapping numbers bound their shared cells; the difference sits in the cells only one owns.",
    knobs: ["shade share", "number carving"],
    neighbors: ["Fill-a-Pix", "Minesweeper"],
  },
  tower_sight: {
    niches: [
      "a 1 beside the tallest",
      "staircase lines that see every tower",
      "two edges that pin the tallest",
    ],
    localPattern:
      "A clue k keeps the tallest at least k − 1 cells in; a 1 puts the tallest beside it.",
    knobs: ["edge clue carving", "given heights at larger sizes"],
    neighbors: ["Skyscrapers", "Towers"],
  },
}

const modes: Mode[] = ["FORCED-CHAIN", "BRANCHY", "MULTI", "RISK"]
const supported: Record<GameCategory, Mode[]> = {
  binary_fill: ["FORCED-CHAIN"],
  crown: ["FORCED-CHAIN", "BRANCHY"],
  path_cover: ["FORCED-CHAIN", "BRANCHY"],
  tile_rotate_connect: ["FORCED-CHAIN"],
  lights_toggle: ["BRANCHY", "MULTI"],
  lamp_rays: ["FORCED-CHAIN"],
  mosaic_count: ["FORCED-CHAIN"],
  tower_sight: ["FORCED-CHAIN"],
}

/** A cross-product of mechanics and research axes, never a list of puzzle boards. */
export function gameLandscape(): LandscapeIdea[] {
  return (
    Object.entries(families) as [
      GameCategory,
      (typeof families)[GameCategory],
    ][]
  ).flatMap(([category, family]) =>
    modes.flatMap((mode) =>
      (["full", "partial"] as const).flatMap((visibility) =>
        family.niches.map((niche, index) => {
          const playable =
            visibility === "full" && supported[category].includes(mode)
          return {
            id: `${category}:${mode}:${visibility}:${index}`,
            category,
            mode,
            visibility,
            vibe: (["calm", "spatial", "tactile"] as const)[index],
            niche,
            localPattern: family.localPattern,
            knobs: family.knobs,
            neighbors: family.neighbors,
            status: playable ? ("assemblable" as const) : ("research" as const),
            ...(!playable
              ? {
                  limitation:
                    visibility === "partial"
                      ? "Partial observation needs an observation policy and a visibility-aware verifier."
                      : "This mode is catalogued but not certified for this mechanic yet.",
                }
              : {}),
          }
        })
      )
    )
  )
}

export function preferenceMatches(
  idea: LandscapeIdea,
  preferences: GamePreferences
): boolean {
  return (
    (!preferences.categories?.length ||
      preferences.categories.includes(idea.category)) &&
    (!preferences.mode || preferences.mode === idea.mode) &&
    (!preferences.visibility || preferences.visibility === idea.visibility)
  )
}

/** Seeded sampling favors category variety; two live ideas keep the sift useful. */
export function pickGameIdeas(
  seed: number,
  preferences: GamePreferences = {},
  count = 4
): LandscapeIdea[] {
  let state = seed >>> 0
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
  const pool = gameLandscape().filter((idea) =>
    preferenceMatches(idea, preferences)
  )
  const ranked = pool
    .map((idea) => ({
      idea,
      rank: random() + (idea.vibe === preferences.vibe ? 1 : 0),
    }))
    .sort((a, b) => b.rank - a.rank)
  const chosen: LandscapeIdea[] = []
  for (const liveOnly of [true, true, false, false]) {
    const eligible = ranked.filter(
      ({ idea }) =>
        !chosen.some((item) => item.id === idea.id) &&
        (!liveOnly || idea.status === "assemblable")
    )
    const next =
      eligible.find(
        ({ idea }) => !chosen.some((item) => item.category === idea.category)
      ) ?? eligible[0]
    if (next) chosen.push(next.idea)
    if (chosen.length === count) break
  }
  return chosen.slice(0, count)
}

import { z } from "zod"

import {
  compileBoardIntent,
  type BoardAffordances,
  type BoardView,
} from "../mini-game-rules/affordances"

/**
 * How the Learner turns a public board into counted taps.
 * `astra-hybrid` is the planned-burst alias of `astra`.
 */
export type LearnerMixId =
  | "astra"
  | "astra-hybrid"
  | "code"
  | "astra-jev"
  | "jev-bare"
  | "astra-laya"
  | "laya-bare"
  | "openai-decisions"
  | "openai-bare"

export const learnerMixIds = [
  "astra",
  "astra-hybrid",
  "code",
  "astra-jev",
  "jev-bare",
  "astra-laya",
  "laya-bare",
  "openai-decisions",
  "openai-bare",
] as const satisfies readonly LearnerMixId[]

/** Modes shown before start. `astra-hybrid` stays accepted on the API. */
export const learnerModeIds = [
  "astra",
  "code",
  "astra-jev",
  "jev-bare",
  "astra-laya",
  "laya-bare",
  "openai-decisions",
  "openai-bare",
] as const satisfies readonly LearnerMixId[]

/** Solver names a target value; the engine compiles it into counted taps. */
export const placementSchema = z.strictObject({
  cell: z.number().int().min(0).max(35),
  value: z.number().int().min(0).max(36).nullable(),
})

export type Placement = z.infer<typeof placementSchema>

/** When false, Learner payloads omit category and mode (score the pattern, not the class). */
export const exposeLearnerClassLabel = false

export type CountedAction =
  | { type: "selectCell"; cell: number }
  | { type: "cycle" }
  | { type: "undo" }
  | { type: "clear" }

const present = (value: string | undefined) => Boolean(value?.trim())

/** Which server credentials exist. Booleans only — never the secret values. */
export function learnerCredentials(env: NodeJS.ProcessEnv = process.env) {
  const openAI = present(env.OPENAI_API_KEY)
  const gateway = present(env.AI_GATEWAY_API_KEY) || present(env.VERCEL_OIDC_TOKEN)
  const jevDirect = present(env.TYPESAFE_API_KEY)
  const layaKey = present(env.LAYA_API_KEY)
  const impossibl = present(env.IMPOSSIBL_API_KEY)
  const layaBase = present(env.LAYA_BASE_URL)
  return {
    openAI,
    gateway,
    jevDirect,
    layaKey,
    impossibl,
    layaBase,
    /** Astra can answer through OpenAI or the Vercel AI Gateway. */
    astra: openAI || gateway,
    /** Jev is called only when a direct key or the gateway credential exists. */
    jev: jevDirect || gateway,
    /**
     * Laya is called only when a Laya key, an Impossibl key, or a base URL is set.
     * An AI Gateway credential does not stand in for Laya.
     */
    laya: layaKey || impossibl || layaBase,
  }
}

export type JevCommit = "wait" | "one" | "batch"

const commitQuestions = {
  commit: {
    type: "choice" as const,
    instructions: "How much of this public-board plan should be played now?",
    criteria: {
      wait: "Play only the first placement. Do not drop the plan.",
      one: "Play only the first placement.",
      batch: "Play the whole short plan.",
    },
  },
}

/** TypeSafe System One body. State is public board data supplied by the caller. */
export function jevCommitBody(state: string) {
  return {
    model: "jev-1.13.0",
    state,
    questions: commitQuestions,
  }
}

/** Convai Laya System One body. Same choice question as Jev, different model id. */
export function layaCommitBody(state: string) {
  return {
    model: "convaiinnovations/laya",
    state,
    questions: commitQuestions,
  }
}

/**
 * Where a Laya commit is sent. Returns null when no Laya credential is set.
 * `LAYA_BASE_URL` wins. Otherwise a lone Impossibl key uses api.impossibl.com,
 * and a Laya key uses api.laya.studio.
 */
export function layaSystemOneTarget(env: NodeJS.ProcessEnv = process.env): {
  url: string
  authorization: string | null
} | null {
  if (!learnerCredentials(env).laya) return null
  const explicit = env.LAYA_BASE_URL?.trim()
  const impossiblOnly =
    present(env.IMPOSSIBL_API_KEY) && !present(env.LAYA_API_KEY) && !explicit
  const origin = (
    explicit ||
    (impossiblOnly ? "https://api.impossibl.com" : "https://api.laya.studio")
  ).replace(/\/$/, "")
  const url = origin.endsWith("/v1/systemone")
    ? origin
    : origin.endsWith("/v1")
      ? `${origin}/systemone`
      : `${origin}/v1/systemone`
  const key = (
    /impossibl\.com/i.test(url)
      ? env.IMPOSSIBL_API_KEY?.trim() || env.LAYA_API_KEY?.trim()
      : env.LAYA_API_KEY?.trim() || env.IMPOSSIBL_API_KEY?.trim()
  )?.trim()
  return { url, authorization: key ? `Bearer ${key}` : null }
}

export function readJevCommit(body: unknown): JevCommit | null {
  if (!body || typeof body !== "object") return null
  const choice = (body as { answers?: { commit?: { choice?: unknown } } })
    .answers?.commit?.choice
  if (choice === "wait" || choice === "one" || choice === "batch") return choice
  return null
}

export const policySchema = z.strictObject({
  rule: z.enum(["first-unlocked", "selected-cycle", "named-cells"]),
  cells: z.array(z.number().int().min(0).max(35)).max(4),
  /** Target value for each named cell; null means empty. */
  value: z.number().int().min(0).max(36).nullable(),
  note: z.string().max(160).nullable(),
})

export type LearnerPolicy = z.infer<typeof policySchema>

/**
 * In-browser sandbox for a Code-mode policy.
 * It reads engine affordances only. It does not eval JavaScript,
 * search hidden values, or call the network.
 */
export function interpretPolicy(
  policy: LearnerPolicy,
  board: BoardView
): CountedAction[] {
  if (policy.rule === "selected-cycle") {
    if (!board.affordances.controls.cycle) return []
    return [{ type: "cycle" }]
  }
  const indexes =
    policy.rule === "first-unlocked"
      ? (() => {
          const offered = board.affordances.controls.selectCell
          const hit = offered.find((cell) => {
            const item = board.affordances.cells[cell]
            if (!item) return false
            return (
              item.value === policy.value ||
              item.options.includes(policy.value)
            )
          })
          return hit !== undefined ? [hit] : []
        })()
      : policy.cells
  return expandPlacements(
    indexes.map((cell) => ({ cell, value: policy.value })),
    board
  )
}

/** Cells the plan actually named, when they are still offered by affordances. */
export function plannedChoiceCells(
  placements: readonly Placement[],
  affordances: BoardAffordances
) {
  const offered = new Set(affordances.controls.selectCell)
  const indexes: number[] = []
  for (const placement of placements) {
    if (!offered.has(placement.cell) || indexes.includes(placement.cell))
      continue
    const cell = affordances.cells[placement.cell]
    if (!cell) continue
    if (
      cell.value !== placement.value &&
      !cell.options.includes(placement.value)
    )
      continue
    indexes.push(placement.cell)
  }
  return indexes
}

/**
 * A wait must not erase a concrete plan. The named cell is played when the
 * chooser picks it; otherwise the first legal placement is played.
 */
export function placementToPlay(
  placements: readonly Placement[],
  affordances: BoardAffordances,
  choice: CountedAction | "wait" | null
): Placement | null {
  const offered = new Set(affordances.controls.selectCell)
  const legal = (placement: Placement) => {
    if (!offered.has(placement.cell)) return false
    const cell = affordances.cells[placement.cell]
    if (!cell) return false
    return (
      cell.value === placement.value ||
      cell.options.includes(placement.value)
    )
  }
  if (choice && choice !== "wait" && choice.type === "selectCell")
    return (
      placements.find((item) => item.cell === choice.cell && legal(item)) ??
      null
    )
  if (choice === "wait" || choice === null)
    return placements.find(legal) ?? null
  return null
}

/** Open cells from the engine controls list, in board order. */
export function bareCandidateCells(affordances: BoardAffordances) {
  return [...affordances.controls.selectCell]
}

/** Minimal System One question. Only engine-offered controls appear. */
export function bareControlQuestions(
  cells: readonly number[],
  controls: { cycle?: boolean; undo?: boolean; clear?: boolean } = {}
) {
  const criteria: Record<string, string> = {
    wait: "No supported tap on the visible board.",
  }
  if (controls.undo) criteria.undo = "Undo the last counted change."
  if (controls.clear) criteria.clear = "Restore the round's starting board."
  if (controls.cycle) criteria.cycle = "Cycle the selected editable cell once."
  for (const cell of cells) {
    criteria[`cell-${cell}`] = `Select visible cell ${cell}.`
  }
  return {
    control: {
      type: "choice" as const,
      instructions:
        "Pick one counted control from the public board. Do not search.",
      criteria,
    },
  }
}

export const captionSchema = z.strictObject({
  option: z.string().min(1).max(40),
  outcome: z.string().min(1).max(160),
})

export type Caption = z.infer<typeof captionSchema>

/**
 * Choice over legal controls with Astra planner captions.
 * Mirrors labs: Decisions/Jev see precomputed outcomes + a short instruction,
 * never a bare board-only state.
 */
export function plannedControlQuestions(
  cells: readonly number[],
  captions: Readonly<Record<string, string>> = {},
  patternClaim: string | null = null,
  controls: { cycle?: boolean; undo?: boolean; clear?: boolean } = {}
) {
  const claim = patternClaim?.trim().slice(0, 120)
  const caption = (key: string, fallback: string) => {
    const written = captions[key]?.trim()
    return written || fallback
  }
  const criteria: Record<string, string> = {
    wait: caption("wait", "Play the plan's first cell. Do not skip the turn."),
  }
  if (controls.undo)
    criteria.undo = caption("undo", "Undo the last counted change.")
  if (controls.clear)
    criteria.clear = caption("clear", "Restore the round's starting board.")
  if (controls.cycle)
    criteria.cycle = caption(
      "cycle",
      "Cycle the selected editable cell once after the plan's selection."
    )
  for (const cell of cells) {
    const key = `cell-${cell}`
    criteria[key] = caption(
      key,
      `Select visible cell ${cell} as the next counted tap.`
    )
  }
  return {
    control: {
      type: "choice" as const,
      instructions: claim
        ? `Choose the single next counted control for this claim: ${claim}`
        : "Choose the single next counted control. Use the public plan and captions as context. Do not search hidden values.",
      criteria,
    },
  }
}

export function readBareControl(
  body: unknown,
  cells: readonly number[]
): CountedAction | "wait" | null {
  if (!body || typeof body !== "object") return null
  const choice = (body as { answers?: { control?: { choice?: unknown } } })
    .answers?.control?.choice
  if (choice === "wait") return "wait"
  if (choice === "cycle") return { type: "cycle" }
  if (choice === "undo") return { type: "undo" }
  if (choice === "clear") return { type: "clear" }
  if (typeof choice !== "string" || !choice.startsWith("cell-")) return null
  const cell = Number(choice.slice(5))
  if (!cells.includes(cell)) return null
  return { type: "selectCell", cell }
}

/** `null` keeps the Astra plan. Jev `wait` drops it. `one` keeps the first placement. */
export function applyCommit<T>(
  items: readonly T[],
  choice: JevCommit | null
): T[] {
  if (choice === "wait") return []
  if (choice === "one") return items.slice(0, 1)
  return [...items]
}

/**
 * In-browser expansion of a model plan into counted taps via the engine
 * contract. It does not search for a solution. Illegal intents are skipped.
 */
export function expandPlacements(
  placements: readonly Placement[] | undefined,
  board: BoardView
): CountedAction[] {
  if (!placements?.length) return []
  const actions: CountedAction[] = []
  for (const placement of placements.slice(0, 6)) {
    const compiled = compileBoardIntent(board, placement)
    if (!compiled.ok) continue
    for (const action of compiled.actions) {
      actions.push(action)
      if (actions.length >= 24) return actions
    }
  }
  return actions
}

/** Strip host-only class labels from a Learner board when the flag is off. */
export function learnerBoardPayload<T extends { category: string; mode: string }>(
  board: T
): T | Omit<T, "category" | "mode"> {
  if (exposeLearnerClassLabel) return board
  const { category, mode, ...publicBoard } = board
  void category
  void mode
  return publicBoard
}

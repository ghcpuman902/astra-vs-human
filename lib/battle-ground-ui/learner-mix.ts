import { z } from "zod"

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

export const learnerMixIds = [
  "astra",
  "astra-hybrid",
  "code",
  "astra-jev",
  "jev-bare",
  "astra-laya",
  "laya-bare",
  "openai-decisions",
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
] as const satisfies readonly LearnerMixId[]

export const placementSchema = z.strictObject({
  cell: z.number().int().min(0).max(35),
  cycles: z.number().int().min(1).max(4),
})

export type Placement = z.infer<typeof placementSchema>

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
      wait: "The plan is not supported by the visible board.",
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

type VisibleCell = { visible: boolean; locked: boolean }

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
  cycles: z.number().int().min(1).max(3),
  note: z.string().max(160).nullable(),
})

export type LearnerPolicy = z.infer<typeof policySchema>

/**
 * In-browser sandbox for a Code-mode policy.
 * It reads visible and locked flags only. It does not eval JavaScript,
 * search hidden values, or call the network.
 */
export function interpretPolicy(
  policy: LearnerPolicy,
  cells: readonly VisibleCell[]
): CountedAction[] {
  if (policy.rule === "selected-cycle") {
    return Array.from({ length: policy.cycles }, () => ({ type: "cycle" }))
  }
  const indexes =
    policy.rule === "first-unlocked"
      ? cells.flatMap((cell, index) =>
          cell.visible && !cell.locked ? [index] : []
        ).slice(0, 1)
      : policy.cells
  return expandPlacements(
    indexes.map((cell) => ({ cell, cycles: policy.cycles })),
    cells
  )
}

/** Up to six visible editable cells, in board order, for a bare choice. */
export function bareCandidateCells(cells: readonly VisibleCell[]) {
  const indexes: number[] = []
  for (let index = 0; index < cells.length && indexes.length < 6; index++) {
    const cell = cells[index]
    if (cell?.visible && !cell.locked) indexes.push(index)
  }
  return indexes
}

/** Minimal System One question. No plan and no written context. */
export function bareControlQuestions(cells: readonly number[]) {
  const criteria: Record<string, string> = {
    wait: "No supported tap on the visible board.",
    cycle: "Cycle the selected editable cell once.",
    undo: "Undo the last counted change.",
    clear: "Restore the round's starting board.",
  }
  for (const cell of cells.slice(0, 6)) {
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
 * In-browser expansion of a model plan into counted taps.
 * It does not search for a solution. Locked or hidden cells are skipped.
 */
export function expandPlacements(
  placements: readonly Placement[] | undefined,
  cells: readonly VisibleCell[]
): CountedAction[] {
  if (!placements?.length) return []
  const actions: CountedAction[] = []
  for (const placement of placements.slice(0, 6)) {
    const cell = cells[placement.cell]
    if (!cell?.visible || cell.locked) continue
    if (placement.cycles < 1 || placement.cycles > 4) continue
    actions.push({ type: "selectCell", cell: placement.cell })
    for (let step = 0; step < placement.cycles; step++)
      actions.push({ type: "cycle" })
    if (actions.length >= 24) break
  }
  return actions
}

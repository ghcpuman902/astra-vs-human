import { z } from "zod"

/**
 * Inspectable agent work, shaped like AI SDK UIMessage parts but read-only.
 * The server records one step per model call; the browser groups a whole
 * request (plan → decide → play → check) into one message per decision.
 */

export const serverStepKinds = ["plan", "policy", "decide", "commit"] as const
export type ServerStepKind = (typeof serverStepKinds)[number]

const count = z.number().int().min(0).max(10_000_000)
export const usageSchema = z.strictObject({
  inputTokens: count,
  outputTokens: count,
  reasoningTokens: count,
})
export type AgentUsage = z.infer<typeof usageSchema>

export const serverStepSchema = z.strictObject({
  kind: z.enum(serverStepKinds),
  model: z.string().max(120),
  ms: z.number().int().min(0).max(600_000),
  status: z.enum(["ok", "error"]),
  usage: usageSchema.optional(),
  note: z.string().max(160).optional(),
})
export type ServerStep = z.infer<typeof serverStepSchema>

type UsageLike =
  | {
      inputTokens?: number | undefined
      outputTokens?: number | undefined
      outputTokenDetails?: { reasoningTokens?: number | undefined }
    }
  | undefined

const whole = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value as number)) : 0

/** AI SDK usage → three plain counters. Missing numbers count as zero. */
export function readUsage(usage: UsageLike): AgentUsage | undefined {
  if (!usage) return undefined
  const next = {
    inputTokens: whole(usage.inputTokens),
    outputTokens: whole(usage.outputTokens),
    reasoningTokens: whole(usage.outputTokenDetails?.reasoningTokens),
  }
  return next.inputTokens || next.outputTokens ? next : undefined
}

/** Times one model call and appends what it cost. Never records prompts or keys. */
export async function traced<T>(
  steps: ServerStep[] | undefined,
  step: { kind: ServerStepKind; model: string },
  run: () => Promise<T>,
  read: (value: T) => { usage?: UsageLike; note?: string } = () => ({})
): Promise<T> {
  const started = performance.now()
  const ms = () => Math.min(600_000, Math.round(performance.now() - started))
  try {
    const value = await run()
    const { usage, note } = read(value)
    const tokens = readUsage(usage)
    steps?.push({
      ...step,
      model: step.model.slice(0, 120),
      ms: ms(),
      status: "ok",
      ...(tokens ? { usage: tokens } : {}),
      ...(note ? { note: note.slice(0, 160) } : {}),
    })
    return value
  } catch (error) {
    steps?.push({
      ...step,
      model: step.model.slice(0, 120),
      ms: ms(),
      status: "error",
      note:
        error instanceof Error && error.name === "AbortError"
          ? "Stopped at the deadline"
          : "Call failed",
    })
    throw error
  }
}

export const sumUsage = (steps: readonly ServerStep[]): AgentUsage =>
  steps.reduce(
    (sum, step) => ({
      inputTokens: sum.inputTokens + (step.usage?.inputTokens ?? 0),
      outputTokens: sum.outputTokens + (step.usage?.outputTokens ?? 0),
      reasoningTokens: sum.reasoningTokens + (step.usage?.reasoningTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 }
  )

/* ---------- Browser side ---------- */

export type AgentPhase =
  "ready" | "thinking" | "playing" | "waiting" | "retrying" | "done"

export type AgentPart =
  | {
      type: "tool"
      tool: ServerStepKind | "run-policy" | "apply" | "check"
      state: "done" | "error"
      text: string
      model?: string
      ms?: number
      usage?: AgentUsage
    }
  /** Pattern claim: the one public line the agent carries to the next board. */
  | { type: "reasoning"; text: string }
  | { type: "status"; tone: "wait" | "retry" | "error"; text: string }

export type AgentMessage = {
  id: number
  seed: number
  /** Zero-based board index in this match. */
  board: number
  /** Epoch ms when the request left the browser. */
  at: number
  /** Round-trip ms. Null while the request is in flight. */
  ms: number | null
  state: "streaming" | "done" | "error"
  parts: AgentPart[]
}

export type BoardMeter = { tokens: number; thinkMs: number; calls: number }
export type AgentMeters = AgentUsage & {
  thinkMs: number
  calls: number
  boards: Record<string, BoardMeter>
}

export type AgentTraceSnapshot = {
  phase: AgentPhase
  label: string
  /** Epoch ms of the request in flight, so a meter can count it live. */
  pendingSince: number | null
  claim: string
  messages: readonly AgentMessage[]
  meters: AgentMeters
}

const MESSAGES = 120
const emptyMeters = (): AgentMeters => ({
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  thinkMs: 0,
  calls: 0,
  boards: {},
})
const initialTrace = (): AgentTraceSnapshot => ({
  phase: "ready",
  label: "Ready",
  pendingSince: null,
  claim: "",
  messages: [],
  meters: emptyMeters(),
})

const partSchema = z.union([
  z.strictObject({
    type: z.literal("tool"),
    tool: z.enum([...serverStepKinds, "run-policy", "apply", "check"]),
    state: z.enum(["done", "error"]),
    text: z.string().max(240),
    model: z.string().max(120).optional(),
    ms: z.number().min(0).max(600_000).optional(),
    usage: usageSchema.optional(),
  }),
  z.strictObject({ type: z.literal("reasoning"), text: z.string().max(240) }),
  z.strictObject({
    type: z.literal("status"),
    tone: z.enum(["wait", "retry", "error"]),
    text: z.string().max(240),
  }),
])
const boardMeterSchema = z.strictObject({
  tokens: count,
  thinkMs: z.number().min(0),
  calls: count,
})
export const agentTraceSchema = z.strictObject({
  phase: z.enum([
    "ready",
    "thinking",
    "playing",
    "waiting",
    "retrying",
    "done",
  ]),
  label: z.string().max(240),
  pendingSince: z.number().nullable(),
  claim: z.string().max(240),
  messages: z
    .array(
      z.strictObject({
        id: z.number().int().min(0),
        seed: z.number().int(),
        board: z.number().int().min(0),
        at: z.number(),
        ms: z.number().min(0).nullable(),
        state: z.enum(["streaming", "done", "error"]),
        parts: z.array(partSchema).max(16),
      })
    )
    .max(MESSAGES),
  meters: usageSchema.extend({
    thinkMs: z.number().min(0),
    calls: count,
    boards: z.record(z.string(), boardMeterSchema),
  }),
})

/** A paused copy: in-flight work from before a reload is closed, not resumed. */
function settle(trace: AgentTraceSnapshot): AgentTraceSnapshot {
  return {
    ...trace,
    phase: trace.phase === "done" ? "done" : "ready",
    label: trace.phase === "done" ? trace.label : "Paused",
    pendingSince: null,
    messages: trace.messages.map((message) =>
      message.state === "streaming"
        ? {
            ...message,
            state: "error",
            parts: [
              ...message.parts,
              {
                type: "status",
                tone: "error",
                text: "Page reloaded before this answer came back.",
              },
            ],
          }
        : message
    ),
  }
}

export function parseAgentTrace(raw: unknown): AgentTraceSnapshot | null {
  const parsed = agentTraceSchema.safeParse(raw)
  return parsed.success ? settle(parsed.data) : null
}

/** One side's trace. A plain store so React can read it with useSyncExternalStore. */
export function createAgentTrace(initial?: AgentTraceSnapshot | null) {
  let snapshot: AgentTraceSnapshot = initial ?? initialTrace()
  let nextId = snapshot.messages.reduce((max, m) => Math.max(max, m.id + 1), 0)
  const listeners = new Set<() => void>()
  const set = (next: Partial<AgentTraceSnapshot>) => {
    snapshot = { ...snapshot, ...next }
    listeners.forEach((listener) => listener())
  }
  const update = (
    id: number,
    change: (message: AgentMessage) => AgentMessage
  ) =>
    set({
      messages: snapshot.messages.map((message) =>
        message.id === id ? change(message) : message
      ),
    })
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    phase: (phase: AgentPhase, label: string) => {
      if (snapshot.phase !== phase || snapshot.label !== label)
        set({ phase, label })
    },
    claim: (claim: string) => set({ claim }),
    /** Opens a message for one request. Returns its id. */
    begin: (seed: number, board: number, label: string) => {
      const id = nextId++
      const at = Date.now()
      set({
        phase: "thinking",
        label,
        pendingSince: at,
        messages: [
          ...snapshot.messages,
          {
            id,
            seed,
            board,
            at,
            ms: null,
            state: "streaming" as const,
            parts: [],
          },
        ].slice(-MESSAGES),
      })
      return id
    },
    /** Adds parts to a message, open or closed (taps land after the answer). */
    add: (id: number, ...parts: AgentPart[]) =>
      update(id, (message) => ({
        ...message,
        parts: [...message.parts, ...parts].slice(-16),
      })),
    /** Closes the request and books its wall time and tokens. */
    end: (
      id: number,
      state: "done" | "error",
      usage: AgentUsage = {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      }
    ) => {
      const message = snapshot.messages.find((item) => item.id === id)
      if (!message || message.state !== "streaming") return
      const ms = Math.max(0, Date.now() - message.at)
      const key = String(message.seed)
      const board = snapshot.meters.boards[key] ?? {
        tokens: 0,
        thinkMs: 0,
        calls: 0,
      }
      const meters = snapshot.meters
      snapshot = {
        ...snapshot,
        pendingSince: null,
        meters: {
          inputTokens: meters.inputTokens + usage.inputTokens,
          outputTokens: meters.outputTokens + usage.outputTokens,
          reasoningTokens: meters.reasoningTokens + usage.reasoningTokens,
          thinkMs: meters.thinkMs + ms,
          calls: meters.calls + 1,
          boards: {
            ...meters.boards,
            [key]: {
              tokens: board.tokens + usage.inputTokens + usage.outputTokens,
              thinkMs: board.thinkMs + ms,
              calls: board.calls + 1,
            },
          },
        },
      }
      update(id, (item) => ({ ...item, ms, state }))
    },
  }
}
export type AgentTrace = ReturnType<typeof createAgentTrace>

"use client"

import { z } from "zod"

import {
  parseAgentTrace,
  type AgentTraceSnapshot,
} from "@/lib/battle-ground-ui/agent-trace"
import type { BattleDump } from "@/lib/battle-ground-ui/controller"
import type { FamilyMarks } from "@/lib/battle-ground-ui/family-bias"
import {
  learnerMixIds,
  type LearnerMixId,
} from "@/lib/battle-ground-ui/learner-mix"
import {
  MATCH_LENGTHS,
  type DealtMatch,
  type MatchLength,
} from "@/lib/battle-ground-ui/match-deck"
import { packSchema } from "@/lib/mini-game-rules/schema"

/** One match in progress (or just finished) in this browser. Survives a reload. */
export type SavedMatch = {
  v: 1
  savedAt: number
  finished: boolean
  setup: {
    arena: "play" | "watch"
    leftMix: LearnerMixId
    rightMix: LearnerMixId
    length: MatchLength
    marks: FamilyMarks
    practice: boolean
  }
  dealt: DealtMatch
  source: string
  rulesShown: boolean
  started: boolean
  model: string | null
  /** Agent A's model in Agent vs Agent. Older saves have none. */
  rivalModel?: string | null
  battle: BattleDump
  traces: {
    human: AgentTraceSnapshot | null
    learner: AgentTraceSnapshot | null
  }
}

const KEY = "avh:match:v1"
/** A paused match is kept for half a day; a finished one only long enough to reread results. */
const LIVE_MS = 12 * 60 * 60 * 1000
const FINISHED_MS = 15 * 60 * 1000

const setupSchema = z.strictObject({
  arena: z.enum(["play", "watch"]),
  leftMix: z.enum(learnerMixIds),
  rightMix: z.enum(learnerMixIds),
  length: z.enum(MATCH_LENGTHS),
  marks: z.strictObject({
    played: z.array(z.string().max(80)).max(40),
    disliked: z.array(z.string().max(80)).max(40),
  }),
  practice: z.boolean(),
})
const cellValue = z.number().int().nullable()
const status = z.enum(["playing", "finished", "action-cap", "time-cap"])
const sides = <T extends z.ZodType>(item: T) =>
  z.strictObject({ human: item, learner: item })
const dumpSchema = z.strictObject({
  cursor: sides(z.number().int().min(0).max(64)),
  records: z
    .array(
      z.strictObject({
        seed: z.number().int(),
        side: z.enum(["human", "learner"]),
        transferGroup: z.string().max(200),
        status: z.enum(["finished", "action-cap", "time-cap"]),
        actions: z.number().int().min(0),
        elapsedMs: z.number().min(0),
        claim: z.string().max(240).nullable(),
        cells: z.array(cellValue).max(64).optional(),
      })
    )
    .max(256),
  attempts: sides(
    z.strictObject({
      state: z.strictObject({
        cells: z.array(cellValue).max(64),
        selectedCell: z.number().int().nullable(),
        history: z.array(z.array(cellValue).max(64)).max(1000),
        actions: z.number().int().min(0),
      }),
      status,
      claim: z.string().max(240).nullable(),
      elapsedMs: z.number().min(0),
    })
  ),
  matchMs: sides(z.number().min(0)),
  stopped: sides(z.boolean()),
  // Missing on matches saved before overtime existed.
  overtime: sides(z.boolean()).optional(),
})
const savedSchema = z.strictObject({
  v: z.literal(1),
  savedAt: z.number(),
  finished: z.boolean(),
  setup: setupSchema,
  dealt: z.strictObject({
    length: z.enum(MATCH_LENGTHS),
    packs: z.array(packSchema).min(1).max(32),
    gameCount: z.number().int().min(1),
    roundsPerGame: z.number().int().min(1),
    clock: z.enum(["attempt", "side"]),
    timeCapMs: z.number().positive().nullable(),
    category: z.string().nullable(),
    familyId: z.string().nullable(),
    solutions: z
      .record(z.string().max(24), z.array(cellValue).max(64))
      .optional(),
  }),
  source: z.string().max(200),
  rulesShown: z.boolean(),
  started: z.boolean(),
  model: z.string().max(120).nullable(),
  rivalModel: z.string().max(120).nullable().optional(),
  battle: dumpSchema,
  traces: sides(z.unknown()),
})

export function readMatch(now = Date.now()): SavedMatch | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null")
    if (!raw) return null
    const parsed = savedSchema.safeParse(raw)
    const age = parsed.success ? now - parsed.data.savedAt : Infinity
    if (
      !parsed.success ||
      age < 0 ||
      age > (parsed.data.finished ? FINISHED_MS : LIVE_MS)
    ) {
      clearMatch()
      return null
    }
    return {
      ...parsed.data,
      dealt: parsed.data.dealt as DealtMatch,
      traces: {
        human: parseAgentTrace(parsed.data.traces.human),
        learner: parseAgentTrace(parsed.data.traces.learner),
      },
    }
  } catch {
    return null
  }
}

export function saveMatch(match: Omit<SavedMatch, "v" | "savedAt">) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...match, v: 1, savedAt: Date.now() })
    )
  } catch {}
}

export function clearMatch() {
  try {
    localStorage.removeItem(KEY)
  } catch {}
}

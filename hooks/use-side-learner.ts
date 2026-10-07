"use client"

import { useEffect, useSyncExternalStore } from "react"

import {
  sumUsage,
  type AgentPart,
  type AgentTrace,
} from "@/lib/battle-ground-ui/agent-trace"
import {
  transferGroup,
  type Side,
  createBattleGround,
} from "@/lib/battle-ground-ui/controller"
import {
  interpretPolicy,
  type LearnerMixId,
} from "@/lib/battle-ground-ui/learner-mix"
import {
  createGameLearnerRunner,
  fetchGameLearnerDecision,
} from "@/lib/battle-ground-ui/model-learner"
import type { GamePack } from "@/lib/mini-game-rules/schema"
import { createLearnerMemory, type LearnerMemory } from "@/lib/puzzle/learner"

type BattleController = ReturnType<typeof createBattleGround>

/** What the agent is doing while a request is in flight, by ability. */
const THINKING: Record<LearnerMixId, string> = {
  astra: "Planning taps",
  "astra-hybrid": "Planning taps",
  code: "Writing a policy",
  "astra-jev": "Planning · Jev commits",
  "jev-bare": "Jev is choosing",
  "astra-laya": "Planning · Laya commits",
  "laya-bare": "Laya is choosing",
  "openai-decisions": "Planning · Luna decides",
}
const ENDED: Record<string, string> = {
  finished: "Finished",
  "action-cap": "Out of taps",
  "time-cap": "Out of time",
}
const WAIT: Record<string, string> = {
  deadline: "No answer within 8 s. Asking again.",
  unavailable: "Server could not reach the model. Asking again.",
  "invalid-decision": "Answer broke the board rules, so nothing was played.",
  inactive: "Board was not live when the answer arrived.",
}

// A reload aborts fetches in flight. Those stay open so the restored trace
// says "Page reloaded" instead of blaming the server.
let unloading = false
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    unloading = true
  })
  // Back from the bfcache: the page lives on, so errors count again.
  window.addEventListener("pageshow", () => {
    unloading = false
  })
}

export function useSideLearner({
  enabled,
  side,
  battle,
  packs,
  started,
  mix,
  getModel,
  trace,
}: {
  enabled: boolean
  side: Side
  battle: BattleController
  packs: readonly GamePack[]
  started: boolean
  mix: LearnerMixId
  getModel: () => string | undefined
  trace: AgentTrace
}) {
  const snapshot = useSyncExternalStore(
    trace.subscribe,
    trace.getSnapshot,
    trace.getSnapshot
  )
  useEffect(() => {
    if (!started || !enabled) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const start = battle.getSnapshot()
    const mine = start.records.filter((record) => record.side === side)
    // After a reload, rounds already recorded stay closed and their claims carry.
    const memory = createLearnerMemory()
    memory.claims = [
      ...new Set(
        mine.flatMap((record) => (record.claim ? [record.claim] : []))
      ),
    ].slice(-30)
    const memories: Record<string, LearnerMemory> = {}
    const closed = new Set<number>(mine.map((record) => record.seed))
    let family: string | null = null
    // The message for the request this loop turn opened, if any.
    let open: { id: number; planned: number } | null = null
    const syncMemory = () => {
      const pack = packs[battle.getSnapshot().cursors[side].index]
      const nextFamily = transferGroup(pack)
      if (family === nextFamily) return
      if (family === null) {
        family = nextFamily
        memories[nextFamily] = {
          claims: [...memory.claims],
          currentClaim: null,
        }
        memory.currentClaim = null
        return
      }
      memories[family] = {
        claims: [...memory.claims],
        currentClaim: memory.currentClaim,
      }
      family = nextFamily
      const stored = memories[nextFamily] ?? createLearnerMemory()
      memories[nextFamily] = stored
      memory.claims = [...stored.claims]
      memory.currentClaim = null
    }
    const runner = createGameLearnerRunner({
      observe: () => battle.boardProps(side),
      api: battle.actions(side),
      memory,
      model: getModel,
      mix,
      decide: async (request, signal) => {
        const board = battle.getSnapshot().cursors[side].index
        const id = trace.begin(request.board.seed, board, THINKING[mix])
        open = { id, planned: 0 }
        let result
        try {
          result = await fetchGameLearnerDecision(request, signal)
        } catch (error) {
          if (unloading) throw error
          trace.add(id, {
            type: "status",
            tone: "error",
            text: disposed
              ? "Paused or changed. Request cancelled."
              : request.model && getModel() !== request.model
                ? "Model changed. Request cancelled."
                : signal.aborted
                  ? "No answer within 8 s. Request cancelled."
                  : "Request failed before the server answered.",
          })
          trace.end(id, "error")
          if (!disposed) trace.phase("retrying", "Retrying")
          throw error
        }
        const parts: AgentPart[] = (result.trace ?? []).map((step) => ({
          type: "tool",
          tool: step.kind,
          state: step.status === "ok" ? "done" : "error",
          text: step.note ?? (step.status === "ok" ? "Done" : "Failed"),
          model: step.model,
          ms: step.ms,
          ...(step.usage ? { usage: step.usage } : {}),
        }))
        const steps = result.policy
          ? interpretPolicy(result.policy, request.board.cells)
          : undefined
        if (result.policy && steps)
          parts.push({
            type: "tool",
            tool: "run-policy",
            state: "done",
            text: `Ran ${result.policy.rule} in this browser → ${steps.length} taps`,
          })
        const played = steps ? { ...result, steps } : result
        const batch = played.steps?.length
          ? played.steps.filter((step) => step.type === "selectCell").length
          : (played.placements?.length ?? 0)
        open.planned = played.steps?.length
          ? played.steps.length
          : (played.placements?.reduce(
              (sum, item) => sum + 1 + item.cycles,
              0
            ) ?? (played.action ? 1 : 0))
        if (played.patternClaim)
          parts.push({ type: "reasoning", text: played.patternClaim })
        if (played.state !== "decision")
          parts.push({
            type: "status",
            tone:
              played.reason === "deadline" || played.reason === "unavailable"
                ? "retry"
                : "wait",
            text:
              (played.reason && WAIT[played.reason]) ??
              "No tap this turn. Looking again.",
          })
        trace.add(id, ...parts)
        trace.end(
          id,
          played.state === "decision" ? "done" : "error",
          sumUsage(result.trace ?? [])
        )
        if (!disposed) {
          trace.phase(
            played.state === "decision"
              ? "playing"
              : played.reason === "deadline" || played.reason === "unavailable"
                ? "retrying"
                : "waiting",
            played.state === "decision"
              ? batch > 1
                ? `Playing · ${batch} cells`
                : `Playing · ${played.action?.type ?? played.policy?.rule ?? "plan"}`
              : played.patternClaim
                ? played.patternClaim
                : played.reason === "deadline"
                  ? "Thinking took too long; retrying"
                  : played.reason === "unavailable"
                    ? "Connection unavailable; retrying"
                    : "Considering next move"
          )
          if (played.patternClaim) trace.claim(played.patternClaim)
        }
        return played
      },
    })
    const unsubscribe = battle.subscribe(runner.sync)
    const closeRound = () => {
      const snap = battle.getSnapshot()
      const seed = snap.seeds[side]
      if (snap.attempts[side].status === "playing" || closed.has(seed)) return
      closed.add(seed)
      const line = memory.currentClaim
      if (line && !memory.claims.includes(line)) memory.claims.push(line)
      if (line) battle.claim(side, line)
      memory.currentClaim = null
    }
    // After the taps land: how many were played, and what the rules now say.
    const settle = (before: { seed: number; actions: number }) => {
      if (!open) return
      const { id, planned } = open
      open = null
      const after = battle.getSnapshot()
      const attempt = after.attempts[side]
      const applied =
        after.seeds[side] === before.seed
          ? attempt.state.actions - before.actions
          : 0
      if (!planned) return
      if (!applied) {
        trace.add(id, {
          type: "status",
          tone: "wait",
          text: "Board moved on before the plan landed, so it was dropped.",
        })
        return
      }
      trace.add(
        id,
        {
          type: "tool",
          tool: "apply",
          state: "done",
          text:
            applied === planned
              ? `Played ${applied} counted tap${applied === 1 ? "" : "s"}`
              : `Played ${applied} of ${planned} taps; the rest were not legal`,
        },
        {
          type: "tool",
          tool: "check",
          state: "done",
          text:
            attempt.status === "finished"
              ? "Rules met. Board solved."
              : attempt.status === "action-cap"
                ? "Out of taps."
                : `Not solved yet · ${attempt.state.actions} taps on this board`,
        }
      )
    }
    async function loop() {
      if (disposed) return
      const snap = battle.getSnapshot()
      if (snap.attempts[side].status !== "playing") {
        closeRound()
        if (!battle.advance(side)) {
          if (!disposed)
            trace.phase(
              "done",
              ENDED[snap.attempts[side].status] ?? snap.attempts[side].status
            )
          return
        }
        if (!disposed) trace.claim("")
        syncMemory()
      }
      const current = battle.getSnapshot()
      const before = {
        seed: current.seeds[side],
        actions: current.attempts[side].state.actions,
      }
      try {
        await runner.step()
      } catch {
        if (!disposed)
          trace.phase("retrying", "Connection interrupted; retrying")
      }
      if (!disposed) settle(before)
      if (!disposed) timer = setTimeout(() => void loop(), 500)
    }
    void loop()
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      unsubscribe()
      runner.dispose()
    }
  }, [battle, enabled, getModel, mix, packs, side, started, trace])
  return { status: snapshot.label, claim: snapshot.claim, trace: snapshot }
}

"use client"

import { useEffect, useState } from "react"

import {
  transferGroup,
  type Side,
  createBattleGround,
} from "@/lib/battle-ground-ui/controller"
import type { LearnerMixId } from "@/lib/battle-ground-ui/learner-mix"
import {
  createGameLearnerRunner,
  fetchGameLearnerDecision,
} from "@/lib/battle-ground-ui/model-learner"
import type { GamePack } from "@/lib/mini-game-rules/schema"
import { createLearnerMemory, type LearnerMemory } from "@/lib/puzzle/learner"

type BattleController = ReturnType<typeof createBattleGround>

export function useSideLearner({
  enabled,
  side,
  battle,
  packs,
  started,
  mix,
  getModel,
}: {
  enabled: boolean
  side: Side
  battle: BattleController
  packs: readonly GamePack[]
  started: boolean
  mix: LearnerMixId
  getModel: () => string | undefined
}) {
  const [status, setStatus] = useState("Ready")
  const [claim, setClaim] = useState("")
  useEffect(() => {
    if (!started || !enabled) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const memory = createLearnerMemory()
    const memories: Record<string, LearnerMemory> = {}
    const closed = new Set<number>()
    let family: string | null = null
    const syncMemory = () => {
      const pack = packs[battle.getSnapshot().cursors[side].index]
      const nextFamily = transferGroup(pack)
      if (family === nextFamily) return
      if (family === null) {
        family = nextFamily
        memories[nextFamily] = { claims: [...memory.claims], currentClaim: null }
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
        if (!disposed) setStatus("Thinking")
        const result = await fetchGameLearnerDecision(request, signal)
        if (!disposed) {
          const batch = result.placements?.length ?? 0
          setStatus(
            result.state === "decision"
              ? batch > 1
                ? `Playing · ${batch} cells`
                : `Playing · ${result.action?.type ?? "plan"}`
              : result.reason === "deadline"
                ? "Thinking took too long; retrying"
                : result.reason === "unavailable"
                  ? "Connection unavailable; retrying"
                  : "Considering next move"
          )
          if (result.patternClaim) setClaim(result.patternClaim)
        }
        return result
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
    async function loop() {
      if (disposed) return
      const snap = battle.getSnapshot()
      if (snap.attempts[side].status !== "playing") {
        closeRound()
        if (!battle.advance(side)) {
          if (!disposed) setStatus(snap.attempts[side].status)
          return
        }
        if (!disposed) setClaim("")
        syncMemory()
      }
      try {
        await runner.step()
      } catch {
        if (!disposed) setStatus("Connection interrupted; retrying")
      }
      if (!disposed) timer = setTimeout(() => void loop(), 500)
    }
    void loop()
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      unsubscribe()
      runner.dispose()
    }
  }, [battle, enabled, getModel, mix, packs, side, started])
  return { status, claim }
}

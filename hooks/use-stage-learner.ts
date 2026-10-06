"use client"

import { useEffect, useState } from "react"

import {
  createStageLearner,
  type LearnerStage,
  type StageLearnerState,
} from "@/lib/puzzle/stage-learner"
import type { LearnerMemory } from "@/lib/puzzle/learner"
import type { Observation, RulePack } from "@/lib/puzzle/types"

/** Cursor owns presentation. This hook starts and stops only the real L0 player. */
export function useStageLearner(options: {
  stage: LearnerStage
  pack: RulePack
  publicMarks: NonNullable<Observation["publicMarks"]>
  memory: LearnerMemory
  model?: string
  running: boolean
}) {
  const { stage, pack, publicMarks, memory, model, running } = options
  const [result, setResult] = useState<{
    stage: LearnerStage
    state: StageLearnerState
  }>({
    stage,
    state: { seed: pack.seed, status: "idle", lastAction: null },
  })
  useEffect(() => {
    if (!running) return
    let active = true
    const session = createStageLearner({
      stage,
      pack,
      publicMarks,
      memory,
      model: () => model,
      onUpdate: (next) => {
        if (active)
          queueMicrotask(() => {
            if (active) setResult({ stage, state: next })
          })
      },
    })
    session.start()
    return () => {
      active = false
      session.dispose()
    }
  }, [stage, pack, publicMarks, memory, model, running])
  // Old round results must not flash on a new seed or after a stop.
  return result.stage !== stage || result.state.seed !== pack.seed || !running
    ? { seed: pack.seed, status: "idle" as const, lastAction: null }
    : result.state
}

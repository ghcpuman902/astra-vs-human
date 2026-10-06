"use client"

import { useMemo } from "react"

import {
  learnerDecisionBackends,
  type LearnerDecisionBackendId,
} from "@/lib/battle-ground-ui/model-learner"

/**
 * The scored Learner still calls `/api/game-learner`.
 * `typesafe-jev` and `openai-decisions` are listed so a later switch stays typed.
 * This hook does not fetch either seam.
 */
export const useLearnerDecisionBackend = () =>
  useMemo(
    () => ({
      active: "openai-generate-text" as const satisfies LearnerDecisionBackendId,
      backends: learnerDecisionBackends,
    }),
    []
  )

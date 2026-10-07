"use client"

import { useMemo } from "react"

import {
  learnerDecisionBackends,
  type LearnerDecisionBackendId,
} from "@/lib/battle-ground-ui/model-learner"

/**
 * The scored Learner still calls `/api/game-learner`.
 * Jev is reached from that route only when a server credential is set.
 * This hook does not fetch Jev or Decisions itself; the route does when wired.
 */
export const useLearnerDecisionBackend = () =>
  useMemo(
    () => ({
      active: "openai-generate-text" as const satisfies LearnerDecisionBackendId,
      backends: learnerDecisionBackends,
    }),
    []
  )

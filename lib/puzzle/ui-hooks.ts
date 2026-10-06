import type { createMatch } from "./match"
import { createLearnerMemory, finishLearnerRound, stepLearner } from "./learner"
import type { LearnerPolicy } from "./learner"

/** Wire to a UI button or paced scheduler. Each step makes at most one shared action. */
export function createLearnerController(
  match: ReturnType<typeof createMatch>,
  policy?: LearnerPolicy
) {
  const memory = createLearnerMemory()
  const api = match.actions("learner")
  let seed = match.observe("learner").seed
  let claimed = false
  return {
    step: () => {
      let view = match.observe("learner")
      if (view.seed !== seed) {
        seed = view.seed
        memory.currentClaim = null
        claimed = false
      }
      const acted = stepLearner(view, api, memory, policy)
      view = match.observe("learner")
      if (view.status !== "playing" && !claimed) {
        claimed = true
        match.claim("learner", finishLearnerRound(memory))
      }
      return acted
    },
    getClaims: () => [...memory.claims],
  }
}

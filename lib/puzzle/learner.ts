import type { Action, ActionAPI, Observation } from "./types"

export type LearnerDecision = {
  action: Action | null
  patternClaim?: string
}
export type LearnerPolicy = (
  view: Observation,
  priorClaims: readonly string[]
) => LearnerDecision
export type LearnerMemory = {
  claims: string[]
  currentClaim: string | null
}
export const createLearnerMemory = (): LearnerMemory => ({
  claims: [],
  currentClaim: null,
})

/** Replace this stub with a policy receiving only the visible board and postcard.
 * There is deliberately no built-in rule interpreter or puzzle-class solver.
 * An async model adapter can obtain one decision first, then supply it here.
 */
export const idleLearnerPolicy: LearnerPolicy = () => ({ action: null })

export function chooseLearnerAction(
  view: Observation,
  memory: LearnerMemory,
  policy: LearnerPolicy = idleLearnerPolicy
): Action | null {
  if (
    view.status !== "playing" ||
    view.remainingActions <= 0 ||
    view.remainingMs <= 0
  )
    return null
  const decision = policy(view, Object.freeze([...memory.claims]))
  if (decision.patternClaim) {
    memory.currentClaim = decision.patternClaim
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240)
  }
  const action = decision.action
  if (!action) return null
  if (action.type === "selectCell") {
    if (
      !Number.isInteger(action.cell) ||
      action.cell < 0 ||
      action.cell >= view.cells.length
    )
      return null
  } else if (!["cycle", "undo", "clear"].includes(action.type)) return null
  return action
}

/** Execute exactly one decision through the same four controls as the human. */
export function stepLearner(
  view: Observation,
  api: ActionAPI,
  memory: LearnerMemory,
  policy: LearnerPolicy = idleLearnerPolicy
): boolean {
  const action = chooseLearnerAction(view, memory, policy)
  if (!action) return false
  if (action.type === "selectCell") api.selectCell(action.cell)
  else api[action.type]()
  return true
}

export function finishLearnerRound(memory: LearnerMemory): string {
  const claim = memory.currentClaim ?? "No pattern claim supplied this round."
  memory.claims.push(claim)
  memory.currentClaim = null
  return claim
}

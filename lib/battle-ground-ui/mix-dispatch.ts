import type { ServerStep } from "./agent-trace"
import type {
  CountedAction,
  LearnerMixId,
  LearnerProgram,
  Placement,
} from "./learner-mix"
import type { GameLearnerRequest } from "./model-learner"

export type BareMixId = "jev-bare" | "laya-bare" | "openai-bare"
export type PlannedMixId = "astra" | "astra-hybrid" | "astra-jev" | "astra-laya"

export type MixDecision = {
  action: CountedAction | null
  patternClaim: string | null
  placements?: Placement[]
  program?: LearnerProgram
}

type BareChoice = CountedAction | "wait" | "unconfigured" | null

/**
 * Provider seams for one Learner mix. Tests pass stubs. The route passes the
 * live network functions from learner-providers.
 */
export type MixProviders = {
  bare: (
    input: GameLearnerRequest,
    mix: BareMixId,
    signal: AbortSignal,
    env: NodeJS.ProcessEnv,
    steps?: ServerStep[]
  ) => Promise<BareChoice>
  plan: (
    input: GameLearnerRequest,
    mix: PlannedMixId,
    signal: AbortSignal,
    env: NodeJS.ProcessEnv,
    steps?: ServerStep[]
  ) => Promise<{
    placements: Placement[]
    patternClaim: string | null
  }>
  decisions: (
    input: GameLearnerRequest,
    signal: AbortSignal,
    env: NodeJS.ProcessEnv,
    steps?: ServerStep[]
  ) => Promise<{
    action: CountedAction | null
    placements?: Placement[]
    patternClaim: string | null
    status: "ok" | "wait" | "unconfigured" | "unavailable"
  }>
  policy: (
    input: GameLearnerRequest,
    signal: AbortSignal,
    env: NodeJS.ProcessEnv,
    steps?: ServerStep[]
  ) => Promise<LearnerProgram>
}

const unconfiguredClaim = (mix: BareMixId) =>
  mix === "laya-bare"
    ? "Laya is not configured."
    : mix === "openai-bare"
      ? "OpenAI Decisions is not configured."
      : "Jev is not configured."

/**
 * Turn one mix's provider results into the decision `decideGameLearner` parses.
 * A bare select is only a select. The chooser cycles to a value the same way a
 * human does, so it is not forced onto the cell's first option. Planned mixes
 * pass {cell, value} placements through. Code returns one program. The
 * browser keeps it and runs it again until that run fails. No provider is
 * called unless the mix needs it.
 */
export async function dispatchMix(
  mix: LearnerMixId,
  visible: GameLearnerRequest,
  providers: MixProviders,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
  trace?: ServerStep[]
): Promise<MixDecision> {
  if (mix === "openai-decisions") {
    const decided = await providers.decisions(visible, signal, env, trace)
    if (decided.status === "unconfigured") {
      return { action: null, patternClaim: decided.patternClaim }
    }
    return {
      action: decided.action,
      patternClaim: decided.patternClaim,
      ...(decided.placements?.length ? { placements: decided.placements } : {}),
    }
  }
  if (mix === "code") {
    const program = await providers.policy(visible, signal, env, trace)
    return { action: null, patternClaim: program.note, program }
  }
  if (mix === "jev-bare" || mix === "laya-bare" || mix === "openai-bare") {
    const choice = await providers.bare(visible, mix, signal, env, trace)
    if (choice === "unconfigured") {
      return { action: null, patternClaim: unconfiguredClaim(mix) }
    }
    if (!choice || choice === "wait") return { action: null, patternClaim: null }
    return { action: choice, patternClaim: null }
  }
  const plan = await providers.plan(visible, mix, signal, env, trace)
  return {
    action: null,
    patternClaim: plan.patternClaim,
    placements: plan.placements,
  }
}

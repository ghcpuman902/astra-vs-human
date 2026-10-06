import {
  createModelLearnerRunner,
  fetchLearnerDecision,
  type ModelLearnerResult,
} from "./model-learner"
import { finishLearnerRound, type LearnerMemory } from "./learner"
import { observeStage, type PublicStage } from "./stage-observation"
import type { Action, ActionAPI, Observation, Player, RulePack } from "./types"

export type LearnerStage = PublicStage & {
  match: PublicStage["match"] & {
    subscribe: (listener: () => void) => () => void
  }
  actions: (side: Player) => ActionAPI
}
export type StageLearnerState = {
  seed: number
  status: "idle" | "thinking" | "playing" | "wait" | "finished" | "error"
  lastAction: Action | null
  waitReason?: ModelLearnerResult["reason"]
}
/** Headless paced orchestration around the public stage adapter and shared controls. */
export function createStageLearner(options: {
  stage: LearnerStage
  pack: RulePack
  publicMarks: NonNullable<Observation["publicMarks"]>
  memory: LearnerMemory
  model?: () => string | undefined
  decide?: typeof fetchLearnerDecision
  paceMs?: number
  onUpdate?: (state: StageLearnerState) => void
}) {
  let disposed = false
  let running = false
  let pumping = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let latest: StageLearnerState = {
    seed: options.pack.seed,
    status: "idle",
    lastAction: null,
  }
  let decision: ModelLearnerResult | null = null
  let claimed = false
  const publish = (
    status: StageLearnerState["status"],
    action = latest.lastAction,
    waitReason?: ModelLearnerResult["reason"]
  ) => {
    latest = {
      seed: options.pack.seed,
      status,
      lastAction: action,
      ...(waitReason ? { waitReason } : {}),
    }
    options.onUpdate?.(latest)
  }
  const runner = createModelLearnerRunner({
    observe: () =>
      observeStage(options.stage, options.pack, options.publicMarks),
    api: options.stage.actions("learner"),
    memory: options.memory,
    model: options.model,
    decide: async (input, signal) => {
      try {
        decision = await (options.decide ?? fetchLearnerDecision)(input, signal)
      } catch {
        decision = {
          action: null,
          state: "wait",
          reason: signal.aborted ? "deadline" : "unavailable",
        }
      }
      return decision
    },
  })
  const pace = Math.max(50, Math.min(2_000, options.paceMs ?? 250))
  const schedule = () => {
    if (running && !disposed) timer = setTimeout(() => void pump(), pace)
  }
  const pump = async (): Promise<void> => {
    if (disposed || !running || pumping) return
    pumping = true
    try {
      if (!options.stage.started()) {
        publish("idle")
        return
      }
      const view = observeStage(
        options.stage,
        options.pack,
        options.publicMarks
      )
      if (options.stage.ended() || view.remainingMs <= 0) {
        publish("finished")
        running = false
        runner.dispose()
        return
      }
      if (view.status !== "playing" || view.remainingActions <= 0) {
        publish("wait")
        return
      }
      publish("thinking")
      decision = null
      const acted = await runner.step()
      if (disposed || !running) return
      if (acted)
        publish(
          "playing",
          (decision as ModelLearnerResult | null)?.action ?? null
        )
      else
        publish(
          "wait",
          latest.lastAction,
          (decision as ModelLearnerResult | null)?.reason
        )
    } catch {
      if (!disposed && running) publish("error")
    } finally {
      pumping = false
      schedule()
    }
  }
  const unsubscribe = options.stage.match.subscribe(() => {
    runner.sync()
    const view = observeStage(options.stage, options.pack, options.publicMarks)
    if (view.status === "finished" && !claimed) {
      claimed = true
      finishLearnerRound(options.memory)
    } else if (view.status === "playing" && view.actions === 0) claimed = false
    if (options.stage.ended()) {
      running = false
      clearTimeout(timer)
      runner.dispose()
      publish("finished")
    }
  })
  return {
    start: () => {
      if (!disposed && !running) {
        running = true
        void pump()
      }
    },
    pause: () => {
      running = false
      clearTimeout(timer)
      runner.cancel()
    },
    dispose: () => {
      disposed = true
      running = false
      clearTimeout(timer)
      unsubscribe()
      runner.dispose()
    },
    getSnapshot: () => latest,
    sync: () => runner.sync(),
    // Deterministic pacing entry for tests; normal integration uses start().
    step: async () => {
      if (!disposed && !running) {
        running = true
        await pump()
        running = false
        clearTimeout(timer)
      }
    },
  }
}

import { createOpenAI } from "@ai-sdk/openai"
import { experimental_decide, gateway, generateText, Output } from "ai"
import { z } from "zod"

import { recordModelFailure } from "../failure-log"
import { modelRefusal } from "../model-refusal"
import { providerSchema } from "../provider-schema"
import { allowedLearnerModel } from "../learner-models"
import { setModelFailureLog, traced, type ServerStep } from "./agent-trace"

setModelFailureLog(recordModelFailure)
import {
  applyCommit,
  bareCandidateCells,
  bareControlQuestions,
  captionSchema,
  jevCommitBody,
  layaCommitBody,
  layaSystemOneTarget,
  learnerBoardPayload,
  learnerCredentials,
  placementSchema,
  placementToPlay,
  plannedChoiceCells,
  plannedControlQuestions,
  policySchema,
  readBareControl,
  readJevCommit,
  type CountedAction,
  type JevCommit,
  type LearnerPolicy,
  type Placement,
} from "./learner-mix"
import type { GameLearnerRequest } from "./model-learner"

/** What the game plays. Captions may be absent. */
const hybridSchema = z.strictObject({
  placements: z.array(placementSchema).max(6),
  patternClaim: z.string().max(240).nullable(),
  captions: z.array(captionSchema).max(12).optional(),
})

/**
 * What OpenAI strict mode can request. Every key is present.
 * A plan the game plays is placements and a claim. Captions are a second
 * contract, used only when a later commit reads them.
 */
const placementWireSchema = providerSchema(
  z.strictObject({
    placements: z.array(placementSchema).max(6),
    patternClaim: z.string().max(240).nullable(),
  })
)
const captionedWireSchema = providerSchema(
  z.strictObject({
    placements: z.array(placementSchema).max(6),
    patternClaim: z.string().max(240).nullable(),
    captions: z.array(captionSchema).max(12),
  })
)

type WirePlan = {
  placements: z.infer<typeof placementSchema>[]
  patternClaim: string | null
  captions?: z.infer<typeof captionSchema>[]
}

const toPlan = (wire: WirePlan): z.infer<typeof hybridSchema> => ({
  placements: wire.placements,
  patternClaim: wire.patternClaim,
  ...(wire.captions?.length ? { captions: wire.captions } : {}),
})

const placementPrompt = `Propose up to four placements on the public board. Each placement names one open cell from affordances.controls.selectCell and a target value from that cell's affordances.options. The engine compiles each {cell, value} into the same counted select and cycle taps a human would need. Skip given and inert cells. This is a short plan of intents, not a puzzle-class name and not a hidden solution. If useful, add one local pattern claim.`

const captionedPrompt = `${placementPrompt}
Add a caption only for a control you might play: one short public outcome, at most six. An empty captions array means none. Do not caption every cell.`

/**
 * Low effort still thinks. The SDK otherwise asks for a detailed reasoning
 * summary, which the game never reads.
 */
const openaiReasoning = {
  openai: {
    store: false,
    reasoningEffort: "low",
    reasoningSummary: null,
  },
} as const

const decisionLimitMs = 5_000

/** A decision is one short choice. The plan may keep thinking; this may not. */
const decisionSignal = (parent: AbortSignal) => {
  const limited = new AbortController()
  const timer = setTimeout(() => limited.abort(), decisionLimitMs)
  const abort = () => limited.abort()
  if (parent.aborted) abort()
  else parent.addEventListener("abort", abort, { once: true })
  limited.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer)
      parent.removeEventListener("abort", abort)
    },
    { once: true }
  )
  return limited.signal
}

const policyPrompt = `Write a tiny policy for this public board. rule is first-unlocked, selected-cycle, or named-cells. cells lists up to four open indexes from affordances.controls.selectCell. value is the target from that cell's options (or null for empty). note is one local pattern claim or null. Return only that policy. Do not return JavaScript. The browser runs only these fields and never sees hidden cells.`

export type PlannedMix = "astra" | "astra-hybrid" | "astra-jev" | "astra-laya"
export type BareMix = "jev-bare" | "laya-bare" | "openai-bare"

function gatewayModelId(model: string) {
  return model.includes("/") ? model : `openai/${model}`
}

/** Prefer cheap Sol for the planner-writer step; fall back to the round model. */
function plannerWriterModel(roundModel: string, env: NodeJS.ProcessEnv) {
  const pack = env.OPENAI_PACK_MODEL?.trim()
  if (pack) return pack
  if (allowedLearnerModel("gpt-6.1-sol")) return "gpt-6.1-sol"
  return roundModel
}

function captionMap(
  captions: { option: string; outcome: string }[] | undefined
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const entry of captions ?? []) {
    const option = entry.option.trim()
    const outcome = entry.outcome.trim()
    if (option && outcome) map[option] = outcome
  }
  return map
}

const planNote = (plan: WirePlan) =>
  `${plan.placements.length} placement${plan.placements.length === 1 ? "" : "s"}${plan.captions?.length ? ` · ${plan.captions.length} captions` : ""}`

async function astraPlan(
  input: GameLearnerRequest,
  model: string,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv,
  steps?: ServerStep[],
  captions = false
) {
  const prompt = JSON.stringify({
    board: publicBoardState(input),
    priorClaims: input.priorClaims,
  })
  const schema = captions ? captionedWireSchema : placementWireSchema
  const system = captions ? captionedPrompt : placementPrompt
  const credentials = learnerCredentials(env)
  if (credentials.openAI && env.OPENAI_API_KEY) {
    const openai = createOpenAI({
      apiKey: env.OPENAI_API_KEY,
      organization: env.OPENAI_ORG_ID,
    })
    const { output } = await traced(
      steps,
      { kind: "plan", model },
      () =>
        generateText({
          model: openai.responses(model),
          output: Output.object({ schema }),
          system,
          prompt,
          abortSignal: signal,
          maxRetries: 0,
          providerOptions: openaiReasoning,
        }),
      (result) => ({ usage: result.usage, note: planNote(result.output) })
    )
    return toPlan(output)
  }
  if (!credentials.gateway) throw new Error("Unconfigured")
  const { output } = await traced(
    steps,
    { kind: "plan", model: gatewayModelId(model) },
    () =>
      generateText({
        model: gateway.languageModel(gatewayModelId(model)),
        output: Output.object({ schema }),
        system,
        prompt,
        abortSignal: signal,
        maxRetries: 0,
      }),
    (result) => ({ usage: result.usage, note: planNote(result.output) })
  )
  return toPlan(output)
}

async function jevCommit(
  state: string,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv,
  steps?: ServerStep[]
): Promise<JevCommit | null> {
  const credentials = learnerCredentials(env)
  const commitNote = (choice: JevCommit | null) => ({
    note: choice ? `Commit ${choice}` : "No commit",
  })
  if (credentials.jevDirect && env.TYPESAFE_API_KEY) {
    const base = (
      env.TYPESAFE_BASE_URL?.trim() || "https://api.typesafe.ai"
    ).replace(/\/$/, "")
    const key = env.TYPESAFE_API_KEY.trim()
    return traced(
      steps,
      { kind: "commit", model: "jev-1.13" },
      async () => {
        const response = await fetch(`${base}/v1/systemone`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(jevCommitBody(state)),
          signal,
        })
        if (!response.ok) return null
        return readJevCommit(await response.json())
      },
      commitNote
    )
  }
  if (!credentials.gateway) return null
  const questions = jevCommitBody(state).questions
  const result = await traced(
    steps,
    { kind: "commit", model: "typesafe-ai/jev" },
    () =>
      experimental_decide({
        model: gateway.decision("typesafe-ai/jev"),
        state,
        questions,
        abortSignal: decisionSignal(signal),
        maxRetries: 0,
      }),
    (decided) => ({
      usage: decided.usage,
      note: `Commit ${decided.answers.commit.choice}`,
    })
  )
  const choice = result.answers.commit.choice
  if (choice === "wait" || choice === "one" || choice === "batch") return choice
  return null
}

async function layaCommit(
  state: string,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv,
  steps?: ServerStep[]
): Promise<JevCommit | null> {
  const target = layaSystemOneTarget(env)
  if (!target) return null
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (target.authorization) headers.authorization = target.authorization
  return traced(
    steps,
    { kind: "commit", model: "convaiinnovations/laya" },
    async () => {
      const response = await fetch(target.url, {
        method: "POST",
        headers,
        body: JSON.stringify(layaCommitBody(state)),
        signal,
      })
      if (!response.ok) return null
      return readJevCommit(await response.json())
    },
    (choice) => ({ note: choice ? `Commit ${choice}` : "No commit" })
  )
}

function publicBoardState(input: GameLearnerRequest) {
  return learnerBoardPayload({
    category: input.board.category,
    mode: input.board.mode,
    postcard: input.board.postcard,
    clues: input.board.clues,
    affordances: input.board.affordances,
    cells: input.board.cells.map((cell) => ({
      index: cell.index,
      value: cell.visible ? cell.value : null,
      role: cell.role,
      selected: cell.visible && cell.selected,
    })),
  })
}

const policyNote = (policy: LearnerPolicy) =>
  `${policy.rule} · ${policy.cells.length} cells · →${policy.value}`

async function planCodePolicy(
  input: GameLearnerRequest,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv,
  steps?: ServerStep[]
): Promise<LearnerPolicy> {
  const model = allowedLearnerModel(input.model)
  if (!model) throw new Error("Model is not allowed")
  const prompt = JSON.stringify({
    board: publicBoardState(input),
    priorClaims: input.priorClaims,
  })
  const credentials = learnerCredentials(env)
  if (credentials.openAI && env.OPENAI_API_KEY) {
    const openai = createOpenAI({
      apiKey: env.OPENAI_API_KEY,
      organization: env.OPENAI_ORG_ID,
    })
    const { output } = await traced(
      steps,
      { kind: "policy", model },
      () =>
        generateText({
          model: openai.responses(model),
          output: Output.object({ schema: providerSchema(policySchema) }),
          system: policyPrompt,
          prompt,
          abortSignal: signal,
          maxRetries: 0,
          providerOptions: openaiReasoning,
        }),
      (result) => ({ usage: result.usage, note: policyNote(result.output) })
    )
    return policySchema.parse(output)
  }
  if (!credentials.gateway) throw new Error("Unconfigured")
  const { output } = await traced(
    steps,
    { kind: "policy", model: gatewayModelId(model) },
    () =>
      generateText({
        model: gateway.languageModel(gatewayModelId(model)),
        output: Output.object({ schema: providerSchema(policySchema) }),
        system: policyPrompt,
        prompt,
        abortSignal: signal,
        maxRetries: 0,
      }),
    (result) => ({ usage: result.usage, note: policyNote(result.output) })
  )
  return policySchema.parse(output)
}

export async function codeLearnerPolicy(
  input: GameLearnerRequest,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
  steps?: ServerStep[]
): Promise<LearnerPolicy> {
  return planCodePolicy(input, signal, env, steps)
}

const controlNote = (choice: CountedAction | "wait" | null) => ({
  note:
    choice === null
      ? "No legal choice"
      : choice === "wait"
        ? "Chose wait"
        : choice.type === "selectCell"
          ? `Chose cell ${choice.cell}`
          : `Chose ${choice.type}`,
})

async function bareChoice(
  state: string,
  cells: readonly number[],
  mix: BareMix,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv,
  steps?: ServerStep[],
  controls: { cycle?: boolean; undo?: boolean; clear?: boolean } = {}
): Promise<CountedAction | "wait" | null> {
  const questions = bareControlQuestions(cells, controls)
  const credentials = learnerCredentials(env)
  if (mix === "laya-bare") {
    const target = layaSystemOneTarget(env)
    if (!target) return null
    const headers: Record<string, string> = {
      "content-type": "application/json",
    }
    if (target.authorization) headers.authorization = target.authorization
    return traced(
      steps,
      { kind: "decide", model: "convaiinnovations/laya" },
      async () => {
        const response = await fetch(target.url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: "convaiinnovations/laya",
            state,
            questions,
          }),
          signal,
        })
        if (!response.ok) return null
        return readBareControl(await response.json(), cells)
      },
      controlNote
    )
  }
  if (mix === "openai-bare") {
    if (credentials.openAI && env.OPENAI_API_KEY) {
      const openai = createOpenAI({
        apiKey: env.OPENAI_API_KEY,
        organization: env.OPENAI_ORG_ID,
      })
      const result = await traced(
        steps,
        { kind: "decide", model: "gpt-6-luna" },
        () =>
          experimental_decide({
            model: openai.decisionModel("gpt-6-luna"),
            state,
            questions,
            abortSignal: decisionSignal(signal),
            maxRetries: 0,
          }),
        (decided) => ({
          usage: decided.usage,
          ...controlNote(readBareControl({ answers: decided.answers }, cells)),
        })
      )
      return readBareControl({ answers: result.answers }, cells)
    }
    if (!credentials.gateway) return null
    const result = await traced(
      steps,
      { kind: "decide", model: "openai/gpt-6-luna" },
      () =>
        experimental_decide({
          model: gateway.decision("openai/gpt-6-luna"),
          state,
          questions,
          abortSignal: decisionSignal(signal),
          maxRetries: 0,
        }),
      (decided) => ({
        usage: decided.usage,
        ...controlNote(readBareControl({ answers: decided.answers }, cells)),
      })
    )
    return readBareControl({ answers: result.answers }, cells)
  }
  if (credentials.jevDirect && env.TYPESAFE_API_KEY) {
    const base = (
      env.TYPESAFE_BASE_URL?.trim() || "https://api.typesafe.ai"
    ).replace(/\/$/, "")
    const key = env.TYPESAFE_API_KEY.trim()
    return traced(
      steps,
      { kind: "decide", model: "jev-1.13.0" },
      async () => {
        const response = await fetch(`${base}/v1/systemone`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ model: "jev-1.13.0", state, questions }),
          signal,
        })
        if (!response.ok) return null
        return readBareControl(await response.json(), cells)
      },
      controlNote
    )
  }
  if (!credentials.gateway) return null
  const result = await traced(
    steps,
    { kind: "decide", model: "typesafe-ai/jev" },
    () =>
      experimental_decide({
        model: gateway.decision("typesafe-ai/jev"),
        state,
        questions,
        abortSignal: decisionSignal(signal),
        maxRetries: 0,
      }),
    (decided) => ({
      usage: decided.usage,
      ...controlNote(readBareControl({ answers: decided.answers }, cells)),
    })
  )
  return readBareControl({ answers: result.answers }, cells)
}

/** Bare decision model. No LLM plan is written into the state. */
export async function bareLearnerControl(
  input: GameLearnerRequest,
  mix: BareMix,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
  steps?: ServerStep[]
): Promise<CountedAction | "wait" | "unconfigured" | null> {
  const credentials = learnerCredentials(env)
  const ready =
    mix === "laya-bare"
      ? credentials.laya
      : mix === "openai-bare"
        ? credentials.astra
        : credentials.jev
  if (!ready) return "unconfigured"
  const selected = input.board.cells.findIndex((cell) => cell.selected)
  const { cycle, undo, clear } = input.board.affordances.controls
  const cells = bareCandidateCells(input.board.affordances).filter(
    (cell) => cell !== selected
  )
  const state = JSON.stringify(publicBoardState(input))
  return bareChoice(state, cells, mix, signal, env, steps, {
    cycle,
    undo,
    clear,
  })
}

export async function planLearnerMix(
  input: GameLearnerRequest,
  mix: PlannedMix,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
  steps?: ServerStep[]
): Promise<{
  placements: Placement[]
  patternClaim: string | null
  jev: "used" | "unconfigured" | "off"
  laya: "used" | "unconfigured" | "off"
}> {
  const model = allowedLearnerModel(input.model)
  if (!model) throw new Error("Model is not allowed")
  const credentials = learnerCredentials(env)
  const decision =
    mix === "astra-laya" ? "laya" : mix === "astra-jev" ? "jev" : "off"
  const ready =
    decision === "laya"
      ? credentials.laya
      : decision === "jev"
        ? credentials.jev
        : false
  const plan = await astraPlan(input, model, signal, env, steps, ready)
  const parsed = hybridSchema.parse(plan)
  if (!ready) {
    return {
      placements: parsed.placements,
      patternClaim: parsed.patternClaim,
      jev: decision === "jev" ? "unconfigured" : "off",
      laya: decision === "laya" ? "unconfigured" : "off",
    }
  }
  const state = JSON.stringify({
    ...publicBoardState(input),
    context: parsed.patternClaim,
    placements: parsed.placements,
    captions: parsed.captions ?? [],
    instruction:
      "Commit how much of this public plan to play. Captions are precomputed public outcomes, not hidden thinking.",
  })
  let choice: JevCommit | null = null
  try {
    choice =
      decision === "laya"
        ? await layaCommit(state, signal, env, steps)
        : await jevCommit(state, signal, env, steps)
  } catch {
    choice = null
  }
  const committed = applyCommit(parsed.placements, choice)
  const fallback =
    committed.length > 0
      ? null
      : placementToPlay(parsed.placements, input.board.affordances, "wait")
  if (fallback && steps)
    steps.push({
      kind: "commit",
      model: "plan",
      ms: 0,
      status: "ok",
      note: "Commit was wait. Playing the first planned cell.",
    })
  return {
    placements: committed.length > 0 ? committed : fallback ? [fallback] : [],
    patternClaim: parsed.patternClaim,
    jev: decision === "jev" ? "used" : "off",
    laya: decision === "laya" ? "used" : "off",
  }
}

/**
 * OpenAI Decisions path: Astra/Sol writes planner + captions, then Decisions
 * chooses the single next legal control. Never posts a bare board-only state.
 */
export async function openaiDecisionsControl(
  input: GameLearnerRequest,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
  steps?: ServerStep[]
): Promise<{
  action: CountedAction | null
  placements?: Placement[]
  patternClaim: string | null
  status: "ok" | "wait" | "unconfigured" | "unavailable"
}> {
  const credentials = learnerCredentials(env)
  if (!credentials.astra)
    return {
      action: null,
      patternClaim: "OpenAI Decisions is not configured.",
      status: "unconfigured",
    }
  const roundModel = allowedLearnerModel(input.model)
  if (!roundModel) throw new Error("Model is not allowed")
  const writer = plannerWriterModel(roundModel, env)
  let plan: z.infer<typeof hybridSchema>
  try {
    plan = hybridSchema.parse(
      await astraPlan(input, writer, signal, env, steps, true)
    )
  } catch (error) {
    const refusal = modelRefusal(error, signal.aborted)
    if (refusal === "rejected" || refusal === "deadline") throw error
    return {
      action: null,
      patternClaim: null,
      status: "unavailable",
    }
  }
  const plannedCells = plannedChoiceCells(
    plan.placements,
    input.board.affordances
  )
  const cells = plannedCells.length
    ? plannedCells
    : bareCandidateCells(input.board.affordances)
  const captions = captionMap(plan.captions)
  const questions = plannedControlQuestions(
    cells,
    captions,
    plan.patternClaim,
    {
      cycle: input.board.affordances.controls.cycle,
      undo: input.board.affordances.controls.undo,
      clear: input.board.affordances.controls.clear,
    }
  )
  const state = JSON.stringify({
    ...publicBoardState(input),
    plan: {
      placements: plan.placements,
      patternClaim: plan.patternClaim,
    },
    captions: plan.captions ?? [],
    priorClaims: input.priorClaims,
    instruction:
      "Choose the single next counted control. Use the public plan and captions.",
  })
  try {
    let choice: CountedAction | "wait" | null = null
    if (credentials.openAI && env.OPENAI_API_KEY) {
      const openai = createOpenAI({
        apiKey: env.OPENAI_API_KEY,
        organization: env.OPENAI_ORG_ID,
      })
      const result = await traced(
        steps,
        { kind: "decide", model: "gpt-6-luna" },
        () =>
          experimental_decide({
            model: openai.decisionModel("gpt-6-luna"),
            state,
            questions,
            abortSignal: decisionSignal(signal),
            maxRetries: 0,
          }),
        (decided) => ({
          usage: decided.usage,
          ...controlNote(readBareControl({ answers: decided.answers }, cells)),
        })
      )
      choice = readBareControl({ answers: result.answers }, cells)
    } else if (credentials.gateway) {
      const result = await traced(
        steps,
        { kind: "decide", model: "openai/gpt-6-luna" },
        () =>
          experimental_decide({
            model: gateway.decision("openai/gpt-6-luna"),
            state,
            questions,
            abortSignal: decisionSignal(signal),
            maxRetries: 0,
          }),
        (decided) => ({
          usage: decided.usage,
          ...controlNote(readBareControl({ answers: decided.answers }, cells)),
        })
      )
      choice = readBareControl({ answers: result.answers }, cells)
    } else {
      return {
        action: null,
        patternClaim: "OpenAI Decisions is not configured.",
        status: "unconfigured",
      }
    }
    const placement = placementToPlay(
      plan.placements,
      input.board.affordances,
      choice
    )
    if (placement && (choice === "wait" || choice === null) && steps)
      steps.push({
        kind: "decide",
        model: "plan",
        ms: 0,
        status: "ok",
        note: "Chose wait. Playing the first planned cell.",
      })
    if (placement && (choice === "wait" || choice === null || choice.type === "selectCell"))
      return {
        action: { type: "selectCell", cell: placement.cell },
        placements: [placement],
        patternClaim: plan.patternClaim,
        status: "ok",
      }
    if (choice === "wait" || choice === null) {
      return {
        action: null,
        patternClaim: plan.patternClaim,
        status: "wait",
      }
    }
    return {
      action: choice,
      patternClaim: plan.patternClaim,
      status: "ok",
    }
  } catch (error) {
    const refusal = modelRefusal(error, signal.aborted)
    if (refusal === "rejected" || refusal === "deadline") throw error
    return {
      action: null,
      patternClaim: plan.patternClaim,
      status: "unavailable",
    }
  }
}

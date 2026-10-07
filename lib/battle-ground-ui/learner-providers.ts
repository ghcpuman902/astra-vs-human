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
  normalizeProgramSource,
  programSchema,
  readBareControl,
  readJevCommit,
  type CountedAction,
  type JevCommit,
  type LearnerProgram,
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

/**
 * OpenAI Decisions public beta (`POST /v1/decisions`, `gpt-6-luna` only).
 * Installed `@ai-sdk/openai` `decisionModel` still wraps the Responses API.
 */
const openAIDecisionChoice = async (input: {
  apiKey: string | undefined
  organization?: string
  state: string
  questions: {
    control: { instructions: string; criteria: Record<string, string> }
  }
  signal: AbortSignal
}) => {
  if (!input.apiKey) {
    throw new Error("OpenAI Decisions needs OPENAI_API_KEY")
  }
  const question = input.questions.control
  const response = await fetch("https://api.openai.com/v1/decisions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      ...(input.organization
        ? { "OpenAI-Organization": input.organization }
        : {}),
    },
    body: JSON.stringify({
      model: "gpt-6-luna",
      input: input.state,
      questions: [
        {
          type: "choice",
          name: "control",
          instructions: question.instructions,
          choices: Object.entries(question.criteria).map(
            ([value, description]) => ({ value, description })
          ),
        },
      ],
    }),
    signal: input.signal,
  })
  if (!response.ok) {
    throw new Error(`OpenAI Decisions returned ${response.status}`)
  }
  const body = (await response.json()) as {
    answers?: Array<{ type?: string; name?: string; choice?: unknown }>
  }
  const answer = body.answers?.find((item) => item.name === "control")
  const choice =
    answer?.type === "choice" && typeof answer.choice === "string"
      ? answer.choice
      : null
  return { answers: { control: { choice } } }
}

const programPrompt = `Write one JavaScript program for public boards like this one.
source is the body of a function. It receives board, whose fields are clues, affordances, and cells. It must return { placements: [{ cell, value }] }, at most six.
cell must be listed in affordances.controls.selectCell. value must be one of that cell's options, or null to clear it.
This source is kept and called again on later boards, including every later game of this kind. Write that one program in a single pass. Do not hard-code only this board's cell indexes.
Do not use import, fetch, eval, or any global. Do not read hidden cells. note is one short claim, or null.
If previous is present, it is the program already being reused. Change it only to fix failure. Do not start a new program when the previous one can be repaired.`

/** Same budget as other live calls. High effort left the board on "Waiting on the server" for minutes. */
const codeReasoning = openaiReasoning

export type PlannedMix = "astra" | "astra-hybrid" | "astra-jev" | "astra-laya"
export type BareMix = "jev-bare" | "laya-bare" | "openai-bare"

function gatewayModelId(model: string) {
  return model.includes("/") ? model : `openai/${model}`
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
    recent: input.recent ?? [],
  })
}

const programNote = (program: LearnerProgram) =>
  `${program.source.length} chars${program.note ? ` · ${program.note}` : ""}`

const writtenProgram = (output: LearnerProgram): LearnerProgram => {
  const source = normalizeProgramSource(output.source)
  if (!source) throw new Error("Empty program")
  return programSchema.parse({ source, note: output.note })
}

async function planCodePolicy(
  input: GameLearnerRequest,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv,
  steps?: ServerStep[]
): Promise<LearnerProgram> {
  const model = allowedLearnerModel(input.model)
  if (!model) throw new Error("Model is not allowed")
  const prompt = JSON.stringify({
    board: publicBoardState(input),
    priorClaims: input.priorClaims,
    ...(input.program ? { previous: input.program } : {}),
    ...(input.failure ? { failure: input.failure } : {}),
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
          output: Output.object({ schema: providerSchema(programSchema) }),
          system: programPrompt,
          prompt,
          abortSignal: signal,
          maxRetries: 0,
          providerOptions: codeReasoning,
        }),
      (result) => ({ usage: result.usage, note: programNote(result.output) })
    )
    return writtenProgram(output)
  }
  if (!credentials.gateway) throw new Error("Unconfigured")
  const { output } = await traced(
    steps,
    { kind: "policy", model: gatewayModelId(model) },
    () =>
      generateText({
        model: gateway.languageModel(gatewayModelId(model)),
        output: Output.object({ schema: providerSchema(programSchema) }),
        system: programPrompt,
        prompt,
        abortSignal: signal,
        maxRetries: 0,
      }),
    (result) => ({ usage: result.usage, note: programNote(result.output) })
  )
  return writtenProgram(output)
}

export async function codeLearnerPolicy(
  input: GameLearnerRequest,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
  steps?: ServerStep[]
): Promise<LearnerProgram> {
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
        const result = await traced(
          steps,
          { kind: "decide", model: "gpt-6-luna" },
          () =>
            openAIDecisionChoice({
              apiKey: env.OPENAI_API_KEY,
              organization: env.OPENAI_ORG_ID,
              state,
              questions,
              signal: decisionSignal(signal),
            }),
          (decided) =>
            controlNote(readBareControl({ answers: decided.answers }, cells))
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
  // A wait commit still plays the first planned cell, so a decision cannot stall the match.
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
 * LLM + Decisions. The selected model writes the plan and captions.
 * gpt-6-luna then chooses the next legal control.
 * Board-only Decisions is openai-bare, through bareLearnerControl.
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
  let plan: z.infer<typeof hybridSchema>
  try {
    plan = hybridSchema.parse(
      await astraPlan(input, roundModel, signal, env, steps, true)
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
      const result = await traced(
        steps,
        { kind: "decide", model: "gpt-6-luna" },
        () =>
          openAIDecisionChoice({
            apiKey: env.OPENAI_API_KEY,
            organization: env.OPENAI_ORG_ID,
            state,
            questions,
            signal: decisionSignal(signal),
          }),
        (decided) =>
          controlNote(readBareControl({ answers: decided.answers }, cells))
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
    // A wait still plays the first planned cell, so a decision cannot stall the match.
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

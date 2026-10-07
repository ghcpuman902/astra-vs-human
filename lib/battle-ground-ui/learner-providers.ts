import { createOpenAI } from "@ai-sdk/openai"
import { experimental_decide, gateway, generateText, Output } from "ai"
import { z } from "zod"

import { allowedLearnerModel } from "../learner-models"
import {
  applyCommit,
  bareCandidateCells,
  bareControlQuestions,
  captionSchema,
  jevCommitBody,
  layaCommitBody,
  layaSystemOneTarget,
  learnerCredentials,
  placementSchema,
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

const hybridSchema = z.strictObject({
  placements: z.array(placementSchema).max(6),
  patternClaim: z.string().max(240).nullable(),
  captions: z.array(captionSchema).max(12).optional(),
})

const hybridPrompt = `Propose up to four placements on the public board. Each placement names one visible editable cell and how many cycle taps follow the selection (1 to 3). Skip locked cells. This is a short plan of counted taps, not a puzzle-class name and not a hidden solution. If useful, add one local pattern claim.
Also write short captions: for each legal next control you consider (wait, cycle, undo, clear, and cell-N for visible editable cells), give one precomputed outcome claim about what that single next tap would do on the visible board. Keep captions local and public — no hidden search.`

const policyPrompt = `Write a tiny policy for this public board. rule is first-unlocked, selected-cycle, or named-cells. cells lists up to four visible editable indexes. cycles is 1 to 3. note is one local pattern claim or null. Return only that policy. Do not return JavaScript. The browser runs only these fields and never sees hidden cells.`

export type PlannedMix = "astra" | "astra-hybrid" | "astra-jev" | "astra-laya"
export type BareMix = "jev-bare" | "laya-bare"

function gatewayModelId(model: string) {
  return model.includes("/") ? model : `openai/${model}`
}

/** Prefer cheap Sol for the planner-writer step; fall back to the round model. */
function plannerWriterModel(
  roundModel: string,
  env: NodeJS.ProcessEnv
) {
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

async function astraPlan(
  input: GameLearnerRequest,
  model: string,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv
) {
  const prompt = JSON.stringify({
    board: input.board,
    priorClaims: input.priorClaims,
  })
  const credentials = learnerCredentials(env)
  if (credentials.openAI && env.OPENAI_API_KEY) {
    const openai = createOpenAI({
      apiKey: env.OPENAI_API_KEY,
      organization: env.OPENAI_ORG_ID,
    })
    const { output } = await generateText({
      model: openai.responses(model),
      output: Output.object({ schema: hybridSchema }),
      system: hybridPrompt,
      prompt,
      abortSignal: signal,
      maxRetries: 0,
      providerOptions: { openai: { store: false, reasoningEffort: "low" } },
    })
    return output
  }
  if (!credentials.gateway) throw new Error("Unconfigured")
  const { output } = await generateText({
    model: gateway.languageModel(gatewayModelId(model)),
    output: Output.object({ schema: hybridSchema }),
    system: hybridPrompt,
    prompt,
    abortSignal: signal,
    maxRetries: 0,
  })
  return output
}

async function jevCommit(
  state: string,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv
): Promise<JevCommit | null> {
  const credentials = learnerCredentials(env)
  if (credentials.jevDirect && env.TYPESAFE_API_KEY) {
    const base = (env.TYPESAFE_BASE_URL?.trim() || "https://api.typesafe.ai").replace(
      /\/$/,
      ""
    )
    const response = await fetch(`${base}/v1/systemone`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.TYPESAFE_API_KEY.trim()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(jevCommitBody(state)),
      signal,
    })
    if (!response.ok) return null
    return readJevCommit(await response.json())
  }
  if (!credentials.gateway) return null
  const questions = jevCommitBody(state).questions
  const result = await experimental_decide({
    model: gateway.decision("typesafe-ai/jev"),
    state,
    questions,
    abortSignal: signal,
    maxRetries: 0,
  })
  const choice = result.answers.commit.choice
  if (choice === "wait" || choice === "one" || choice === "batch") return choice
  return null
}

async function layaCommit(
  state: string,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv
): Promise<JevCommit | null> {
  const target = layaSystemOneTarget(env)
  if (!target) return null
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (target.authorization) headers.authorization = target.authorization
  const response = await fetch(target.url, {
    method: "POST",
    headers,
    body: JSON.stringify(layaCommitBody(state)),
    signal,
  })
  if (!response.ok) return null
  return readJevCommit(await response.json())
}

function publicCells(input: GameLearnerRequest) {
  return input.board.cells.map((cell) => ({
    index: cell.index,
    value: cell.visible ? cell.value : null,
    locked: cell.visible && cell.locked,
    selected: cell.visible && cell.selected,
  }))
}

async function planCodePolicy(
  input: GameLearnerRequest,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv
): Promise<LearnerPolicy> {
  const model = allowedLearnerModel(input.model)
  if (!model) throw new Error("Model is not allowed")
  const prompt = JSON.stringify({
    board: input.board,
    priorClaims: input.priorClaims,
  })
  const credentials = learnerCredentials(env)
  if (credentials.openAI && env.OPENAI_API_KEY) {
    const openai = createOpenAI({
      apiKey: env.OPENAI_API_KEY,
      organization: env.OPENAI_ORG_ID,
    })
    const { output } = await generateText({
      model: openai.responses(model),
      output: Output.object({ schema: policySchema }),
      system: policyPrompt,
      prompt,
      abortSignal: signal,
      maxRetries: 0,
      providerOptions: { openai: { store: false, reasoningEffort: "low" } },
    })
    return policySchema.parse(output)
  }
  if (!credentials.gateway) throw new Error("Unconfigured")
  const { output } = await generateText({
    model: gateway.languageModel(gatewayModelId(model)),
    output: Output.object({ schema: policySchema }),
    system: policyPrompt,
    prompt,
    abortSignal: signal,
    maxRetries: 0,
  })
  return policySchema.parse(output)
}

export async function codeLearnerPolicy(
  input: GameLearnerRequest,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env
): Promise<LearnerPolicy> {
  return planCodePolicy(input, signal, env)
}

async function bareChoice(
  state: string,
  cells: readonly number[],
  mix: BareMix,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv
): Promise<CountedAction | "wait" | null> {
  const questions = bareControlQuestions(cells)
  const credentials = learnerCredentials(env)
  if (mix === "laya-bare") {
    const target = layaSystemOneTarget(env)
    if (!target) return null
    const headers: Record<string, string> = { "content-type": "application/json" }
    if (target.authorization) headers.authorization = target.authorization
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
  }
  if (credentials.jevDirect && env.TYPESAFE_API_KEY) {
    const base = (env.TYPESAFE_BASE_URL?.trim() || "https://api.typesafe.ai").replace(
      /\/$/,
      ""
    )
    const response = await fetch(`${base}/v1/systemone`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.TYPESAFE_API_KEY.trim()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "jev-1.13.0", state, questions }),
      signal,
    })
    if (!response.ok) return null
    return readBareControl(await response.json(), cells)
  }
  if (!credentials.gateway) return null
  const result = await experimental_decide({
    model: gateway.decision("typesafe-ai/jev"),
    state,
    questions,
    abortSignal: signal,
    maxRetries: 0,
  })
  return readBareControl({ answers: result.answers }, cells)
}

/** Bare decision model. No Astra plan is written into the state. */
export async function bareLearnerControl(
  input: GameLearnerRequest,
  mix: BareMix,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env
): Promise<CountedAction | "wait" | "unconfigured" | null> {
  const credentials = learnerCredentials(env)
  if (mix === "laya-bare" ? !credentials.laya : !credentials.jev)
    return "unconfigured"
  const cells = bareCandidateCells(input.board.cells)
  const state = JSON.stringify({
    category: input.board.category,
    postcard: input.board.postcard,
    clues: input.board.clues,
    cells: publicCells(input),
  })
  return bareChoice(state, cells, mix, signal, env)
}

export async function planLearnerMix(
  input: GameLearnerRequest,
  mix: PlannedMix,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env
): Promise<{
  placements: Placement[]
  patternClaim: string | null
  jev: "used" | "unconfigured" | "off"
  laya: "used" | "unconfigured" | "off"
}> {
  const model = allowedLearnerModel(input.model)
  if (!model) throw new Error("Model is not allowed")
  const plan = await astraPlan(input, model, signal, env)
  const parsed = hybridSchema.parse(plan)
  const credentials = learnerCredentials(env)
  const decision =
    mix === "astra-laya" ? "laya" : mix === "astra-jev" ? "jev" : "off"
  const ready =
    decision === "laya"
      ? credentials.laya
      : decision === "jev"
        ? credentials.jev
        : false
  if (!ready) {
    return {
      placements: parsed.placements,
      patternClaim: parsed.patternClaim,
      jev: decision === "jev" ? "unconfigured" : "off",
      laya: decision === "laya" ? "unconfigured" : "off",
    }
  }
  const state = JSON.stringify({
    category: input.board.category,
    postcard: input.board.postcard,
    context: parsed.patternClaim,
    cells: publicCells(input),
    placements: parsed.placements,
    captions: parsed.captions ?? [],
    instruction:
      "Commit how much of this public plan to play. Captions are precomputed public outcomes, not hidden thinking.",
  })
  let choice: JevCommit | null = null
  try {
    choice =
      decision === "laya"
        ? await layaCommit(state, signal, env)
        : await jevCommit(state, signal, env)
  } catch {
    choice = null
  }
  return {
    placements: applyCommit(parsed.placements, choice),
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
  env: NodeJS.ProcessEnv = process.env
): Promise<{
  action: CountedAction | null
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
    plan = hybridSchema.parse(await astraPlan(input, writer, signal, env))
  } catch {
    return {
      action: null,
      patternClaim: null,
      status: "unavailable",
    }
  }
  const cells = bareCandidateCells(input.board.cells)
  const captions = captionMap(plan.captions)
  const questions = plannedControlQuestions(
    cells,
    captions,
    plan.patternClaim
  )
  const state = JSON.stringify({
    category: input.board.category,
    postcard: input.board.postcard,
    clues: input.board.clues,
    cells: publicCells(input),
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
      const result = await experimental_decide({
        model: openai.decisionModel("gpt-6-luna"),
        state,
        questions,
        abortSignal: signal,
        maxRetries: 0,
      })
      choice = readBareControl({ answers: result.answers }, cells)
    } else if (credentials.gateway) {
      const result = await experimental_decide({
        model: gateway.decision("openai/gpt-6-luna"),
        state,
        questions,
        abortSignal: signal,
        maxRetries: 0,
      })
      choice = readBareControl({ answers: result.answers }, cells)
    } else {
      return {
        action: null,
        patternClaim: "OpenAI Decisions is not configured.",
        status: "unconfigured",
      }
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
  } catch {
    return {
      action: null,
      patternClaim: plan.patternClaim,
      status: "unavailable",
    }
  }
}

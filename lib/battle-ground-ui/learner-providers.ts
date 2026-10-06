import { createOpenAI } from "@ai-sdk/openai"
import { experimental_decide, gateway, generateText, Output } from "ai"
import { z } from "zod"

import { allowedLearnerModel } from "../learner-models"
import {
  applyCommit,
  jevCommitBody,
  learnerCredentials,
  placementSchema,
  readJevCommit,
  type JevCommit,
  type LearnerMixId,
  type Placement,
} from "./learner-mix"
import type { GameLearnerRequest } from "./model-learner"

const hybridSchema = z.strictObject({
  placements: z.array(placementSchema).max(6),
  patternClaim: z.string().max(240).nullable(),
})

const hybridPrompt = `Propose up to four placements on the public board. Each placement names one visible editable cell and how many cycle taps follow the selection (1 to 3). Skip locked cells. This is a short plan of counted taps, not a puzzle-class name and not a hidden solution. If useful, add one local pattern claim.`

function gatewayModelId(model: string) {
  return model.includes("/") ? model : `openai/${model}`
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

export async function planLearnerMix(
  input: GameLearnerRequest,
  mix: Exclude<LearnerMixId, "astra">,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env
): Promise<{
  placements: Placement[]
  patternClaim: string | null
  jev: "used" | "unconfigured" | "off"
}> {
  const model = allowedLearnerModel(input.model)
  if (!model) throw new Error("Model is not allowed")
  const plan = await astraPlan(input, model, signal, env)
  const parsed = hybridSchema.parse(plan)
  if (mix === "astra-hybrid" || !learnerCredentials(env).jev) {
    return {
      placements: parsed.placements,
      patternClaim: parsed.patternClaim,
      jev: mix === "astra-hybrid" ? "off" : "unconfigured",
    }
  }
  const state = JSON.stringify({
    category: input.board.category,
    postcard: input.board.postcard,
    cells: input.board.cells.map((cell) => ({
      index: cell.index,
      value: cell.visible ? cell.value : null,
      locked: cell.visible && cell.locked,
    })),
    placements: parsed.placements,
  })
  let choice: JevCommit | null = null
  try {
    choice = await jevCommit(state, signal, env)
  } catch {
    choice = null
  }
  return {
    placements: applyCommit(parsed.placements, choice),
    patternClaim: parsed.patternClaim,
    jev: "used",
  }
}

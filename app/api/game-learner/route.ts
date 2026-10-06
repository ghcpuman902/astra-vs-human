import { learnerDecisionSchema } from "@/lib/puzzle/model-learner"
import { createOpenAI } from "@ai-sdk/openai"
import { gateway, generateText, Output } from "ai"
import { allowedLearnerModel } from "@/lib/learner-models"
import { planLearnerMix } from "@/lib/battle-ground-ui/learner-providers"

import {
  decideGameLearner,
  gameLearnerRequestSchema,
  gameLearnerSystemPrompt,
} from "@/lib/battle-ground-ui/model-learner"

export const runtime = "nodejs"
export const maxDuration = 15

// Live provider is OpenAI generateText structured output.
// TypeSafe Jev and the OpenAI Decisions API stay unwired seams in
// lib/battle-ground-ui/model-learner.ts. Do not call them from this route.
export async function POST(request: Request) {
  const started = performance.now()
  const headers = { "cache-control": "no-store" }
  let input: unknown
  try {
    if (Number(request.headers.get("content-length")) > 32_768)
      return Response.json(
        { error: "Request too large" },
        { status: 413, headers }
      )
    const reader = request.body?.getReader()
    if (!reader) throw new Error("Missing body")
    const decoder = new TextDecoder()
    let bytes = 0
    let text = ""
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 32_768) {
          await reader.cancel()
          return Response.json(
            { error: "Request too large" },
            { status: 413, headers }
          )
        }
        text += decoder.decode(value, { stream: true })
      }
      input = JSON.parse(text + decoder.decode())
    } finally {
      reader.releaseLock()
    }
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400, headers })
  }
  const parsed = gameLearnerRequestSchema.safeParse(input)
  if (!parsed.success)
    return Response.json(
      { error: "Expected public board and priorClaims only" },
      { status: 400, headers }
    )
  const selectedModel = allowedLearnerModel(parsed.data.model)
  if (!selectedModel)
    return Response.json(
      { error: "Model is not allowed" },
      { status: 400, headers }
    )
  const mix = parsed.data.mix ?? "astra"
  if (mix !== "astra") {
    const planned = await decideGameLearner(
      {
        ...parsed.data,
        board: {
          ...parsed.data.board,
          remainingMs: Math.max(
            0,
            parsed.data.board.remainingMs - (performance.now() - started)
          ),
        },
      },
      async (visible, signal) => {
        const plan = await planLearnerMix(visible, mix, signal)
        return {
          action: null,
          patternClaim: plan.patternClaim,
          placements: plan.placements,
        }
      },
      request.signal
    )
    return Response.json(planned, { headers })
  }
  const result = await decideGameLearner(
    {
      ...parsed.data,
      board: {
        ...parsed.data.board,
        remainingMs: Math.max(
          0,
          parsed.data.board.remainingMs - (performance.now() - started)
        ),
      },
    },
    async (visible, signal) => {
      const prompt = JSON.stringify({
        board: visible.board,
        priorClaims: visible.priorClaims,
      })
      if (process.env.OPENAI_API_KEY) {
        const openai = createOpenAI({
          apiKey: process.env.OPENAI_API_KEY,
          organization: process.env.OPENAI_ORG_ID,
        })
        const { output } = await generateText({
          model: openai.responses(selectedModel),
          output: Output.object({ schema: learnerDecisionSchema }),
          system: gameLearnerSystemPrompt,
          prompt,
          abortSignal: signal,
          maxRetries: 0,
          providerOptions: { openai: { store: false, reasoningEffort: "low" } },
        })
        return output
      }
      if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) {
        const { output } = await generateText({
          model: gateway.languageModel(
            selectedModel.includes("/") ? selectedModel : `openai/${selectedModel}`
          ),
          output: Output.object({ schema: learnerDecisionSchema }),
          system: gameLearnerSystemPrompt,
          prompt,
          abortSignal: signal,
          maxRetries: 0,
        })
        return output
      }
      throw new Error("Unconfigured")
    },
    request.signal
  )
  return Response.json(result, { headers })
}

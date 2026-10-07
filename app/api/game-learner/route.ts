import { allowedLearnerModel } from "@/lib/learner-models"
import {
  bareLearnerControl,
  codeLearnerPolicy,
  planLearnerMix,
} from "@/lib/battle-ground-ui/learner-providers"

import {
  decideGameLearner,
  gameLearnerRequestSchema,
} from "@/lib/battle-ground-ui/model-learner"

export const runtime = "nodejs"
export const maxDuration = 15

// Astra plays or writes a policy. Jev and Laya commit only for their mixes.
// OpenAI Decisions is a local placeholder: this route does not post it.
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
  const visibleInput = {
    ...parsed.data,
    model: selectedModel,
    board: {
      ...parsed.data.board,
      remainingMs: Math.max(
        0,
        parsed.data.board.remainingMs - (performance.now() - started)
      ),
    },
  }
  if (mix === "openai-decisions") {
    return Response.json(
      {
        action: null,
        state: "wait",
        patternClaim: "OpenAI Decisions stays local.",
      },
      { headers }
    )
  }
  const result = await decideGameLearner(
    visibleInput,
    async (visible, signal) => {
      if (mix === "code") {
        const policy = await codeLearnerPolicy(visible, signal)
        return { action: null, patternClaim: policy.note, policy }
      }
      if (mix === "jev-bare" || mix === "laya-bare") {
        const choice = await bareLearnerControl(visible, mix, signal)
        if (choice === "unconfigured") {
          return {
            action: null,
            patternClaim:
              mix === "laya-bare"
                ? "Laya is not configured."
                : "Jev is not configured.",
          }
        }
        return {
          action: choice === "wait" ? null : choice,
          patternClaim: null,
        }
      }
      const plan = await planLearnerMix(visible, mix, signal)
      return {
        action: null,
        patternClaim: plan.patternClaim,
        placements: plan.placements,
      }
    },
    request.signal
  )
  return Response.json(result, { headers })
}

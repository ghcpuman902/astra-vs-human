import { allowedLearnerModel } from "@/lib/learner-models"
import { type ServerStep } from "@/lib/battle-ground-ui/agent-trace"
import {
  bareLearnerControl,
  codeLearnerPolicy,
  openaiDecisionsControl,
  planLearnerMix,
} from "@/lib/battle-ground-ui/learner-providers"
import { dispatchMix } from "@/lib/battle-ground-ui/mix-dispatch"

import {
  decideGameLearner,
  gameLearnerRequestSchema,
} from "@/lib/battle-ground-ui/model-learner"

export const runtime = "nodejs"
export const maxDuration = 300

// Astra plays or writes a policy / planner wrap. Jev, Laya, and OpenAI
// Decisions commit only when their credentials exist. Decisions and scored
// Jev paths are planner-wrapped — never bare board-only by default.
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
  // One entry per model call: kind, model, ms, tokens. No prompts, no keys.
  const trace: ServerStep[] = []
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
  const result = await decideGameLearner(
    visibleInput,
    (visible, signal) =>
      dispatchMix(
        mix,
        visible,
        {
          bare: bareLearnerControl,
          plan: planLearnerMix,
          decisions: openaiDecisionsControl,
          policy: codeLearnerPolicy,
        },
        signal,
        process.env,
        trace
      ),
    request.signal
  )
  return Response.json({ ...result, trace: trace.slice(0, 8) }, { headers })
}

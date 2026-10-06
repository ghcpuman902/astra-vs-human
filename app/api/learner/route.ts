import { createOpenAI } from "@ai-sdk/openai"
import { generateText, Output } from "ai"

import {
  decideWithModel,
  learnerDecisionSchema,
  learnerRequestSchema,
  learnerSystemPrompt,
} from "@/lib/puzzle/model-learner"

export const runtime = "nodejs"
export const maxDuration = 15

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
  const parsed = learnerRequestSchema.safeParse(input)
  if (!parsed.success)
    return Response.json(
      { error: "Expected visible observation and priorClaims only" },
      { status: 400, headers }
    )
  const result = await decideWithModel(
    {
      ...parsed.data,
      observation: {
        ...parsed.data.observation,
        remainingMs: Math.max(
          0,
          parsed.data.observation.remainingMs - (performance.now() - started)
        ),
      },
    },
    async (visible, signal) => {
      if (!process.env.OPENAI_API_KEY) throw new Error("Unconfigured")
      const openai = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        organization: process.env.OPENAI_ORG_ID,
      })
      const { output } = await generateText({
        model: openai.responses(process.env.OPENAI_MODEL ?? "gpt-6-astra"),
        output: Output.object({ schema: learnerDecisionSchema }),
        system: learnerSystemPrompt,
        prompt: JSON.stringify(visible),
        abortSignal: signal,
        maxRetries: 0,
        providerOptions: { openai: { store: false, reasoningEffort: "low" } },
      })
      return output
    },
    request.signal
  )
  return Response.json(result, { headers })
}

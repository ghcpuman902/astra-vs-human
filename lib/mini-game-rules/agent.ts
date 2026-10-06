import { createOpenAI } from "@ai-sdk/openai"
import { ToolLoopAgent, isStepCount, tool } from "ai"
import { z } from "zod"

import { assemblyRequestSchema, type AssemblyRequest } from "./schema"
import type { GamePreferences, LandscapeIdea } from "./catalogue"

export const siftSchema = z.object({
  ideaId: z.string(),
  invention: z.string().min(1).max(160),
  playability: z.string().min(1).max(300),
  transferPattern: z.string().min(1).max(240),
  estimatedSeconds: z.number().min(10).max(120),
})
export type Sift = z.infer<typeof siftSchema>
export type AssemblyFeedback = {
  ok: boolean
  reason?: string
  category?: string
  mode?: string
  unique?: boolean
  hasFoothold?: boolean
}
export type PlannerContext = {
  seed: number
  n: 4 | 5 | 6
  preferences: GamePreferences
  ideas: LandscapeIdea[]
  signal: AbortSignal
  sift: (selection: Sift) => AssemblyFeedback
  assemble: (request: AssemblyRequest) => AssemblyFeedback
}
export type GamePlanner = {
  source: "openai" | "injected"
  model?: string
  run: (context: PlannerContext) => Promise<void>
}

/** Author capability only: typed tools, no arbitrary source-code execution. */
export function createAstraGamePlanner(): GamePlanner | undefined {
  if (typeof window !== "undefined")
    throw new Error("Game author is server-only")
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return undefined
  const modelName = process.env.OPENAI_MODEL?.trim() || "gpt-6-astra"
  const provider = createOpenAI({
    apiKey,
    organization: process.env.OPENAI_ORG_ID,
  })
  return {
    source: "openai",
    model: modelName,
    async run(context) {
      let sifted = false
      let assembled = false
      const agent = new ToolLoopAgent({
        model: provider.responses(modelName),
        maxRetries: 0,
        maxOutputTokens: 1600,
        providerOptions: {
          openai: {
            store: false,
            parallelToolCalls: false,
            reasoningEffort: "low",
          },
        },
        instructions: `You author short-session mini-games, not UI chrome and not learner moves.
Sift the four sampled ideas, invent a playable local twist, then call assemble.
Rounds target 10–120 seconds; a stuck player may take 600 seconds. Grid 4–6.
Use 2–3 local rules where appropriate. Identify a friend-pattern that transfers across three respawns.
Tango/Queens/Zip/lights resemblance is allowed; naming the class is not the score.
Research-only ideas cannot ship until their engine is implemented. Full visibility only tonight.
Use the request seed and size exactly. Honor requested categories and mode. Prefer variety of vibe.
Assembly is a pure verified engine tool; use only knobs supported by its schema.
After rejected assembly, change knobs or choose another live idea through sift and retry.
Never invent a successful audit, hidden answer, new win predicate, or unsupported action.
No prose output is needed; stop after a successful assemble tool result.`,
        tools: {
          sift: tool({
            description:
              "Choose one sampled assemblable idea; explain short-session fit and transferable local pattern.",
            inputSchema: siftSchema,
            execute: (selection) => {
              const feedback = context.sift(selection)
              sifted = feedback.ok
              return feedback
            },
          }),
          assemble: tool({
            description:
              "Build and verify a pack using the typed engine. The returned audit contains no solution.",
            inputSchema: assemblyRequestSchema,
            execute: (request) => {
              if (!sifted)
                return {
                  ok: false,
                  reason: "First call sift with an assemblable idea.",
                }
              const feedback = context.assemble(request)
              assembled = feedback.ok
              return feedback
            },
          }),
        },
        stopWhen: [isStepCount(6), () => assembled],
        prepareStep: () => ({
          toolChoice: "required" as const,
          ...(!sifted ? { activeTools: ["sift" as const] } : {}),
        }),
      })
      await agent.generate({
        abortSignal: context.signal,
        prompt: JSON.stringify({
          seed: context.seed,
          n: context.n,
          preferences: context.preferences,
          sampledIdeas: context.ideas,
          instruction:
            "Sift, invent within supported knobs, assemble, inspect verification; retry only on failure.",
        }),
      })
    },
  }
}

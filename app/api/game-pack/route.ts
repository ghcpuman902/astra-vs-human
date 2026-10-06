import { randomInt } from "node:crypto"
import { z } from "zod"

import {
  createGameGenerator,
  gameBudget,
  GameGenerationError,
  type GenerateGameRequest,
} from "@/lib/mini-game-rules/generator"
import { categorySchema, modeSchema } from "@/lib/mini-game-rules/schema"

export const runtime = "nodejs"
export const maxDuration = 60

const generator = createGameGenerator()
const maxBodyBytes = 32 * 1024
const preferencesSchema = z
  .object({
    categories: z
      .array(categorySchema)
      .min(1)
      .max(5)
      .refine((items) => new Set(items).size === items.length)
      .optional(),
    mode: modeSchema.optional(),
    visibility: z.enum(["full", "partial"]).optional(),
    targetSeconds: z.number().min(10).max(120).optional(),
    vibe: z.enum(["calm", "spatial", "tactile"]).optional(),
  })
  .strict()
const requestSchema = z
  .object({
    seed: z.number().int().min(0).max(0xffffffff),
    n: z.union([z.literal(4), z.literal(5), z.literal(6)]).default(4),
    preferences: preferencesSchema.optional(),
    transferFrom: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict()

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

class BodyError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

async function readBody(request: Request, deadline: number): Promise<unknown> {
  if (!request.body)
    throw new BodyError(400, "A JSON request body is required.")
  const declared = request.headers.get("content-length")
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBodyBytes)
    throw new BodyError(413, "Request body exceeds 32 KiB.")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new BodyError(408, "Request body exceeded the pack deadline.")),
      Math.max(0, deadline - Date.now())
    )
    onAbort = () => reject(new BodyError(408, "Request was aborted."))
    request.signal.addEventListener("abort", onAbort, { once: true })
    if (request.signal.aborted) onAbort()
  })
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), expiry])
      if (done) break
      length += value.byteLength
      if (length > maxBodyBytes)
        throw new BodyError(413, "Request body exceeds 32 KiB.")
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    } catch {
      throw new BodyError(400, "Request body must contain valid JSON.")
    }
  } finally {
    if (timer) clearTimeout(timer)
    if (onAbort) request.signal.removeEventListener("abort", onAbort)
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

async function generate(
  input: GenerateGameRequest,
  started: number,
  budget: number
) {
  const remaining = budget - (Date.now() - started)
  if (remaining <= 0)
    return json(
      { error: "Pack request deadline exhausted.", code: "budget" },
      408
    )
  try {
    const { pack, audit, meta } = await generator.generate({
      ...input,
      budgetMs: remaining,
    })
    // Author sift, sampled landscape and host solutions never enter the scored interface.
    return json({
      pack,
      audit: {
        certified: audit.certified,
        unique: audit.unique,
        solutionCount: audit.solutionCount,
        solutionMeaning: audit.solutionMeaning,
        hasFoothold: audit.hasFoothold,
      },
      meta: {
        source: meta.source,
        plannerSource: meta.plannerSource,
        plannerAttempt: meta.plannerAttempt,
        model: meta.model,
        fallbackReason: meta.fallbackReason,
        requestedSeed: meta.requestedSeed,
        elapsedMs: Date.now() - started,
        contentHash: meta.contentHash,
        warmedSeeds: meta.warmedSeeds,
      },
    })
  } catch (error) {
    if (error instanceof GameGenerationError)
      return json(
        { error: error.message, code: error.code },
        error.code === "unsupported-profile" ? 422 : 503
      )
    return json(
      { error: "Pack generation failed.", code: "generation-failed" },
      500
    )
  }
}

/** GET /api/game-pack?seed=123&n=4&category=lights_toggle */
export async function GET(request: Request) {
  const started = Date.now()
  const query = new URL(request.url).searchParams
  if (
    [...query.keys()].some(
      (key) =>
        !["seed", "n", "category"].includes(key) ||
        query.getAll(key).length !== 1
    )
  )
    return json({ error: "Use only seed, n, and category query fields." }, 400)
  const seed = query.get("seed")
  const n = query.get("n")
  if (
    (seed !== null && !/^\d{1,10}$/.test(seed)) ||
    (n !== null && !/^[456]$/.test(n))
  )
    return json({ error: "Use a uint32 seed and n=4, 5, or 6." }, 400)
  const category = query.get("category")
  const parsed = requestSchema.safeParse({
    seed: seed === null ? randomInt(0, 0x100000000) : Number(seed),
    n: n === null ? 4 : Number(n),
    ...(category === null ? {} : { preferences: { categories: [category] } }),
  })
  if (!parsed.success) return json({ error: "Invalid pack request." }, 400)
  return generate(
    parsed.data,
    started,
    gameBudget(process.env.PACK_GEN_BUDGET_MS)
  )
}

export async function POST(request: Request) {
  const started = Date.now()
  const budget = gameBudget(process.env.PACK_GEN_BUDGET_MS)
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? ""
    )
  )
    return json({ error: "Use Content-Type: application/json." }, 415)
  try {
    const body = await readBody(request, started + budget)
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success)
      return json(
        {
          error:
            "Invalid pack request; budget and unknown fields are not accepted.",
        },
        400
      )
    return generate(parsed.data, started, budget)
  } catch (error) {
    if (error instanceof BodyError)
      return json({ error: error.message }, error.status)
    return json({ error: "Request body could not be read." }, 400)
  }
}

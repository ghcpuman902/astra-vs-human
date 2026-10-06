import { randomInt } from "node:crypto"

import { createPackGenerator, packBudget } from "@/lib/puzzle/generator"

export const runtime = "nodejs"
export const maxDuration = 60

// Only puzzle data persists across requests. No player state or secrets in cache.
const generator = createPackGenerator()

/** GET /api/pack?seed=123&n=4. Without a seed, invent a fresh seeded niche. */
export function GET(request: Request) {
  const query = new URL(request.url).searchParams
  const seedText = query.get("seed")
  const nText = query.get("n") ?? "4"
  if (
    (seedText !== null && !/^\d{1,10}$/.test(seedText)) ||
    !/^[456]$/.test(nText)
  ) {
    return Response.json(
      { error: "Use a uint32 seed and n=4, 5, or 6." },
      { status: 400 }
    )
  }
  const seed = seedText === null ? randomInt(0, 0x100000000) : Number(seedText)
  if (seed > 0xffffffff)
    return Response.json({ error: "Seed exceeds uint32." }, { status: 400 })
  const result = generator.generate(
    seed,
    Number(nText) as 4 | 5 | 6,
    packBudget(process.env.PACK_GEN_BUDGET_MS)
  )
  return Response.json(result, { headers: { "Cache-Control": "no-store" } })
}

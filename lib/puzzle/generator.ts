import { createHash } from "node:crypto"

import { authorPack, certify } from "./author"
import { cachedPacks } from "./packs"
import type { RulePack } from "./types"

export const MAX_BUDGET_MS = 55_000
const POSTCARD_MAX_CHARS = 1800
const POSTCARD_MAX_LINES = 32
const CACHE_SLOTS = 24

export function packBudget(value: string | undefined): number {
  const parsed =
    value === undefined || value.trim() === "" ? MAX_BUDGET_MS : Number(value)
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(1, Math.min(Math.floor(parsed), MAX_BUDGET_MS))
    : MAX_BUDGET_MS
}

export type PackResult = {
  pack: RulePack
  source: "generated" | "cache" | "fallback"
  requestedSeed: number
  elapsedMs: number
  contentHash: string
  niche: "family-a-paired-zigzag"
  warmedSeeds: number[]
}
type GeneratorOptions = {
  now?: () => number
  candidate?: typeof authorPack
}

/** Process-local LRU, seeded with five certified packs rather than a puzzle atlas. */
export function createPackGenerator(options: GeneratorOptions = {}) {
  const now = options.now ?? (() => performance.now())
  const candidate = options.candidate ?? authorPack
  const cache = new Map<string, RulePack>()
  const key = (seed: number, n: number) => `${n}:${seed}`
  const put = (pack: RulePack) => {
    const id = key(pack.seed, pack.n)
    cache.delete(id)
    cache.set(id, structuredClone(pack))
    if (cache.size > CACHE_SLOTS) cache.delete(cache.keys().next().value!)
  }
  cachedPacks().forEach(put)

  return {
    generate: (seed: number, n: 4 | 5 | 6, budgetMs: number): PackResult => {
      if (
        !Number.isSafeInteger(seed) ||
        seed < 0 ||
        seed > 0xffffffff ||
        ![4, 5, 6].includes(n)
      )
        throw new Error("Invalid pack request")
      const started = now()
      const budget =
        Number.isFinite(budgetMs) && budgetMs > 0
          ? Math.min(budgetMs, MAX_BUDGET_MS)
          : MAX_BUDGET_MS
      // Reserve response time. Tiny budgets use a startup pack immediately.
      const deadline = started + Math.max(0, budget - Math.min(100, budget / 5))
      class Deadline extends Error {}
      const checkpoint = () => {
        if (now() >= deadline) throw new Deadline()
      }
      const validCandidate = (candidateSeed: number, mutation: number) => {
        checkpoint()
        const pack = candidate(candidateSeed, n, checkpoint, mutation)
        checkpoint()
        if (
          pack.seed !== candidateSeed ||
          pack.n !== n ||
          pack.rulesPostcard.length > POSTCARD_MAX_LINES ||
          pack.rulesPostcard.join("\n").length > POSTCARD_MAX_CHARS
        )
          throw new Error("Candidate rejected")
        const certificate = certify(pack, 200_000, checkpoint)
        if (
          !certificate.unique ||
          !certificate.foothold ||
          !certificate.forcedComplete
        )
          throw new Error("Candidate rejected")
        checkpoint()
        return pack
      }
      let pack = cache.get(key(seed, n))
      let source: PackResult["source"] = pack ? "cache" : "generated"
      if (pack) put(pack) // Refresh LRU slot.
      for (let mutation = 0; !pack && mutation < 4; mutation++) {
        try {
          pack = validCandidate(seed, mutation)
          put(pack)
        } catch (error) {
          if (error instanceof Deadline) break
        }
      }
      if (!pack) {
        source = "fallback"
        pack =
          [...cache.values()].reverse().find((cached) => cached.n === n) ??
          cachedPacks().find((cached) => cached.n === n)!
        // Fallback keeps its real seed. Both players must use this returned pack.
      }
      const warmedSeeds: number[] = []
      if (source !== "fallback")
        for (const offset of [1, 2]) {
          const nextSeed = (seed + offset) >>> 0
          if (cache.has(key(nextSeed, n)) || now() + 100 >= deadline) continue
          try {
            const warm = validCandidate(nextSeed, 0)
            put(warm)
            warmedSeeds.push(nextSeed)
          } catch {
            break
          } // Primary pack is already ready; warming is best effort.
        }
      const resultPack = structuredClone(pack)
      return {
        pack: resultPack,
        source,
        requestedSeed: seed,
        elapsedMs: Math.max(0, now() - started),
        contentHash: createHash("sha256")
          .update(JSON.stringify(resultPack))
          .digest("hex"),
        niche: "family-a-paired-zigzag",
        warmedSeeds,
      }
    },
    cacheSize: () => cache.size,
  }
}

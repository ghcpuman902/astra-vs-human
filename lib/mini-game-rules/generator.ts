import { createHash } from "node:crypto"

import { assembleGamePack } from "./assembler"
import {
  assemblyRequestSchema,
  type AssemblyRequest,
  type GamePack,
  type PackAudit,
} from "./schema"
import {
  createAstraGamePlanner,
  siftSchema,
  type GamePlanner,
  type Sift,
  type AssemblyFeedback,
} from "./agent"
import {
  gameLandscape,
  pickGameIdeas,
  preferenceMatches,
  type GamePreferences,
  type LandscapeIdea,
} from "./catalogue"

export const GAME_MAX_BUDGET_MS = 55_000
export type PublicPackAudit = Omit<PackAudit, "solution" | "foothold"> & {
  hasFoothold: boolean
}
export type GenerateGameRequest = {
  seed: number
  n?: 4 | 5 | 6
  budgetMs?: number
  preferences?: GamePreferences
  transferFrom?: string
}
export type GameGenerationResult = {
  pack: GamePack
  audit: PublicPackAudit
  meta: {
    source: "agent" | "cache" | "fallback"
    plannerSource: "openai" | "injected" | "unavailable"
    plannerAttempt: "openai" | "injected" | "unavailable"
    model?: string
    fallbackReason?:
      | "budget"
      | "model-unavailable"
      | "planner-failed"
      | "no-certified-assembly"
    requestedSeed: number
    elapsedMs: number
    contentHash: string
    sampledIdeas: LandscapeIdea[]
    sift?: Sift
    warmedSeeds: number[]
  }
}
type Entry = {
  pack: GamePack
  audit: PublicPackAudit
  request: AssemblyRequest
  sift?: Sift
  plannerSource: GameGenerationResult["meta"]["plannerSource"]
  model?: string
  hash: string
}
type GeneratorOptions = {
  planner?: GamePlanner | null
  assemble?: typeof assembleGamePack
}

export class GameGenerationError extends Error {
  constructor(
    public readonly code: "unsupported-profile" | "no-fallback",
    message: string
  ) {
    super(message)
  }
}

export function gameBudget(value: string | number | undefined): number {
  const parsed =
    value === undefined || value === "" ? GAME_MAX_BUDGET_MS : Number(value)
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(1, Math.min(GAME_MAX_BUDGET_MS, Math.floor(parsed)))
    : GAME_MAX_BUDGET_MS
}

function publicAudit(audit: PackAudit): PublicPackAudit {
  return {
    certified: audit.certified,
    solutionCount: audit.solutionCount,
    solutionMeaning: audit.solutionMeaning,
    unique: audit.unique,
    nodes: audit.nodes,
    hasFoothold: audit.foothold !== null,
  }
}

function matches(
  pack: GamePack,
  n: number,
  preferences: GamePreferences
): boolean {
  return (
    pack.n === n &&
    (!preferences.categories?.length ||
      preferences.categories.includes(pack.category)) &&
    (!preferences.mode || pack.mode === preferences.mode) &&
    (!preferences.visibility ||
      pack.visibility.kind === preferences.visibility) &&
    (!preferences.targetSeconds ||
      pack.session.targetSeconds === preferences.targetSeconds)
  )
}

/** Process-local LRU of verified boards plus author-selected assembly profiles. */
export function createGameGenerator(options: GeneratorOptions = {}) {
  const assemble = options.assemble ?? assembleGamePack
  const planner =
    options.planner === undefined
      ? createAstraGamePlanner()
      : (options.planner ?? undefined)
  const cache = new Map<string, Entry>()
  const put = (entry: Entry) => {
    cache.delete(entry.hash)
    cache.set(entry.hash, structuredClone(entry))
    while (cache.size > 32) cache.delete(cache.keys().next().value!)
  }
  const build = (
    request: AssemblyRequest,
    deadlineMs: number,
    origin: Pick<Entry, "plannerSource" | "model" | "sift">
  ): Entry => {
    if (Date.now() >= deadlineMs) throw new Error("Generation deadline reached")
    const { pack, audit } = assemble(request, { deadlineMs, nodeCap: 100_000 })
    if (
      !audit.certified ||
      (pack.mode !== "MULTI" && !audit.unique) ||
      (pack.mode === "FORCED-CHAIN" && !audit.foothold)
    )
      throw new Error("Engine did not certify the requested pack")
    if (pack.seed !== request.seed || pack.n !== request.n)
      throw new Error("Engine changed seed or size")
    const hash = createHash("sha256").update(JSON.stringify(pack)).digest("hex")
    return {
      pack,
      audit: publicAudit(audit),
      request,
      hash,
      plannerSource: origin.plannerSource,
      model: origin.model,
      sift: origin.sift,
    }
  }

  return {
    async generate(input: GenerateGameRequest): Promise<GameGenerationResult> {
      const started = Date.now()
      const n = input.n ?? 4
      const preferences = input.preferences ?? {}
      if (
        !Number.isInteger(input.seed) ||
        input.seed < 0 ||
        input.seed > 0xffffffff ||
        ![4, 5, 6].includes(n)
      )
        throw new Error("Seed must be uint32 and board size must be 4–6")
      const budget = gameBudget(
        input.budgetMs ?? process.env.PACK_GEN_BUDGET_MS
      )
      const deadline =
        started + Math.max(1, budget - Math.min(250, budget / 10))
      const liveIdeas = gameLandscape().filter(
        (idea) =>
          idea.status === "assemblable" && preferenceMatches(idea, preferences)
      )
      if (!liveIdeas.length)
        throw new GameGenerationError(
          "unsupported-profile",
          "Requested mode/visibility has no certified engine yet; choose an available full-visibility profile."
        )
      const sampledIdeas = pickGameIdeas(input.seed, preferences)
      let entry: Entry | undefined
      let source: GameGenerationResult["meta"]["source"] = "agent"
      let fallbackReason: GameGenerationResult["meta"]["fallbackReason"]
      const warmedSeeds: number[] = []
      const finish = (): GameGenerationResult => {
        if (!entry)
          throw new GameGenerationError(
            "no-fallback",
            "No certified pack fits this preference profile."
          )
        put(entry)
        return structuredClone({
          pack: entry.pack,
          audit: entry.audit,
          meta: {
            source,
            plannerSource: entry.plannerSource,
            plannerAttempt: planner?.source ?? "unavailable",
            model: planner?.model ?? entry.model,
            fallbackReason,
            requestedSeed: input.seed,
            elapsedMs: Date.now() - started,
            contentHash: entry.hash,
            sampledIdeas,
            sift: entry.sift,
            warmedSeeds,
          },
        })
      }
      const compatible = [...cache.values()]
        .reverse()
        .filter((cached) => matches(cached.pack, n, preferences))
      entry = compatible.find(
        (cached) =>
          cached.pack.seed === input.seed &&
          (!input.transferFrom || cached.hash === input.transferFrom)
      )
      if (entry) {
        source = "cache"
        return finish()
      }
      if (input.transferFrom) {
        const template = cache.get(input.transferFrom)
        if (template && matches(template.pack, n, preferences)) {
          try {
            entry = build(
              {
                ...template.request,
                seed: input.seed,
                variant: `transfer-${input.seed}`,
              },
              deadline,
              template
            )
            source = "cache"
            return finish()
          } catch {
            /* Fall through to sift; never reuse a mismatched profile. */
          }
        }
      }

      // Establish a certified fallback before spending the remaining deadline on inference.
      let fallback = compatible[0]
      if (!fallback) {
        for (const idea of liveIdeas) {
          if (Date.now() >= deadline) break
          try {
            const candidate = build(
              {
                category: idea.category,
                seed: input.seed,
                n,
                preferences: {
                  mode: preferences.mode ?? idea.mode,
                  visibility: "full",
                  targetSeconds: preferences.targetSeconds ?? 60,
                },
              },
              deadline,
              { plannerSource: "unavailable" }
            )
            if (matches(candidate.pack, n, preferences)) {
              fallback = candidate
              put(candidate)
              break
            }
          } catch {
            /* A category/mode can be unavailable at this size; try another. */
          }
        }
      }
      if (!fallback)
        throw new GameGenerationError(
          "no-fallback",
          "No certified pack fits this size and preference profile within budget."
        )
      let selection: Sift | undefined
      let closed = false
      const controller = new AbortController()
      const remaining = Math.max(0, deadline - Date.now())
      let timer: ReturnType<typeof setTimeout> | undefined
      const available = () =>
        !closed && !controller.signal.aborted && Date.now() < deadline
      const feedback = (reason: string): AssemblyFeedback => ({
        ok: false,
        reason,
      })
      const context = {
        seed: input.seed,
        n,
        preferences,
        ideas: sampledIdeas,
        signal: controller.signal,
        sift: (raw: Sift): AssemblyFeedback => {
          if (!available()) return feedback("Budget exhausted")
          const parsed = siftSchema.safeParse(raw)
          if (!parsed.success) return feedback("Invalid sift schema")
          const idea = sampledIdeas.find(
            (candidate) => candidate.id === parsed.data.ideaId
          )
          if (!idea || idea.status !== "assemblable")
            return feedback("Choose an assemblable sampled idea")
          selection = parsed.data
          return { ok: true, category: idea.category, mode: idea.mode }
        },
        assemble: (raw: AssemblyRequest): AssemblyFeedback => {
          if (!available()) return feedback("Budget exhausted")
          if (!selection) return feedback("Sift before assembly")
          const parsed = assemblyRequestSchema.safeParse(raw)
          if (!parsed.success) return feedback("Invalid assembly schema")
          const idea = sampledIdeas.find(
            (candidate) => candidate.id === selection?.ideaId
          )!
          if (
            parsed.data.seed !== input.seed ||
            parsed.data.n !== n ||
            parsed.data.category !== idea.category
          )
            return feedback("Use the selected category and requested seed/size")
          try {
            const request: AssemblyRequest = {
              ...parsed.data,
              preferences: {
                ...parsed.data.preferences,
                ...(preferences.mode ? { mode: preferences.mode } : {}),
                visibility: preferences.visibility ?? "full",
                targetSeconds:
                  preferences.targetSeconds ?? selection.estimatedSeconds,
              },
            }
            const candidate = build(request, deadline, {
              plannerSource: planner?.source ?? "unavailable",
              model: planner?.model,
              sift: selection,
            })
            if (!matches(candidate.pack, n, preferences))
              return feedback(
                "Verified pack does not fit requested preferences"
              )
            entry = candidate
            return {
              ok: true,
              category: candidate.pack.category,
              mode: candidate.pack.mode,
              unique: candidate.audit.unique,
              hasFoothold: candidate.audit.hasFoothold,
            }
          } catch {
            return feedback(
              "Assembly rejected or verification deadline reached; mutate supported knobs and retry"
            )
          }
        },
      }
      try {
        if (!planner) fallbackReason = "model-unavailable"
        else if (remaining < 50) fallbackReason = "budget"
        else {
          await Promise.race([
            planner.run(context),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                controller.abort()
                reject(new Error("Budget exhausted"))
              }, remaining)
            }),
          ])
          if (!entry) fallbackReason = "no-certified-assembly"
        }
      } catch {
        fallbackReason = controller.signal.aborted ? "budget" : "planner-failed"
      } finally {
        closed = true
        controller.abort()
        if (timer) clearTimeout(timer)
      }
      if (!entry) {
        entry = fallback
        source = "fallback"
      }
      {
        // Three same-profile respawns; warmed boards carry their real seed and certificate.
        for (const offset of [1, 2, 3]) {
          if (Date.now() + 10 >= deadline) break
          try {
            const seed = (input.seed + offset) >>> 0
            const warm = build(
              { ...entry.request, seed, variant: `transfer-${seed}` },
              Math.min(deadline, Date.now() + 100),
              entry
            )
            if (!matches(warm.pack, n, preferences)) continue
            put(warm)
            warmedSeeds.push(seed)
          } catch {
            break
          }
        }
      }
      return finish()
    },
    cacheSize: () => cache.size,
  }
}

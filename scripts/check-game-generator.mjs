import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, mkdir, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const output = await mkdtemp(join(tmpdir(), "astra-game-generator-"))
try {
  await writeFile(join(output, "package.json"), '{"type":"module"}')
  await symlink(fileURLToPath(new URL("../node_modules", import.meta.url)), join(output, "node_modules"))
  for (const folder of ["puzzle", "mini-game-rules"]) {
    await mkdir(join(output, folder))
    for (const file of await readdir(new URL(`../lib/${folder}/`, import.meta.url))) {
      if (!file.endsWith(".ts")) continue
      const source = await readFile(new URL(`../lib/${folder}/${file}`, import.meta.url), "utf8")
      const compiled = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
      }).outputText.replace(/from "(\.\.?\/[^".]+)"/g, 'from "$1.js"')
      await writeFile(join(output, folder, file.replace(/\.ts$/, ".js")), compiled)
    }
  }
  const { createGameGenerator, GameGenerationError, gameBudget } = await import(join(output, "mini-game-rules/generator.js"))
  const { gameLandscape, pickGameIdeas } = await import(join(output, "mini-game-rules/catalogue.js"))
  const { assembleGamePack } = await import(join(output, "mini-game-rules/assembler.js"))
  assert.equal(gameLandscape().length, 120)
  assert.deepEqual(pickGameIdeas(57), pickGameIdeas(57))
  assert.equal(pickGameIdeas(57).length, 4)
  assert.ok(new Set(pickGameIdeas(57).map(idea => idea.category)).size >= 3)
  assert.equal(gameBudget(100_000), 55_000)
  assert.equal(gameBudget("bad"), 55_000)

  let siftCalls = 0, assemblyFailures = 0, runs = 0
  const planner = {
    source: "injected",
    async run(context) {
      runs++
      const research = context.ideas.find(idea => idea.status === "research")
      if (research) {
        assert.equal(context.sift({ ideaId: research.id, invention: "Risk research", playability: "Short toy", transferPattern: "Local patterns", estimatedSeconds: 30 }).ok, false)
      }
      const idea = context.ideas.find(idea => idea.status === "assemblable")
      assert.ok(idea)
      const selection = { ideaId: idea.id, invention: "A small local twist", playability: "Visible corner clues for a short round", transferPattern: idea.localPattern, estimatedSeconds: 30 }
      assert.equal(context.sift(selection).ok, true)
      siftCalls++
      assert.equal(context.assemble({ category: idea.category, seed: context.seed + 90, n: context.n }).ok, false)
      assemblyFailures++
      const result = context.assemble({ category: idea.category, seed: context.seed, n: context.n, preferences: { clueDensity: 0.55 } })
      assert.equal(result.ok, true)
      assert.equal("foothold" in result, false)
    },
  }
  const generator = createGameGenerator({ planner })
  const first = await generator.generate({ seed: 77, budgetMs: 1500, preferences: { categories: ["binary_fill"], targetSeconds: 30 } })
  assert.equal(first.meta.source, "agent")
  assert.equal(first.meta.plannerSource, "injected")
  assert.equal(first.pack.seed, 77)
  assert.equal(first.pack.session.targetSeconds, 30)
  assert.equal("solution" in first.audit, false)
  assert.equal("foothold" in first.audit, false)
  assert.equal(first.audit.hasFoothold, true)
  assert.equal(first.meta.warmedSeeds.length, 3)
  assert.equal(siftCalls, 1)
  assert.equal(assemblyFailures, 1)
  const repeated = await generator.generate({ seed: 77, budgetMs: 100, preferences: { categories: ["binary_fill"], targetSeconds: 30 } })
  assert.equal(repeated.meta.source, "cache")
  assert.equal(runs, 1)
  const transferred = await generator.generate({ seed: 888, budgetMs: 1000, transferFrom: first.meta.contentHash, preferences: { categories: ["binary_fill"], targetSeconds: 30 } })
  assert.equal(transferred.meta.source, "cache")
  assert.equal(transferred.pack.seed, 888)
  assert.equal(transferred.pack.transfer.family, first.pack.transfer.family)
  assert.notEqual(transferred.meta.contentHash, first.meta.contentHash)
  assert.equal(runs, 1)

  let aborted = false
  const slow = createGameGenerator({ planner: { source: "injected", run: (context) => new Promise(() => {
    context.signal.addEventListener("abort", () => { aborted = true })
  }) } })
  const started = Date.now()
  const timeout = await slow.generate({ seed: 101, budgetMs: 35, preferences: { categories: ["lights_toggle"], mode: "MULTI" } })
  assert.ok(Date.now() - started < 100)
  assert.equal(timeout.meta.source, "fallback")
  // Very small budgets skip inference entirely; larger budgets abort the actual planner.
  assert.ok(timeout.meta.fallbackReason === "budget")
  const slowRun = await slow.generate({ seed: 202, budgetMs: 90, preferences: { categories: ["lights_toggle"], mode: "MULTI" } })
  assert.equal(slowRun.meta.fallbackReason, "budget")
  assert.equal(aborted, true)
  assert.equal(slowRun.pack.category, "lights_toggle")
  assert.equal(slowRun.pack.mode, "MULTI")

  const offline = createGameGenerator({ planner: null })
  for (const category of ["binary_fill", "crown", "path_cover", "tile_rotate_connect", "lights_toggle"]) {
    const result = await offline.generate({ seed: 500, n: 4, budgetMs: 1000, preferences: { categories: [category] } })
    assert.equal(result.pack.category, category)
    assert.equal(result.meta.source, "fallback")
    assert.equal(result.meta.fallbackReason, "model-unavailable")
    assert.equal(result.meta.plannerSource, "unavailable")
  }
  await assert.rejects(offline.generate({ seed: 44, preferences: { visibility: "partial" } }), error => error instanceof GameGenerationError && error.code === "unsupported-profile")
  await assert.rejects(offline.generate({ seed: 44, preferences: { mode: "RISK" } }), error => error instanceof GameGenerationError && error.code === "unsupported-profile")
  await assert.rejects(offline.generate({ seed: 44, preferences: { categories: ["lights_toggle"], mode: "FORCED-CHAIN" } }), error => error instanceof GameGenerationError && error.code === "unsupported-profile")

  let attempts = 0
  const rejecting = createGameGenerator({ planner, assemble: (request, options) => {
    if (request.preferences?.clueDensity === 0.55 && attempts++ === 0) throw new Error("Rejected candidate")
    return assembleGamePack(request, options)
  } })
  const retryPlanner = {
    source: "injected",
    async run(context) {
      const idea = context.ideas.find(idea => idea.status === "assemblable")
      context.sift({ ideaId: idea.id, invention: "Retry niche", playability: "Short visible puzzle", transferPattern: idea.localPattern, estimatedSeconds: 30 })
      const request = { category: idea.category, seed: context.seed, n: context.n, preferences: { clueDensity: 0.55 } }
      assert.equal(context.assemble(request).ok, false)
      assert.equal(context.assemble({ ...request, preferences: { clueDensity: 0.65 } }).ok, true)
    },
  }
  const retry = createGameGenerator({ planner: retryPlanner, assemble: (request, options) => {
    if (request.preferences?.clueDensity === 0.55) throw new Error("Rejected candidate")
    return assembleGamePack(request, options)
  } })
  const repaired = await retry.generate({ seed: 111, budgetMs: 1000, preferences: { categories: ["binary_fill"] } })
  assert.equal(repaired.meta.source, "agent")
  assert.ok(rejecting.cacheSize() === 0)
  console.log("Game generation checks passed: seeded sift, real assembly, rejection retry, deadline abort, profile cache, public audit, and all five mechanics.")
} finally {
  await rm(output, { recursive: true, force: true })
}

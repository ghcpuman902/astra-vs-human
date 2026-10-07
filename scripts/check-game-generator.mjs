import assert from "node:assert/strict"
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  mkdir,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const output = await mkdtemp(join(tmpdir(), "astra-game-generator-"))
try {
  await writeFile(join(output, "package.json"), '{"type":"module"}')
  await symlink(
    fileURLToPath(new URL("../node_modules", import.meta.url)),
    join(output, "node_modules")
  )
  for (const folder of ["puzzle", "mini-game-rules"]) {
    await mkdir(join(output, folder))
    for (const file of await readdir(
      new URL(`../lib/${folder}/`, import.meta.url)
    )) {
      if (!file.endsWith(".ts")) continue
      const source = await readFile(
        new URL(`../lib/${folder}/${file}`, import.meta.url),
        "utf8"
      )
      const compiled = ts
        .transpileModule(source, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ES2022,
          },
        })
        .outputText.replace(/from "(\.\.?\/[^".]+)"/g, 'from "$1.js"')
      await writeFile(
        join(output, folder, file.replace(/\.ts$/, ".js")),
        compiled
      )
    }
  }
  const { createGameGenerator, GameGenerationError, gameBudget } = await import(
    join(output, "mini-game-rules/generator.js")
  )
  const { gameLandscape, pickGameIdeas } = await import(
    join(output, "mini-game-rules/catalogue.js")
  )
  const { assembleGamePack } = await import(
    join(output, "mini-game-rules/assembler.js")
  )
  assert.equal(gameLandscape().length, 144)
  assert.deepEqual(pickGameIdeas(57), pickGameIdeas(57))
  assert.equal(pickGameIdeas(57).length, 4)
  assert.ok(new Set(pickGameIdeas(57).map((idea) => idea.category)).size >= 3)
  assert.equal(gameBudget(100_000), 55_000)
  assert.equal(gameBudget("bad"), 55_000)

  let siftCalls = 0,
    assemblyFailures = 0,
    runs = 0
  const planner = {
    source: "injected",
    async run(context) {
      runs++
      const research = context.ideas.find((idea) => idea.status === "research")
      if (research) {
        assert.equal(
          context.sift({
            ideaId: research.id,
            invention: "Risk research",
            playability: "Short toy",
            transferPattern: "Local patterns",
            estimatedSeconds: 30,
          }).ok,
          false
        )
      }
      const idea = context.ideas.find((idea) => idea.status === "assemblable")
      assert.ok(idea)
      const selection = {
        ideaId: idea.id,
        invention: "A small local twist",
        playability: "Visible corner clues for a short round",
        transferPattern: idea.localPattern,
        estimatedSeconds: 30,
      }
      assert.equal(context.sift(selection).ok, true)
      siftCalls++
      assert.equal(
        context.assemble({
          category: idea.category,
          seed: context.seed + 90,
          n: context.n,
        }).ok,
        false
      )
      assemblyFailures++
      const result = context.assemble({
        category: idea.category,
        seed: context.seed,
        n: context.n,
        preferences: { clueDensity: 0.55 },
      })
      assert.equal(result.ok, true)
      assert.equal("foothold" in result, false)
    },
  }
  const generator = createGameGenerator({ planner })
  const first = await generator.generate({
    seed: 77,
    budgetMs: 1500,
    preferences: { categories: ["binary_fill"], targetSeconds: 30 },
  })
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
  const repeated = await generator.generate({
    seed: 77,
    budgetMs: 100,
    preferences: { categories: ["binary_fill"], targetSeconds: 30 },
  })
  assert.equal(repeated.meta.source, "cache")
  assert.equal(runs, 1)
  const transferred = await generator.generate({
    seed: 888,
    budgetMs: 1000,
    transferFrom: first.meta.contentHash,
    preferences: { categories: ["binary_fill"], targetSeconds: 30 },
  })
  assert.equal(transferred.meta.source, "cache")
  assert.equal(transferred.pack.seed, 888)
  assert.equal(transferred.pack.transfer.family, first.pack.transfer.family)
  assert.notEqual(transferred.meta.contentHash, first.meta.contentHash)
  assert.equal(runs, 1)

  let aborted = false
  const slow = createGameGenerator({
    planner: {
      source: "injected",
      run: (context) =>
        new Promise(() => {
          context.signal.addEventListener("abort", () => {
            aborted = true
          })
        }),
    },
  })
  const started = Date.now()
  const timeout = await slow.generate({
    seed: 101,
    budgetMs: 35,
    preferences: { categories: ["lights_toggle"], mode: "MULTI" },
  })
  assert.ok(Date.now() - started < 100)
  assert.equal(timeout.meta.source, "fallback")
  // Very small budgets skip inference entirely; larger budgets abort the actual planner.
  assert.ok(timeout.meta.fallbackReason === "budget")
  const slowRun = await slow.generate({
    seed: 202,
    budgetMs: 90,
    preferences: { categories: ["lights_toggle"], mode: "MULTI" },
  })
  assert.equal(slowRun.meta.fallbackReason, "budget")
  assert.equal(aborted, true)
  assert.equal(slowRun.pack.category, "lights_toggle")
  assert.equal(slowRun.pack.mode, "MULTI")

  const offline = createGameGenerator({ planner: null })
  for (const category of [
    "binary_fill",
    "crown",
    "path_cover",
    "tile_rotate_connect",
    "lights_toggle",
    "lamp_rays",
  ]) {
    const result = await offline.generate({
      seed: 500,
      n: 4,
      budgetMs: 1000,
      preferences: { categories: [category] },
    })
    assert.equal(result.pack.category, category)
    assert.equal(result.meta.source, "fallback")
    assert.equal(result.meta.fallbackReason, "model-unavailable")
    assert.equal(result.meta.plannerSource, "unavailable")
  }
  await assert.rejects(
    offline.generate({ seed: 44, preferences: { visibility: "partial" } }),
    (error) =>
      error instanceof GameGenerationError &&
      error.code === "unsupported-profile"
  )
  await assert.rejects(
    offline.generate({ seed: 44, preferences: { mode: "RISK" } }),
    (error) =>
      error instanceof GameGenerationError &&
      error.code === "unsupported-profile"
  )
  await assert.rejects(
    offline.generate({
      seed: 44,
      preferences: { categories: ["lights_toggle"], mode: "FORCED-CHAIN" },
    }),
    (error) =>
      error instanceof GameGenerationError &&
      error.code === "unsupported-profile"
  )

  const retryPlanner = {
    source: "injected",
    async run(context) {
      const idea = context.ideas.find((idea) => idea.status === "assemblable")
      context.sift({
        ideaId: idea.id,
        invention: "Retry niche",
        playability: "Short visible puzzle",
        transferPattern: idea.localPattern,
        estimatedSeconds: 30,
      })
      const request = {
        category: idea.category,
        seed: context.seed,
        n: context.n,
        preferences: { clueDensity: 0.55 },
      }
      assert.equal(context.assemble(request).ok, false)
      assert.equal(
        context.assemble({ ...request, preferences: { clueDensity: 0.65 } }).ok,
        true
      )
    },
  }
  const retry = createGameGenerator({
    planner: retryPlanner,
    assemble: (request, options) => {
      if (request.preferences?.clueDensity === 0.55)
        throw new Error("Rejected candidate")
      return assembleGamePack(request, options)
    },
  })
  const repaired = await retry.generate({
    seed: 111,
    budgetMs: 1000,
    preferences: { categories: ["binary_fill"] },
  })
  assert.equal(repaired.meta.source, "agent")

  // Direct route tests use the real handler/engine, disabling paid model inference only.
  const routeSource = (
    await readFile(
      new URL("../app/api/game-pack/route.ts", import.meta.url),
      "utf8"
    )
  )
    .replaceAll("@/lib/mini-game-rules/", "./mini-game-rules/")
    .replace("createGameGenerator()", "createGameGenerator({ planner: null })")
  const routeCompiled = ts
    .transpileModule(routeSource, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    })
    .outputText.replace(/from "(\.\.?\/[^".]+)"/g, 'from "$1.js"')
  await writeFile(join(output, "game-route.js"), routeCompiled)
  const { GET, POST, maxDuration } = await import(join(output, "game-route.js"))
  assert.equal(maxDuration, 60)
  const queryResult = await GET(
    new Request(
      "http://localhost/api/game-pack?seed=700&n=4&category=path_cover"
    )
  )
  assert.equal(queryResult.status, 200)
  assert.equal(queryResult.headers.get("cache-control"), "no-store")
  const queryBody = await queryResult.json()
  assert.equal(queryBody.pack.category, "path_cover")
  assert.equal("solution" in queryBody.audit, false)
  assert.equal("foothold" in queryBody.audit, false)
  assert.equal("sift" in queryBody.meta, false)
  assert.equal("sampledIdeas" in queryBody.meta, false)
  for (const query of [
    "seed=4294967296",
    "n=3",
    "category=unknown",
    "seed=1&seed=2",
    "budgetMs=999999",
  ]) {
    assert.equal(
      (await GET(new Request(`http://localhost/api/game-pack?${query}`)))
        .status,
      400
    )
  }
  const post = (body, headers = { "content-type": "application/json" }) =>
    POST(
      new Request("http://localhost/api/game-pack", {
        method: "POST",
        headers,
        body: typeof body === "string" ? body : JSON.stringify(body),
      })
    )
  const validPost = await post({
    seed: 800,
    n: 4,
    preferences: {
      categories: ["lights_toggle"],
      mode: "MULTI",
      targetSeconds: 25,
    },
  })
  assert.equal(validPost.status, 200)
  assert.equal((await validPost.json()).pack.session.targetSeconds, 25)
  assert.equal((await post({ seed: 800, budgetMs: 99_999 })).status, 400)
  assert.equal(
    (await post({ seed: 800, preferences: { secretOption: true } })).status,
    400
  )
  assert.equal(
    (await post({ seed: 800, preferences: { categories: ["crown", "crown"] } }))
      .status,
    400
  )
  assert.equal(
    (await post({ seed: 800, preferences: { visibility: "partial" } })).status,
    422
  )
  assert.equal((await post("broken json")).status, 400)
  assert.equal(
    (await post({ seed: 800 }, { "content-type": "text/plain" })).status,
    415
  )
  assert.equal(
    (
      await post(" ".repeat(33 * 1024), {
        "content-type": "application/json",
        "content-length": "1",
      })
    ).status,
    413
  )
  const originalBudget = process.env.PACK_GEN_BUDGET_MS
  try {
    process.env.PACK_GEN_BUDGET_MS = "25"
    const stalledBody = new ReadableStream({ start() {} })
    const timedBody = await POST(
      new Request("http://localhost/api/game-pack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: stalledBody,
        duplex: "half",
      })
    )
    assert.equal(timedBody.status, 408)
    process.env.PACK_GEN_BUDGET_MS = "150"
    const delayedBody = new ReadableStream({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(
            new TextEncoder().encode(
              '{"seed":900,"preferences":{"categories":["lights_toggle"]}}'
            )
          )
          controller.close()
        }, 30)
      },
    })
    const delayed = await POST(
      new Request("http://localhost/api/game-pack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: delayedBody,
        duplex: "half",
      })
    )
    assert.equal(delayed.status, 200)
    assert.ok((await delayed.json()).meta.elapsedMs >= 25)
  } finally {
    if (originalBudget === undefined) delete process.env.PACK_GEN_BUDGET_MS
    else process.env.PACK_GEN_BUDGET_MS = originalBudget
  }
  console.log(
    "Game generation checks passed: seeded sift, real assembly, rejection retry, deadline abort, profile cache, public audit, and all six mechanics."
  )
} finally {
  await rm(output, { recursive: true, force: true })
}

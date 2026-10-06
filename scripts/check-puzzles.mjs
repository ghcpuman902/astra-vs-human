import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ts from "typescript"

// Compile only this framework-neutral module set into an isolated temporary folder.
const output = await mkdtemp(join(tmpdir(), "astra-puzzles-"))
try {
  await writeFile(join(output, "package.json"), '{"type":"module"}')
  for (const file of await readdir(
    new URL("../lib/puzzle/", import.meta.url)
  )) {
    if (!file.endsWith(".ts")) continue
    const source = await readFile(
      new URL(`../lib/puzzle/${file}`, import.meta.url),
      "utf8"
    )
    let compiled = ts
      .transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ES2022,
        },
      })
      .outputText.replace(/from "(\.\/[^".]+)"/g, 'from "$1.js"')
    if (file === "packs.ts") {
      const json = await readFile(
        new URL("../lib/puzzle/packs-cache.json", import.meta.url),
        "utf8"
      )
      compiled = compiled.replace(
        'import cached from "./packs-cache.json";',
        `const cached = ${json};`
      )
    }
    await writeFile(join(output, file.replace(/\.ts$/, ".js")), compiled)
  }
  const { authorPack, certify, forcedChain } = await import(
    join(output, "author.js")
  )
  const { verify } = await import(join(output, "verifier.js"))
  const { createMatch, learningSlope } = await import(join(output, "match.js"))
  const { createLearnerController } = await import(join(output, "ui-hooks.js"))
  const { createPackGenerator, packBudget } = await import(
    join(output, "generator.js")
  )
  const candidates = [
    [4101, 4],
    [4102, 4],
    [4103, 4],
    [5101, 5],
    [6101, 6],
  ]
  const packs = candidates.map(([seed, n]) => authorPack(seed, n))
  if (process.argv.includes("--refresh-cache")) {
    await writeFile(
      new URL("../lib/puzzle/packs-cache.json", import.meta.url),
      JSON.stringify(packs, null, 2) + "\n"
    )
  }
  const cached = JSON.parse(
    await readFile(
      new URL("../lib/puzzle/packs-cache.json", import.meta.url),
      "utf8"
    )
  )
  assert.deepEqual(cached, packs, "Cache must reproduce exactly from seeds")

  // Independent exhaustive enumeration on 4×4. No author propagation used.
  function independentSolutions(pack) {
    let count = 0
    for (let bits = 0; bits < 2 ** (pack.n ** 2); bits++) {
      const cells = pack.cells.map((_, index) => (bits >>> index) & 1)
      if (
        pack.cells.some(
          (given, index) => given !== null && given !== cells[index]
        )
      )
        continue
      const valid = pack.constraints.every((rule) => {
        const values = rule.cells.map((cell) => cells[cell])
        if (rule.kind === "quota")
          return values.reduce((a, b) => a + b, 0) === rule.ones
        if (rule.kind === "no-three") return new Set(values).size > 1
        return (values[0] === values[1]) === (rule.relation === "=")
      })
      if (valid) count++
    }
    return count
  }
  for (const pack of cached) {
    const certificate = certify(pack)
    assert.equal(certificate.unique, true)
    assert.equal(certificate.forcedComplete, true)
    assert.ok(certificate.foothold)
    assert.ok(certificate.chainLength >= 3)
    if (pack.n === 4) assert.equal(independentSolutions(pack), 1)
    const match = createMatch([pack], {
      actionCap: 300,
      timeCapMs: 60_000,
      now: () => 0,
    })
    assert.equal(
      createLearnerController(match).step(),
      false,
      "Default stub must not solve or guess"
    )
    assert.equal(match.observe("learner").actions, 0)
    // Test-only replay fixture, not a learner policy or learning experiment.
    // It checks the adapter executes decisions through the shared Action API.
    const replay = forcedChain(pack).steps.flatMap(({ cell, value }) => [
      { type: "selectCell", cell },
      ...Array.from({ length: value + 1 }, () => ({ type: "cycle" })),
    ])
    const learner = createLearnerController(match, (view, priorClaims) => {
      assert.equal("constraints" in view, false)
      assert.equal("verifierSpec" in view, false)
      assert.ok(Object.isFrozen(view.cells))
      assert.ok(Object.isFrozen(priorClaims))
      return {
        action: replay.shift() ?? null,
        patternClaim: "Test replay fixture, not a learning result.",
      }
    })
    for (let step = 0; step < 300 && learner.step(); step++);
    assert.equal(
      match.observe("learner").status,
      "finished",
      `Shared-action replay must finish seed ${pack.seed}`
    )
    assert.equal(
      match.getSnapshot().canAdvance,
      false,
      "Learner cannot advance while human plays"
    )
    assert.ok(match.getSnapshot().records[0].patternClaim)
    assert.equal(verify(pack, match.observe("learner").cells).complete, true)
    const given = pack.cells.findIndex((value) => value !== null)
    const changed = [...match.observe("learner").cells]
    changed[given] = 1 - changed[given]
    assert.equal(verify(pack, changed).valid, false)
    assert.equal(verify(pack, []).valid, false)
    assert.equal(verify(pack, Array(pack.cells.length)).valid, false)
    assert.equal(verify(pack, Array(pack.cells.length).fill(2)).valid, false)
    console.log(
      `seed ${pack.seed}, n=${pack.n}: unique, ${certificate.chainLength} forced cells, replay ${match.observe("learner").actions} actions`
    )
  }
  assert.equal(
    certify({ ...cached[0], cells: Array(16).fill(null), constraints: [] })
      .unique,
    false
  )
  assert.equal(certify(cached[0], 0).exhausted, true)
  assert.throws(() =>
    createMatch([cached[0], cached[0]], { actionCap: 10, timeCapMs: 100 })
  )
  for (let seed = 1; seed <= 12; seed++)
    assert.ok(certify(authorPack(seed, (seed % 3) + 4)).unique)

  let clock = 0
  const match = createMatch(cached, {
    actionCap: 4,
    timeCapMs: 100,
    now: () => clock,
  })
  const human = match.actions("human")
  const editable = cached[0].cells.indexOf(null)
  human.selectCell(editable)
  human.cycle()
  assert.equal(match.observe("learner").cells[editable], null)
  human.undo()
  assert.equal(match.observe("human").cells[editable], null)
  assert.equal(match.observe("human").actions, 3, "Undo never refunds actions")
  human.clear()
  assert.equal(match.observe("human").status, "action-cap")
  assert.equal(match.advance(), false)
  clock = 101
  match.tick()
  assert.equal(match.observe("learner").status, "time-cap")
  assert.equal(match.advance(), true)
  assert.equal(match.observe("human").seed, match.observe("learner").seed)
  assert.equal(match.observe("human").actions, 0)
  assert.throws(() => {
    match.getSnapshot().players.human.cells[editable] = 1
  })
  assert.deepEqual(
    Object.keys(match.observe("learner")).sort(),
    [
      "seed",
      "n",
      "mode",
      "rulesPostcard",
      "cells",
      "given",
      "selectedCell",
      "actions",
      "remainingActions",
      "remainingMs",
      "status",
    ].sort()
  )
  const records = [30, 25, 20].map((actions, seed) => ({
    seed,
    n: 4,
    transferGroup: "family-a-4",
    editableCells: 10,
    player: "learner",
    actions,
    status: "finished",
    patternClaim: null,
  }))
  assert.equal(learningSlope(records, "learner", "family-a-4").slope, -5)
  assert.equal(
    learningSlope(records.slice(0, 2), "learner", "family-a-4").eligible,
    false
  )
  assert.equal(
    learningSlope(
      records.map((record) => ({ ...record, status: "action-cap" })),
      "learner",
      "family-a-4"
    ).eligible,
    false
  )

  const generator = createPackGenerator()
  const fresh = generator.generate(98765, 4, 55_000)
  assert.equal(fresh.source, "generated")
  assert.equal(fresh.pack.seed, 98765)
  assert.ok(
    fresh.elapsedMs < 1000,
    "Fresh playable pack should arrive well under the wall budget"
  )
  assert.equal(fresh.warmedSeeds.length, 2)
  assert.equal(generator.generate(98766, 4, 55_000).source, "cache")
  const again = generator.generate(98765, 4, 55_000)
  assert.equal(again.contentHash, fresh.contentHash)
  again.pack.cells[0] = 2
  assert.notEqual(generator.generate(98765, 4, 55_000).pack.cells[0], 2)
  const rejecting = createPackGenerator({
    candidate: () => {
      throw new Error("rejected")
    },
  })
  for (const n of [4, 5, 6]) {
    const fallback = rejecting.generate(88888, n, 1)
    assert.equal(fallback.source, "fallback")
    assert.equal(fallback.pack.n, n)
    assert.notEqual(fallback.pack.seed, fallback.requestedSeed)
    assert.ok(certify(fallback.pack).unique)
  }
  let attempts = 0
  const mutating = createPackGenerator({
    candidate: (seed, n, checkpoint, mutation) => {
      attempts++
      const pack = authorPack(seed, n, checkpoint, mutation)
      return mutation === 0
        ? { ...pack, rulesPostcard: ["x".repeat(1801)] }
        : pack
    },
  })
  assert.equal(mutating.generate(77777, 4, 50).source, "generated")
  assert.equal(attempts, 2)
  let fakeTime = 0
  const expiring = createPackGenerator({
    now: () => fakeTime,
    candidate: (seed, n, checkpoint) => {
      fakeTime = 10
      checkpoint()
      return authorPack(seed, n)
    },
  })
  assert.equal(expiring.generate(99999, 4, 10).source, "fallback")
  assert.equal(packBudget("999999"), 55_000)
  assert.equal(packBudget("0.1"), 1)
  assert.equal(packBudget("garbage"), 55_000)
  for (let seed = 100; seed < 125; seed++) generator.generate(seed, 4, 10)
  assert.ok(generator.cacheSize() <= 24)

  // Exercise the actual route exports without starting a server.
  const routeSource = await readFile(
    new URL("../app/api/pack/route.ts", import.meta.url),
    "utf8"
  )
  const routeJS = ts
    .transpileModule(routeSource, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    })
    .outputText.replace('"@/lib/puzzle/generator"', '"./generator.js"')
  await writeFile(join(output, "route.js"), routeJS)
  const { GET } = await import(join(output, "route.js"))
  const response = GET(new Request("http://localhost/api/pack?seed=123456&n=6"))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const body = await response.json()
  assert.equal(body.pack.seed, 123456)
  assert.ok(certify(body.pack).unique)
  assert.ok(body.elapsedMs < 1000)
  for (const query of ["n=3", "seed=-1", "seed=4294967296", "seed=abc", "n="]) {
    assert.equal(
      GET(new Request(`http://localhost/api/pack?${query}`)).status,
      400
    )
  }
  console.log(
    `Fresh generator: ${fresh.elapsedMs.toFixed(1)}ms; route n=6: ${body.elapsedMs.toFixed(1)}ms; retry, deadlines, fallback, warming, and bounded cache passed.`
  )
  console.log(
    "Puzzle, fairness, capability boundary, and learning-slope checks passed."
  )
} finally {
  await rm(output, { recursive: true, force: true })
}

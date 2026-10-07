import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import ts from "typescript"

await mkdir("_agent", { recursive: true })
const output = await mkdtemp(join(process.cwd(), "_agent/game-rules-"))
try {
  for (const folder of ["mini-game-rules", "puzzle"]) {
    await mkdir(join(output, folder))
    const files = folder === "puzzle" ? ["author", "types", "verifier"] : ["schema", "runtime", "verifier", "assembler"]
    for (const file of files) {
      const source = await readFile(`lib/${folder}/${file}.ts`, "utf8")
      const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace(/from "(\.[^"\n]+)"/g, 'from "$1.js"')
      await writeFile(join(output, folder, `${file}.js`), compiled)
    }
  }
  const { assembleGamePack } = await import(join(output, "mini-game-rules/assembler.js"))
  const { verifyGame } = await import(join(output, "mini-game-rules/verifier.js"))
  const { initialGameState, applyGameAction, rotatePorts, pathCandidates } = await import(join(output, "mini-game-rules/runtime.js"))
  const categories = ["binary_fill", "crown", "path_cover", "tile_rotate_connect", "lights_toggle"]
  for (const category of categories) for (const n of [4, 5, 6]) for (let seed = 0; seed < 30; seed++) {
    const request = { category, seed, n }
    const { pack, audit } = assembleGamePack(request)
    assert.ok(audit.certified)
    assert.ok(verifyGame(pack, audit.solution).complete, `${category}/${n}/${seed}`)
    assert.ok(pack.postcard.rules.length <= 4)
    assert.ok(pack.mode !== "FORCED-CHAIN" || audit.foothold)
    assert.ok(!JSON.stringify(pack).includes('"solution"'))
    assert.deepEqual(pack, assembleGamePack(request).pack)
    let state = initialGameState(pack)
    assert.equal(verifyGame(pack, state.cells).complete, false, "A fresh puzzle must require play")
    // Zip cells only take a value one step from a numbered neighbour.
    const editable = pack.cells.findIndex((cell, id) => !cell.locked && (category !== "path_cover" || pathCandidates(n, state.cells, id, pack.rules.active.length).length > 0))
    assert.ok(editable >= 0)
    state = applyGameAction(pack, state, { type: "selectCell", cell: editable })
    const before = [...state.cells]
    const next = applyGameAction(pack, state, { type: "cycle" })
    assert.notDeepEqual(next.cells, before)
    assert.deepEqual(applyGameAction(pack, next, { type: "undo" }).cells, before)
    assert.deepEqual(applyGameAction(pack, next, { type: "clear" }).cells, pack.cells.map(cell => cell.value))
    if (category === "tile_rotate_connect") {
      const id = audit.foothold.cell
      const adjacent = (index) => Math.abs(Math.floor(id / n) - Math.floor(index / n)) + Math.abs(id % n - index % n) === 1
      assert.equal(pack.rules.ports.filter((mask, index) => mask && adjacent(index)).length, 1)
      assert.ok(rotatePorts(pack.rules.ports[id], audit.foothold.value))
    }
  }
  // Independently enumerate all crown placements, rather than trusting the author count.
  for (const n of [4, 5, 6]) for (const diagonal of [false, true]) {
    const { pack, audit } = assembleGamePack({ category: "crown", seed: 91, n, preferences: { noDiagonalTouch: diagonal, clueDensity: 0.2 } })
    let count = 0
    function visit(columns) {
      if (columns.length === n) {
        const cells = Array.from({ length: n * n }, (_, id) => columns[Math.floor(id / n)] === id % n ? 1 : 0)
        if (verifyGame(pack, cells).complete) count++
        return
      }
      for (let col = 0; col < n; col++) if (!columns.includes(col)) visit([...columns, col])
    }
    visit([])
    assert.equal(count, audit.solutionCount)
  }
  for (const n of [4, 5, 6]) for (const length of [4, 7, 12]) {
    const { pack, audit } = assembleGamePack({ category: "path_cover", seed: length, n, preferences: { pathLength: length } })
    let count = 0
    function visit(path) {
      const id = path.at(-1)
      if (id === pack.rules.end) {
        if (path.length !== pack.rules.active.length) return
        const cells = pack.cells.map(() => null)
        path.forEach((cell, order) => { cells[cell] = order + 1 })
        if (verifyGame(pack, cells).complete) count++
        return
      }
      for (const next of pack.rules.active) {
        const distance = Math.abs(Math.floor(id / n) - Math.floor(next / n)) + Math.abs(id % n - next % n)
        if (distance === 1 && !path.includes(next)) visit([...path, next])
      }
    }
    visit([pack.rules.start])
    assert.equal(count, audit.solutionCount)
    assert.equal(verifyGame(pack, pack.cells.map(cell => cell.value)).complete, false)
  }
  // Full-cover Zip: independently count every covering route through the public clues.
  for (const n of [4, 5]) for (const seed of [3, 17, 401]) {
    const { pack, audit } = assembleGamePack({ category: "path_cover", seed, n })
    assert.equal(pack.rules.active.length, n * n)
    let count = 0
    const used = new Set([pack.rules.start])
    function visit(id, order) {
      if (order === n * n) {
        if (id === pack.rules.end) count++
        return
      }
      for (const next of [id - n, id + 1, id + n, id - 1]) {
        if (next < 0 || next >= n * n || used.has(next)) continue
        if (Math.abs(next % n - id % n) + Math.abs(Math.floor(next / n) - Math.floor(id / n)) !== 1) continue
        const fixed = pack.cells[next].value
        if (fixed !== null && fixed !== order + 1) continue
        used.add(next)
        visit(next, order + 1)
        used.delete(next)
      }
    }
    visit(pack.rules.start, 1)
    assert.equal(count, 1, `zip ${n}/${seed}`)
    assert.equal(audit.solutionCount, 1)
    // ±1 cycle: the cell after 1 takes 2 in one tap, and never a value held elsewhere.
    const second = audit.solution.indexOf(2)
    if (!pack.cells[second].locked) {
      let state = applyGameAction(pack, initialGameState(pack), { type: "selectCell", cell: second })
      state = applyGameAction(pack, state, { type: "cycle" })
      assert.equal(state.cells[second], 2)
    }
  }
  assert.throws(() => assembleGamePack({ category: "crown", seed: 1, n: 4 }, { deadlineMs: Date.now() - 1 }), /deadline/)
  assert.throws(() => assembleGamePack({ category: "crown", seed: 1, n: 4 }, { nodeCap: 1 }), /budget/)
  console.log("450 seeded packs passed public verification, deterministic assembly, fresh play, shared actions, deadlines, and private-answer boundary checks.")
} finally { await rm(output, { recursive: true, force: true }) }

import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import ts from "typescript"

await mkdir("_agent", { recursive: true })
const output = await mkdtemp(join(process.cwd(), "_agent/affordances-"))
try {
  for (const [folder, files] of Object.entries({
    puzzle: ["author", "types", "verifier"],
    "mini-game-rules": [
      "schema",
      "runtime",
      "affordances",
      "verifier",
      "binary",
      "lamp",
      "assembler",
    ],
  })) {
    await mkdir(join(output, folder))
    for (const file of files) {
      const source = await readFile(`lib/${folder}/${file}.ts`, "utf8")
      const js = ts
        .transpileModule(source, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ES2022,
          },
        })
        .outputText.replace(/from "(\.[^"\n]+)"/g, 'from "$1.js"')
      await writeFile(join(output, folder, `${file}.js`), js)
    }
  }
  const { assembleGamePack } = await import(
    join(output, "mini-game-rules/assembler.js")
  )
  const { applyGameAction, initialGameState } = await import(
    join(output, "mini-game-rules/runtime.js")
  )
  const {
    describeBoard,
    compileIntent,
    compileBoardIntent,
    controlAllows,
  } = await import(join(output, "mini-game-rules/affordances.js"))

  const categories = [
    "binary_fill",
    "crown",
    "path_cover",
    "tile_rotate_connect",
    "lights_toggle",
    "lamp_rays",
  ]
  for (const category of categories) {
    for (const seed of [0, 7, 41]) {
      const { pack, audit } = assembleGamePack({ category, seed, n: 4 })
      assert.ok(audit.certified)
      const state = initialGameState(pack)
      const affordances = describeBoard(pack, state)
      assert.equal(affordances.cells.length, pack.n ** 2)
      assert.equal(affordances.intents, "setCell")
      assert.ok(affordances.cycle.effect.length > 0)
      const dumped = JSON.stringify(affordances)
      assert.equal(dumped.includes("solution"), false)
      assert.equal(dumped.includes("foothold"), false)
      assert.equal(dumped.includes('"transfer"'), false)
      for (const cell of affordances.cells) {
        if (cell.role === "open") {
          // Path cells beside no numbered neighbour may start with empty options.
          if (category !== "path_cover")
            assert.ok(
              cell.options.length > 0,
              `${category}/${seed} open cell ${cell.index} has no options`
            )
        } else assert.equal(cell.options.length, 0)
      }
      for (const index of affordances.controls.selectCell) {
        assert.equal(affordances.cells[index].role, "open")
        const select = { type: "selectCell", cell: index }
        assert.equal(controlAllows(affordances, select), true)
        const applied = applyGameAction(pack, state, select)
        assert.ok(applied.ok, applied.reason)
      }
      const open = affordances.controls.selectCell.find(
        (index) => (affordances.cells[index].options.length ?? 0) > 0
      )
      if (open === undefined) continue
      const option = affordances.cells[open].options[0]
      const compiled = compileIntent(pack, state, { cell: open, value: option })
      assert.ok(compiled.ok, compiled.reason)
      let next = state
      for (const action of compiled.actions) {
        const result = applyGameAction(pack, next, action)
        assert.ok(result.ok, result.reason)
        next = result.state
      }
      assert.equal(next.cells[open], option)
      const boardView = {
        n: pack.n,
        category: pack.category,
        clues: pack.rules,
        actionSurface: pack.actionSurface,
        affordances,
        cells: affordances.cells.map((cell, index) => ({
          index,
          value: cell.value,
          locked: pack.cells[index].locked,
          role: cell.role,
          visible: true,
        })),
      }
      const fromBoard = compileBoardIntent(boardView, {
        cell: open,
        value: option,
      })
      assert.ok(fromBoard.ok, fromBoard.reason)
      assert.deepEqual(fromBoard.actions, compiled.actions)
    }
  }
  console.log(
    "Affordance contract: describe, compile, apply, and board-view parity passed for all six categories."
  )
} finally {
  await rm(output, { recursive: true, force: true })
}

import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import ts from "typescript"

// Execute the real author modules. Temporary compiled code remains git-ignored.
await mkdir("_agent", { recursive: true })
const output = await mkdtemp(join(process.cwd(), "_agent/game-showcase-"))
const portablePaths = [
  "lib/mini-game-rules/schema.ts",
  "lib/mini-game-rules/runtime.ts",
  "lib/mini-game-rules/verifier.ts",
  "lib/puzzle/verifier.ts",
  "lib/puzzle/types.ts",
]
const rendererRequirements = {
  binary_fill: [
    "Render blank/0/1 as two clearly distinct fill states with an explicit empty state.",
    "Display exact row/column quota numbers from quota constraints beside the grid.",
    "Render = and × friend marks between their referenced cells and explain their meaning in the postcard.",
    "Locked givens look fixed; cycle only editable cells. Do not show computed forced moves in scored rounds.",
  ],
  crown: [
    "Render crown, pencil-empty mark, and undecided as distinct cell states.",
    "Render blocked cells from rules.blocked and locked crowns as fixed givens.",
    "Show one-crown-per-row-and-column and the optional diagonal-touch rule in the postcard.",
    "Keep the row/column layout visible at all times; do not calculate candidate highlights for scored players.",
  ],
  path_cover: [
    "Render only rules.active as open cells; shade every inactive cell as blocked.",
    "Render fixed start/end and numbered checkpoints. Open cells cycle through empty then 1 through active.length.",
    "Draw path segments only between currently numbered consecutive edge neighbors.",
    "Show the next cycle value on the selected cell control so ordinal cycling remains understandable on touch.",
  ],
  tile_rotate_connect: [
    "Render ports as N=1, E=2, S=4, W=8 bits. Apply rotatePorts(baseMask, currentCellValue) before drawing.",
    "Render zero-port tiles as blank locked cells. Render active endpoints, straights and elbows as pipes.",
    "The shared cycle reducer skips equivalent orientations of symmetric tiles. Never assume every tile has four distinct states.",
    "Keep tile hit targets fixed during rotation; matching pipes should join visually across shared edges.",
  ],
  lights_toggle: [
    "Render on/off lights with both shape/brightness and color differences.",
    "A cycle tap flips the selected light and its orthogonal neighbors through the shared reducer.",
    "Show the affected cross on press/selection as interaction feedback, using the same feedback for Human and Learner.",
    "Undo restores the previous whole board; clear restores the generated starting lights. Solved means all lights are off.",
  ],
}
const requests = [
  { category: "binary_fill", seed: 640101, n: 4, variant: "showcase-binary", preferences: { targetSeconds: 45, clueDensity: 0.3 } },
  { category: "crown", seed: 640202, n: 5, variant: "showcase-crowns", preferences: { targetSeconds: 60, noDiagonalTouch: true, clueDensity: 0.3 } },
  { category: "path_cover", seed: 640303, n: 4, variant: "showcase-path", preferences: { targetSeconds: 60, pathLength: 9 } },
  { category: "tile_rotate_connect", seed: 640404, n: 5, variant: "showcase-pipes", preferences: { targetSeconds: 40 } },
  { category: "lights_toggle", seed: 640505, n: 4, variant: "showcase-lights", preferences: { targetSeconds: 60 } },
]
try {
  for (const path of [
    ...portablePaths,
    "lib/puzzle/author.ts",
    "lib/mini-game-rules/assembler.ts",
    "lib/mini-game-rules/binary.ts",
    "lib/mini-game-rules/lamp.ts",
    "lib/mini-game-rules/mosaic.ts",
    "lib/mini-game-rules/towers.ts",
  ]) {
    const source = await readFile(path, "utf8")
    const destination = join(output, path.replace(/\.ts$/, ".js"))
    await mkdir(join(destination, ".."), { recursive: true })
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace(/from "(\.[^"\n]+)"/g, 'from "$1.js"')
    await writeFile(destination, compiled)
  }
  const { assembleGamePack } = await import(join(output, "lib/mini-game-rules/assembler.js"))
  const { initialGameState, applyGameAction } = await import(join(output, "lib/mini-game-rules/runtime.js"))
  const { verifyGame } = await import(join(output, "lib/mini-game-rules/verifier.js"))
  const games = requests.map(request => {
    const { pack, audit } = assembleGamePack(request, { deadlineMs: Date.now() + 2000 })
    assert.ok(audit.certified && verifyGame(pack, audit.solution).complete)
    let state = initialGameState(pack)
    assert.equal(verifyGame(pack, state.cells).complete, false)
    const cell = pack.cells.findIndex(value => !value.locked)
    const actions = [
      { type: "selectCell", cell },
      { type: "cycle" },
      { type: "cycle" },
      { type: "undo" },
      { type: "clear" },
    ]
    const snapshots = [{ step: 0, action: null, cells: [...state.cells], selectedCell: state.selectedCell, actions: state.actions, verification: verifyGame(pack, state.cells) }]
    for (const [index, action] of actions.entries()) {
      const before = state
      const result = applyGameAction(pack, state, action)
      assert.ok(result.ok, result.reason)
      state = result.state
      assert.notEqual(state, before)
      snapshots.push({ step: index + 1, action, cells: [...state.cells], selectedCell: state.selectedCell, actions: state.actions, verification: verifyGame(pack, state.cells) })
    }
    assert.deepEqual(snapshots[4].cells, snapshots[2].cells)
    assert.deepEqual(snapshots[5].cells, snapshots[0].cells)
    assert.equal(state.history.length, 0)
    assert.equal(
      applyGameAction(pack, state, { type: "clear" }).ok,
      false,
      "Clear on a clean board is rejected"
    )
    return { id: request.variant, pack, rendererRequirements: rendererRequirements[pack.category], inputOutputTrace: snapshots }
  })
  const files = Object.fromEntries(await Promise.all(portablePaths.map(async path => [path, await readFile(path, "utf8")])))
  const bundle = {
    format: "mini-game-rules-showcase/v1",
    generatedBy: "node scripts/generate-game-showcase.mjs",
    generatedAt: new Date().toISOString(),
    tracks: { miniGameRules: "These public packs, typed engine files, category renderers and verified action traces.", battleGroundUi: "The separate frozen hackathon frame: white board, OKLCH craft tokens, Human|Agent tabs, dual clocks, shared Action API and advance lock." },
    dependencies: { zod: "^4.6.5", language: "TypeScript" },
    actionContract: "Both players call selectCell(cell), cycle(), undo(), clear(). Dispatch the corresponding GameAction through applyGameAction. Check completion with verifyGame(pack, state.cells). Neither player receives author audits or solutions.",
    fairness: { samePackAndSeed: true, sameActions: true, sameClock: true, advance: "Lock until both finish or reach a shared action/time cap.", hints: "practice-only", scoring: "Score falling actions across at least three near-transfer rounds within the same rule family and board size. The five mixed showcase categories are renderer demos, not one learning-slope cohort.", claim: "We score the pattern they carried forward, not the puzzle class they recognised." },
    roundDesign: { targetSeconds: { minimum: 10, maximum: 120 }, stretchSeconds: 600, note: "The target is a design estimate. Passing two minutes is not a failure; a stuck player may use the shared ten-minute cap." },
    lovableTask: "Build five distinct category renderers behind the existing battle-ground-ui frame. Reuse the frozen white/OKLCH craft and Human|Agent dual-clock chrome. Treat engine files as authoritative. After user approval, summarize the UI decisions that transfer to the next typed game pack.",
    games,
    files,
  }
  const destination = "handoffs/mini-game-rules/generated-showcase.json"
  await mkdir("handoffs/mini-game-rules", { recursive: true })
  const serialized = JSON.stringify(bundle, null, 2) + "\n"
  assert.ok(Buffer.byteLength(serialized) < 1_000_000)
  assert.ok(games.every(game => !Object.hasOwn(game, "audit") && !Object.hasOwn(game.pack, "solution")))
  await writeFile(destination, serialized)
  console.log(`${destination}: ${games.length} generated categories, ${games.reduce((sum, game) => sum + game.inputOutputTrace.length, 0)} verified trace snapshots, ${Buffer.byteLength(serialized)} bytes; no host audit or answer included.`)
} finally {
  await rm(output, { recursive: true, force: true })
}

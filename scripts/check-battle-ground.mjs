import assert from "node:assert/strict"
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import ts from "typescript"
const out = await mkdtemp(join(tmpdir(), "astra-battle-"))
try {
  await writeFile(out + "/package.json", '{"type":"module"}')
  await symlink(resolve("node_modules"), out + "/node_modules")
  for (const folder of ["puzzle", "mini-game-rules", "battle-ground-ui"]) {
    await mkdir(out + "/" + folder)
    for (const file of await readdir("lib/" + folder))
      if (file.endsWith(".ts")) {
        const source = await readFile("lib/" + folder + "/" + file, "utf8")
        await writeFile(
          out + "/" + folder + "/" + file.replace(/\.ts$/, ".js"),
          ts
            .transpileModule(source, {
              compilerOptions: {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.ES2022,
              },
            })
            .outputText.replace(/from "(\.\.?\/[^".]+)"/g, 'from "$1.js"')
        )
      }
  }
  const { assembleGamePack } = await import(
    out + "/mini-game-rules/assembler.js"
  )
  const { createBattleGround, scoreTransfer } = await import(
    out + "/battle-ground-ui/controller.js"
  )
  for (const category of [
    "binary_fill",
    "crown",
    "path_cover",
    "tile_rotate_connect",
    "lights_toggle",
  ]) {
    const packs = [91, 92].map(
      (seed) => assembleGamePack({ category, seed, n: 4 }).pack
    )
    let time = 0
    const battle = createBattleGround(packs, { actionCap: 2, now: () => time })
    assert.equal(
      battle.boardProps("human").seed,
      battle.boardProps("learner").seed
    )
    assert.equal(battle.boardProps("learner").readOnly, true)
    assert.equal("friendPatterns" in battle.boardProps("human"), false)
    const before = battle.getSnapshot().attempts.learner.state.cells
    battle.actions("human").selectCell(0)
    battle.actions("human").undo()
    assert.equal(battle.getSnapshot().attempts.human.state.actions, 2)
    assert.deepEqual(battle.getSnapshot().attempts.learner.state.cells, before)
    assert.equal(battle.advance(), false)
    time = 121000
    battle.tick()
    assert.equal(battle.getSnapshot().attempts.learner.status, "playing")
    battle.actions("learner").clear()
    battle.actions("learner").undo()
    assert.equal(battle.getSnapshot().canAdvance, true)
    assert.equal(battle.advance(), true)
    time += 600001
    battle.tick()
    assert.equal(battle.getSnapshot().attempts.human.status, "time-cap")
    assert.equal(battle.getSnapshot().attempts.learner.status, "time-cap")
  }
  const records = [12, 9, 7].map((actions, index) => ({
    seed: index,
    side: "human",
    transferGroup: "family",
    status: "finished",
    actions,
    elapsedMs: 100,
    claim: null,
  }))
  assert.equal(scoreTransfer(records, "human", "family").actionsFalling, true)
  assert.equal(
    scoreTransfer(records.slice(0, 2), "human", "family").eligible,
    false
  )
  console.log(
    "Battle bridge verified: five mechanics, shared clock, independent state, counted controls, advance lock, transfer scoring."
  )
} finally {
  await rm(out, { recursive: true, force: true })
}

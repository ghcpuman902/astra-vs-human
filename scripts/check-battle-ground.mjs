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
  const { buildMatchDeck } = await import(
    out + "/battle-ground-ui/match-deck.js"
  )
  const { matchFamilies, rankMatchFamilies, orderByFamily } = await import(
    out + "/battle-ground-ui/family-bias.js"
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
    assert.equal(battle.getSnapshot().attempts.human.status, "action-cap")
    assert.deepEqual(battle.getSnapshot().attempts.learner.state.cells, before)
    assert.equal(battle.getSnapshot().attempts.learner.status, "playing")
    assert.equal(
      battle.advance("learner"),
      false,
      "A side still playing cannot be advanced"
    )
    const learnerRemaining = battle.getSnapshot().remainingMs.learner
    assert.equal(battle.advance("human"), true)
    assert.equal(battle.getSnapshot().cursors.human.index, 1)
    assert.equal(battle.getSnapshot().cursors.learner.index, 0)
    assert.equal(battle.getSnapshot().attempts.learner.status, "playing")
    assert.equal(battle.getSnapshot().remainingMs.learner, learnerRemaining)
    assert.deepEqual(battle.getSnapshot().attempts.learner.state.cells, before)
    assert.notEqual(
      battle.boardProps("human").seed,
      battle.boardProps("learner").seed
    )
    let reads = 0
    const unsubscribe = battle.subscribe(() => reads++)
    time += 1
    battle.boardProps("human")
    battle.boardProps("learner")
    assert.equal(
      reads,
      0,
      "Reading board props must not publish during React rendering"
    )
    unsubscribe()
    time = 121000
    battle.tick()
    assert.equal(battle.getSnapshot().attempts.learner.status, "playing")
    assert.equal(
      battle.getSnapshot().cursors.learner.index,
      0,
      "The clock must not pull the learner into the human's round"
    )
    battle.actions("learner").clear()
    battle.actions("learner").undo()
    assert.equal(battle.getSnapshot().canAdvance.learner, true)
    assert.equal(battle.getSnapshot().canAdvance.human, false)
    assert.equal(battle.advance("learner"), true)
    assert.equal(battle.getSnapshot().cursors.learner.index, 1)
    assert.equal(battle.getSnapshot().cursors.human.index, 1)
    time += 600001
    battle.tick()
    assert.equal(battle.getSnapshot().attempts.human.status, "time-cap")
    assert.equal(battle.getSnapshot().attempts.learner.status, "time-cap")
  }
  let readingClock = 0
  const pausedPack = assembleGamePack({
    category: "binary_fill",
    seed: 934,
    n: 4,
  }).pack
  const paused = createBattleGround([pausedPack], {
    startPaused: true,
    timeCapMs: 120000,
    now: () => readingClock,
  })
  readingClock = 200000
  paused.tick()
  paused.actions("human").selectCell(0)
  assert.equal(paused.getSnapshot().remainingMs.human, 120000)
  assert.equal(paused.getSnapshot().remainingMs.learner, 120000)
  assert.equal(paused.getSnapshot().attempts.human.state.actions, 0)
  assert.equal(paused.start(), true)
  assert.equal(paused.start(), false)
  readingClock += 1000
  paused.tick()
  assert.equal(paused.getSnapshot().remainingMs.human, 119000)
  assert.equal(paused.getSnapshot().remainingMs.learner, 119000)
  readingClock += 120000
  paused.tick()
  assert.equal(paused.getSnapshot().attempts.human.status, "time-cap")
  assert.equal(paused.getSnapshot().attempts.learner.status, "time-cap")

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

  const deck = buildMatchDeck()
  assert.equal(deck.gameCount, 5)
  assert.equal(deck.roundsPerGame, 3)
  assert.equal(deck.packs.length, 15)
  assert.equal(new Set(deck.packs.map((pack) => pack.seed)).size, 15)
  for (const game of deck.games) {
    assert.equal(game.packs.length, 3)
    assert.equal(
      new Set(game.packs.map((pack) => pack.transfer.family)).size,
      1
    )
    assert.equal(
      new Set(game.packs.map((pack) => JSON.stringify(pack.cells))).size,
      3,
      `${game.category} repeated a board`
    )
  }
  let matchTime = 0
  const match = createBattleGround(deck.packs, {
    roundsPerGame: 3,
    actionCap: 1,
    timeCapMs: 1000,
    now: () => matchTime,
  })
  assert.equal(match.getSnapshot().gameCount, 5)
  const learnerSeed = match.boardProps("learner").seed
  const learnerCells = match.getSnapshot().attempts.learner.state.cells
  match.actions("human").selectCell(0)
  assert.equal(match.getSnapshot().attempts.human.status, "action-cap")
  matchTime = 1000
  match.tick()
  assert.equal(match.getSnapshot().attempts.learner.status, "time-cap")
  assert.equal(match.getSnapshot().attempts.human.status, "action-cap")
  assert.equal(match.getSnapshot().cursors.learner.index, 0)
  assert.equal(match.advance("human"), true)
  assert.deepEqual(match.getSnapshot().cursors.human, {
    index: 1,
    game: 0,
    round: 1,
  })
  assert.equal(match.getSnapshot().attempts.human.status, "playing")
  assert.equal(match.boardProps("learner").seed, learnerSeed)
  assert.deepEqual(match.getSnapshot().attempts.learner.state.cells, learnerCells)
  assert.equal(match.advance("learner"), true)
  assert.equal(match.getSnapshot().cursors.learner.index, 1)
  assert.equal(match.getSnapshot().cursors.human.index, 1)
  for (let step = 0; step < 2; step++) {
    match.actions("human").selectCell(0)
    assert.equal(match.advance("human"), true)
  }
  assert.deepEqual(match.getSnapshot().cursors.human, {
    index: 3,
    game: 1,
    round: 0,
  })
  assert.equal(match.getSnapshot().cursors.learner.index, 1)

  const catalogue = matchFamilies()
  assert.equal(catalogue.length, 5)
  assert.deepEqual(
    rankMatchFamilies().map((family) => family.id),
    catalogue.map((family) => family.id)
  )
  const playedFirst = rankMatchFamilies({
    played: [catalogue[0].id],
    disliked: [],
  })
  assert.equal(playedFirst.at(-1).id, catalogue[0].id)
  assert.equal(playedFirst.length, 5)
  const dislikedAll = rankMatchFamilies({
    played: [],
    disliked: catalogue.map((family) => family.id),
  })
  assert.equal(dislikedAll.length, 5)
  assert.deepEqual(
    dislikedAll.map((family) => family.id),
    catalogue.map((family) => family.id)
  )
  const lessLights = rankMatchFamilies({
    played: [],
    disliked: ["lights-cross-cancellation"],
  })
  assert.equal(lessLights.at(-1).id, "lights-cross-cancellation")
  assert.deepEqual(
    lessLights.slice(0, 4).map((family) => family.id),
    catalogue.slice(0, 4).map((family) => family.id)
  )
  const ordered = orderByFamily(deck.games, {
    played: [],
    disliked: ["lights-cross-cancellation"],
  })
  assert.equal(ordered.at(-1).category, "lights_toggle")
  assert.equal(ordered[0].category, "binary_fill")
  assert.equal(
    ordered.flatMap((game) => game.packs).length,
    15
  )

  const appSource = await readFile(
    new URL("../components/battle-app.tsx", import.meta.url),
    "utf8"
  )
  const fieldSource = await readFile(
    new URL("../components/lovable/battle-field.tsx", import.meta.url),
    "utf8"
  )
  const shellSource = await readFile(
    new URL("../app/lovable-shell.css", import.meta.url),
    "utf8"
  )
  assert.match(appSource, /data-slot="match-next"/)
  assert.match(appSource, /advance\("human"\)/)
  assert.doesNotMatch(fieldSource, /onNext|advance\(/)
  assert.match(shellSource, /"human agent"/)
  assert.match(shellSource, /grid-area: actions/)
  console.log(
    "Battle bridge verified: five games, three distinct rounds, independent clocks, per-side advance, transfer scoring."
  )
} finally {
  await rm(out, { recursive: true, force: true })
}

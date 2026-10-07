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
  for (const file of [
    "model-refusal.ts",
    "provider-schema.ts",
    "learner-models.ts",
  ]) {
    const source = await readFile("lib/" + file, "utf8")
    await writeFile(
      out + "/" + file.replace(/\.ts$/, ".js"),
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
  const { assembleGamePack } = await import(
    out + "/mini-game-rules/assembler.js"
  )
  const { createBattleGround, scoreTransfer, tallyBlitz, compareBlitz } =
    await import(out + "/battle-ground-ui/controller.js")
  const { createGameLearnerRunner } = await import(
    out + "/battle-ground-ui/model-learner.js"
  )
  const { countCells, rates } = await import(
    out + "/battle-ground-ui/cell-f1.js"
  )
  const { verifyGame } = await import(out + "/mini-game-rules/verifier.js")
  const {
    buildMatchDeck,
    dealMatch,
    freshDeal,
    boardId,
    pickDeepFamily,
    randomDeepFamily,
    DEFAULT_MATCH_LENGTH,
    BLITZ_MATCH_MS,
  } = await import(out + "/battle-ground-ui/match-deck.js")
  const { matchFamilies, rankMatchFamilies, orderByFamily } = await import(
    out + "/battle-ground-ui/family-bias.js"
  )
  const locked = [1, 0, null]
  const exact = countCells(locked, [1, 0, 1], [false, false, true])
  assert.deepEqual(exact, { tp: 2, fp: 0, fn: 0, open: 2 })
  assert.equal(rates(exact).f1, 1)
  const blank = countCells([1, 0], [1, null], [false, false])
  assert.deepEqual(blank, { tp: 1, fp: 0, fn: 1, open: 2 })
  assert.equal(rates(blank).precision, 1)
  assert.equal(rates(blank).recall, 0.5)
  assert.ok(Math.abs(rates(blank).f1 - 2 / 3) < 1e-9)
  const wrong = countCells([1], [0], [false])
  assert.deepEqual(wrong, { tp: 0, fp: 1, fn: 1, open: 1 })
  assert.equal(rates(wrong).f1, 0)
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
    assert.equal("solution" in battle.boardProps("human"), false)
    const before = battle.getSnapshot().attempts.learner.state.cells
    const open =
      battle.boardProps("human").affordances.cells.find(
        (item) => item.role === "open" && item.options.length > 0
      )?.index ?? battle.boardProps("human").affordances.controls.selectCell[0]
    battle.actions("human").undo()
    assert.equal(
      battle.getSnapshot().attempts.human.state.actions,
      0,
      "Empty undo is rejected and must not count"
    )
    battle.actions("human").selectCell(open)
    battle.actions("human").cycle()
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
    const closed = battle
      .getSnapshot()
      .records.find((record) => record.side === "human")
    assert.equal(closed?.cells?.length, 16)
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
    const learnerOpen =
      battle.boardProps("learner").affordances.cells.find(
        (item) => item.role === "open" && item.options.length > 0
      )?.index ??
      battle.boardProps("learner").affordances.controls.selectCell[0]
    battle.actions("learner").selectCell(learnerOpen)
    battle.actions("learner").cycle()
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
  const freePack = assembleGamePack({ category: "binary_fill", seed: 91, n: 4 }).pack
  const free = createBattleGround([freePack], {
    actionCap: 2,
    limitHumanTaps: false,
  })
  const freeCell =
    free.boardProps("human").affordances.controls.selectCell[0]
  const freeTap = () => {
    free.actions("human").selectCell(freeCell)
    free.actions("human").cycle()
  }
  freeTap()
  const afterPlace = free.getSnapshot().attempts.human.state.actions
  free.actions("human").undo()
  assert.equal(
    free.getSnapshot().attempts.human.state.actions,
    afterPlace,
    "Undo does not spend a tap"
  )
  free.actions("human").clear()
  assert.equal(
    free.getSnapshot().attempts.human.state.actions,
    afterPlace,
    "Clear does not spend a tap"
  )
  freeTap()
  freeTap()
  assert.equal(free.getSnapshot().attempts.human.status, "playing")
  assert.equal(free.boardProps("human").readOnly, false)
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

  // Settings open: pause() freezes both clocks; start() resumes from the same second.
  for (const clock of ["attempt", "side"]) {
    let stillClock = 0
    const still = createBattleGround([pausedPack], {
      timeCapMs: 120000,
      clock,
      now: () => stillClock,
    })
    stillClock += 5000
    assert.equal(still.pause(), true)
    assert.equal(still.pause(), false)
    assert.equal(still.running(), false)
    stillClock += 60000
    still.tick()
    assert.equal(still.getSnapshot().remainingMs.human, 115000)
    assert.equal(still.getSnapshot().remainingMs.learner, 115000)
    still.actions("human").selectCell(0)
    assert.equal(still.getSnapshot().attempts.human.state.actions, 0)
    assert.equal(still.dump().attempts.human.elapsedMs, 5000)
    assert.equal(still.start(), true)
    stillClock += 1000
    still.tick()
    assert.equal(still.getSnapshot().remainingMs.human, 114000)
    assert.equal(still.getSnapshot().remainingMs.learner, 114000)
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
      new Set(
        game.packs.map((pack) =>
          // Mosaic starts blank, so its numbers tell the boards apart.
          JSON.stringify([pack.cells, pack.rules])
        )
      ).size,
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
  const tapOpen = (side) => {
    const cell = match.boardProps(side).affordances.controls.selectCell[0]
    match.actions(side).selectCell(cell)
  }
  tapOpen("human")
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
    tapOpen("human")
    assert.equal(match.advance("human"), true)
  }
  assert.deepEqual(match.getSnapshot().cursors.human, {
    index: 3,
    game: 1,
    round: 0,
  })
  assert.equal(match.getSnapshot().cursors.learner.index, 1)

  const catalogue = matchFamilies()
  assert.equal(catalogue.length, 14)
  for (const id of ["lamplight", "mosaic", "skyline"])
    assert.ok(catalogue.some((family) => family.id === id), id)
  const rankedFresh = rankMatchFamilies()
  assert.equal(rankedFresh.length, catalogue.length)
  assert.equal(rankedFresh.at(-1).demote, true)
  assert.equal(rankedFresh.at(-1).id, "pipe-boundaries")
  const playedFirst = rankMatchFamilies({
    played: [catalogue[0].id],
    disliked: [],
  })
  assert.ok(playedFirst.map((f) => f.id).indexOf(catalogue[0].id) > 0 || playedFirst[0].id !== catalogue[0].id)
  assert.notEqual(playedFirst[0].id, catalogue[0].id)
  assert.equal(playedFirst.length, catalogue.length)
  const dislikedAll = rankMatchFamilies({
    played: [],
    disliked: catalogue.map((family) => family.id),
  })
  assert.equal(dislikedAll.length, catalogue.length)
  assert.deepEqual(
    dislikedAll.map((family) => family.id),
    catalogue.map((family) => family.id)
  )
  const lessLights = rankMatchFamilies({
    played: [],
    disliked: ["cross-lights"],
  })
  assert.ok(lessLights.map((family) => family.id).indexOf("cross-lights") >= 0)
  assert.equal(lessLights.at(-1).id === "cross-lights" || lessLights.at(-1).id === "pipe-boundaries", true)
  const ordered = orderByFamily(deck.games, {
    played: [],
    disliked: ["cross-lights"],
  })
  // Eight mechanics, five seats: catalogue order fills the deprecated deck, so
  // lights, skyline and demoted pipe wait outside it. A disliked family goes last.
  assert.deepEqual(
    deck.games.map((game) => game.category),
    ["binary_fill", "crown", "path_cover", "lamp_rays", "mosaic_count"]
  )
  assert.ok(deck.games.some((game) => game.category === "lamp_rays"))
  assert.ok(deck.games.some((game) => game.category === "mosaic_count"))
  const dislikedLamp = orderByFamily(deck.games, {
    played: [],
    disliked: ["lamplight"],
  })
  assert.equal(dislikedLamp.at(-1).category, "lamp_rays")
  assert.equal(ordered[0].category, "binary_fill")
  assert.equal(
    ordered.flatMap((game) => game.packs).length,
    15
  )

  assert.equal(DEFAULT_MATCH_LENGTH, "deep")
  const deep = dealMatch("deep")
  assert.equal(deep.length, "deep")
  assert.equal(deep.gameCount, 1)
  assert.equal(deep.roundsPerGame, 5)
  assert.equal(deep.packs.length, 5)
  assert.equal(deep.clock, "attempt")
  assert.equal(new Set(deep.packs.map((pack) => pack.category)).size, 1)
  assert.equal(new Set(deep.packs.map((pack) => pack.seed)).size, 5)
  assert.equal(deep.familyId, catalogue[0].id)
  assert.equal(
    pickDeepFamily({ played: [catalogue[0].id], disliked: [] }).id,
    catalogue[1].id
  )
  assert.equal(
    dealMatch("deep", { played: [catalogue[0].id], disliked: [] }).familyId,
    catalogue[1].id
  )
  assert.equal(
    dealMatch("deep", { played: [], disliked: [catalogue[0].id] }).familyId,
    catalogue[1].id
  )
  assert.equal(
    dealMatch("deep", {
      played: [],
      disliked: catalogue.map((family) => family.id),
    }).familyId,
    catalogue[0].id
  )

  const tour = dealMatch("tour")
  assert.equal(tour.packs.length, 5)
  assert.equal(tour.roundsPerGame, 1)
  assert.equal(tour.gameCount, 5)
  assert.equal(tour.clock, "attempt")
  assert.equal(new Set(tour.packs.map((pack) => pack.category)).size, 5)
  assert.ok(tour.packs.some((pack) => pack.category === "lamp_rays"))
  assert.ok(tour.packs.some((pack) => pack.category === "mosaic_count"))
  assert.ok(!tour.packs.some((pack) => pack.category === "tile_rotate_connect"))
  // Eight mechanics, five seats. A fresh profile tours the first five in
  // catalogue order; skyline and lights wait until those are marked played.
  assert.deepEqual(
    tour.packs.map((pack) => pack.category),
    ["binary_fill", "crown", "path_cover", "lamp_rays", "mosaic_count"]
  )
  const second = dealMatch("tour", {
    played: tour.packs.map((pack) => pack.transfer.family),
    disliked: [],
  })
  assert.equal(new Set(second.packs.map((pack) => pack.category)).size, 5)
  assert.ok(second.packs.some((pack) => pack.category === "tower_sight"))
  assert.ok(second.packs.some((pack) => pack.category === "lights_toggle"))
  // Two tours with the played marks carried forward reach every mechanic bar pipe.
  assert.deepEqual(
    [
      ...new Set(
        [...tour.packs, ...second.packs].map((pack) => pack.category)
      ),
    ].sort(),
    [
      "binary_fill",
      "crown",
      "lamp_rays",
      "lights_toggle",
      "mosaic_count",
      "path_cover",
      "tower_sight",
    ]
  )

  // Every deal is fresh: a rematch of the same family shares no board with the last one.
  const noMarks = { played: [], disliked: [] }
  const firstDeal = freshDeal("deep", noMarks)
  const rematch = freshDeal("deep", noMarks, {
    familyId: firstDeal.familyId,
    avoid: new Set(firstDeal.packs.map(boardId)),
  })
  assert.equal(rematch.familyId, firstDeal.familyId)
  assert.equal(rematch.packs.length, 5)
  assert.ok(
    rematch.packs.every(
      (pack) => !firstDeal.packs.some((old) => boardId(old) === boardId(pack))
    )
  )
  for (const pack of firstDeal.packs) {
    const gold = firstDeal.solutions?.[String(pack.seed)]
    assert.equal(gold?.length, pack.n ** 2)
    assert.equal(verifyGame(pack, gold).complete, true)
    assert.equal("solution" in pack, false)
  }
  // Deep on the new mechanics: five distinct, solvable boards each.
  for (const [familyId, category] of [
    ["mosaic", "mosaic_count"],
    ["skyline", "tower_sight"],
  ]) {
    const deal = freshDeal("deep", noMarks, { familyId })
    assert.equal(deal.familyId, familyId)
    assert.equal(deal.packs.length, 5)
    assert.equal(new Set(deal.packs.map(boardId)).size, 5, familyId)
    for (const pack of deal.packs) {
      assert.equal(pack.category, category)
      assert.equal(pack.transfer.family, familyId)
      assert.equal(verifyGame(pack, deal.solutions[String(pack.seed)]).complete, true)
    }
  }
  // Different game skips the family on screen and the demoted pipe shelf.
  const spun = new Set()
  for (let i = 0; i < 24; i++) {
    const next = randomDeepFamily(noMarks, firstDeal.familyId)
    assert.notEqual(next.id, firstDeal.familyId)
    assert.notEqual(next.id, "pipe-boundaries")
    assert.notEqual(next.demote, true)
    spun.add(next.id)
  }
  assert.ok(spun.size > 1)
  // Ties go to the family dealt least recently, so reloads rotate families.
  assert.notEqual(
    freshDeal("deep", { ...noMarks, recent: [firstDeal.familyId] }).familyId,
    firstDeal.familyId
  )
  for (const kind of ["tour", "blitz"]) {
    const a = freshDeal(kind, noMarks).packs.map(boardId)
    const b = freshDeal(kind, noMarks).packs.map(boardId)
    assert.notDeepEqual(a, b)
  }
  const blitzDeal = dealMatch("blitz")
  assert.equal(blitzDeal.timeCapMs, BLITZ_MATCH_MS)
  assert.equal(blitzDeal.timeCapMs, 180_000)
  assert.equal(blitzDeal.clock, "side")
  assert.equal(blitzDeal.gameCount, 1)
  assert.equal(new Set(blitzDeal.packs.map((pack) => pack.category)).size, 5)
  assert.notEqual(blitzDeal.packs[0].category, blitzDeal.packs[1].category)
  assert.equal(blitzDeal.packs[0].category, blitzDeal.packs[5].category)
  let blitzTime = 0
  const blitz = createBattleGround(blitzDeal.packs, {
    timeCapMs: BLITZ_MATCH_MS,
    clock: "side",
    roundsPerGame: blitzDeal.roundsPerGame,
    actionCap: 1,
    now: () => blitzTime,
  })
  assert.equal(blitz.getSnapshot().remainingMs.human, 180_000)
  assert.equal(blitz.getSnapshot().remainingMs.learner, 180_000)
  const blitzCell = blitz
    .boardProps("human")
    .cells.find((cell) => cell.visible && !cell.locked)
  assert.ok(blitzCell)
  blitz.actions("human").selectCell(blitzCell.index)
  assert.equal(blitz.getSnapshot().attempts.human.status, "action-cap")
  assert.equal(blitz.getSnapshot().attempts.learner.status, "playing")
  assert.equal(blitz.advance("human"), true)
  assert.equal(blitz.getSnapshot().cursors.human.index, 1)
  assert.equal(blitz.getSnapshot().cursors.learner.index, 0)
  blitzTime = 30_000
  blitz.tick()
  assert.equal(blitz.getSnapshot().remainingMs.human, 150_000)
  assert.equal(blitz.getSnapshot().remainingMs.learner, 150_000)
  assert.equal(blitz.getSnapshot().attempts.learner.status, "playing")
  assert.equal(blitz.getSnapshot().cursors.learner.index, 0)
  blitzTime = 180_000
  blitz.tick()
  assert.equal(blitz.getSnapshot().attempts.human.status, "time-cap")
  assert.equal(blitz.getSnapshot().attempts.learner.status, "time-cap")
  assert.equal(blitz.getSnapshot().cursors.human.index, 1)
  assert.equal(blitz.getSnapshot().cursors.learner.index, 0)
  assert.equal(blitz.advance("learner"), false)
  const humanBlitz = tallyBlitz(
    blitz.getSnapshot().records,
    "human",
    blitz.getSnapshot().remainingMs.human
  )
  const learnerBlitz = tallyBlitz(
    blitz.getSnapshot().records,
    "learner",
    blitz.getSnapshot().remainingMs.learner
  )
  assert.equal(humanBlitz.rounds, 1)
  assert.equal(learnerBlitz.rounds, 0)
  assert.equal(humanBlitz.leftoverMs, 0)
  assert.equal(compareBlitz(humanBlitz, learnerBlitz), "human")
  assert.equal(
    compareBlitz(
      { rounds: 2, actions: 10, leftoverMs: 0 },
      { rounds: 2, actions: 8, leftoverMs: 0 }
    ),
    "learner"
  )
  assert.equal(
    compareBlitz(
      { rounds: 2, actions: 8, leftoverMs: 1_000 },
      { rounds: 2, actions: 8, leftoverMs: 5_000 }
    ),
    "learner"
  )

  // Reload resilience: dump() → JSON → restore comes back paused with the same
  // cursors, taps, records and clocks; start() resumes from the saved elapsed time.
  {
    let t = 0
    const deal = dealMatch("blitz")
    const options = {
      timeCapMs: BLITZ_MATCH_MS,
      clock: "side",
      roundsPerGame: deal.roundsPerGame,
      actionCap: 1,
      startPaused: true,
      now: () => t,
    }
    const live = createBattleGround(deal.packs, options)
    assert.equal(live.running(), false)
    live.start()
    const cell = live
      .boardProps("human")
      .cells.find((item) => item.visible && !item.locked)
    live.actions("human").selectCell(cell.index)
    assert.equal(live.advance("human"), true)
    t = 40_000
    live.tick()
    const dump = JSON.parse(JSON.stringify(live.dump()))
    assert.equal(dump.matchMs.human, 40_000)
    assert.equal(dump.cursor.human, 1)
    t = 999_999
    const back = createBattleGround(deal.packs, { ...options, restore: dump })
    assert.equal(back.running(), false)
    assert.equal(back.getSnapshot().cursors.human.index, 1)
    assert.equal(back.getSnapshot().cursors.learner.index, 0)
    assert.equal(back.getSnapshot().records.length, 1)
    assert.equal(back.getSnapshot().remainingMs.human, 140_000)
    assert.equal(back.getSnapshot().remainingMs.learner, 140_000)
    back.tick()
    assert.equal(back.getSnapshot().remainingMs.human, 140_000)
    back.start()
    t += 10_000
    back.tick()
    assert.equal(back.getSnapshot().remainingMs.human, 130_000)
    assert.equal(back.getSnapshot().remainingMs.learner, 130_000)
    assert.throws(() =>
      createBattleGround(deal.packs.slice(0, 2), {
        ...options,
        restore: { ...dump, cursor: { human: 9, learner: 0 } },
      })
    )
  }
  {
    const { createAgentTrace, parseAgentTrace, sumUsage, traced } =
      await import(out + "/battle-ground-ui/agent-trace.js")
    const steps = []
    await traced(
      steps,
      { kind: "plan", model: "gpt-test" },
      async () => ({ usage: { inputTokens: 120, outputTokens: 30, outputTokenDetails: { reasoningTokens: 8 } } }),
      (value) => ({ usage: value.usage, note: "2 placements" })
    )
    await assert.rejects(
      traced(steps, { kind: "decide", model: "luna" }, async () => {
        throw new Error("boom")
      })
    )
    assert.deepEqual(
      steps.map((step) => [step.kind, step.status]),
      [["plan", "ok"], ["decide", "error"]]
    )
    assert.deepEqual(sumUsage(steps), {
      inputTokens: 120,
      outputTokens: 30,
      reasoningTokens: 8,
    })
    const trace = createAgentTrace()
    const id = trace.begin(7, 0, "Planning taps")
    assert.equal(trace.getSnapshot().phase, "thinking")
    trace.add(id, { type: "reasoning", text: "Pairs never repeat." })
    trace.end(id, "done", sumUsage(steps))
    const open = trace.begin(7, 0, "Planning taps")
    const meters = trace.getSnapshot().meters
    assert.equal(meters.calls, 1)
    assert.equal(meters.inputTokens + meters.outputTokens, 150)
    assert.equal(meters.boards["7"].tokens, 150)
    const restored = parseAgentTrace(JSON.parse(JSON.stringify(trace.getSnapshot())))
    assert.ok(restored)
    assert.equal(restored.pendingSince, null)
    assert.equal(restored.messages.find((m) => m.id === open).state, "error")
    assert.equal(restored.meters.calls, 1)
    assert.equal(createAgentTrace(restored).begin(7, 1, "x"), open + 1)
  }

  // Click path without a browser: family marks order the deck, Start is paused
  // until Start both, both boards are live, and human Next does not abort or
  // move an agent that is still thinking.
  let smokeTime = 0
  const smoke = createBattleGround(
    ordered.flatMap((game) => game.packs),
    {
      roundsPerGame: 3,
      actionCap: 1,
      timeCapMs: 120000,
      startPaused: true,
      now: () => smokeTime,
    }
  )
  smokeTime = 5000
  smoke.tick()
  assert.equal(smoke.getSnapshot().remainingMs.human, 120000)
  assert.equal(smoke.getSnapshot().remainingMs.learner, 120000)
  const openingCell = smoke
    .boardProps("human")
    .cells.find((cell) => cell.visible && !cell.locked)
  assert.ok(openingCell)
  smoke.actions("human").selectCell(openingCell.index)
  assert.equal(smoke.getSnapshot().attempts.human.state.actions, 0)
  assert.equal(smoke.boardProps("human").seed, smoke.boardProps("learner").seed)
  assert.equal(smoke.boardProps("learner").readOnly, true)
  assert.equal(smoke.getSnapshot().cursors.human.index, 0)
  assert.equal(smoke.getSnapshot().cursors.learner.index, 0)
  assert.equal(smoke.start(), true)
  assert.equal(smoke.start(), false)
  smokeTime += 1000
  smoke.tick()
  assert.equal(smoke.getSnapshot().remainingMs.human, 119000)
  assert.equal(smoke.getSnapshot().remainingMs.learner, 119000)
  assert.equal(smoke.getSnapshot().attempts.human.status, "playing")
  assert.equal(smoke.getSnapshot().attempts.learner.status, "playing")
  const agentSeed = smoke.boardProps("learner").seed
  const agentCells = smoke.getSnapshot().attempts.learner.state.cells.slice()
  const agentRemaining = smoke.getSnapshot().remainingMs.learner
  const agentCell = smoke
    .boardProps("learner")
    .cells.find((cell) => cell.visible && !cell.locked)
  assert.ok(agentCell)
  let learnerSignal
  let finishThink
  const runner = createGameLearnerRunner({
    observe: () => smoke.boardProps("learner"),
    api: smoke.actions("learner"),
    memory: { claims: [], currentClaim: null },
    mix: "astra",
    decide: async (_request, signal) => {
      learnerSignal = signal
      return new Promise((done) => {
        finishThink = done
      })
    },
  })
  const unsubscribeSmoke = smoke.subscribe(runner.sync)
  const pendingThink = runner.step()
  assert.equal(learnerSignal.aborted, false)
  smoke.actions("human").selectCell(openingCell.index)
  assert.equal(smoke.getSnapshot().attempts.human.status, "action-cap")
  assert.equal(smoke.getSnapshot().canAdvance.human, true)
  assert.equal(smoke.getSnapshot().canAdvance.learner, false)
  assert.equal(learnerSignal.aborted, false)
  assert.equal(smoke.advance("human"), true)
  assert.equal(smoke.advance("learner"), false)
  assert.equal(smoke.getSnapshot().cursors.human.index, 1)
  assert.equal(smoke.getSnapshot().cursors.learner.index, 0)
  assert.equal(smoke.boardProps("learner").seed, agentSeed)
  assert.deepEqual(
    smoke.getSnapshot().attempts.learner.state.cells,
    agentCells
  )
  assert.equal(smoke.getSnapshot().remainingMs.learner, agentRemaining)
  assert.equal(smoke.getSnapshot().attempts.learner.status, "playing")
  runner.sync()
  assert.equal(
    learnerSignal.aborted,
    false,
    "Human Next must not abort the agent"
  )
  finishThink({
    action: { type: "selectCell", cell: agentCell.index },
    state: "decision",
    patternClaim: "Still on this round.",
  })
  assert.equal(await pendingThink, true)
  assert.equal(smoke.getSnapshot().cursors.learner.index, 0)
  assert.equal(smoke.getSnapshot().attempts.learner.state.actions, 1)
  assert.equal(smoke.getSnapshot().cursors.human.index, 1)
  unsubscribeSmoke()
  runner.dispose()

  // LinkedIn / share path without keys: Code mix returns a policy; the UI hook
  // expands it with interpretPolicy into counted steps. Human Next still must
  // not abort or move the agent while that policy is thinking.
  const { interpretPolicy } = await import(out + "/battle-ground-ui/learner-mix.js")
  let codeTime = 0
  const codeBattle = createBattleGround(
    ordered.flatMap((game) => game.packs),
    {
      roundsPerGame: 3,
      actionCap: 1,
      timeCapMs: 120000,
      startPaused: true,
      now: () => codeTime,
    }
  )
  assert.equal(codeBattle.start(), true)
  codeTime += 500
  codeBattle.tick()
  const codeBoard = codeBattle.boardProps("learner")
  const codeCell = codeBoard.cells.find((cell) => cell.role === "open")
  assert.ok(codeCell)
  const codeHumanCell = codeBattle
    .boardProps("human")
    .cells.find((cell) => cell.role === "open")
  assert.ok(codeHumanCell)
  const codeTarget =
    codeBoard.affordances.cells[codeCell.index].options[0] ?? codeCell.value
  const codeSeed = codeBattle.boardProps("learner").seed
  const codeCells = codeBattle.getSnapshot().attempts.learner.state.cells.slice()
  let codeSignal
  let finishCode
  const codeRunner = createGameLearnerRunner({
    observe: () => codeBattle.boardProps("learner"),
    api: codeBattle.actions("learner"),
    memory: { claims: [], currentClaim: null },
    mix: "code",
    decide: async (_request, signal) => {
      codeSignal = signal
      return new Promise((done) => {
        finishCode = done
      })
    },
  })
  const unsubCode = codeBattle.subscribe(codeRunner.sync)
  const pendingCode = codeRunner.step()
  assert.equal(codeSignal.aborted, false)
  codeBattle.actions("human").selectCell(codeHumanCell.index)
  assert.equal(codeBattle.advance("human"), true)
  assert.equal(codeBattle.getSnapshot().cursors.human.index, 1)
  assert.equal(codeBattle.getSnapshot().cursors.learner.index, 0)
  assert.equal(codeBattle.boardProps("learner").seed, codeSeed)
  assert.deepEqual(
    codeBattle.getSnapshot().attempts.learner.state.cells,
    codeCells
  )
  assert.equal(
    codeSignal.aborted,
    false,
    "Human Next must not abort Code-mode thinking"
  )
  const codePolicy = {
    rule: "named-cells",
    cells: [codeCell.index],
    value: codeTarget,
    note: "Code policy on the public board.",
  }
  const codeSteps = interpretPolicy(
    codePolicy,
    codeBattle.boardProps("learner")
  )
  assert.ok(codeSteps.length >= 1)
  assert.equal(codeSteps[0].type, "selectCell")
  assert.equal(codeSteps[0].cell, codeCell.index)
  finishCode({
    action: null,
    state: "decision",
    patternClaim: codePolicy.note,
    policy: codePolicy,
    steps: codeSteps,
  })
  assert.equal(await pendingCode, true)
  assert.equal(codeBattle.getSnapshot().cursors.learner.index, 0)
  assert.equal(
    codeBattle.getSnapshot().attempts.learner.state.actions,
    1,
    "Code steps apply at least the first counted tap under the action cap"
  )
  assert.equal(codeBattle.getSnapshot().attempts.learner.status, "action-cap")
  assert.equal(codeBattle.getSnapshot().cursors.human.index, 1)
  unsubCode()
  codeRunner.dispose()

  const read = (path) =>
    readFile(new URL(path, import.meta.url), "utf8")
  const appSource = await read("../components/battle-app.tsx")
  const fieldSource = await read("../components/lovable/battle-field.tsx")
  const setupSource = await read("../components/setup-screen.tsx")
  const optionSource = await read("../components/match-options.tsx")
  const settingsSource = await read("../components/match-settings.tsx")
  const shellSource = await read("../app/lovable-shell.css")
  assert.match(appSource, /data-slot="match-next"/)
  assert.match(appSource, /advance\("human"\)/)
  assert.doesNotMatch(appSource, /advance\("learner"\)/)
  assert.doesNotMatch(fieldSource, /onNext|advance\(/)
  assert.match(appSource, /Start both/)
  assert.match(appSource, /interactive=\{!watching\}/)
  // Methods are composed: LLM, DM, or both. Code only with an LLM.
  assert.match(optionSource, /LLM \+ DM/)
  assert.match(optionSource, /Writes code/)
  assert.match(optionSource, /writeAgentStack/)
  for (const label of [
    "LLM",
    "Code",
    "LLM + Jev",
    "Jev",
    "LLM + Laya",
    "Laya",
    "LLM + Decisions",
    "Decisions",
    "You vs Agent",
    "Agent vs Agent",
    "Deep",
    "Tour",
    "Blitz",
  ]) {
    assert.match(
      optionSource,
      new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    )
  }
  assert.match(setupSource, /legend="Agent A"/)
  assert.match(setupSource, /legend="Agent B"/)
  // Hero: host, one punchline, one call to action. No eyebrow.
  assert.match(setupSource, /astra-vs-human\.vercel\.app/)
  assert.match(setupSource, /Agents are good\./)
  assert.match(setupSource, /faster AND smarter than humans\?/)
  assert.match(setupSource, /Battle them on mini games!/)
  // Setup shows every model and Deep by default; the rest sits behind More options.
  // Deep families live in that panel, each with a color mark. Up first stays a board.
  assert.match(setupSource, /<ModelChoice/)
  assert.match(setupSource, /className="deep-families"/)
  assert.match(setupSource, /swatch: family\.paint/)
  assert.match(setupSource, /length === "deep" \? matchFamilies\(\)/)
  assert.doesNotMatch(setupSource, /Families you/)
  assert.match(setupSource, /More options/)
  assert.match(appSource, /randomDeepFamily\(marks, preview\?\.familyId\)/)
  assert.match(appSource, /useState<MatchLength>\(DEFAULT_MATCH_LENGTH\)/)
  assert.equal(DEFAULT_MATCH_LENGTH, "deep")
  assert.match(optionSource, /3 min/)
  // Play view: two phone cards; seed lives behind the info button; no scored/test toggle.
  assert.match(appSource, /<Phone/)
  assert.match(appSource, /<MatchInfo/)
  assert.doesNotMatch(appSource, /New boards|Scored|Invent a board/)
  assert.doesNotMatch(appSource, /Out of taps|out of taps/)
  assert.match(settingsSource, /Apply settings and restart/)
  assert.doesNotMatch(settingsSource, /Leave to setup/)
  assert.match(appSource, /<AgentModelMenu|modelMenu\(/)
  assert.match(appSource, /battle\.pause\(\)/)
  assert.match(appSource, /battle\.start\(\)/)
  assert.match(appSource, /chooseModel/)
  // Boards are dealt in the browser per Start/Rematch/Respawn, never baked into the static page.
  assert.match(appSource, /freshDeal\(/)
  assert.match(appSource, /rememberDeal\(/)
  const pageSource = await read("../app/page.tsx")
  assert.doesNotMatch(pageSource, /buildFamilyLibrary/)
  assert.doesNotMatch(appSource, /astra-hybrid/)
  assert.match(shellSource, /\.phone \{/)
  assert.doesNotMatch(shellSource, /body \{[^}]*overflow: hidden/)
  assert.match(
    shellSource,
    /puzzle-cell:not\(\[data-fixed="true"\]\):active:not\(:disabled\)/
  )
  const layoutSource = await read("../app/layout.tsx")
  assert.match(layoutSource, /display: "swap"/)
  assert.match(layoutSource, /adjustFontFallback: true/)
  assert.match(shellSource, /\.primary-button:disabled\s*\{[^}]*surface-muted/)
  assert.match(shellSource, /max\(36px,\s*min\(44px/)
  assert.match(shellSource, /max\(36px,\s*var\(--cell\)\)/)
  assert.match(shellSource, /min-width:\s*36px/)
  assert.doesNotMatch(shellSource, /\(100vi - 80px\) \/ 12/)
  // A chosen chip is outlined with a check; only the primary action is filled ink.
  assert.doesNotMatch(shellSource, /\.option-chip:has\(input:checked\) \{[^}]*background: var\(--ink\)/)
  assert.match(shellSource, /\.primary-button \{[^}]*background: var\(--ink\)/)
  const sideLearnerSource = await read("../hooks/use-side-learner.ts")
  assert.match(sideLearnerSource, /codeTurn\(heldProgram/)
  assert.match(sideLearnerSource, /runProgram\(heldProgram\.source/)
  assert.match(sideLearnerSource, /mix/)
  assert.match(sideLearnerSource, /fetchGameLearnerDecision/)
  assert.match(appSource, /useSideLearner/)
  assert.match(appSource, /transferGroup\(packs\[cursor\.index\]\)/)
  assert.match(appSource, /transfer rounds/)
  assert.doesNotMatch(appSource, /5 × 3|5×3/)
  console.log(
    "Battle bridge verified: Deep 1×5 default, Tour 5×1, Blitz 3:00 independent clocks, human Next leaves the agent thinking, Code policy steps, shared-rules scroll."
  )
} finally {
  await rm(out, { recursive: true, force: true })
}

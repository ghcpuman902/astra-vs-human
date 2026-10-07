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
  const { createBattleGround, scoreTransfer, tallyBlitz, compareBlitz } =
    await import(out + "/battle-ground-ui/controller.js")
  const { createGameLearnerRunner } = await import(
    out + "/battle-ground-ui/model-learner.js"
  )
  const {
    buildMatchDeck,
    dealMatch,
    pickDeepFamily,
    DEFAULT_MATCH_LENGTH,
    BLITZ_MATCH_MS,
  } = await import(out + "/battle-ground-ui/match-deck.js")
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
  assert.equal(catalogue.length, 9)
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
  assert.equal(ordered.at(-1).category, "tile_rotate_connect")
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
  const codeCell = codeBattle
    .boardProps("learner")
    .cells.find((cell) => cell.visible && !cell.locked)
  assert.ok(codeCell)
  const codeHumanCell = codeBattle
    .boardProps("human")
    .cells.find((cell) => cell.visible && !cell.locked)
  assert.ok(codeHumanCell)
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
    cycles: 1,
    note: "Code policy on the public board.",
  }
  const codeSteps = interpretPolicy(
    codePolicy,
    codeBattle.boardProps("learner").cells
  )
  assert.deepEqual(codeSteps, [
    { type: "selectCell", cell: codeCell.index },
    { type: "cycle" },
  ])
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
  assert.doesNotMatch(appSource, /advance\("learner"\)/)
  assert.doesNotMatch(fieldSource, /onNext|advance\(/)
  assert.match(appSource, /Show rules/)
  assert.match(appSource, /Start both/)
  assert.match(
    appSource,
    /Finish this attempt to unlock Next\. The agent is not moved\./
  )
  assert.match(
    appSource,
    /data-phase=\{!rulesShown \? "rules" : !started \? "start" : "next"\}/
  )
  assert.match(appSource, /humanInteractive=\{!watching\}/)
  assert.match(appSource, /learnerModeIds\.map/)
  for (const label of [
    "Astra",
    "Code",
    "Astra + Jev",
    "Jev bare",
    "Astra + Laya",
    "Laya bare",
    "OpenAI Decisions",
    "You vs Agent",
    "Agent vs Agent",
  ]) {
    assert.match(appSource, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  }
  assert.match(appSource, /legend="3 · Agent A"/)
  assert.match(appSource, /legend="4 · Agent B"/)
  assert.match(appSource, /legend="3 · Agent ability"/)
  assert.doesNotMatch(appSource, /astra-hybrid/)
  assert.match(shellSource, /"human agent"/)
  assert.match(shellSource, /grid-area: actions/)
  assert.match(
    shellSource,
    /puzzle-cell:not\(\[data-fixed="true"\]\):active:not\(:disabled\)/
  )
  const layoutSource = await readFile(
    new URL("../app/layout.tsx", import.meta.url),
    "utf8"
  )
  assert.match(layoutSource, /display: "swap"/)
  assert.match(layoutSource, /adjustFontFallback: true/)
  assert.match(shellSource, /\.shared-rules/)
  assert.match(shellSource, /max-height:\s*min\(12rem,\s*32svh\)/)
  assert.match(shellSource, /overflow:\s*auto/)
  assert.match(shellSource, /\.primary-button:disabled\s*\{[^}]*surface-muted/)
  assert.match(shellSource, /max\(36px,\s*min\(44px/)
  assert.match(shellSource, /max\(36px,\s*var\(--cell\)\)/)
  assert.match(shellSource, /min-width:\s*36px/)
  assert.doesNotMatch(shellSource, /\(100vi - 80px\) \/ 12/)
  const sideLearnerSource = await readFile(
    new URL("../hooks/use-side-learner.ts", import.meta.url),
    "utf8"
  )
  assert.match(sideLearnerSource, /interpretPolicy\(result\.policy/)
  assert.match(sideLearnerSource, /mix/)
  assert.match(sideLearnerSource, /fetchGameLearnerDecision/)
  assert.match(appSource, /useSideLearner/)
  assert.match(appSource, /label: "Code"/)
  assert.match(appSource, /Match length/)
  assert.match(appSource, /useState<MatchLength>\(DEFAULT_MATCH_LENGTH\)/)
  assert.match(appSource, /label: "Deep"/)
  assert.match(appSource, /label: "Tour"/)
  assert.match(appSource, /label: "Blitz"/)
  assert.match(appSource, /3 min/)
  assert.match(
    shellSource,
    /\.length-choice \.paper-button\[aria-pressed="true"\]/
  )
  assert.match(
    shellSource,
    /\.length-choice \.paper-button\[aria-pressed="true"\][\s\S]*background:\s*var\(--ink\)/
  )
  assert.match(appSource, /transferGroup\(pack\) === group/)
  assert.match(appSource, /\$\{count\}\/\$\{goal\} completed transfer rounds/)
  assert.doesNotMatch(appSource, /\/3 completed transfer rounds/)
  assert.doesNotMatch(appSource, /5 × 3|5×3/)
  console.log(
    "Battle bridge verified: Deep 1×5 default, Tour 5×1, Blitz 3:00 independent clocks, human Next leaves the agent thinking, Code policy steps, shared-rules scroll."
  )
} finally {
  await rm(out, { recursive: true, force: true })
}

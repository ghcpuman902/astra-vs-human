import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import ts from "typescript"

const sources = {
  "": ["model-refusal"],
  puzzle: ["author", "types", "verifier", "model-learner"],
  "mini-game-rules": [
    "schema",
    "runtime",
    "affordances",
    "verifier",
    "binary",
    "lamp",
    "mosaic",
    "towers",
    "assembler",
  ],
  "battle-ground-ui": [
    "agent-trace",
    "controller",
    "learner-mix",
    "model-learner",
    "mix-dispatch",
  ],
}

/** Transpile the headless game runtime into a temp dir. No network, no UI. */
export async function loadGameRuntime(label = "agent-suite") {
  await mkdir("_agent", { recursive: true })
  const dir = await mkdtemp(join(process.cwd(), `_agent/${label}-`))
  const options = {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }
  for (const [folder, files] of Object.entries(sources)) {
    const out = folder ? join(dir, folder) : dir
    await mkdir(out, { recursive: true })
    for (const file of files) {
      const from = folder ? `lib/${folder}/${file}.ts` : `lib/${file}.ts`
      const source = await readFile(from, "utf8")
      const js = ts
        .transpileModule(source, options)
        .outputText.replace(/from "(\.[^"\n]+)"/g, 'from "$1.js"')
      await writeFile(join(out, `${file}.js`), js)
    }
  }
  const load = (path) => import(join(dir, path))
  const [rules, affordances, runtime, battle, learner, mix] = await Promise.all([
    load("mini-game-rules/assembler.js"),
    load("mini-game-rules/affordances.js"),
    load("mini-game-rules/runtime.js"),
    load("battle-ground-ui/controller.js"),
    load("battle-ground-ui/model-learner.js"),
    load("battle-ground-ui/learner-mix.js"),
  ])
  const dispatch = await load("battle-ground-ui/mix-dispatch.js")
  const schema = await load("mini-game-rules/schema.js")
  const verifier = await load("mini-game-rules/verifier.js")
  return {
    dir,
    assembleGamePack: rules.assembleGamePack,
    describeBoard: affordances.describeBoard,
    reachableOptions: affordances.reachableOptions,
    compileBoardIntent: affordances.compileBoardIntent,
    applyGameAction: runtime.applyGameAction,
    initialGameState: runtime.initialGameState,
    createBattleGround: battle.createBattleGround,
    decideGameLearner: learner.decideGameLearner,
    createGameLearnerRunner: learner.createGameLearnerRunner,
    learnerMixIds: mix.learnerMixIds,
    isChoiceLearnerMix: mix.isChoiceLearnerMix,
    bareControlQuestions: mix.bareControlQuestions,
    plannedControlQuestions: mix.plannedControlQuestions,
    interpretPolicy: mix.interpretPolicy,
    runProgram: mix.runProgram,
    codeTurn: mix.codeTurn,
    learnerBoardPayload: mix.learnerBoardPayload,
    dispatchMix: dispatch.dispatchMix,
    packSchema: schema.packSchema,
    verifyGame: verifier.verifyGame,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

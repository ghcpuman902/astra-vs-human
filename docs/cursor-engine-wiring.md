# Cursor shell wiring for the judges' demo

Lovable owns presentation. The authoritative source is `battle-ground-ui.md`, `mini-game-rules.md`, and `skills/minigame-craft-style/`. The frozen token file is imported once in `app/globals.css`. Keep the imported shell; no category-renderer rebuild is required for the video. One playable binary pack plus a selectable real Learner is sufficient.

Use `GET /api/pack?seed=4101&n=4` for a certified binary pack. It returns `{ pack, source, ... }`. The host verifier and `createMatch` remain under `lib/puzzle`; never pass a full pack, verifier, or private answer to the Learner. Optional novel packs are under `/api/game-pack` and do not replace the demo shell.

The attached stage is already compatible with the shared binary actions. `lib/puzzle/stage-observation.ts` bridges its public snapshot to the live Learner. Its `displayedMarks` projection receives the same `fixture.publicBoard` quotas and friend marks that the human sees. Do not derive extra hidden clues for the agent.

```ts
const models = useLearnerModel()
const memory = createLearnerMemory()
const publicMarks = displayedMarks(pack.n, fixture.publicBoard)
const runner = createModelLearnerRunner({
  observe: () => observeStage(stage, pack, publicMarks, "learner"),
  api: stage.actions("learner"),
  memory,
  model: models.getModel,
})
const unsubscribe = stage.match.subscribe(runner.sync)

// Existing stable Start control, after choices load:
if (!models.startRound(stageId)) return
stage.start()
// Start one serial loop here. Await runner.step() before the next request.
// Continue while stage.started() && !stage.ended(); do not run during reading.

// At the stage deadline, before its existing next-stage control advances:
runner.cancel()
models.endRound(stageId)
// At component teardown:
unsubscribe()
runner.dispose()
```

Import the hook from `hooks/use-learner-model`, the projection from `lib/puzzle/stage-observation`, and the runner from `lib/puzzle/model-learner`. Use a unique stage ID, including the model test round and stage index, rather than only a repeated seed. The selector hook provides models, selectedModel, isFrozen, status, selectModel, startRound, endRound, and getModel. Render it in the existing shell. The server validates the model allowlist.

The attached click helper deliberately alternates pieces while translating through the shared underlying cycle API. Preserve it for both input paths and count every underlying action. Pack verifier semantics remain independent of this presentation helper. Both attempts use the same returned seed; inference time consumes the same stage clock.

Structured public observations are the current agent input. A base64 image is only an image transport encoding; it does not establish fairness. If vision is added later, capture the same public board renderer, after the shared reveal, without solutions, private author hints, or hidden cells. Do not build a second agent-only board rendering pipeline for the demo.

Validated in the running server: the same board yielded legal moves from Astra, Sol 6.1, and Luna. API access can still fail per request; show a real wait rather than substituting a scripted solver. The original export's idle marker should be replaced by policy status once Cursor connects this runner.

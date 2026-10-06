# L0 live Learner

## Cursor's exported stage

The authoritative Lovable `createStage` exposes `match.getSnapshot`, `match.subscribe`, `started`, `ended`, and `actions(side)`. It has no `observe` method. Use this single headless hook call inside Cursor's stage shell:

```ts
import { useStageLearner } from "@/hooks/use-stage-learner"
import { displayedMarks } from "@/lib/puzzle/stage-observation"
import { useMemo } from "react"

// Keep stage, pack, publicMarks, and memory stable across ordinary renders.
// publicMarks must be derived from the exact clue props rendered for the human.
const publicMarks = useMemo(() => displayedMarks(pack.n, publicBoard), [pack.n, publicBoard])
const learner = useStageLearner({
  stage,
  pack,
  publicMarks,
  memory,
  model: frozenRoundModel,
  running: agentEnabled,
})
// learner.status: idle | thinking | playing | wait | finished | error
// learner.lastAction: last counted action, or null
// learner.waitReason: deadline | unavailable | invalid-decision | inactive
```

Memoize `displayedMarks` from stable public-board props before passing it to the hook. The hook waits for the existing Start control, then makes serial real `/api/learner` decisions every 250 ms after the preceding response. It uses the stage's Learner action controls and never writes to the human attempt. UI clock updates should continue calling the existing `stage.match.tick`; inference never pauses either clock. Replacing the stage or seed disposes pending work. Stopping `running`, stage expiry, and component teardown cancel inference. The hook waits through same-seed stage respawns, discards decisions from the previous attempt, and retains one-line claims in the supplied memory.

No page, grid, Start control, picker, or layout is supplied by this hook. Cursor owns those components. The observation adapter bounds the exported stage's effectively unlimited action counter to the public request limits, and sends the displayed quota/friend marks without sending pack constraints or verifier data. The fixture test reads and transpiles the exported stage source only, using an injected policy. Run `node scripts/check-stage-learner.mjs /absolute/path/to/export/src/lib/puzzle` to check a new export.

## Cursor model picker wiring

`GET /api/learner-models` returns `{ models: [{ id, label }], defaultModel }`. Verified default choices are `gpt-6-astra`, `gpt-6.1-sol`, and `gpt-6-luna`, listed in the official [OpenAI model catalogue](https://developers.openai.com/api/docs/models). `OPENAI_MODEL` sets the preferred default. Server `LEARNER_MODELS` can supply a comma-separated replacement allowlist. If that list excludes the preferred default, its first allowed model is the default. Configured identifiers still require API access in the hosting account; the catalogue is not a live access probe.

Both `/api/learner` and `/api/game-learner` accept optional top-level `model`. The server rejects a model outside the allowlist with HTTP 400 before invoking OpenAI. Omitting `model` preserves the server default. Model selection changes only the provider model and is excluded from the puzzle prompt.

Use the typed hook in Cursor's shell. It fetches model choices and freezes selection for a round, without providing UI components.

```ts
import { useLearnerModel } from "@/hooks/use-learner-model"

const learnerModel = useLearnerModel()
// Build the picker from learnerModel.models and learnerModel.selectedModel.
// Disable it until status === 'ready' and whenever isFrozen is true.
// Its change handler calls learnerModel.selectModel(id).
// Before starting a round, freeze and record the chosen model:
const roundModel = learnerModel.startRound(seed)
if (!roundModel) return // choices still loading or another round remains frozen

const runner = createGameLearnerRunner({
  observe: () => battle.boardProps("learner"),
  api: battle.actions("learner"),
  memory,
  model: learnerModel.getModel,
})
// Keep that same runner and model for the full round.
// After both sides finish or hit a cap, cancel pending inference before unlocking:
runner.cancel()
learnerModel.endRound(seed)
```

`selectModel` returns false during a round or for an unavailable ID. `startRound` is idempotent for the same round ID and rejects a different active round. `endRound` only unlocks its matching ID. `getModel` is stable and returns the frozen selection. Both runner types accept `model: () => string | undefined`; a changed model cancels and discards pending decisions. The API stays stateless, so freezing scored rounds is the shell's responsibility. Do not recreate a runner or change the chosen model during an active attempt.

The five-category demo uses `POST /api/game-learner` with `{ board: BoardProps, priorClaims }`. This endpoint accepts only the public board contract from `battle.boardProps("learner")`. It validates binary clues, crown exclusions, path checkpoints, tile port marks, or the lights neighbourhood according to `category`. Full pack records, transfer patterns, audit data, solutions, and win-predicate internals are rejected. A hidden cell must have `value: null` and no selected or locked flag. The response uses the same single-action/wait shape and deadline as the binary adapter below.

```ts
import { createGameLearnerRunner } from "@/lib/battle-ground-ui/model-learner"
import { createLearnerMemory, finishLearnerRound } from "@/lib/puzzle/learner"

const memory = createLearnerMemory()
const runner = createGameLearnerRunner({
  observe: () => battle.boardProps("learner"),
  api: battle.actions("learner"),
  memory,
})
// Subscribe sync to every battle update and clock tick.
const unsubscribe = battle.subscribe(() => runner.sync())
await runner.step() // await each decision before starting another
// Once when this attempt finishes:
battle.claim("learner", finishLearnerRound(memory))
// Cleanup on page teardown:
unsubscribe()
runner.dispose()
```

The Learner board's `readOnly` flag controls the human viewing that tab. The Learner still acts through its own shared controls. Every response is checked against the current seed, board, clues, selected cell, counters, and status before it can produce a tap. The adapter supplies structured public data, with no screenshot or tools. Preserve prior claims across respawns and clear `memory.currentClaim` when starting the next round.

`POST /api/learner` takes `{ observation, priorClaims }`. `observation` is the existing `Observation` from `lib/puzzle/types.ts`. Extra properties fail validation, including pack constraints, solutions, verifier specs, and hint requests. This first adapter supports the existing binary FORCED-CHAIN round. Future categories need their own visible observation adapter; do not pass the full rules engine to this route.

The response is `{ action, state, patternClaim?, reason? }`. `action` is one of the existing four counted controls or `null`. `state` is `decision` or `wait`. A wait never advances the board. Failure reasons are `inactive`, `deadline`, `unavailable`, or `invalid-decision`; provider error bodies and credentials are never returned or logged.

The server uses `OPENAI_API_KEY`, optional `OPENAI_ORG_ID`, and `OPENAI_MODEL`, defaulting to `gpt-6-astra`. These variables stay in the route. Each call has zero SDK retries and ends after at most eight seconds or the remaining round clock, whichever is shorter. Aborted results cannot produce a tap. This clock continues during inference, just as it does while a human thinks.

The model receives the visible board, given marks, selected cell, postcard, counters, status, and up to thirty previous one-line claims. It has no tools, rule interpreter, solver, or answer feed. The prompt asks for a local pattern claim, not puzzle classification. This is an instruction boundary for model reasoning; it is not proof of how a model internally reasons.

## Lovable integration

`Observation.publicMarks` optionally carries the public clues drawn for both players: `{ quotas: { cells, count }[], friends: { cells: [a, b], relation: '=' | '×' }[] }`. Quota counts refer to cells valued `1`; all references are zero-indexed. The match constructor supplies these marks. Legacy observations can omit them, which means no extra displayed marks were supplied. Render these same marks for the human; never add private clues for the model. Marks accept only these visible fields, with bounded cell indexes and counts. The postcard cap is 32 lines and 1,800 characters including line breaks.

Keep the game engine and hackathon chrome separate. Wire this adapter to the agent attempt, irrespective of the active Human|Agent display tab. The two attempts start from the same seed and reveal moment. In the scored battle, each side then keeps its own clock and calls `advance` only for itself. In the authoritative Lovable timed stage, each side can repeat its own attempts until the shared stage deadline; retain the chosen model for that full stage. Hints are practice-only.

```ts
import { createLearnerMemory, finishLearnerRound } from "@/lib/puzzle/learner"
import { createModelLearnerRunner } from "@/lib/puzzle/model-learner"

const memory = createLearnerMemory()
const runner = createModelLearnerRunner({
  observe: () => match.observe("learner"),
  api: match.actions("learner"),
  memory,
})

// Call runner.sync() from the match subscription and clock updates.
// This cancels pending work if a round, board, action counter, or status changes.
// A paced loop awaits each step before starting the next one.
await runner.step()

// Once per completed round, record the claim and retain memory for respawns.
match.claim("learner", finishLearnerRound(memory))
// Clear memory.currentClaim on the next respawn. Keep memory.claims.

// On page teardown:
runner.dispose()
```

The runner makes at most one request at a time and rechecks the live board before applying the response. Selection, cycle, undo, and clear all go through the shared Action API. Call `runner.cancel()` before replacing an attempt or `runner.dispose()` when leaving the page. Do not run a second policy beside it or pause either clock while inference runs.

We score the pattern they carried forward, not the puzzle class they recognised.

The SDK implementation follows the installed AI SDK structured output docs. The model and output format are described in the official [GPT-6 Astra model page](https://developers.openai.com/api/docs/models/gpt-6-astra) and [structured output guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

## Decision backends

The live Learner path is `openai-generate-text` through `/api/game-learner`. Two later backends are typed and unwired in `lib/battle-ground-ui/model-learner.ts`:

- **TypeSafe Jev** (`typesafe/jev-1.13`): a Choice question over the public board. `jevActionRequest` builds the object and does not send it.
- **OpenAI Decisions API**: preview only, no stable public schema. `openAIDecisionsRequest` is a placeholder and does not send it.

`assertLearnerBackendWired` throws for both seams. `useLearnerDecisionBackend` reports the active backend as `openai-generate-text`. Do not add keys or call either seam from a route.

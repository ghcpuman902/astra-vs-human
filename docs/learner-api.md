# L0 live Learner

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

Keep the game engine and hackathon chrome separate. Wire this adapter to the agent attempt, irrespective of the active Human|Agent display tab. The two attempts start from the same seed and clock. Keep advance locked until both finish or reach a cap. Hints are practice-only. During a scored round, the human tab must not reveal the Learner's filled answers while the human attempt is still playing.

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

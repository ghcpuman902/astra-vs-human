# L0 live Learner

`POST /api/learner` takes `{ observation, priorClaims }`. `observation` is the existing `Observation` from `lib/puzzle/types.ts`. Extra properties fail validation, including pack constraints, solutions, verifier specs, and hint requests. This first adapter supports the existing binary FORCED-CHAIN round. Future categories need their own visible observation adapter; do not pass the full rules engine to this route.

The response is `{ action, state, patternClaim?, reason? }`. `action` is one of the existing four counted controls or `null`. `state` is `decision` or `wait`. A wait never advances the board. Failure reasons are `inactive`, `deadline`, `unavailable`, or `invalid-decision`; provider error bodies and credentials are never returned or logged.

The server uses `OPENAI_API_KEY`, optional `OPENAI_ORG_ID`, and `OPENAI_MODEL`, defaulting to `gpt-6-astra`. These variables stay in the route. Each call has zero SDK retries and ends after at most eight seconds or the remaining round clock, whichever is shorter. Aborted results cannot produce a tap. This clock continues during inference, just as it does while a human thinks.

The model receives the visible board, given marks, selected cell, postcard, counters, status, and up to thirty previous one-line claims. It has no tools, rule interpreter, solver, or answer feed. The prompt asks for a local pattern claim, not puzzle classification. This is an instruction boundary for model reasoning; it is not proof of how a model internally reasons.

## Lovable integration

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

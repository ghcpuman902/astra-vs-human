# Puzzle handoff

Run `pnpm check:puzzles` to independently enumerate the 4×4 packs, certify all five cached packs, and exercise the learner adapter through shared-action replay fixtures. Regenerate the cache with `pnpm check:puzzles --refresh-cache`.

`lib/puzzle/types.ts` defines the pack, constraint, observation, and Action API types. Cells are row-major, zero-based in code and one-based on the postcard. Empty cells are `null`; values are `0` and `1`. Every pack combines row/column no-three rules, exact line quotas, and visible adjacent =/× friends.

`verifier.ts` is pure. It checks board shape, alphabet, locked givens, and every constraint. Its partial `valid` result means no currently violated constraint, not proof of a completion. `author.ts` generates seed-stable packs and certifies uniqueness with a bounded search. A budget exhaustion never counts as uniqueness. Its forced chain certificate proves every editable cell can be filled with one-constraint deductions, including an immediate foothold. Keep the author module and certificates away from L0.

`packs.ts` returns a copy of the five cached packs. The first three are 4×4 near-transfer rounds; the last two cover 5×5 and 6×6. The cache contains no solution or proof trace. The host needs constraints to verify, but L0 receives only `Observation`.

## Budgeted pack API

Call `GET /api/pack?seed=123&n=4`. Both parameters are optional. The default size is 4; omitted seeds come from server randomness. The response contains `{ pack, source, requestedSeed, elapsedMs, contentHash, niche, warmedSeeds }`. Hand the returned `pack` to the host and start both players from that exact pack. A fallback keeps its actual seed, which can differ from `requestedSeed`.

The niche is a paired zigzag with quotas and sparse adjacent friends. The author varies orientation, symbol polarity, friend locations, and clue removal from the seed. This is one procedural template and five startup packs, not an atlas. It tries up to four mutations, independently rechecks uniqueness and a complete local forced chain, and rejects postcards above 32 lines or 1800 characters. Successful packs enter a process-local 24-slot LRU keyed by size and seed, with a SHA-256 content hash in the response. Two subsequent seeds of the same size warm when the remaining budget permits. Cold processes initialize from the five checked-in packs; cache state is disposable and is not shared between server instances.

`PACK_GEN_BUDGET_MS` is read server-side per request, defaults to 55000, and is capped at 55000. Generation and certification check a monotonic deadline inside clue removal, propagation, and search. The service reserves up to 100ms for response work and returns a same-size cached pack if candidates fail or the deadline approaches. Each search also has a node cap. Small budgets skip warming. The handler has a 60-second deployment duration setting and returns `Cache-Control: no-store`. Tests measure generation/handler work; platform cold-start and network delay remain outside that measurement.

The generator is procedural and makes no OpenAI request. `OPENAI_API_KEY` and `OPENAI_ORG_ID` remain server-only and unused in this implementation. It does not inspect, log, echo, or serialize either value. No credential is needed for this hard-budget path.

## UI integration

```ts
import { cachedPacks } from "@/lib/puzzle/packs"
import { createMatch, learningSlope } from "@/lib/puzzle/match"
import { createLearnerController } from "@/lib/puzzle/ui-hooks"

const match = createMatch(cachedPacks(), { actionCap: 300, timeCapMs: 120_000 })
const human = match.actions("human")
const learner = createLearnerController(match, (view, priorClaims) => {
  // Replace this idle stub with one board/postcard-only policy decision.
  // For an async model, obtain a decision first and provide it here.
  console.log(view, priorClaims)
  return { action: null }
})

// Same four controls for both players.
human.selectCell(3)
human.cycle()
human.undo()
human.clear()
learner.step() // At most one shared action per click or paced scheduler tick.

// subscribe + getSnapshot are framework-neutral UI hooks.
const unsubscribe = match.subscribe(render)
function render() {
  const state = match.getSnapshot()
  // Show both boards, postcard text, caps, claims, and a disabled Next control
  // until state.canAdvance. Call match.advance() from the Next control.
  console.log(state)
}
// A UI clock must call match.tick() periodically to enforce idle timeouts.
// Dispose the scheduler and unsubscribe when the UI unmounts.
unsubscribe()

const slope = learningSlope(match.getSnapshot().records, "learner", "family-a-4")
console.log(slope)
```

`createMatch` is the trusted host controller, not a capability handed to the learner. Pass a model only `match.observe("learner")` and `match.actions("learner")`. `learner.ts` imports types only. Its callback receives the visible board, postcard strings, and prior one-line claims, and returns one of the shared actions or waits. There is no built-in rule interpreter, class solver, search, private board simulation, or verifier access. The default stub waits for a policy decision. Supply a board/postcard-only model policy to run L0; model inference is not wired in this change. Tests use explicit replay fixtures to verify action plumbing, not to demonstrate L0 solving ability.

Both players start the same seed with the same givens and the same wall-clock deadline. Neither can move after finishing or a cap. Both must finish or reach a cap before the host can advance. All in-range actions count, including undo, clear, and ineffective cycle attempts. Invalid selection coordinates are rejected. Undo restores board and selection without refunding actions. Givens stay locked.

The controller retains one-line learner claims across rounds. Scoring requires at least three completed rounds in the same size/family transfer group and reports raw action slope plus whether every round used fewer actions than its predecessor. Capped rounds disqualify the group. Different clue counts can confound slope, so records include editable cell counts. This is instrumentation, not evidence of learning. No L2 or L3 is implemented.

The starter page is untouched. These are integration hooks, not a finished match screen. Tests invoke the actual API handler exports and exercise the host controller. Browser runtime verification requires an existing development server; none was running during this change.

Collab board update is pending: the documented CLI read returned `waiting_for_copy`, so RULES and INBOX/OUTBOX were unavailable. No board edits were attempted.

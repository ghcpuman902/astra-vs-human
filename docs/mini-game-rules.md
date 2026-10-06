# mini-game-rules

“We score the pattern they carried forward, not the puzzle class they recognised.”

This is the durable game record and authoring pipeline. `battle-ground-ui` is the separate hackathon interface: white board, craft tokens, Human/Agent views, identical actions and clocks. A rules pack supplies props to that interface; it does not define page layout, colors, dual clocks, or competition scoring.

Rounds target 10–120 seconds. Taking up to 600 seconds when stuck is an allowed stretch. Naming a puzzle class does not demonstrate transfer. Measure actions across at least three near-transfer respawns, with the same returned seed and action/time caps for both players. Hints are practice-only.

## Typed pack and engine

`lib/mini-game-rules/schema.ts` defines the validated `GamePack` union. Each pack carries category, seed, size, honest mode badge, visibility, postcard, public cells and rules, win predicate, action surface, transfer family/patterns, and session target. `runtime.ts` handles the four shared actions: selectCell, cycle, undo, clear. `verifier.ts` checks the resulting state. `assembler.ts` constructs and certifies author candidates; its solution and foothold are host-only.

The public generator returns only a certificate summary with `hasFoothold`. It never returns a solution, forced cell/value, or solution trace. Its author tools can assemble a pack but cannot execute arbitrary generated code. Learner observations must still be built separately from visible board and postcard data; the author and learner have different capabilities.

| Mechanic | Live engine modes | Transferring local idea | Adjacent flavor |
| --- | --- | --- | --- |
| binary_fill | FORCED-CHAIN | matching ends, quotas, equal/opposite friends | Tango |
| crown | FORCED-CHAIN or BRANCHY | a forced seat removes a column and touching diagonals | Queens |
| path_cover | FORCED-CHAIN or BRANCHY | a checkpoint reserves sequence position; dead ends force endpoints | Zip |
| tile_rotate_connect | FORCED-CHAIN | a boundary and matched neighbor constrain tile orientation | pipe toys |
| lights_toggle | BRANCHY or MULTI | two taps cancel; shared neighbors cancel | Lights Out |

Modes are certified outcomes rather than stickers requested by the model. In particular, Lights uses press-parity solution counts; different move orders and pairs of canceling taps do not create extra counted solutions. A specific mode may be unavailable at a particular size or seed. Resemblance is allowed and stated plainly.

## Landscape, sampling, and agent sift

`catalogue.ts` describes a bounded but extensible landscape: five mechanic knobs × four inference modes × two visibility modes × three vibe niches. These 120 records contain ideas and capability labels, never pre-drawn puzzles or stored answers. Add mechanics by extending the schema, runtime, assembler, verifier, and capability table together.

The full research axes are FORCED-CHAIN → BRANCHY → MULTI → RISK and full → partial visibility. RISK and partial visibility remain research tonight. They cannot be silently shipped with another mode or visibility. Neighboring occupied flavors include Tango, Queens, Sudoku, Zip, Wordle, Mines, 2048, and Zendo-ish toys; word/trivia, large Sudoku, Rush Hour, and heavy probability scoring are outside this engine's initial scope. The catalogue is not a novelty rejection filter.

The seeded picker draws approximately four varied ideas, including at least two assemblable choices when possible. Preferences can restrict categories, mode, and visibility, choose a 10–120 second session target, or gently favor calm/spatial/tactile vibe. The author sifts those choices for short-session playability and a pattern to carry forward, then assembles one with supported knobs such as clue density, crown diagonal touching, and path length. Verification feedback enables a bounded mutation/retry.

`agent.ts` wires the actual AI SDK `ToolLoopAgent` to the OpenAI Responses API. Its tools are `sift` and `assemble`; it is capped at six steps and stops on the first certified assembly. It reads `OPENAI_API_KEY`, `OPENAI_ORG_ID`, and optional `OPENAI_MODEL` only on the server. The default model is `gpt-6-astra`; unsupported or unauthorized access produces an honest cached fallback, never an automatic model substitution. Generation does not log provider errors or credentials.

The adapter follows installed AI SDK 7 and OpenAI provider 4 sources/docs. [OpenAI's GPT-6 Astra model reference](https://developers.openai.com/api/docs/models/gpt-6-astra) documents the model. A real API call still depends on the configured account's model access; offline orchestration tests do not prove account access or model latency.

## Assemble, verify, cache

`createGameGenerator().generate({ seed, n, preferences, budgetMs, transferFrom })` is asynchronous. `n` defaults to 4. The budget is clamped to 55,000ms, or read from `PACK_GEN_BUDGET_MS` when omitted. A small response reserve stays inside that budget.

Before inference, the generator finds or assembles a certified fallback matching the requested profile. Model calls receive an abort signal and race the remaining deadline. Assembler search checks an absolute deadline and node cap. Failed candidates, missing model configuration, model errors, and a nearly spent budget fall back to a certified matching pack. If no certified mechanic fits a requested profile, a typed error reports that limitation; categories and mode are never silently changed. The response carries its actual seed, which must be used for both competitors even if fallback differs from the requested seed.

The process-local LRU has 32 slots keyed by content hash. Each slot contains a certified board and the assembly profile that produced it. After acceptance, up to three nearby seeds are assembled from that profile and verified within the remaining deadline. This creates near-transfer boards without a frozen atlas. `transferFrom` names a previously returned content hash: reuse its profile with a fresh seed to create a new certified board quickly. Cold instances have no shared cache; cache reuse across deployments is not promised.

Response metadata distinguishes `source: agent | cache | fallback`, the pack's `plannerSource`, the attempted planner, configured model, fallback reason, real elapsed time, content hash, sampled ideas, author sift, and warmed seeds. This metadata is for author/debug views; a scored Learner receives only its visible game observation.

## Verification

Run `node scripts/check-game-generator.mjs` for seeded sampling, sift validation, actual assembly across all five mechanics, rejected candidate repair, abort/fallback under a deadline, preference matching, fresh-seed profile reuse, cache hits, and absence of solutions/foothold values in public output. The tests inject an author planner while retaining real engine assembly and verification. They make no paid API request and do not exercise provider model access.

The existing binary `/api/pack` live-demo path remains distinct. `/api/game-pack` is the broader authoring path consumed by mini-game-rules tooling and a separate UI pass against frozen battle-ground-ui props. New category authoring does not restyle the hackathon page.

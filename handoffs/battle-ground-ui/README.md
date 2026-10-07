# Battle-ground UI

Use the frozen white-paper craft frame with near-black grid lines, OKLCH category colours paired with shape marks, and no shadows. One board viewport has Human and Agent views over independent attempts. Human is playable; Agent is read-only. Both clocks start together on round one, then each side keeps its own clock and pack cursor. Counted controls stay selectCell/cycle/undo/clear. A side may advance only after its own attempt ends. Human progress never forces the Agent onto the next pack. Hints are practice-only and disabled in scored rounds.

`lib/battle-ground-ui/controller.ts` bridges durable `GamePack` records to `BoardProps`; it owns per-side attempts, clocks, action caps, advance, claims, and transfer scoring. Subscribe with `useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)` and call `tick()` on your UI clock. Human taps call `actions("human")`; the Learner policy calls `actions("learner")`. `advance(side)` moves only that side. A tap may select then cycle, but both calls count for both players.

Choose category renderers from the generated mini-game-rules attachment. Do not change their mechanics. The mixed gallery checks renderer variety; learning scores require at least three completed rounds in the same transfer family. Intended rounds last 10–120 seconds. A stuck side gets its own 600-second cap.

The engine and input requirements remain under `mini-game-rules`. UI tokens, tabs, clocks, and demo layout remain here. On UI approval, write `ui-patterns.md`, `game-ui-adapter.schema.json`, and `new-game-prompt.md` describing the reusable rendering decisions.

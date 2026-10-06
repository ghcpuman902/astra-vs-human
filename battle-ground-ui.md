# battle-ground-ui

The directly reusable final hackathon demo shell; keep separate from mini-game-rules.

- Full viewport white paper canvas with hairline header, human-left/agent-right division and footer.
- Five stages per round, three minutes per game type, unlimited independent attempts; supplied puzzles repeat for the demo.
- Separate reading and play timers; one stable-width button stays mounted for Start, countdown and stage advance.
- Results show reading time, per-type wins, average solve-time delta, actions and wins per minute; absent completions have no time delta.
- Independent attempts share the same puzzle, seed, rules and reveal moment.
- Shared scrollable rules sit between the boards when space allows, otherwise below; no Rules modal or hidden clues.
- Neither puzzle renders until the human presses Start. Preparation time and commands do not count toward either attempt.
- Show keyboard/ASCII input cues only on the agent side, not across the battleground.
- Hovering the agent area shows a not-allowed cursor to distinguish it from human play.
- Agent-only ASCII input uses one-based row column value, with semicolon-separated moves. Translate it into existing typed actions, with each underlying action counted normally.
- Never expose solution data or a client solver. The supplied gallery Learner stays visibly idle until a real policy is connected.
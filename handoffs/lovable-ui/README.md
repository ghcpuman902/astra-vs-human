# Lovable UI experiment: five playable rule combinations

Build a small game UI gallery from the five fixtures in `lovable-ui-kit.json`. The purpose is to learn which presentation choices make unfamiliar rules understandable, then extract a repeatable game-to-UI method after the human approves the result. The data, verifier, match controller, and learner action adapter are provided. Your work is rendering, interaction, and style iteration.

This handoff was designed for the astra-vs-human board at https://mg.mk/c/vault-truck-ellen. Read its RULES and use INBOX for questions and OUTBOX for results. The source files are included in the JSON because the current logic work is local and may not yet exist on GitHub.

## What to make

Use one reusable board component and one restrained paper-style shell. Add a clearly labeled design-gallery picker for the five fixtures. Keep the board geometry, type scale, selection behavior, and controls consistent. Vary the clue presentation only when the selected game's rules need it. Choosing a gallery fixture creates a fresh preview match; label this as a UI preview, not a scored multi-round learning run.

1. **Pairs & Balance, 4×4.** No-three plus row and column quotas. Test whether margins make counts understandable.
2. **Thread Count, 4×4.** Quotas plus =/× friends. Three repeated marks are allowed. Test whether relation glyphs read as links instead of cell contents.
3. **Echo Lanes, 5×5.** No-three plus friends, without quotas. Test a board that needs no number gutters.
4. **Row Budget, 5×5.** No-three, friends, and row-only quotas. Test whether asymmetric annotations communicate asymmetric rules.
5. **Full Weave, 6×6.** All three kinds, with row and column quotas. Test clue density and mobile layout.

Each fixture has an exact `pack`, a 35–55-word `postcard`, a `publicBoard` render description, a style question, and a verified input/output trace. Every pack has exactly one solution and can be completed by local forced steps. No solution, solver, or forced-step trace is included in this handoff.

## Deliverable format and setup

`lovable-ui-kit.json` contains:

- `fixtures`: five data objects. Keep these as data, not five hardcoded components.
- `files`: a map from relative file path to complete source text. Materialize those files in the UI project. The engine is plain TypeScript and has no third-party runtime dependencies. Relative imports inside `lib/puzzle` work outside Next.js too.
- `sharedDefaults`: caps, the supported mode, and integration status.

The fixture envelope is:

```ts
type GameFixture = {
  id: string
  title: string
  purpose: string
  transferGroup: string
  postcard: { goal: string; rules: string[]; wordCount: number }
  uiBrief: { designQuestion: string; emphasis: string }
  pack: RulePack
  publicBoard: {
    symbols: { value: 0 | 1; label: string; glyph: string; colorToken: string }[]
    quotas: { axis: 'row' | 'column'; line: number; value: 1; target: number; cells: number[] }[]
    friends: { cells: [number, number]; relation: '=' | '×'; label: string }[]
    noThree: 'rows-and-columns' | 'none'
  }
  verification: {
    unique: true
    shortForcedFoothold: true
    fullyForcedChain: true
    editableCells: number
  }
  interactionTrace: {
    input: Action
    output: {
      selectedCell: number | null
      cell: number
      value: 0 | 1 | null
      actions: number
      remainingActions: number
      status: PlayerStatus
    }
  }[]
}
```

`RulePack`, `Action`, `PlayerStatus`, and `Observation` are defined in the included `types.ts`. `verification` is a build-time QA summary for the implementer. Do not pass it to the learner or display it as a gameplay hint.

## State and rendering contract

Cell indices are zero-based and row-major: `row = floor(index / n)`, `column = index % n`. Render `null` as empty, `0` as ● circle, and `1` as ■ square. A non-null value in the initial `pack.cells` is a locked given. Distinguish givens with a small fixed corner mark, not color alone.

`publicBoard` is public clue data derived from the actual constraints. Put a quota beside its named line and count squares, not circles. Show column quotas above columns and row quotas to the right. A friend glyph belongs at the midpoint between its two adjacent cells. Use a small white backing so =/× stays legible on the lattice. Do not add quotas or a no-three rule to a fixture where they are absent.

Show `postcard.goal` and at most four `postcard.rules`. This concise postcard is a presentation summary. Keep `pack.rulesPostcard` available under an accessible “Read all clues” disclosure: it is the full textual equivalent of the visible margins and links. The learner sees that same public clue transcript through its `Observation`. No private constraint object or answer data goes into its input.

A `selectedCell` is gameplay state; keyboard focus is browser state. Give selection an inset border and focus an outer ring. Both may be visible at once. An empty selected cell remains visibly empty.

## Inputs and outputs

Instantiate one match per selected gallery fixture:

```ts
const match = createMatch([fixture.pack], { actionCap: 300, timeCapMs: 120_000 })
const human = match.actions('human')
const agent = match.actions('learner')
```

The four game commands return `void`. Read the resulting immutable state with `match.observe(player)` or `match.getSnapshot()`. Subscribe once with `match.subscribe(render)` and dispose the subscription when replacing the fixture or unmounting. Call `match.tick()` on a modest UI clock, such as every 250ms, and clear that timer on disposal.

| UI input | Exact command | Expected output |
| --- | --- | --- |
| Tap an unselected cell | `selectCell(index)` | Selection changes; value is unchanged; action count +1. |
| Tap the selected cell | `cycle()` | Editable value cycles empty → circle → square → empty; action count +1. |
| Enter or Space on a focused cell | Same select-or-cycle behavior as a tap | Keyboard and pointer have identical game semantics. |
| Arrow navigation in the grid | `selectCell(nextIndex)` when in bounds | Moves selection; action count +1. |
| Tab navigation | Browser focus only | No game action or value change. |
| Undo | `undo()` | Restores the preceding board/selection operation; counts as a new action. |
| Clear | `clear()` | Restores initial givens, empties editable cells, clears selection; count +1. |
| Undo after Clear | `undo()` | Restores the cleared attempt; count +1. |
| Tick at deadline | `match.tick()` | Any still-playing attempt becomes `time-cap`. |
| Next round in a scored deck | `match.advance()` | Succeeds only when both attempts ended and another pack exists. |

Out-of-range selection is rejected. Cycling a given or cycling with no selection cannot change the board, but the current engine counts that attempted command. Disable unavailable controls so users do not accidentally waste actions. Do not set cell arrays directly. Do not create a single-click shortcut that performs two API calls while displaying a one-action cost.

Each fixture's `interactionTrace` provides exact expected outputs for Select → Cycle → Cycle → Undo → Clear → Undo. Use it as an integration check. It does not disclose a solution or tell the learner which moves to choose.

## Fairness and the one-board brief

The engine owns independent Human and Learner attempts starting from the same pack and seed. One player's move must never alter the other's cells. The board brief asks for one board viewport with HUMAN and AGENT clocks/counters above it, plus a FORCED-CHAIN badge and LEARNER label.

The proposed gallery treatment is a single viewport with a “Viewing Human / Agent” control over those independent attempts. Grokbot has been asked to confirm that interpretation and the hint scope. Treat agent viewing as preview-only while a scored attempt is active: observing an agent's answers during the human attempt would leak information. In scored play, keep the human board visible until both attempts end, then allow comparison in the same viewport. No side-by-side duplicate boards are needed.

The engine starts a shared wall-clock deadline for both attempts. Show the active deadline and each player's action count. A finished attempt shows its terminal status rather than suggesting it is still taking moves. Lock advance while either attempt is playing, and disable Next at the end of the deck. The gallery picker is outside scoring and must be visibly labeled as such.

`learner.ts` and `ui-hooks.ts` provide a real action adapter with an idle policy stub. There is no connected model in this bundle. Label any manual or canned action preview “Demo agent”; do not label it live Astra or claim it learned. The model adapter should receive only `Observation` plus prior one-line claims and return one Action or wait. Do not add a puzzle-class solver.

These five gallery samples change rule combinations. Do not report their action counts as a learning slope. A real learning test needs at least three distinct near-transfer packs from one unchanged rules profile. The existing engine's size-based group is too broad for this mixed gallery, so leave the gallery slope display off. Keep the scoring UI component ready for a genuine same-profile deck later.

## Feedback and hints

`verify(pack, cells)` returns `{ valid, complete, errors, violations }`. It is a pure host verifier. `valid` on a partial board means no rule is currently violated; it does not prove a completion. `complete` requires all cells filled and all rules satisfied. Use `complete`/terminal status for round completion.

Do not expose live violation locations to only one player in scored play. In the design gallery, an explicitly labeled feedback preview can demonstrate invalid-cell hatching using the verifier's violated constraint indices. Provide a textual rule explanation alongside the hatch. Keep preview feedback separate from the learner's policy and action score.

The board's proposed Hint button is not implemented in the shared four-action API. Keep it disabled with a concise “Hints unavailable in scored play” label until Grokbot resolves equal access and action cost. Do not silently fabricate a `requestHint()` endpoint or a forced-cell solver. Preview the dashed hint appearance only as an explicitly marked visual state, with no automatic placement.

## Craft constraints

Use the board's paper style: white canvas, near-black text, 1px lattice, 2px perimeter, system sans, no gradients or shadows. Reuse its OKLCH category tokens when present. Both categories always carry different shape marks. Do not invent a new palette for each sample.

Cells should remain approximately 44px square. A 6×6 board is 264px wide before its quota gutter; it can fit a 320px viewport with a 20px right gutter and 16px page padding. Avoid large left/right gutters and fixed-width sidebars at that size. Put the postcard below the board on narrow screens. Keep the two clock/counter groups readable without squeezing the cells.

Check givens, editable values, keyboard focus, selection, empty selection, agent proposal preview, invalid preview, finished, action-cap, time-cap, waiting-for-peer, loading, and pack fallback. An agent proposal preview uses a dashed ghost plus “A?” and must not reveal hidden solution data during a scored human attempt. State previews should be clearly labeled in the gallery.

## What to return for review

Return a working preview link and screenshots of all five examples at desktop width, plus Full Weave at 320px. For each example, answer its `uiBrief.designQuestion` with one observation and one change you made. Demonstrate the provided six-action trace on at least one example and keyboard-only play on another. Keep the logic contract intact and list any proposed contract change separately in INBOX.

The human will decide whether the UI is useful. Do not equate a successful render with approval.

After explicit human approval, produce these small reusable outputs:

1. `ui-patterns.md`: observation → UI choice → evidence → when it fails, one entry per useful trick.
2. `game-ui-adapter.schema.json`: the minimum game-agnostic display/state/action contract the renderer actually needed, with one working example.
3. `new-game-prompt.md`: a short repeatable prompt that takes a fresh game schema, rules, visible state, legal actions, and expected outputs, then produces and checks a UI.

Separate reusable rules from game-specific ones. For example, “put line constraints beside their lines” transfers; “every puzzle has circles and squares” does not. Preserve semantic roles such as cell, edge clue, line quota, selected, locked, and terminal status instead of storing only this game's glyphs. Record action-counting and information-parity decisions along with visual tricks.

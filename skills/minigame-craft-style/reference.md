# Minigame craft — reference

Long-form tables behind `SKILL.md`. Values are frozen; copy, don't tune.

## Contents
- Colour architecture
- Category subsets & secondary marks
- Border / state tokens
- Type & spacing
- Postcard copy contract
- Hint ladder detail
- Dual-play layout
- Freeze list (do not iterate)
- Legitimate reasons to break the freeze

## Colour architecture

One lightness and one chroma for every category fill: `L 86%`, `C 0.065`, hues `20 / 80 / 140 / 200 / 260 / 320`. See `tokens.css`.

- Ink on any fill ≈ 12.4–13.0:1 → dark text on fills is safe.
- Fill vs white ≈ 1.5:1 → **a pale fill must never be the only boundary.** Geometry is carried by the 2px near-black region line.
- Rule: *the pastel fill says "category quickly"; the dark border and secondary mark say "category unambiguously".*
- Describe the palette as **"CVD-resilient through redundant encoding"**, never "colourblind-safe".
- Categories have no semantic colour meaning (no "red = bad", "green = correct"). Sort generated category IDs deterministically, then map onto the subset below.

## Category subsets & secondary marks

| Categories | Swatches |
|---|---|
| 2 | cat-2, cat-5 |
| 3 | cat-1, cat-3, cat-5 |
| 4 | cat-1, cat-3, cat-4, cat-6 |
| 5 | cat-1, cat-2, cat-3, cat-5, cat-6 |
| 6 | all six |

| Fill | Mark |
|---|---|
| cat-1 | ● |
| cat-2 | ■ |
| cat-3 | ▲ |
| cat-4 | ◆ |
| cat-5 | + |
| cat-6 | × |

- 4–6 categories: show the mark wherever that state must be distinguished.
- Always add `aria-label="Category N"`.
- If the fill only decorates a region already outlined in dark lines, the mark is optional.

## Border / state tokens

| Token | Value | Purpose |
|---|---|---|
| Canvas | white | No off-white page |
| Cell lattice | 1px solid #4A4D53 | Quiet structure |
| Region boundary | 2px solid #14161A | Puzzle topology |
| Board perimeter | 2px solid #14161A | Strong frame |
| Selected cell | 3px inset #14161A | Selection, no new colour |
| Keyboard focus | 3px solid #0B0D12, 2px offset | Obvious focus |
| Hint-localised group | 2px dashed #14161A, inset | Hint, not state |
| Forced-cell hint | 3px solid #14161A, inset | Stronger hint |
| Cell radius | 0 | Diagrammatic grid |
| Control radius | 6px | Slight softness |
| Badge radius | pill | Metadata only |
| Shadows / gradients | none | Not a dashboard, not arcade |

States use shape, never extra hues:
- invalid → dark diagonal hatch + error text label
- selection → inset outline
- focus → external outline
- hint → dashed local outline
- actor → small `H` / `A` corner marker on the latest move, plus the move log
- agent proposal (not committed) → ghost cell: dashed inset outline + `A ?`; becomes an ordinary cell once committed

## Type & spacing

System sans stack only (`--font-sans`).

| Role | Spec |
|---|---|
| Title | 20/24, 650 |
| Rules/body | 16/23, 400 |
| Secondary UI | 14/20, 400–500 |
| Buttons | 14/20, 600 |
| Clock | 18/22, 650, tabular numerals |
| Mode badge | 12/16, 650 |
| Board value | 18/20, 600 |
| Category glyph | 12px, near-black |

- Left-aligned text, except board contents and clocks (centred).
- No condensed/display/outlined "game" fonts, and no all-caps instruction copy.
- Spacing: 4 / 8 / 12 / 16 / 24 / 32. Use 8 for the everyday step, 16 for control padding, 24–32 for major gaps.
- Cells: 44×44 desktop, 36×36 compact fallback only.

Target character: **white paper + black diagram + faded highlighter + small editorial controls.**
Not: cards + glow + gradients + badges everywhere + game HUD.

## Postcard copy contract

```text
Goal line:        ≤ 14 words
Rule bullets:     ≤ 4  (one invariant per bullet)
Words per bullet: target ≤ 14
Total onboarding: target 35–55 words
Examples:         not inline with rules
Strategy:         never in rules
Hint mechanics:   not in rules
Scoring/timers:   not in rules
```

Template (drop unused bullets, never pad):

> **Goal:** Complete the board so every cell satisfies all rules.
> - Each **[unit]** must contain **[count / set constraint]**.
> - **[Adjacency / sequence constraint]**.
> - Friends **[same / differ / constrain each other]**.
> - **[Symbol]** means **[special local relation]**.

Good: "Goal: Fill every empty cell without breaking any constraint. • Each row contains one of every symbol. • Three matching cells cannot touch in a line. • Friends must use different categories. • A joined pair must satisfy its printed relation."

Bad: "In this puzzle, your goal is to strategically analyse the different coloured regions while…"

Put relations on the board itself where you can (region labels, edge symbols). If a generated rule doesn't fit the envelope, the generator provides a short label plus an optional `Learn rules` sheet. The UI does not grow.

## Hint ladder detail

The renderer receives `{ ruleLabel, ruleText, cellIds[], forced?: { cellId, value, reason } }`. It **never deduces** anything itself.

| Level | Shows | Do | Don't |
|---|---|---|---|
| L1 Rule reminder | "Remember the **X** rule: …" | Use the exact onboarding wording, one rule, board unchanged | Name a coordinate, highlight cells, say where to play |
| L2 Local highlight | "Look here. These cells form a useful **X** pattern." + dashed outline on 2–5 cells | Smallest sufficient set, one group, canonical pattern name | Candidates everywhere, dimming the rest of the board, marking every occurrence, arrows to the answer |
| L3 Forced cell | "This cell is forced: **B**. Its two friends already rule out A." + 3px inset on that one cell | One cell, one value, one reason. The player places it. Log hint use. | Auto-placing, revealing the next cell, showing the chain, rapid-fire repeats |

```text
Hint → L1 → "More specific" → L2 → "Show one forced cell" → L3
     → LOCK until board state changes → reset to L1
```

Escalation is human-invoked only. Never jump levels based on agent confidence.

## Dual-play layout

One authoritative board. Actors live in the metadata, not in the geometry.

```text
┌──────────────────────────────────────────────────────────┐
│ PUZZLE TITLE                                    ? Rules  │
│ HUMAN              [ FORCED-CHAIN ]             AGENT    │
│ 02:14                                           00:07    │
│ ● ACTIVE                                        IDLE     │
│               ┌──────────────────────┐                   │
│               │     SHARED BOARD     │                   │
│               └──────────────────────┘                   │
│ Undo             Hint · 1/3                    Clear     │
│ Last move  H · r3c4             Agent reason · View      │
└──────────────────────────────────────────────────────────┘
```

Compact: the badge goes above the clocks, then `HUMAN 02:14   AGENT 00:07` on one row, then the board. Cells drop 44 → 36. Don't stack the clocks far apart.

- `HUMAN` / `AGENT` labels are always visible. Never rely on position.
- Persistent controls are Undo · Hint · Clear, nothing more. `Ask agent` / `Explain` / `Accept proposal` appear contextually in the status row.
- Mode badge enum (from puzzle metadata, rendered as-is): `FORCED-CHAIN | BRANCHY | MULTI | RISK`. Neutral outline, no per-mode colour. The UI never infers or validates the mode.
- No actor colours.

## Freeze list (do not iterate)

- White background: no cream, texture, tint, dark mode, or vignette.
- Don't tune the six hues by eye. If CVD is weak, rely on the secondary mark.
- Don't raise saturation to make categories "pop".
- Never use a fill as an essential boundary.
- No semantic colours for human / agent / selection / hint / warning / mode.
- Keep the system sans stack and don't run font bake-offs.
- No shadows, gradients, glass, glow, 3D cells, sound, confetti, particles, or arcade transitions. Completion gets one restrained state change plus result text.
- Square cells only.
- ≤ 4 rule bullets. Don't rewrite rules to "sound fun", and keep strategy out of them.
- Hint never becomes Solve: one forced cell, then lock.
- The agent never mutates unseen state. Proposals are visible ghosts.
- The mode badge is never game logic.
- Don't change the hierarchy for one awkward puzzle. Fix the generator data instead.
- No side panel unless the board can't work without one.

## Legitimate reasons to break the freeze

1. Real accessibility failure (keyboard state, non-colour ambiguity).
2. Functional interaction bug.
3. Board/text overflow at a supported viewport.
4. Generated content violating the component's data contract.

Everything else is post-hackathon polish.

---
name: minigame-craft-style
description: Applies a frozen, paper-like visual and interaction craft pack (white canvas, near-black geometry, desaturated OKLCH category fills, postcard rules, 3-step hint ladder, shared human+agent board with dual clocks and mode badge) to small grid logic minigames. Use when building, styling, or reviewing the UI of a human-vs-agent or human+agent logic puzzle / LinkedIn- or NYT-style minigame, when choosing puzzle colours/tokens, writing rule copy, designing hints, or laying out dual-play boards. Craft only — not for puzzle rule generation or solvers.
disable-model-invocation: true
---

# Minigame craft style (frozen)

A reusable craft pack for short grid logic minigames that a human and an agent play on **one shared board**. Derived from earlier craft research. **Values are frozen.** Apply them; don't redesign them.

**Verdict:** paper-like, not arcade. White paper, black diagram, faded highlighter, small editorial controls.

**Scope boundary:** this skill owns *presentation only*. Rules, solvers, difficulty, mode classification, and hint *content* come from the generator as data. The UI renders that data and never infers it.

## Quick start checklist

```
- [ ] Copy tokens.css into the app (global CSS) and import it once
- [ ] Board: white canvas, 1px #4A4D53 lattice, 2px #14161A regions + perimeter, square cells 44px (36px compact)
- [ ] Map category IDs → frozen subset (table below); add secondary marks for 4–6 categories + aria-label
- [ ] States via shape only: inset select, outer focus, dashed hint, hatch invalid, H/A corner marker
- [ ] Postcard rules: goal ≤14 words, ≤4 bullets, 35–55 words total
- [ ] Hint ladder L1→L2→L3, then lock until the board changes
- [ ] Layout: HUMAN clock · mode badge · AGENT clock above one shared board; Undo · Hint · Clear below
- [ ] Run the go/no-go checklist, then stop styling
```

## Instructions

### 1. Tokens
Use `tokens.css` as-is. The core:
- Canvas `oklch(100% 0 0)`, ink `oklch(16% 0.010 260)`, strong border `oklch(20% 0.008 260)`, secondary ink `oklch(42% 0.010 260)`, muted surface `oklch(97% 0.004 260)`.
- Categories `--cat-1..6` = `oklch(86% 0.065 H)` with H = 20 / 80 / 140 / 200 / 260 / 320.
- Dark text on fills is fine (~12:1). Fills against white are only ~1.5:1, so **the dark border carries the geometry, never the fill.**

### 2. Categories
| n | Use | | Fill | Mark |
|---|---|---|---|---|
| 2 | cat-2, cat-5 | | cat-1 | ● |
| 3 | cat-1, cat-3, cat-5 | | cat-2 | ■ |
| 4 | cat-1, cat-3, cat-4, cat-6 | | cat-3 | ▲ |
| 5 | cat-1, cat-2, cat-3, cat-5, cat-6 | | cat-4 | ◆ |
| 6 | all | | cat-5 | + |
| | | | cat-6 | × |

Sort category IDs deterministically, then map. Colours carry no meaning. Call the palette "CVD-resilient through redundant encoding", never "colourblind-safe".

### 3. States (no new hues)
- Selected: 3px inset outline.
- Focus: 3px outer outline with 2px offset.
- Hint group: 2px dashed inset.
- Forced hint: 3px solid inset.
- Invalid: dark diagonal hatch plus a text label.
- Actor: tiny `H`/`A` on the latest move, plus the log.
- Agent proposal: a ghost cell (dashed + `A ?`) until committed.

### 4. Type & spacing
- System sans stack.
- Sizes: title 20/24 at 650; body 16/23; UI 14/20; clock 18/22 at 650 with tabular numerals; badge 12/16 at 650; cell value 18/20 at 600.
- Spacing 4/8/12/16/24/32.
- Radii: cells 0, controls 6px, badge pill.
- No shadows or gradients.

### 5. Postcard rules
```text
Goal:  ≤14 words
Rules: ≤4 bullets, one invariant each, ~≤14 words
Total: 35–55 words. No strategy, hints, scoring, or examples in the rules.
```
Template: **Goal:** Complete the board so every cell satisfies all rules. • Each [unit] must contain [constraint]. • [Adjacency/sequence constraint]. • Friends [same/differ]. • [Symbol] means [relation]. Delete unused bullets. If a rule doesn't fit, the generator supplies a `Learn rules` sheet. The UI does not grow.

### 6. Hint ladder
Input: `{ ruleLabel, ruleText, cellIds[], forced?: { cellId, value, reason } }`.
1. **L1 Rule reminder.** "Remember the X rule: …". Exact onboarding wording, board unchanged.
2. **L2 Local highlight.** "Look here. These cells form a useful X pattern." Dashed outline on 2–5 cells only.
3. **L3 Forced cell.** "This cell is forced: B. [one local reason]." Mark one cell and **don't auto-place it**.
4. **Lock**: no further hints until the board state changes, then reset to L1. Escalation is human-invoked only.

### 7. Dual-play layout
```text
PUZZLE TITLE                              ? Rules
HUMAN 02:14      [ FORCED-CHAIN ]      AGENT 00:07
              ┌──────────────────┐
              │   SHARED BOARD   │
              └──────────────────┘
Undo             Hint · 1/3              Clear
Last move H · r3c4        Agent reason · View
```
- One authoritative board.
- `HUMAN`/`AGENT` labels are always shown.
- No actor colours.
- Agent actions (Ask / Explain / Accept) appear contextually in the status row.
- Compact: badge above the clocks, both clocks on one row.

**Mode badge enum** (from metadata, rendered verbatim, neutral outline, no colour): `FORCED-CHAIN` · `BRANCHY` · `MULTI` · `RISK`.

### 8. Freeze, then ship
Don't iterate the background, hues, saturation, font, cell shape, effects, rule length, or hierarchy. The full list is in [reference.md](reference.md#freeze-list-do-not-iterate). Break the freeze only for:
- an accessibility failure
- an interaction bug
- overflow at a supported viewport
- generator data breaking the contract

## Go / no-go

```text
WHITE CANVAS?                 yes
DARK GEOMETRY?                yes
PALE OKLCH CATEGORIES?        yes
CATEGORY WORKS WITHOUT HUE?   yes
RULES ≤ 4 BULLETS?            yes
HINTS STOP AFTER ONE CELL?    yes
ONE SHARED BOARD?             yes
TWO LABELLED CLOCKS?          yes
NEUTRAL MODE BADGE?           yes
NO DECORATIVE UI PROJECT?     yes
→ SHIP THE CRAFT.
```

## Additional resources
- [tokens.css](tokens.css): CSS custom properties plus minimal cell/badge/clock helpers
- [reference.md](reference.md): full token tables, copy contract, hint do/don't, layouts, freeze list

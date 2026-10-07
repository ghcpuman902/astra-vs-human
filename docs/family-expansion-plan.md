# Family expansion plan (design only)

2026-10-07 · Opus pass on the brief in `_agent/opus-family-design-2026-10-07.md`. Analysed against `main` @ `417aab4` plus that checkout's uncommitted changes. No code changed. Every proposed build is a **suggestion** unless it says otherwise. The diagnosis numbers are measured and can be reproduced (see "How the numbers were measured" at the end).

## TL;DR

1. **The catalogue is smaller than it looks.** `FAMILY_DEFS` lists 9 families, but `assembleDistinct` passes no family knobs to the assembler. Only the size `n` and the label change. Crown seats and Sparse crowns both use n=5, so they draw from the same distribution. The other sibling pairs differ only in size. So there are 5 mechanics × sizes, and nothing else.
2. **binary_fill (Summer Moons / Quota islands) has a fixed answer.** `authorPack` always derives the solution from one formula, `(⌊r/2⌋+⌊c/2⌋+r+c+flip) mod 2`, with optional mirroring. Over 300 seeds there were **2 distinct solutions at n=4, 2 at n=5 up to symmetry, and 1 at n=6**. Real 6×6 Tango has **11,222** valid solution grids. That is the "I recognise this" feeling. The visible quota numbers on every line add weight without adding a new idea (see §2).
3. **Path boards look regular for two reasons.** (a) The Warnsdorff sampler covers only a small part of the shape space: 60 of the 549 possible 5×5 route shapes in 1,000 deals, with 55% more U-turns than a uniform sample. (b) A Hamiltonian path on an empty square grid is stripy even when sampled uniformly. Fixing the sampler gives more variety. Only changing the geometry (walls, holes, masks) removes the corridors.
4. **Recommendation (suggestion):** fix variety first, then add mechanics. Order: wire family knobs → crisp Tango with random solutions → path sampler + walls → Queens regions → one new mechanic (Futoshiki-style "Ladder"). Cut pipe from rotation. Rework Lights or merge its two families.

---

## 1. Diagnosis: current families

### 1.1 Families are labels, not generators

`lib/battle-ground-ui/match-deck.ts` → `assembleDistinct()` calls `assembleGamePack({ category, seed, n, variant, preferences: { visibility, targetSeconds } })`. The family id goes only into `variant` and `transfer.family`. None of `clueDensity`, `noDiagonalTouch` or `pathLength` reach the assembler.

| Family | Mechanic | n | What actually differs from its sibling |
| --- | --- | --- | --- |
| Summer Moons | binary_fill | 4 | size only |
| Quota islands | binary_fill | 5 | size only (odd n gives uneven quotas) |
| Crown seats | crown | 5 | **nothing** — same mechanic, same n, same defaults |
| Sparse crowns | crown | 5 | **nothing** ("blocked lanes" is not a knob that gets passed) |
| Number trail | path_cover | 4 | size only |
| Checkpoint snake | path_cover | 5 | size only |
| Cross lights | lights_toggle | 4 | size only |
| Cascade taps | lights_toggle | 5 | size only ("larger cross network" is still 2 presses) |
| Pipe turn | tile_rotate_connect | 5 | demoted |

The pattern blurbs promise different ideas ("quota islands", "blocked lanes", "cascade"). The boards don't deliver them, so players correctly see the same shapes.

### 1.2 Per-mechanic variety (300 seeds each unless noted)

| Mechanic | n | Distinct solutions | Notes |
| --- | --- | --- | --- |
| binary_fill | 4 | **2** (complements: `0110 1001 1001 0110`) | ~4.7 givens, ~3.6 friends, 8 quota clues (all "2") |
| binary_fill | 5 | 8 (**2** up to symmetry) | 10 quota clues, odd counts |
| binary_fill | 6 | 2 (**1** up to symmetry) | 12 quota clues (all "3") |
| crown | 5 | 14 (the total number of non-touching permutations at n=5) | ~8 blocked cells, ~1.3 given crowns. No regions. |
| path_cover | 4 | 17 of 38 possible shapes reached in 1,000 deals; the top 3 shapes are 38% of deals | Only 9/300 FORCED |
| path_cover | 5 | 60 of 549 possible shapes in 1,000 deals | 0/300 FORCED, all BRANCHY |
| lights_toggle | 4 / 5 | always MULTI (16 / 4 press solutions) | 2 random presses, so the board is just two visible crosses |
| tile_rotate_connect | 5 | — | one unbranched corridor of ≤12 tiles, so it is a path puzzle with a rotate action |

Other findings:

- **Crown is not Queens yet.** LinkedIn Queens is defined by coloured regions (one queen per row, column and region). Ours replaces regions with blocked cells, at a size (5) that has only 14 legal answers. n=6 has 90, n=7 has 646, n=8 has 5,242.
- **Dedupe keys are too fine.** `boardId`/`fingerprint` hash the full pack, givens included. Two Summer Moons deals with the same answer but different givens count as "new". The per-browser `avoid` set therefore never prevents the déjà vu.
- **Lights is trivially shallow.** `max(2, ⌊n/2⌋)` = 2 presses for n=4 and n=5. Players and models can read the two crosses straight off the board, so there's nothing to transfer.

---

## 2. Summer Moons vs real Tango

**What LinkedIn Tango is:** a 6×6 grid of sun/moon. (1) No more than two of the same symbol next to each other in any row or column. (2) Every row and column holds three of each. (3) `=` and `×` markers between adjacent cells. Plus a few givens. Players learn three local forcings and repeat them: a pair forces its ends, a gap forces its middle, and a marker propagates from a known cell. A line's count only matters for cleanup.

**Why ours feels heavier:**

- The *count* rule is printed as **numbers on every row and column**: 8–12 quota chips, all of which say "half" when n is even. That's a visual tax with no new information. At n=5 the counts are uneven, so the player really does have to read and track them: that's the "outer quotas" heaviness.
- n=4 is too short for the no-three rule to do much work (balance ≈ no-three on 4 cells). The pair and gap patterns barely appear.
- The solution never changes (§1.2), so `=`/`×` markers and givens are the only thing that varies.
- The postcard has 4 rules (no-three, quotas, friends, cycling). Tango needs 3 short ones.

**Option A — Crisp Tango (suggestion, recommended for Summer Moons):**

- n=6 (keep n=4 only as a tutorial board).
- Rules: no three in a row; each line half-and-half, stated **once** in the rules with no per-line numbers; `=`/`×` markers.
- Solution drawn uniformly from the 11,222 valid 6×6 grids (14 valid rows; backtracking is instant).
- Clue carving with a *human-technique* solver (pair, gap, marker, count cleanup), not just `forcedStep` over any constraint. Remove givens before markers until a target mix is reached (e.g. 4–8 givens and 6–10 markers). Reject boards where one technique does >70% of the steps.
- Done-when: ≥95 distinct solutions per 100 deals; the postcard has ≤3 rules; median human solve 45–90 s.

**Option B — a cousin that isn't "complicated Tango" (suggestion, for the second binary family):**

| Cousin | Rule swap | New friend pattern | Why it isn't just Tango |
| --- | --- | --- | --- |
| **No-square garden** | Replace "no three in a line" with "no 2×2 block of one symbol"; keep balance and `=`/`×` | Three corners of a square force the fourth | A 2-D local shape instead of a 1-D run. Same symbols and UI. |
| **Echo pairs** | Every symbol must touch **exactly one** orthogonal twin, so the board tiles into same-symbol dominoes | A cell whose other neighbours are filled forces its pair | Reads as dominoes, Pips-adjacent; balance becomes optional |
| **Sparse tally** (rework of Quota islands) | Tango rules at n=5 or 7 (odd), with counts shown on only 2–4 lines | "This line has one spot left for a sun" | Counting is the point, so the numbers earn their space |

My pick for a second binary family is **No-square garden**: one rule swap, the same renderer, and a clearly different first move.

---

## 3. Path boards that look random

**Root causes (measured, 1,000 deals each):**

| | 4×4 uniform | 4×4 Warnsdorff | 5×5 uniform | 5×5 Warnsdorff |
| --- | --- | --- | --- | --- |
| Route shapes in the space (up to symmetry + reversal) | 38 | 17 reached | 549 | 60 reached |
| Share of the most common shape | — | 13.5% | — | 4.8% |
| U-turns per route | 0.67 | 0.84 | 1.47 | **2.28** |
| Share of steps on wall-to-wall straights | 0.41 | 0.33 | 0.26 | 0.25 |
| Endpoints on a corner (of 2) | 0.75 | 0.47 | 0.76 | 0.53 |

1. **Sampler bias.** Warnsdorff ("fewest onward exits first") hugs the walls and folds back on itself. It reaches about 11% of the 5×5 shape space and produces more hairpins than uniform. It also avoids corner endpoints.
2. **Geometry.** Uniform samples are *just as stripy* on an empty square (same wall-to-wall share). Small empty squares only admit serpentines and spirals. **A better sampler alone won't remove the up-down-up-down look.**
3. **Clue placement.** Pins go where a rival route first diverges, so givens cluster early (e.g. `1,2,4,7,8,11,16,25`). The late path has no landmarks, which makes it read as "fill the rest with stripes".
4. **4×4 full cover is exhausted.** There are 38 shapes in total. Number trail can't feel fresh at that size, whatever the sampler.

**Fixes, in order of leverage (suggestions):**

| Fix | Effect | Cost |
| --- | --- | --- |
| **Walls between cells** (LinkedIn Zip has them) | Breaks stripes and creates forced turns. Also a new friend pattern: "a walled corridor forces the direction". Variety grows combinatorially. | Schema + renderer + verifier adjacency; medium |
| **Board masks** (holes, L, plus, ring, 5×6 rectangles) | Different silhouettes, and dead ends become meaningful. `active` already supports inactive cells. | Low for the engine, low-to-medium for the UI |
| **Backbite MCMC sampler** (random "backbite" moves on a seed path, ~10·n² steps) | Near-uniform over Hamiltonian paths; works with masks and walls | Low |
| **Spread checkpoints** (place by order quantiles, then add fork pins; prefer pins on turns) | Landmarks across the whole route; fewer front-loaded givens | Low |
| **Shape-novelty filter** (reject if U-turns > uniform mean + 1σ, or if the canonical shape is in the recent `avoid` set) | Cuts the worst corridor boards | Low |
| **Default to 6×6** for path; retire 4×4 except as a tutorial | 6×6 space is huge (the generator already reached 232 distinct routes in 300 deals) | Trivial |

The same principle applies to every mechanic: **dedupe and avoid on the canonical solution (up to symmetry), not on the full pack hash.**

---

## 4. Expansion options

### 4.1 Options weighed

| Option | Variety gain | Learnability / friend pattern | Cost | Risk |
| --- | --- | --- | --- | --- |
| **A. Make sibling families real** (wire knobs per family: density, touch, walls, press depth, size) | High per line of code; turns 5 distributions into 9 | Siblings teach a *changed* pattern, which is exactly near-transfer | Low (`FamilyDef` → `preferences`) | Low |
| **B. Random solutions + canonical dedupe** (binary and crown) | Very high for binary | Unchanged | Low–medium | Low |
| **C. Queens regions** (crown → one per row, column and region at n=6–8) | High (90 → 5,242 base answers × region layouts) | "Smallest region first", "k regions confined to k rows". Recognisable and sharp. | Medium: region generation + uniqueness + region paint in the renderer | Recognition (see §4.3) |
| **D. Board geometry** (masks/walls for path; masks for binary and crown) | High, and visibly different at a glance | New local patterns at edges and walls | Medium (renderer) | Mobile legibility |
| **E. New mechanics** | High | Depends on the mechanic | Medium–high each: schema, runtime, verifier, assembler, catalogue, `model-learner` observation, paper-board rendering, check scripts | Scope creep |
| **F. Recombined friend packs** (two simple rules from different families, Sudoku-Bench style; e.g. Tango + region balance, Zip + `=`/`×` parity) | Very high novelty | Good for the "transfer, not recall" thesis | Medium; certification is per combination | Rules get long; must stay ≤3 rules |

### 4.2 New mechanic shortlist (if E is chosen)

Ranked by fit with the existing `selectCell`/`cycle`/`set-cell` surface and the "local pattern, ≤3 rules" bar:

1. **Ladder (Futoshiki-style, LinkedIn Mini Sudoku spirit).** A 4–5 Latin square with `<`/`>` between cells. Values cycle 1..n, which fits easily since path already cycles numbers. Friend patterns: "the low end of a `<` can't be n", "a chain of k `<` signs fixes its ends". Different-feeling, cheap, and tolerant of small boards.
2. **Tents (trees and tents).** Binary set-cell. Each tree gets one orthogonal tent, and tents never touch. Row/column counts are optional. Friend pattern: "a tree with one free neighbour gets its tent". Reuses the binary renderer plus a tree glyph.
3. **Light Up (Akari).** Binary set-cell. Numbered walls, and bulbs that can't see each other. Friend patterns: "a 4 lights all its sides", "an unlit cell with a single viewer forces it". Distinctive, but the line-of-sight rendering costs more.

Skipped for now: Patches/Shikaku (needs a region-drag action), Nurikabe (too much global reasoning), Pips (domino UI), word games (outside the scope in `mini-game-rules.md`).

### 4.3 Keep vs cut

- **Keep 2 of the 3 LinkedIn spirits as headline families: Tango (after Option A) and Zip (after §3).** Both teach a crisp local move within seconds and gain the most from generator fixes.
- **Queens: keep, but only promote it once it has regions.** Without regions it's an n-queens toy with 14 answers. With regions it's the sharpest of the three, and also the most recognisable. Tension with the product line "we score the pattern they carried forward, not the puzzle class they recognised": state the resemblance plainly (already the policy) and lean on knob-shifted siblings (e.g. 2-per-row Star Battle-lite) so recognising the class doesn't solve round 3.
- **Pipe: cut from rotation** (keep the code). A single unbranched corridor is a path puzzle with a worse input. The only version worth reviving is Tatham-style *Net* (branching tree, no loops), and that's a rewrite.
- **Lights: merge to one family** with real depth: scramble from ⌈n²/3⌉ presses, a "fewest taps" target, and certified press rank. Or demote it like pipe. Two Lights families that are both 2-press boards is the weakest part of the shelf.

### 4.4 Proposed shelf after the work (suggestion)

| Family | Mechanic | Knob signature | Spirit |
| --- | --- | --- | --- |
| Summer Moons | binary_fill | 6×6 crisp Tango, random solution | Tango |
| No-square garden | binary_fill | 2×2 ban + balance + `=`/`×` | Friend |
| Sparse tally | binary_fill | odd n, 2–4 line counts | Friend |
| Crown estates | crown + regions | n=7, one per region | Queens |
| Twin crowns | crown + regions | n=8–9, two per row/col/region | Friend |
| Number trail | path_cover | 6×6, backbite, spread pins | Zip |
| Walled trail | path_cover | 6×6 + walls | Zip |
| Odd shapes | path_cover | masked board (holes/L/ring) | Friend |
| Ladder | latin + inequality (new) | 5×5, `<` chains | Friend |
| Cross lights | lights_toggle | deeper scramble, fewest-taps | Lights Out |

10 families, 5 mechanics, and no two families share a knob signature. Pipe is gone, and Lights is down to one. Note: n>6 needs the schema's `n: 4|5|6` widened, and the phone board layout must be checked at 7–9.

---

## 5. Recommended next experiments (no code in this pass)

Each one is a small, separately shippable step. Order = leverage ÷ cost.

| # | Experiment | Done when |
| --- | --- | --- |
| E1 | **Variety audit as a check script.** Per family over 100 deals: distinct canonical solutions, top-shape share, U-turns (path), givens per stage. | The script runs in CI-style `node scripts/…`. A baseline table is recorded, and the current numbers match §1.2. |
| E2 | **Family → knobs.** `FamilyDef` carries assembly preferences; `assembleDistinct` passes them. | Each sibling pair differs measurably on at least one audit metric. Crown seats ≠ Sparse crowns. |
| E3 | **Canonical dedupe.** `avoid`/`usedBoards` key on the solution up to symmetry. | No repeated canonical solution within one Deep shelf. Repeat rate across 5 refreshes is reported. |
| E4 | **Crisp Tango prototype** (Option A) behind a family id. | ≥95/100 distinct solutions; ≤3 postcard rules; no per-line numbers; 3 humans solve 6×6 in 45–90 s. A one-line note says whether it "feels like Tango". |
| E5 | **Path backbite + spread pins.** | 5×5: ≥400 of 549 shapes in 1,000 deals; U-turns ≤ uniform + 10%; givens spread across all thirds of the order. |
| E6 | **Walls and masks spike** for path (paper first: 5 hand-drawn boards, then generator). | Side-by-side screenshots (current vs walled) judged "less regular" by Mangle. Walls readable at phone width. |
| E7 | **Queens regions spike.** | n=7 region boards certified unique by the existing crown search, with region paint legible in light and dark themes. |
| E8 | **One new mechanic (Ladder)** end to end, after E1–E5. | Passes the same audit, and a model-learner observation exists for it. Tour can deal it. |
| E9 | **Lights decision.** Deepen it (≥⌈n²/3⌉ presses, fewest-taps) or demote it. | One Lights family remains, or Lights is demoted like pipe. |

Not yet: partial visibility, the RISK mode, recombined friend packs (F). Revisit after E8, since F needs per-combination certification and is easier to judge once the base shelf feels varied.

---

## How the numbers were measured

The numbers come from a throwaway harness, which isn't in the repo. It transpiled `lib/mini-game-rules/*` and `lib/puzzle/{author,verifier}.ts` with the repo's `typescript` (the same approach as `_agent/ux-rant-2026-10-07/smoke-assemble.mjs`) and called `assembleGamePack` with `visibility: "full"` on 300–1,000 seeds per configuration. Canonical form = the minimum over the 8 square symmetries (plus reversal for routes). Uniform path baselines enumerate every Hamiltonian path (552 directed at 4×4, 8,648 at 5×5). Tango and crown solution-space counts are direct enumeration. E1 is the proposal to turn this into a kept script.

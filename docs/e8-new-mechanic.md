# E8: new mechanics (research note)

2026-10-07. This note covers E8 in `docs/family-expansion-plan.md`. The plan named Ladder (Futoshiki), but I surveyed the wider field before picking. **First pick: Lamplight**, a light-and-ray mechanic in the spirit of Nikoli's *Light Up* (Akari). §1–6 cover why I picked it and when it counts as done. §7 adds **Mosaic** and **Skyline**, taken from the same shortlist without a new survey.

## 1. What the shelf already teaches

Every family on the shelf reasons with one of four operators:

| Operator | Families | What the eye does |
| --- | --- | --- |
| Adjacent-cell patterns plus a line count | Summer Moons, Moon garden, Sparse tally | Looks at 2–4 touching cells |
| Exclusive placement (one per line or region) | Crown seats, Sparse crowns | Strikes out a row, column or region |
| Ordering on a route (degree and dead ends) | Number trail, Walled trail, Odd shapes | Follows the route forward |
| Parity on a fixed stencil | Cross lights, Cascade taps | Overlays crosses |

No family has a constraint that **travels**: something that acts at a distance along a line and stops at an obstacle. No family puts a **number on a cell that you don't fill**. That gap is why it feels like "same games, shuffled": each round brings a new board, but the operator is always one of these four.

## 2. Terrain surveyed

**Daily hit games (2024–26).**
- LinkedIn: Queens, Tango, Zip, Mini Sudoku, Patches (Mar 2026, Shikaku-style rectangles with area and shape badges), plus the word games Pinpoint, Crossclimb and Wend.
- NYT: Pips (dominoes on coloured regions with sum, `=`, `≠`, `<` and `>` conditions).

All of these are partitions, Latin squares, or the four operators above. Patches and Pips are the newest, and both are **region-partition** mechanics.

**Collections and genre taxonomies.**
- Simon Tatham's collection has about 40 genres. Sorted by operator:
  - Latin plus arithmetic: Towers, Unequal, Keen.
  - Rays and visibility: Light Up, Range (Kurodoko), Undead.
  - Neighbour counts: Mosaic, Mines.
  - Partition: Filling, Rectangles, Galaxies.
  - Loops: Loopy, Pearl.
  - Pairing: Dominosa, Tents, Magnets.
  - Paths and rotation: Signpost, Net.
- Nikoli genres are well studied for hardness. Most are NP-complete, Light Up among them (McPhail 2005, by reduction from circuit-SAT). A short local-technique round is therefore a property of how a board is carved, not of the genre.
- Pulles (2021, Radboud) shows that Akari with no numbers is in P. The rays alone are easy, and the numbers are where the depth comes from. That suits a 60–90 s round well, because the clue mix sets the difficulty.

**Where models fail (the battle angle).**
- **TopoBench** (2026) tested six Tatham families: Flow, Bridges, Galaxies, Undead, Pattern and Loopy.
  - Frontier models solve under 25% of hard instances.
  - The main bottleneck is "extracting structured constraint information from spatial representations rather than reasoning over them".
  - The most damaging failure is premature commitment.
- **Sudoku-Bench** (Sakana) found models can take locally consistent steps under a novel rule, but lose global coherence and miss break-ins.

For a fair human-vs-agent duel, this suggests a mechanic where:
- the human's eye gets a real but learnable edge (light you can see),
- the agent gets the same facts as structured clues,
- the decisive move is local enough that both sides can learn it in three rounds.

**Human difficulty literature.** Sudoku rating work (e.g. Pelánek 2014, arXiv 1403.7373; technique-based raters) finds that humans solve CSPs with a few propagation techniques and prefer simple ones. The house style already follows this: carve clues while single-rule moves still finish the board. The new mechanic should keep that certificate.

## 3. Options weighed

| Candidate | New operator? | Friend pattern | Fits `selectCell`/`cycle` | Cost | Verdict |
| --- | --- | --- | --- | --- | --- |
| **Ladder** (Futoshiki) | Partly. Inequality chains, but on a Latin square, as in Mini Sudoku | "A chain of k `<` fixes its ends" | Numeric cycle 1..n | Low | Still a LinkedIn cousin (Mini Sudoku) |
| **Towers** (Skyscrapers) | Yes: record-high visibility | "1 at the edge: tallest is adjacent"; "n: the line climbs" | Numeric cycle | Low–medium | Strong patterns, but a Latin core again. Arithmetic favours the agent. |
| **Lamplight** (Light Up) | **Yes: rays that stop at walls**, plus numbered obstacles | "A dark cell only one open cell can see takes the lamp" | `null → × → lamp`, same as crown | Medium | **Picked** |
| Range (Kurodoko) | Yes: visibility counts | "A clue equal to its reach clears its cross" | Binary | Medium | Its connectivity rule is global, so it fails the ≤3 local rules bar |
| Mosaic / Fill-a-pix | Neighbour sums | Minesweeper "1-2" subtraction | Binary | Low | Strong, but reads as Minesweeper and stays inside a 3×3 window. Good next candidate. |
| Tents | Pairing | "A tree with one free side gets its tent" | Binary | Medium | The pairing proof needs bijection reasoning. Rules run to 4. |
| Patches / Shikaku | Partition | "Primes are one-wide" | Needs a drag-rectangle action | High | New action surface. Just shipped on LinkedIn. |
| Dominosa / Pips | Pairing on numbers | "A pair seen once is forced" | Needs pairing input | High | New action surface |
| Loopy / Masyu | Loop closure | Corner and degree rules | Edge input | High | Models fail at loops almost completely (TopoBench). Unfair, and it needs an edge UI. |

## 4. Why Lamplight

1. **A new operator.** Light travels along a row or column until a wall. No family on the shelf reasons along rays. Players get a new first move instead of a reskinned one.
2. **Three rules fit on the postcard.**
   - Every open cell is lit.
   - Lamps never see each other.
   - A number counts lamps on its four sides.
3. **No new input.** The cycle is `empty → × (rule out) → lamp → empty`, like crown. Walls are locked cells. The board needs only a lit-cell wash and numbers drawn on walls.
4. **Certifiable the house way.**
   - A three-technique human solver carves the numbers.
   - An independent backtracking count certifies uniqueness.
   - The foothold is the solver's first step.
5. **Fair asymmetry.**
   - The human sees light spread across the board.
   - The agent gets walls and numbers as integer lists, so it has the same facts in a structured form. TopoBench found that structured clues are what helps models.
   - Neither side gets a hint. Zip already sets the precedent: the line drawn between orders is derived from public state.
6. **Not a LinkedIn or NYT daily.** The resemblance to Light Up is stated plainly, as with the other spirits.

## 5. Friend-pattern claim

The new pattern this family earns, and the one that should carry from round to round:

> **Lonely viewer.** A dark cell that only one open cell can still see (counting itself) forces a lamp on that cell.

Two supporting patterns, which teach the numbers:

- **Full number.** A number with exactly as many open sides as it needs gets a lamp on every open side. A number that is already met crosses its other sides.
- **Lamp shadow.** A lamp rules out every cell it lights.

Near-transfer to Queens is intended: "a row with one legal spot" and "a dark cell with one viewer" are the same hitting-set move on a different geometry. Lamplight's version bends around walls and has no fixed count per line, so recognising Queens does not solve it.

## 6. Done-when for play

- [ ] `lamp_rays` category: schema, runtime (shared reducer), public verifier, assembler. The assembler outputs a certified unique board, a foothold, and FORCED-CHAIN mode.
- [ ] Every certified board is finished by the three techniques alone. Rounds where Lonely viewer never fires are rejected, so the new pattern does the work.
- [ ] An independent counter in `runtime.test.mjs` finds exactly one answer on every assembled board.
- [ ] A **Lamplight** family on the shelf at 6×6. Tour deals it, since Tour takes one board per mechanic and pipe is demoted. Deep can pick it.
- [ ] Learner board schema and system prompt describe `walls` and `numbers`. A model-learner observation parses.
- [ ] Board, thumbnail and postcard draw walls, numbers, lamps and the lit wash in both themes.
- [ ] Variety audit row for Lamplight, with the old shelf rows not regressed.
- [ ] Median human solve of 45–90 s: not measured here. It needs live play.

## 7. Picks 2 and 3: Mosaic and Skyline

This round did no new survey. It took the next two rows of the §3 table that add an operator the shelf (now including Lamplight) still lacks, and ran them through Lamplight's path: a three-or-fewer-rule postcard, a human-technique solver used to carve clues, a reject rule so the new move does the work, an independent count, then wiring.

| | Mosaic (`mosaic_count`) | Skyline (`tower_sight`) |
| --- | --- | --- |
| Spirit | Fill-a-Pix / Tatham *Mosaic* | Skyscrapers / Tatham *Towers* |
| New operator | **Overlapping window counts.** Two 3×3 sums share cells, so their difference is pinned to the cells only one of them owns. | **Ordered visibility.** An edge number counts record heights along a line, so taller towers hide shorter ones. |
| Friend pattern (the claim) | *Overlap subtraction:* two overlapping numbers bound their shared shade, and the rest must sit in the cells only one owns. | *Edge distance:* a clue k keeps the tallest at least k − 1 cells in, and a 1 puts the tallest right beside it. |
| Supporting patterns | A met number empties its block. A number as large as its open cells fills them. | A line with one gap takes its missing height. At 5×5, whole-line reasoning with two edge clues. |
| Postcard | A number counts shade in its 3×3, itself included. Numbered cells can be shaded. | Heights 1..n once per row and column. Count the towers seen from an edge number; hidden ones fade. A 1 sees only n. An n sees them climb 1 to n. |
| Input | `null → × → shade`, like crown and lamp | `null → 1 → … → n`, the numeric cycle |
| Reject rule | Fewer than 6 overlap steps at 6×6 | Edge or line reasoning must place at least one height; no givens at ≤5×5 |
| Certificate | Every-cell backtracking count | Row-permutation backtracking count |
| Shelf | `mosaic` 6×6 | `skyline` 5×5 (6×6 is engine-only: it falls back to a few givens, because whole-line reasoning is not human-sized there) |

Why these two and not the others in §3:

- **Ladder** is still a Mini Sudoku cousin, and Skyline already covers the numeric/Latin surface with an operator Ladder lacks.
- **Range** has a global connectivity rule.
- **Tents** needs four rules.
- **Patches and Dominosa** need new input surfaces.

Neither pick needed a runtime or reducer change. Both read as set-cell cycles through `affordances.ts`, so the Decision and solver contract (`describeBoard`, `compileIntent`) covers them without new code paths. Mosaic numbers sit on ordinary open cells. Skyline givens are ordinary locked cells.

Measured at authoring time (60 seeds each, prototype harness):

- **Mosaic 6×6:** about 17 numbers left after carving. About 16 of 36 forced steps come from overlap. About 7 ms per board, 16 ms at worst.
- **Skyline 5×5:** about 7 edge clues and no givens. About 17 of 25 placements are credited to edge or line reasoning. About 40 ms per board, about 200 ms at worst.
- All boards were distinct.

Done-when is the same as §6, applied to each pick. Live human solve times are still unmeasured.

### Postcard lesson from Skyline

The first Skyline postcard was correct, but players couldn't use it. "An edge number counts towers seen; taller hides shorter" missed three things a new player needs:

- **Direction.** It didn't say you look in from the number, along its row or column.
- **What counts.** The strip showed four heights but not which ones were seen. Hidden towers now fade, so the count can be checked by eye.
- **Size.** The strips were always four cells of 1–4, even on a 5×5 board. `skylineCard(n)` in `components/lovable/marks.tsx` now builds them from the board size. It also computes each edge number from its own strip, so the picture and the rule can't disagree.

The postcard now also shows the two extreme clues: a 1 sees only the tallest, and the largest clue sees a climb from 1 to n. They are the rule's endpoints, not strategy, and they give a first-time player somewhere to start.

For the next mechanic: if a rule counts something, the postcard picture must show which things count, at the board's real size.

## Sources

- LinkedIn games lineup and Patches rules: [trecebits](https://www.trecebits.com/juegos-linkedin/), [axeetech Patches](https://axeetech.com/puzzles/how-to-play-linkedin-patches/)
- NYT Pips: [Tom's Guide](https://www.tomsguide.com/gaming/nyts-new-game-pips-is-already-addictive-heres-how-to-play)
- [Simon Tatham's Portable Puzzle Collection](https://www.chiark.greenend.org.uk/~sgtatham/puzzles/)
- Light Up hardness: [Wikipedia, Light Up](https://en.wikipedia.org/wiki/Light_Up_(puzzle)) (McPhail 2005); [Pulles 2021, Analysis of Akari](https://www.cs.ru.nl/bachelorscripties/2021/Bram_Pulles___1015194___Analysis_of_Akari.pdf)
- Range / Kurodoko rules: [Tatham docs](https://www.chiark.greenend.org.uk/~sgtatham/puzzles/doc/range.html)
- Nikoli hardness survey context: [Demaine, Playing Games with Algorithms](https://arxiv.org/pdf/cs/0106019)
- TopoBench: [arXiv 2603.12133](https://arxiv.org/html/2603.12133v1)
- Sudoku-Bench / GPT-5 notes: [Sakana](https://pub.sakana.ai/sudoku-gpt5/)
- Human difficulty rating: [Pelánek, arXiv 1403.7373](https://arxiv.org/pdf/1403.7373)

---
name: de-slop-ui-hierarchy
description: Reviews and fixes AI-slop tells in web UI hierarchy, elevation, typography, forms, and control grouping. Use when building or styling a UI, when a design reads as generic or "AI-made," or when the user asks to de-slop a surface, clean up visual hierarchy, fix eyebrow text, nested cards, dropdown overuse, or form/control layout., too much roundness, radius matching outer shell, separator under header, full-cell border-radius, tall controls, control height matching shell radius, scrollbar, transparent track, thumb-only scrollbar, light mode, dark mode, theme toggle, both themes, empty icon slot
---

# De-slop UI hierarchy

A checklist for the structural half of "this looks AI-generated": hierarchy, elevation, labels, and controls. It complements broader slop catalogs (palette, motion, copy cadence) rather than repeating them; see Further reading.

## Reach for spacing before chrome

Before adding a border or a divider, walk this list in order and stop at the first tool that solves the problem:

1. Gap or spacing (proximity)
2. Color or opacity
3. Visual weight
4. Font size or weight
5. A light background fill to group related items
6. A border
7. A divider line

Most AI-generated layouts skip straight to step 7. A divider between two sections that already have enough gap between them is decoration, not information. Reserve lines for places spacing genuinely cannot express the boundary, such as a dense data table.

Two rules of thumb do most of the work here: things placed close together read as related, and things given contrast (in weight, color, or size) read as important. Gestalt grouping (proximity, similarity, shared enclosure) already tells the eye what belongs together. Extra borders and nested cards usually fight that grouping instead of reinforcing it.

**Radius stays under the content.** Corner radius must stay well below the shortest side of the surface (never ≈ row/cell height). Inner/nested corners are smaller than the outer shell; matching "outer roundness" means the shell, not puffing every cell to a pill.
**Header dividers are step-7 chrome.** If gap/spacing already separates the header from the body, delete the underline/separator — do not add one for "structure."
**Control height tracks the content, not a tall pill.** Toolbar buttons and icon hits should sit shorter than the text surface they attach to; puffing control height to "match" shell radius recreates the full-cell pill tell.
**Scrollbars: thumb only, track transparent.** Page shell may use a wider gutter (`scrollbar-gutter: stable` so overflow does not layout-shift); nested/editor tracks stay thinner than the shell. Never leave an opaque/stale track; custom scrollbar CSS is part of the surface, not a one-off.
**Both themes or it didn't ship.** After any color, blur, veil, or blend change, inspect light **and** dark. Blend modes / L tweaks that work in one often wash out or crush the other. If the user says a *colored* element is too dark/faint, fix that element — do not recolor the page background.
**Theme-control hit box matches paint.** Floating theme toggles: clickable/hoverable region must match the rendered control (z-index / overlay stacking is a recurring miss).

## One plateau, not a mountain

Treat every solid border-plus-background combination as raising a surface one level above the page. Stacking these (a card inside a card inside a bordered panel) builds a mountain of nested elevation that reads as generated rather than designed.

Atlassian's design system states this directly: raised surfaces are for movable cards or a single deliberate focal point, limited to one region per screen, and always paired with a matching shadow. A sunken surface is a well *inside* the default page (a Kanban column, a filters rail), never stacked on top of a raised or overlay surface. When the goal is just visual separation and not literal elevation, its own guidance is to use spacing or a border instead: "raised elevations can create visual noise, so don't use them to group content when a border or white space would suffice."

Applied here: pick at most one raised level for the whole screen. Everything else lives on the flat page surface, told apart by spacing, a single border, or a light fill, not by nesting.

## A surface gets a title or a description, never both

Page, card, panel, tab, dialog, settings group, list row: each of these picks one label, not a title-plus-subtitle stack. If both feel necessary, the subtitle is usually restating the title in more words, or it belongs merged into the title itself.

The same applies to shadcn `Card`: use `CardTitle` or write the explanatory sentence into the content, not both a `CardTitle` and a `CardDescription` on every card in a grid.

## Eyebrows: the tracking is the tell, not the case

A small uppercase label sitting directly above a heading (an "eyebrow" or "kicker") has become one of the most recognized AI-SaaS signals in 2025-2026 design critique, especially the pill-chip variant above an oversized hero. The specific, checkable tell is letter-spacing at or above roughly `0.1em` combined with a small size (`14px` or less) sitting immediately before a large heading. Repeating that same treatment above three or more sections on one page makes it worse, not more consistent.

Uppercase alone is not the problem; wide tracking on it is. If a label needs to stay:

- Keep normal or only slightly tightened letter-spacing.
- Fold the words into the heading, breadcrumb, or body copy instead of giving them a separate line.
- Keep genuinely functional labels (status, release version, a real breadcrumb) as an earned exception, not a decorative default.

## Icons: one library, consistent weight

**Icon + concrete label, not an empty slot.** Toolbar/actions that imply a glyph get a Lucide icon from the project set — never "instead of nothing." Prefer icon+real name (full filename, platform name) over a generic label alone; icon-only controls still need a matching accessible name.

Pick a single coherent icon set (Lucide, Tabler, and Heroicons are all fine choices) and stay inside it. Mixing Unicode arrows, emoji, and inline ad-hoc glyphs with real icon components is what makes an interface look assembled rather than drawn. Match whatever set the project already uses before adding a second one; only default to Lucide when starting fresh.

Keep icon weight in proportion to the text beside it. An icon that is bolder, larger, or more saturated than its label is the icon doing the label's job for it.

## Forms: match the control to the option count, not the default

Nielsen Norman Group's guidance, echoed across design systems (IBM Carbon, Google Material, USWDS), is consistent: dropdowns save space but cost an extra click and hide the options, so they're worth that cost only in a specific range.

| Situation | Use |
|---|---|
| Exactly two mutually exclusive states (on/off) | Switch or toggle |
| A handful of mutually exclusive options (roughly under 5) | Radio buttons or a segmented control, all visible at once |
| A handful of independent options, any number selectable | Checkboxes |
| A moderate list (roughly 5-15), one selection, space-constrained | Dropdown or select |
| A long list (15+) | Combobox with search/typeahead |

Luke Wroblewski's framing is a good gut check: dropdowns should be the UI of last resort, reached for only after buttons, radios, switches, and steppers have been ruled out, not the default input for every choice.

## Controls live where the thing they control lives

Functional hierarchy should mirror the real relationships between things, not the order fields happened to get added. A control (or its label) belongs in the same visual group as what it acts on, or immediately outside that group's edge where it's visually attached to the border. Two unrelated control groups should never share a container without a clear boundary between them, whether that's spacing, a heading, or (for real form fields) a `<fieldset>` and `<legend>`.

A settings row where the label sits far from its toggle, or a table where the row action lives in a different visual block than the row it edits, is a functional-hierarchy mismatch even when the typography looks fine.

## Self-audit

- Did the last hierarchy decision start with a border or divider instead of spacing?
- Is any surface carrying both a title and a subtitle that says the same thing twice?
- Count the raised (bordered-plus-background) levels stacked on this screen. More than one, without a stated reason?
- Any uppercase label with visible letter-spacing sitting right above a heading?
- Are icons from more than one set, or an emoji next to a real icon component?
- Is a dropdown hiding fewer than five mutually exclusive options that would fit as radios or a segmented control?
- Does every control sit in the same group as the thing it changes?

## Further reading

- [NN/g: Does Your Form Really Need a Dropdown List?](https://www.nngroup.com/articles/dropdown-list/)
- [NN/g: Checkboxes vs. Radio Buttons](https://www.nngroup.com/articles/checkboxes-vs-radio-buttons/)
- [LukeW: Dropdowns Should Be the UI of Last Resort](https://www.lukew.com/ff/entry.asp?1950=)
- [Atlassian Design: Elevation](https://atlassian.design/foundations/elevation)
- [Impeccable: Slop catalog](https://impeccable.style/slop) (eyebrow, tracking, and hero-chip tells)
- [anti-ui-slop skill (discountry/ritmex-skills)](https://github.com/discountry/ritmex-skills/blob/main/skills/anti-ui-slop/SKILL.md) for the broader palette/motion/copy catalog this skill doesn't cover
- [BuilderIO agent-native `frontend-design` skill](https://tessl.io/registry/skills/github/BuilderIO/agent-native/frontend-design) for surface density and default-chrome rules ("a surface gets a title or a description, never both" originates there)

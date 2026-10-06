# Design system

This starter uses **Tailwind CSS 4** and **shadcn/ui** (base-nova preset).

## Tokens

Prefer semantic utilities over raw colors:

| Use | Avoid |
|-----|-------|
| `bg-background` | `bg-[#fff]` |
| `text-foreground` | `text-zinc-900` (unless intentional) |
| `text-muted-foreground` | low-contrast arbitrary grays |
| `border-border` | `border-gray-200` |
| `bg-primary` / `text-primary-foreground` | brand hex without token |

Theme variables are defined in `app/globals.css`. Dark mode is class-based via `next-themes`.

## Typography

- Default body text uses the project sans font (Geist). Keep component body copy at default size unless hierarchy requires otherwise.
- Use `text-sm` / `text-xs` for secondary metadata, not as the default for main content.

## Components

- UI primitives: `components/ui/` (shadcn — do not edit lightly; extend via composition).
- App components: `components/` (your feature components).
- Utility: `cn()` from `lib/utils.ts` for conditional classes.

## Icons

Use `lucide-react`. Import only the icons you need.

## Motion

`motion` is available for animations. Respect `prefers-reduced-motion` for accessibility-sensitive motion.

## Layout

- Mobile-first: start with single-column layouts, then add breakpoints (`sm:`, `md:`, `lg:`).
- Use `min-h-svh` for full-viewport shells where appropriate.

## Adding shadcn components

All registry components were installed at bootstrap. To add or refresh:

```bash
pnpm dlx shadcn@latest add <component-name>
```

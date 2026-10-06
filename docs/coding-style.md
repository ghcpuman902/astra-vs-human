# Coding style

Conventions for TypeScript, React, and Next.js in this repo.

## TypeScript

- `strict` mode is enabled — avoid `any`; prefer explicit types at module boundaries.
- Use `type` for object shapes; use `interface` when extending or declaring public APIs if you prefer consistency with shadcn patterns.

## React

- Use function components and hooks.
- Name event handlers with a `handle` prefix: `handleClick`, `handleSubmit`.
- Prefer early returns for loading, error, and empty states.
- Colocate small helpers with the component; extract only when reused.

## Server vs client

- Default to **Server Components** in the App Router.
- Add `"use client"` only when you need browser APIs, hooks, or event handlers.
- Read `node_modules/next/dist/docs/` before choosing data-fetching or caching patterns.

## File structure

```
app/           # routes, layouts, page-level code
components/    # shared UI (non-route)
components/ui/ # shadcn primitives
lib/           # utilities, shared logic
hooks/         # client hooks
public/        # static assets
```

## Imports

- Use `@/` path alias (maps to project root).
- Group imports: external → internal → relative.

## Formatting

```bash
pnpm format    # Prettier
pnpm lint      # ESLint (flat config)
pnpm typecheck # tsc --noEmit
```

## Validation

Use **Zod** for runtime validation of env vars, form data, and API payloads when needed.

## Accessibility

- Use semantic HTML (`button`, `nav`, `main`, `label`).
- Ensure interactive elements are keyboard reachable.
- shadcn components include sensible defaults; preserve them when composing.

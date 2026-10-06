# Agent workflow

Practical guidance for humans and coding agents working in this repo.

## Principles

- **Small tasks** — One concern per branch or PR. Easier to review, revert, and validate.
- **Demoable increments** — Each change should be runnable and verifiable (`pnpm lint`, `pnpm build`, manual check in browser).
- **Avoid large refactors** unless explicitly requested. Prefer incremental improvement.
- **Read before coding** — For Next.js APIs, use `node_modules/next/dist/docs/` as source of truth.
- **Use the project skills** — see [agent-skills.md](./agent-skills.md); e.g. `next-dev-loop` to verify changes against a running dev server.

## Branch and PR workflow

1. Create a short-lived branch from `main`: `feat/short-description` or `fix/short-description`.
2. Make focused edits; keep the diff reviewable.
3. Run `pnpm lint` and `pnpm build` before opening a PR.
4. Use Vercel preview deployments (after GitHub + Vercel are linked) to validate UI changes.
5. For visual work, capture screenshots of preview URLs and iterate from those.

## Validation checklist

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm build
```

Start the dev server only when you need interactive testing:

```bash
pnpm dev
```

## UI iteration

- Design **mobile-first**; widen to tablet and desktop after narrow layouts work.
- Use semantic design tokens (`primary`, `background`, `muted-foreground`) — see [design-system.md](./design-system.md).
- shadcn/ui components live in `components/ui/`; compose them rather than reinventing primitives.

## Agent scope

- Do not add marketing landing pages or product-specific copy unless asked.
- Do not start the dev server unless the user requests it (see `.cursor/rules/never-start-the-dev-server.mdc`).
- Do not commit `.env.local` or local scratch notes.

## Official Next.js docs

- [Next.js documentation](https://nextjs.org/docs)
- [Upgrading guide](https://nextjs.org/docs/app/guides/upgrading)
- In-repo: `node_modules/next/dist/docs/` (version-matched)

## Upgrading Next.js

When a newer stable release is available:

```bash
pnpm dlx @next/codemod@latest upgrade latest   # bumps next, react, types, eslint-config-next + runs codemods
pnpm install && pnpm lint && pnpm typecheck && pnpm build
```

The codemod may bump `eslint` to a new major; keep `eslint@^9` until `eslint-plugin-react` supports ESLint 10.

Read the [upgrade guide](https://nextjs.org/docs/app/guides/upgrading) and any version-specific notes in `node_modules/next/dist/docs/` before merging.

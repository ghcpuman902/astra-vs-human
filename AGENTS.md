<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project rules

Next.js 16.3 (App Router, Turbopack) · React 19.3 · TypeScript · Tailwind 4 · shadcn/ui (base-nova, Base UI) · pnpm 11.

- Use **pnpm** only. Before handing back: `pnpm lint && pnpm typecheck && pnpm build`.
- **Never start `pnpm dev` / `pnpm start` unless the user asks.** If one is running, `.next/dev/lock` has its URL — reuse it.
- Runtime checks (incl. the `next-dev-loop` skill): use `/_next/mcp` plus **your own built-in browser/preview or browser MCP first**; `agent-browser` / headless Chrome only if you have none. This overrides the skill's agent-browser requirement.
- Never commit `.env.local` or secrets. Agent scratch goes in git-ignored `_agent/`.
- Keep diffs small; no big refactors or marketing copy unless asked.

# Where to look

| Task | Go to |
| --- | --- |
| Any Next.js API | `node_modules/next/dist/docs/` |
| Verify a change in the running app | `next-dev-loop` skill + [browser override](./docs/agent-skills.md#browser-tooling-override) |
| Agent skills (installed in `.agents/skills/`) | [docs/agent-skills.md](./docs/agent-skills.md) |
| UI, tokens, shadcn | [docs/design-system.md](./docs/design-system.md) + `shadcn` skill |
| TS / React style | [docs/coding-style.md](./docs/coding-style.md) |
| Branches, PRs, validation | [docs/agent-workflow.md](./docs/agent-workflow.md) |
| Scoping | [docs/product-principles.md](./docs/product-principles.md) |

# Agent skills

Load this when you need to know which project skills exist, or to add/update them.

Skills are project-local, installed with the [skills CLI](https://github.com/vercel-labs/skills) and pinned in `skills-lock.json`.

- Canonical copies: `.agents/skills/<name>/` (read natively by Cursor, Codex and other agents).
- Claude Code: `.claude/skills/<name>` symlinks to the same folders.

Agents pick a skill from its `description`; you rarely need to name it. To force one, say "use the `<name>` skill".

| Skill | Source | Use for |
| --- | --- | --- |
| `next-dev-loop` | `vercel/next.js` | Edit → verify against the running `next dev` via `/_next/mcp` + the agent's own browser (see override below). Needs a dev server the user started. |
| `vercel-react-best-practices` | `vercel-labs/agent-skills` | React/Next performance rules (waterfalls, bundle size, re-renders, server patterns). |
| `vercel-composition-patterns` | `vercel-labs/agent-skills` | Component API design: compound components, no boolean-prop sprawl, React 19 patterns. |
| `web-design-guidelines` | `vercel-labs/agent-skills` | "Review my UI / accessibility" audits (fetches the latest guidelines from GitHub). |
| `shadcn` | `shadcn-ui/ui` | Adding, composing and styling shadcn/ui components (this repo uses Base UI). Use `pnpm dlx shadcn@latest`, not `npx`. |
| `ai-sdk` | `vercel/ai` | Building AI features with the AI SDK (`ai` package, AI Gateway). Not installed by default — the skill adds `ai` when needed. |

## Browser tooling override

This project overrides `next-dev-loop`'s browser choice. The vendored `SKILL.md` is left unedited so `skills-lock.json` hashes and `npx skills update` keep working.

1. Framework view: always `/_next/mcp` on the running dev server (URL in `.next/dev/lock`; default `http://localhost:3000/_next/mcp`).
2. Browser view: use the browser tooling your agent already has — Cursor's built-in browser, Claude Code / Codex preview or browser MCP (Playwright MCP, Chrome DevTools MCP), etc. Map the skill's `agent-browser` steps (open, console, network, DOM/React tree, screenshot) to the nearest equivalent your tool offers.
3. Fallback only: if the agent has no built-in browser tooling, use `agent-browser` (`npm i -g agent-browser@latest`, optional) or a headless Chrome/Playwright script. Ignore the skill's "refuse if agent-browser is missing" rule.

Next.js 16.3 retired the old docs-only Next.js skills (`next-best-practices` etc.); the managed block in `AGENTS.md` plus `node_modules/next/dist/docs/` replace them. Do not reinstall them.

## Commands

```bash
npx skills ls                                   # list project skills
npx skills update -p -y                         # update project skills (review the diff)
npx skills experimental_install                 # restore from skills-lock.json
npx skills add <owner/repo> --skill <name> -a claude-code cursor codex -y
npx skills remove <name> -y
```

Optional Next.js workflow skills (add when the app needs them): `next-cache-components-adoption`, `next-cache-components-optimizer`, `next-partial-prefetching-adoption` from `vercel/next.js`; `deploy-to-vercel` from `vercel-labs/agent-skills` (see note in [vercel.md](./vercel.md)).

Review any new `SKILL.md` before committing — skills run with full agent permissions.

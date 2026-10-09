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

Note on Vercel skills (`vercel-react-best-practices`, `vercel-composition-patterns`): each pack
ships a large nested `AGENTS.md`. In this repo that file is renamed to `REFERENCE.md` so Cursor
won't treat it as always-on/nested rules. Skills still read `REFERENCE.md` on demand via
`SKILL.md`. After `npx skills update`, re-check and rename again if `AGENTS.md` returns.

## Browser tooling override

This project overrides `next-dev-loop`'s browser choice. The vendored `SKILL.md` is left unedited so `skills-lock.json` hashes and `npx skills update` keep working.

1. Framework view: always `/_next/mcp` on the running dev server (URL in `.next/dev/lock`; default `http://localhost:3000/_next/mcp`).
2. Browser view: Cursor agents use Cursor's built-in browser tab and map the skill's `agent-browser` steps (open, console, network, DOM/React tree, screenshot) to it. Claude Code and other CLI agents use `agent-browser` as the skill describes (it runs on the system Google Chrome).
3. Always finish with `agent-browser close`. Never launch Chrome binaries directly, `pkill` Chrome, run `playwright install`, or write throwaway headless Chrome/Playwright scripts.

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

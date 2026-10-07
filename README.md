# astra-vs-human

![Demo](public/demo.gif)

**Are you cleverer than the agent, or is the agent just quicker?**

Play: [astra-vs-human.vercel.app](https://astra-vs-human.vercel.app) · Demo: [Loom](https://www.loom.com/share/b549d07622694c8c9b1d9b31f2e38f60) · Craft: [Lovable](https://paper-play-board.lovable.app)

**We score the pattern carried forward, not the class recognised.**

OpenAI × Lovable **GPT-6 Astra Hackathon London** · Tue 6 Oct 2026.

## How to run

Node 20+ and pnpm 11.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Put `OPENAI_API_KEY` in `.env.local` for live Learner calls. Optional `OPENAI_MODEL` defaults to `gpt-6-astra`. That file stays gitignored. Cached packs and `GET /api/pack` run without a key.

Offline checks (no paid model call):

```bash
pnpm check:puzzles
node scripts/check-battle-ground.mjs
node scripts/check-game-generator.mjs
node scripts/check-model-learner.mjs
node scripts/check-game-learner.mjs
```

## Fairness (Human | Agent)

- A match is five games. Each game is three distinct packs in one transfer family, not the same seed three times.
- Before the match, mark families you have played or want less of. Novel families come first. Disliked families move later. None are removed.
- Clocks, game marks, and Next live in the top bar. The boards stay put when you advance. Next only moves you.
- One pack and seed per round index. While the sides are on different rounds they see different boards.
- Independent attempts and clocks. Human finishing, skipping, or hitting a cap does not end or advance the Agent.
- Shared actions: `selectCell`, `cycle`, `undo`, `clear`. Each tap counts on that side.
- Each side's next round stays locked until that side finishes or reaches its own action and time cap.
- Hints are practice-only. Scored rounds leave Hint off. The Learner receives the visible board, the postcard, and its earlier one-line claims.

## mini-game-rules and battle-ground-ui

| Track | Owns |
| --- | --- |
| `mini-game-rules` | Pack schema, generator, verifier, postcards, transfer families, action effects |
| `battle-ground-ui` | White board, craft tokens, Human\|Agent progress, per-side clocks and advance |

A rules pack supplies props to the frame. It does not set layout or colours. Category renderers sit inside the frozen frame. See [docs/mini-game-rules.md](docs/mini-game-rules.md) and [handoffs/battle-ground-ui/README.md](handoffs/battle-ground-ui/README.md).

## Stack

- **Lovable / Cursor** — paper-craft UI. Cursor ports the Mac craft export. This lane does not restyle tokens.
- **Codex** — packs, verifiers, and `/api/pack` plus `/api/game-pack`.
- **Astra Learner** — `/api/learner` and `/api/game-learner`. Same eyes as the human. Default model `gpt-6-astra`.

Three abilities share that public board and the counted taps. **Play** is Astra: one cell or a short burst. **Code** asks Astra for a tiny policy (first unlocked cell, cycle the selection, or named cells); the browser runs it and does not eval JavaScript. **Code plus a cheap decision model** either lets Astra write that plan as context for Jev (AI Gateway `typesafe-ai/jev`, or `TYPESAFE_API_KEY`) or Laya (when `LAYA_API_KEY`, `IMPOSSIBL_API_KEY`, or `LAYA_BASE_URL` is set), or it sends the board to that model with no written plan. The question, carried over from a manual 2048 bench, is whether the written context beats the bare model and the human. OpenAI Decisions stays a local placeholder and is not called. Agent vs Agent can pit two of these modes on independent clocks. No keys are stored in the repo.

## Learner credentials

Set these in Vercel or `.env.local`. This repo does not ship values.

| Name | Used for |
| --- | --- |
| `OPENAI_API_KEY` | Astra through OpenAI (`OPENAI_MODEL`, `OPENAI_ORG_ID` optional) |
| `AI_GATEWAY_API_KEY` | Astra and Jev through the Vercel AI Gateway / AI SDK |
| `VERCEL_OIDC_TOKEN` | Gateway auth on Vercel when the API key is unset |
| `TYPESAFE_API_KEY` | Jev direct `POST /v1/systemone` (`TYPESAFE_BASE_URL` optional) |
| `LAYA_API_KEY` | Laya direct `POST /v1/systemone` (Laya Studio unless `LAYA_BASE_URL` is set) |
| `IMPOSSIBL_API_KEY` | Laya on `https://api.impossibl.com` with model `convaiinnovations/laya` |
| `LAYA_BASE_URL` | Optional Laya origin. Overrides the default host |

`GET /api/learner-mix` reports only whether each credential is present.
- **Vercel** — [astra-vs-human.vercel.app](https://astra-vs-human.vercel.app)

Next.js 16.3 (App Router) · React 19.3 · TypeScript · Tailwind 4 · shadcn/ui · pnpm 11.

## Public repo and demo

- Repo (public): https://github.com/ghcpuman902/astra-vs-human
- Demo GIF: [docs/demo.gif](docs/demo.gif) (≈5s sped-up dual-arena loop)
- 60-second shoot sheet: [docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md)
- Submit list: [docs/SUBMIT-CHECKLIST.md](docs/SUBMIT-CHECKLIST.md)
- Learner model picker: [docs/MODEL-SELECTOR.md](docs/MODEL-SELECTOR.md)

Built tonight. Keys stay off the board, out of the repo, and out of the video.

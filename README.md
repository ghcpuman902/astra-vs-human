# astra-vs-human

**We score the pattern carried forward, not the class recognised.**

OpenAI × Lovable **GPT-6 Astra Hackathon London** · Tue 6 Oct 2026 · submit 20:30 Europe/London.

A human and one Learner each play the same rule pack and the same seed. The attempts are independent. The score is the local friend-pattern that shows up again on the next near-transfer board.

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

On this branch, `app/page.tsx` is still the starter card. The demo frame is `components/battle-board.tsx` with `lib/battle-ground-ui/controller.ts`. Cursor is porting the Lovable craft UI locally.

## Fairness (Human | Agent)

- One pack and one returned seed for both sides. A fallback pack keeps its actual seed.
- Independent attempts. One board viewport. Human is the playable tab. Agent shows the Learner’s own attempt.
- Shared actions: `selectCell`, `cycle`, `undo`, `clear`. Each tap counts on that side.
- Shared clock. Learner inference time stays on the Learner clock.
- The next round stays locked until both finish or reach the shared action and time cap.
- Hints are practice-only. Scored rounds leave Hint off. The Learner receives the visible board, the postcard, and its earlier one-line claims.

## mini-game-rules and battle-ground-ui

| Track | Owns |
| --- | --- |
| `mini-game-rules` | Pack schema, generator, verifier, postcards, transfer families, action effects |
| `battle-ground-ui` | White board, craft tokens, Human\|Agent tabs, dual clocks, round lock |

A rules pack supplies props to the frame. It does not set layout or colours. Category renderers sit inside the frozen frame. See [docs/mini-game-rules.md](docs/mini-game-rules.md) and [handoffs/battle-ground-ui/README.md](handoffs/battle-ground-ui/README.md).

## Stack

- **Lovable / Cursor** — paper-craft UI. Cursor ports the Mac craft export. This lane does not restyle tokens.
- **Codex** — packs, verifiers, and `/api/pack` plus `/api/game-pack`.
- **Astra Learner** — `/api/learner` and `/api/game-learner`. Same eyes as the human. Default model `gpt-6-astra`.
- **Vercel** — deploy backup once a project is linked. No production URL is stored in the repo.

Next.js 16.3 (App Router) · React 19.3 · TypeScript · Tailwind 4 · shadcn/ui · pnpm 11.

## Public repo and demo

- Repo (public): https://github.com/ghcpuman902/astra-vs-human
- Engine branch: `codex/broad-game-engine`
- 60-second shoot sheet: [docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md)
- 20:30 list: [docs/SUBMIT-CHECKLIST.md](docs/SUBMIT-CHECKLIST.md)
- Learner model picker (UX stub): [docs/MODEL-SELECTOR.md](docs/MODEL-SELECTOR.md)

Backup MVP, if the novel minigame is still landing: pick one OpenAI model, play human vs that Learner on one shared pack and seed, and show the two attempts plus the one-line pattern claim. A second mechanic on the same frame is the stretch. The video is at most one minute and shows tonight’s work. Keys stay off the board, out of the repo, and out of the video.

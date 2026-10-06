# Environment variables

## Files

| File | Committed | Purpose |
|------|-----------|---------|
| `.env.example` | Yes | Documented placeholders for collaborators |
| `.env.local` | No | Local secrets and overrides |
| `.env.*.local` | No | Environment-specific local overrides |

## Local setup

```bash
cp .env.example .env.local
```

Edit `.env.local` with real values. Never commit it.

## Next.js conventions

- `NEXT_PUBLIC_*` — exposed to the browser; use only for non-sensitive public config.
- All other variables — server-only by default in App Router.

## Adding new variables

1. Add a commented placeholder to `.env.example`.
2. Document usage in code or `docs/setup.md` if non-obvious.
3. Add the value in Vercel project settings for preview/production.
4. Pull with `vercel env pull .env.local` when using Vercel CLI.

## Validation (optional)

Use Zod in `lib/env.ts` to validate required env vars at startup when your app grows:

```ts
import { z } from "zod"

const envSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
})

export const env = envSchema.parse(process.env)
```

## Security

- Do not log secrets.
- Do not put API keys in `NEXT_PUBLIC_*` variables.
- Rotate keys if accidentally committed; use gitignored scratch files for recovery notes.

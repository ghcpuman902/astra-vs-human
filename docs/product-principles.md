# Product principles

Generic guidance for building features in this starter — adapt as your product evolves.

## Ship small, validate often

- Break work into steps that can be shown and tested independently.
- Prefer a working thin slice over a large unfinished change.
- Each PR should leave `main` in a deployable state.

## Clarity over cleverness

- Readable code and obvious UX beat premature abstraction.
- Reuse shadcn/ui and existing patterns before adding new dependencies.

## Mobile-first

- Most users start on small screens; design there first.
- Touch targets should be comfortable; avoid hover-only affordances.

## Preview-driven UI work

When Vercel is connected:

1. Push a branch → get a preview URL.
2. Test on real devices or responsive mode.
3. Share screenshots in PRs for visual review.

## Scope discipline

- No landing-page marketing copy in the starter — replace with product content when you know the product.
- No large refactors without explicit approval.
- Document env vars and setup changes in `docs/` when they affect collaborators.

## Security defaults

- Keep secrets in `.env.local` (gitignored).
- Commit only `.env.example` with placeholder keys.
- Never commit `LOCAL_NOTES.md`, `PUSH_NOTES.md`, or `VERCEL_PRIVATE_NOTES.md`.

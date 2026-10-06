# Collaboration workflow

How to work with others on this starter after GitHub is set up.

## Inviting collaborators (GitHub)

1. Open the repo on GitHub → **Settings** → **Collaborators** (or **Manage access** for org repos).
2. **Add people** by GitHub username or email.
3. Recommended permission: **Write** for active contributors (can push branches and open PRs).
4. Use **Maintain** or **Admin** only for owners who manage settings and releases.

For organisation repos, prefer team-based access via the org's team permissions.

## Branch strategy

- `main` — stable, deployable default branch.
- `feat/*`, `fix/*`, `chore/*` — short-lived topic branches.
- Open PRs for review before merging to `main`.

## PR checklist

- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes
- [ ] Changes are scoped and described clearly
- [ ] Screenshots attached for UI changes (preview URL or local)
- [ ] Env var changes documented in `.env.example` and `docs/env.md`

## Preview deployments

With Vercel linked to GitHub, every PR gets a preview URL automatically. Use it for:

- Visual review on mobile and desktop
- Sharing with non-technical stakeholders
- Agent/human iteration on layout (screenshot → fix → repeat)

## Communication

- Link the Vercel preview in the PR description.
- Note any manual test steps in the PR body.
- Flag breaking env or setup changes prominently.

## Local notes

Collaborators should use their own `.env.local`. Shared secrets belong in a team password manager or Vercel env settings — not in the repo.

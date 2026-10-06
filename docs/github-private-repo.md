# GitHub private repository

This repo is initialised locally only. Create a **private** GitHub repository when you are ready to push.

## Option A: GitHub CLI (recommended)

Prerequisites: [GitHub CLI](https://cli.github.com/) installed and authenticated (`gh auth login`).

From the project root:

```bash
cd ~/dev/nextjs/nextjs-starter

# Create private repo and set origin (does not push yet if you omit --push)
gh repo create nextjs-starter --private --source=. --remote=origin

# Push main branch
git push -u origin main
```

Use your preferred repo name instead of `nextjs-starter` if needed.

### Verify

```bash
gh repo view --web
git remote -v
```

## Option B: GitHub web UI

1. Go to [github.com/new](https://github.com/new).
2. Repository name: `nextjs-starter` (or your choice).
3. Visibility: **Private**.
4. Do **not** initialise with README, .gitignore, or licence (this repo already has them).
5. Create repository.
6. Link and push:

```bash
git remote add origin git@github.com:<your-org>/nextjs-starter.git
git branch -M main
git push -u origin main
```

## Sensitive local notes

If you jot down tokens, repo URLs, or org-specific details, use gitignored files:

- `PUSH_NOTES.md`
- `LOCAL_NOTES.md`

These are listed in `.gitignore` and must not be committed.

## Default assumption

**Private** unless you have a deliberate reason to go public.

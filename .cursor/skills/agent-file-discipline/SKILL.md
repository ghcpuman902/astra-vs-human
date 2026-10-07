---
name: agent-file-discipline
description: Keep agent scratch inside the project (_agent/), not parents or /tmp. Use when creating, moving, or cleaning agent files under a Mac project.
---

# Agent file discipline

When creating, moving, or cleaning agent scratch under `~/dev` (path casing `~/dev/macOS`):

- Keep files **inside that project** — never loose in `~/dev/macOS` or other parents; no new top-level `~/dev` folders.
- Do **not** use `/tmp` or `$TMPDIR` for anything that must be found later.
- Put scratch in `<project>/_agent/` (git-ignored) with a short README note: created-by, created-at, purpose, clean-up-after. Clean up when done; keep the README.

This skill is the public-safe project copy of the Mac agent-file-discipline rule.

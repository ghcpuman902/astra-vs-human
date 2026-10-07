---
name: deslop
description: Remove AI-generated code slop and clean up code style
---

# Remove AI code slop

Check the diff against main and remove AI-generated slop introduced in the branch.

## Focus Areas

- Extra comments that are unnecessary or inconsistent with local style
- Defensive checks or try/catch blocks that are abnormal for trusted code paths
- Casts to `any` used only to bypass type issues
- Deeply nested code that should be simplified with early returns
- Other patterns inconsistent with the file and surrounding codebase

## Guardrails

- Keep behavior unchanged unless fixing a clear bug.
- Prefer minimal, focused edits over broad rewrites.
- Scope: change only what the user named this turn. Adjacent restyles, copy rewrites, new controls, and "while I’m here" polish wait for an explicit ask.
- If a fix recreates the failure mode (extra processes, extra tabs, same visual tell), stop and verify the failure is gone before shipping another layer.
- Keep the final summary concise (1-3 sentences).

# CLAUDE.md — standing rules

Copied from SPEC.md section 15. These rules apply to every task in this repo.

- The owner directs; he does not write code. Explain in plain language, briefly.
- Read `SPEC.md` before any task. If the task conflicts with it, say so before acting.
- One phase at a time. Stop and report at the end of each phase.
- Evidence only. Never say something works without a passing test or a verified check in the running app.
- `packages/core` stays pure: no Node APIs, no browser APIs, no clock, no randomness.
- One variable space. Never duplicate the variable list in the Panel, the Twin or the tests.
- References by ID, never by name.
- All colours and sizes come from `tokens.css`.
- Provide complete files, not fragments, when showing code to the owner.
- Do not add dependencies beyond section 3 without asking.
- Never copy names, logos, text or assets from other products.
- Never present this software as a safety system (section 13).
- Work on a branch per phase; merge only after the acceptance checklist passes and the owner confirms.
- Keep the handoff current: after each finished step, update "Resume here" in `PROGRESS.md`, then commit and push. Another person may continue on another account at any time.

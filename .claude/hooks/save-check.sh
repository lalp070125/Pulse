#!/usr/bin/env bash
# Stop: do not end a turn with unsaved work, so the next person can pick it up.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
input=$(cat)
# Already asked once this turn: let it stop (prevents an endless loop).
if echo "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then exit 0; fi
dirty=$(git status --porcelain 2>/dev/null)
unpushed=$(git log --branches --not --remotes --oneline 2>/dev/null)
if [ -n "$dirty" ] || [ -n "$unpushed" ]; then
  echo '{"decision":"block","reason":"Unsaved work. Update the Resume here block in PROGRESS.md (branch, last step done and checked, exact next step, open questions), then commit and push, so the next person can continue."}'
fi
exit 0

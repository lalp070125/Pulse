#!/usr/bin/env bash
# SessionStart: show the new session where the last one stopped.
# Whatever this prints is added to Claude's context at the start of a session.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git fetch --quiet origin 2>/dev/null
echo "== Handoff: you may be taking over from another person's session =="
echo "Current branch: $(git branch --show-current)"
echo "Latest commits on all remote branches:"
git for-each-ref --sort=-committerdate --count=5 \
  --format='  %(refname:short)  %(committerdate:relative)  %(subject)' refs/remotes/origin
echo
# Print only the "Resume here" block of PROGRESS.md (up to the next "## " heading).
awk '/^## Resume here/{on=1; print; next} on && /^## /{exit} on' PROGRESS.md 2>/dev/null
echo
echo "If the branch named above is not the current one, merge or check it out before working."
exit 0

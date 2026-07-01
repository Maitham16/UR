---
description: Summarize the working tree and recent commits in one paragraph.
---

Run these three Bash commands in parallel:

1. `git status --short`
2. `git diff --stat`
3. `git log -5 --oneline`

If any of those commands fail (not a git repo, no commits yet, etc.) say so
plainly and stop.

Otherwise, write a single paragraph (3–5 sentences) that covers:

- What files are modified, added, or deleted (by category, not file-by-file
  unless there are five or fewer).
- The total scope of changes (insertions and deletions).
- Context from the five most recent commits — what direction the work has
  been moving in.

Do not editorialize. Do not project intent onto the changes. Stick to what
the commands actually returned.

End with one short line: the current branch and whether the working tree
is clean. Use the format `branch: <name> — clean` or
`branch: <name> — N files dirty`.

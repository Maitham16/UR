---
description: "Route an authorized security-research task into the UR-exclusive Reverse Skills capability pack."
argument-hint: "<research task>"
allowed-tools:
  - "Skill"
  - "TaskCreate"
  - "TaskList"
  - "TaskUpdate"
---

Before invoking another skill or using Bash, Edit, or Write, inspect the request
for multiple outcomes, sequencing, verification/reporting deliverables, or any
workspace-changing action. When any of those apply, call `TaskList`, create
2–8 concrete outcome tasks with `TaskCreate` if no actionable board exists,
and mark the first unblocked task in progress with `TaskUpdate`. Do not wait for
`TaskListRequired`, and do not disable UR's task gate to bypass this preflight.

Invoke the `reverse-skills:reverse-skill-router` skill with the user's arguments.
Follow its UR redteam execution contract, select the smallest applicable set of
specialist skills, and begin with local/passive triage. Do not interpret redteam
mode activation as target authorization.

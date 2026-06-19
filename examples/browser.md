# Browser

- `/chrome` drives a real browser via the built-in browser integration
  (navigate, read, screenshot) — risky actions ask for approval.
- `/browser <url|task>` is Playwright-aware: if Playwright is installed it can
  script the page; otherwise it prints the install command and points to `/chrome`.
- Browsing actions that submit forms, download, or log in require explicit approval.

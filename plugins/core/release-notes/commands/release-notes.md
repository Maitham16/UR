---
description: Draft release notes by grouping commits since the last tag (or a given ref).
argument-hint: "[since-ref] (default: last tag)"
---

Determine the base ref:

- If `$ARGUMENTS` is non-empty, use it.
- Otherwise run `git describe --tags --abbrev=0` to find the most recent
  tag and use that.
- If there are no tags, fall back to `HEAD~20`.

Get the commit list:

```sh
git log <base>..HEAD --pretty=format:'%h %s'
```

If the result is empty, say "No new commits since `<base>`." and stop.

Otherwise group commits by category. Decide category from the commit
message itself, in this order of preference:

1. Conventional-commit prefix (`feat:`, `fix:`, `docs:`, `chore:`,
   `refactor:`, `test:`, `perf:`, `style:`).
2. Keyword in the subject (`add`, `new`, `introduce` → feature;
   `fix`, `bug`, `correct` → fix; `doc`, `readme` → docs).
3. Otherwise → "Other".

Render a markdown draft:

```md
## <next-version-or-today>

### Features
- <one-line per feature commit, short SHA in backticks at the end>

### Fixes
- ...

### Documentation
- ...

### Other
- ...
```

If the project has a `package.json` with a `version`, use it for the
header (`## <version> — <YYYY-MM-DD>`). Otherwise just use today's
date.

Omit any section that has no entries — do not show empty headers.

End with one line: how many commits total were grouped and what
percentage fell into "Other". A high "Other" percentage signals the
project would benefit from conventional-commit messages.

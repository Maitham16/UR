# release-notes

Adds `/release-notes` — drafts release notes by grouping commits since the
last tag (or a given ref) into Features / Fixes / Documentation / Other.

## Use

```text
/release-notes
/release-notes v1.3.0
/release-notes HEAD~30
```

With no argument, the plugin uses `git describe --tags --abbrev=0` to
find the most recent tag. If there are no tags, falls back to `HEAD~20`.

## What it returns

A markdown release-notes draft. Categories with no entries are omitted.
The footer reports how many commits were grouped and what percentage fell
into "Other" — a high "Other" percentage hints that the project would
benefit from conventional-commit messages.

## Install

```text
/plugin install release-notes@ur-plugins-official
```

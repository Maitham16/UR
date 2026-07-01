# UR-AGENT 1.17.0 Upgrade Notes

UR 1.17.0 adds the P0 reliable repo editing surface.

## Reliable Repo Editing

```sh
ur repo-edit index
ur repo-edit search checkoutTotal
ur repo-edit plan rename oldName --to newName
ur repo-edit preview rename oldName --to newName
ur repo-edit apply rename oldName --to newName --check "bun test"
```

`repo-edit` is designed for safer repository-wide code changes:

- Builds `.ur/repo-edit/index.json` with file metadata, tokens, and
  JavaScript/TypeScript symbols.
- Searches paths, indexed tokens, content lines, and symbols.
- Plans JavaScript/TypeScript identifier renames from AST nodes instead of
  replacing arbitrary text.
- Prints a unified patch preview before writing.
- Applies all files transactionally and rolls back touched files if syntax
  validation or an optional check command fails.

## Validation

```sh
bun test test/repoEdit.test.ts
bun run typecheck
node ./bin/ur.js repo-edit --help
```

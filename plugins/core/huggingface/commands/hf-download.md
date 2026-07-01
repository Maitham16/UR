---
description: Download a Hugging Face model, dataset, or specific files to a local directory.
argument-hint: "<repo-id> [file globs] (e.g. 'BAAI/bge-small-en-v1.5')"
---

Download from the Hub.

1. Parse `$ARGUMENTS` into a repo id and optional file patterns. If empty, ask
   for a repo id and stop.
2. Choose the target directory: the user's path if given, else
   `${user_config.HF_DOWNLOAD_DIR}` if set, else `./<repo-name>`.
3. Download with the `hf` CLI:

   ```sh
   hf download <repo-id> [<files>] --local-dir <target>
   ```
   Add `--repo-type dataset` for datasets. For gated repos, confirm the user has
   run `hf auth login` (or has `HF_TOKEN` in the environment) and surface the
   acceptance-required message if the download is blocked.
4. Report the destination path, total size, and the files fetched.

Do not load, import, or execute the downloaded artifacts — downloading is the end
state. Warn before overwriting an existing non-empty target.

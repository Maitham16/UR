# huggingface

Work the Hugging Face Hub from any UR session: search and vet models and
datasets, read model cards with a deployment verdict, and download weights.
Backed by the official Hugging Face MCP server, with the `hf` CLI for downloads.

## Commands

| Command | Argument | What it does |
| --- | --- | --- |
| `/hf-model-search` | `<task>` | Rank the strongest models for a task with a single pick. |
| `/hf-dataset-search` | `<topic>` | Find datasets and flag fitness and licensing concerns. |
| `/hf-model-card` | `<model-id>` | Summarize a model card with a GO / CAUTION / NO-GO verdict. |
| `/hf-download` | `<repo-id> [files]` | Download a model, dataset, or files to a local directory. |

A bundled `huggingface-workflow` skill documents the MCP tools, the `hf`
cheatsheet, token scopes, model-selection criteria, and licensing pitfalls.

## Setup

```sh
/plugin install huggingface@ur-plugins-official
```

On enable, set **HF_TOKEN** — a read token is enough for search and gated
downloads; use a write token only to push. Optionally set **HF_DOWNLOAD_DIR** as
the default target for `/hf-download`.

The `hf` CLI uses its own `hf auth login` session (or `HF_TOKEN` in the
environment); the commands work through whichever path is available.

## Security

The token is stored in secure storage (keychain / credentials file), never in
plaintext settings. Downloads never load or execute the fetched artifacts, and
pushes are never performed without explicit intent and a write token.

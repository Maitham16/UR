# obsidian

Operate an Obsidian vault as a second brain from any UR session: capture atomic
notes, run daily notes, build Maps of Content, wire backlinks, and search the
vault with citations. Works two ways — direct edits to the vault files on disk
(no Obsidian needed), or live control of a running vault through the official
**Local REST API** plugin's built-in MCP server.

## Commands

| Command | Argument | What it does |
| --- | --- | --- |
| `/second-brain` | `<url \| file \| topic \| text>` | Capture a source into one atomic, linked, tagged permanent note. |
| `/daily-note` | `[log entry]` | Open/create today's daily note and append a timestamped entry. |
| `/moc` | `<topic>` | Build or refresh a Map of Content index note for a topic. |
| `/backlinks` | `[note path]` | Add the bidirectional `[[wikilinks]]` a note should have. |
| `/vault-search` | `<query>` | Answer from the vault only, with `[[wikilink]]` citations. |

A bundled `second-brain` skill defines the note conventions all commands follow.

## Setup

1. Install and enable the plugin:

   ```sh
   /plugin install obsidian@ur-plugins-official
   ```
2. Set **OBSIDIAN_VAULT_PATH** to your vault root when prompted. This alone
   enables every command via direct file edits.
3. Optional — live MCP control of a running vault: install the **Local REST
   API** community plugin in Obsidian, copy its API key into **OBSIDIAN_API_KEY**,
   and confirm **OBSIDIAN_API_URL** (default `https://127.0.0.1:27124/mcp/`; use
   `http://127.0.0.1:27123/mcp/` if you enabled the non-encrypted server).

The commands prefer the MCP server when it is reachable and fall back to direct
file edits otherwise.

## Security

The vault path and API URL are stored in settings; the API key is stored in
secure storage (keychain / credentials file), never in plaintext settings. The
Local REST API listens on localhost only. Do not expose its port to a network.

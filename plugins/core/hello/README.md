# hello

A minimal example plugin for the **ur-plugins-official** marketplace.

It adds a single slash command, `/hello`, that greets the user.

## Layout

```
.ur-plugin/
  plugin.json      ← plugin manifest (metadata only)
commands/
  hello.md         ← the slash command body + frontmatter
```

## Use as a template

To start your own plugin:

```sh
cp -r plugins/core/hello plugins/core/my-plugin
$EDITOR plugins/core/my-plugin/.ur-plugin/plugin.json
$EDITOR plugins/core/my-plugin/commands/*.md
```

Then add an entry to `.ur-plugin/marketplace.json`:

```json
{
  "name": "my-plugin",
  "source": "./plugins/core/my-plugin",
  "description": "What it does in one line."
}
```

## Install

From any UR session pointed at this marketplace (the default for this
distribution):

```sh
/plugin install hello@ur-plugins-official
/hello
/hello Maitham
```

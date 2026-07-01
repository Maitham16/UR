# UR-AGENT Documentation Site

This folder is a static documentation project for UR-AGENT.

Open `index.html` directly in a browser. No build step or dev server is
required.

## Files

- `index.html` - documentation app shell and content sections.
- `styles.css` - responsive documentation layout and visual system.
- `app.js` - command data, search, filters, copy buttons, and navigation.
- `assets/ur-architecture.svg` - architecture diagram used by the docs.

## Maintenance

When adding a public command, update the `commands` array in `app.js` and add
examples to the relevant tutorial or workflow section in `index.html`.

When a command writes project state, also update `projectFiles` in `app.js`.
For safety or context features, include the relevant `.ur/` paths and validation
commands so the static docs match the implementation.

When provider, auth, update, status-bar, IDE integration, or plugin behavior
changes, update `index.html`, `app.js`, and the matching markdown guide under
`docs/` in the same patch.

For public feature patches, also check the project-wide docs set:

- root `README.md`
- `docs/`
- `documentation/`
- `examples/`
- extension or marketplace docs when the feature affects them

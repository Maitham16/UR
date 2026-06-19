# UR Agent Documentation Site

This folder is a static documentation project for UR Agent.

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

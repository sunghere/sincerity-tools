# Sincerity Tools

Chrome extension that surfaces small developer tools when you select text on a page.
Inspired by Google Translate's selection popover and Slack's hover action bar.

## v0.1 surface

- **base64 decoder** — select text that looks like base64, click the icon in
  the toolbar that appears above your selection, see the decoded UTF-8 in a
  popover.

The popover anchors to the *page* (not the viewport), so it scrolls with the
content and may slide off-screen. It is dismissed only by:

- pressing **ESC**, or
- making a **new selection** (the new toolbar/popover replaces the previous one).

## Stack

- TypeScript
- Vite + `@crxjs/vite-plugin` (Manifest V3)
- No runtime dependencies — the content script is a single self-contained ESM bundle

## Develop

```bash
npm install
npm run dev     # builds to dist/ and watches
```

Then load `dist/` as an unpacked extension at `chrome://extensions` with
Developer Mode on.

## Build

```bash
npm run build
```

Output goes to `dist/`. Load that folder the same way as above.

## Release

One-shot version bump + build + zip + git tag:

```bash
npm run release:patch   # 0.1.0 -> 0.1.1
npm run release:minor   # 0.1.0 -> 0.2.0
npm run release:major   # 0.1.0 -> 1.0.0
# or pick an explicit version:
node scripts/release.mjs 1.2.3
```

This writes a packaged zip to `releases/sincerity-tools-vX.Y.Z.zip`, creates a
release commit and a `vX.Y.Z` tag, then prints the next step:

```bash
git push --follow-tags
```

Flags: `--no-tag`, `--no-zip`, `--no-commit`.

## First-time GitHub setup

After `gh auth login`:

```bash
npm run github:init                # uses your gh user, repo name "sincerity-tools"
# or:
node scripts/github-init.mjs cisisn/sincerity-tools           # explicit owner/name
node scripts/github-init.mjs --private                        # create as private
```

Idempotent — re-running just pushes any local commits/tags that aren't on the
remote yet.

## Adding a tool

1. Create `src/tools/<your-tool>/index.ts` exporting a `Tool` (see `src/types.ts`).
2. Register it in `src/tools/registry.ts`.
3. The toolbar auto-renders your icon for any selection where `canHandle` returns true.

## Layout

```
src/
  content/
    index.ts      # selection listener, toolbar + popover orchestration
    toolbar.ts    # Slack-style icon bar that floats above the selection
    popover.ts    # result panel anchored to the page (scrolls with content)
    root.ts       # shadow-DOM host management
    styles.ts     # injected CSS (kept as a string so the bundle stays single-file)
  tools/
    registry.ts   # tool list
    base64-decoder/
      index.ts    # Tool definition
      decode.ts   # base64 detection + UTF-8-safe decode
  types.ts        # Tool interface

scripts/
  release.mjs     # version bump + build + zip + git tag
  github-init.mjs # one-shot gh-based repo bootstrap
```

# Sincerity Tools

Chrome extension that surfaces small developer tools when you select text on a page.
Inspired by Google Translate's selection popover and Slack's hover action bar.

## v0.1 surface

- **base64 decoder** — select text that looks like base64, click the icon in
  the toolbar that appears above your selection, see the decoded UTF-8 in a
  popover. If the decoded result is an `http(s)://` URL, an **Open** button
  appears in the popover footer to launch it in a new tab.

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

```bash
npm run release:patch   # 0.1.0 -> 0.1.1
npm run release:minor   # 0.1.0 -> 0.2.0
npm run release:major   # 0.1.0 -> 1.0.0
node scripts/release.mjs 1.2.3   # explicit
```

Writes `releases/sincerity-tools-vX.Y.Z.zip`, makes a release commit and a
`vX.Y.Z` tag. Then:

```bash
git push --follow-tags
```

Flags: `--no-tag`, `--no-zip`, `--no-commit`.

### Auto-release on merge

`.github/workflows/release.yml` runs the same `scripts/release.mjs` pipeline
whenever something lands on `main`. The bump comes from a label on the
merged PR:

- `release:major` / `release:minor` / `release:patch` — explicit bump
- no label — defaults to **patch**
- `release:skip` — no release this time (use for docs/chore PRs)

Manual run: **Actions → Release → Run workflow** lets you pick the bump
(or pass an explicit `X.Y.Z`). The workflow ignores its own `release:` and
`chore: pre-release sync` commits to avoid loops.

## First-time GitHub setup

```bash
gh auth status       # if not logged in: gh auth login
npm run github:init
```

Default: public repo named `sincerity-tools` under your gh user. Override with
`node scripts/github-init.mjs sunghere/some-name` or add `--private`. The script
cleans transient sandbox leftovers, repairs/initializes `.git`, makes the
first commit, creates the repo on GitHub, and pushes — idempotent on re-runs.

## GitHub Pages

After the first push, enable Pages at
`https://github.com/<you>/<repo>/settings/pages`, choose **main** + **/docs**.
The onboarding page lives at `docs/index.html` and is plain HTML+CSS.

## Adding a tool

1. Create `src/tools/<your-tool>/index.ts` exporting a `Tool` (see `src/types.ts`).
2. Register it in `src/tools/registry.ts`.
3. The toolbar auto-renders your icon for any selection where `canHandle` returns true.
4. To attach a context button (like the URL-open button), return `actions` on
   the `ToolResult`.

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
  types.ts        # Tool / ToolResult / ToolAction interfaces

scripts/
  release.mjs     # version bump + build + zip + git tag
  github-init.mjs # one-shot gh-based repo bootstrap (cleans sandbox leftovers)

docs/
  index.html      # GitHub Pages onboarding (dark Slack tone)
```

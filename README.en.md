<p align="center">
  <img src="./assets/icon.png" width="128" alt="DSH-Codinput" />
</p>

<h1 align="center">DSH-Codinput</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-codinput"><img src="https://img.shields.io/npm/v/dsh-codinput" alt="npm Version" /></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DSH-0.2.2--rc.3%20desktop-blue" alt="DSH Version" /></a>
  <a href="https://www.npmjs.com/package/dsh-codinput"><img src="https://img.shields.io/npm/dt/dsh-codinput" alt="Downloads" /></a>
  <a href="https://github.com/Witherwithwinter/DSH-Codinput/stargazers"><img src="https://img.shields.io/github/stars/Witherwithwinter/DSH-Codinput" alt="GitHub Stars" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/Witherwithwinter/DSH-Codinput" alt="License" /></a>
</p>

<p align="center">
  <a href="./README.md">中文</a> | English
</p>

<p align="center">
  An editor-style input panel, right where the DeepSeek Harness chat composer used to be.<br />
  <a href="#features">Features</a> · <a href="#installation">Installation</a> · <a href="#theme--skin">Theme / Skin</a> · <a href="#development--verification">Development</a>
</p>

<table>
  <tr>
    <td width="50%"><img src="./assets/preview-normal.webp" alt="Default mode" /><br /><sub>Default mode (takes over the original composer slot)</sub></td>
    <td width="50%"><img src="./assets/preview-split.webp" alt="Edit + preview split" /><br /><sub>Edit + preview split (strictly 50/50)</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="./assets/preview-float.webp" alt="Floating mode" /><br /><sub>Floating mode (draggable, 8-way resizable)</sub></td>
    <td width="50%"><img src="./assets/preview-side.webp" alt="Sidebar tab mode" /><br /><sub>Sidebar tab mode (full-height panel)</sub></td>
  </tr>
</table>

## Features

Three mutually exclusive forms sharing one official input machine and one draft — never coexisting with the official composer.

### Three forms

| Form | How to enter | Notes |
| --- | --- | --- |
| **Default** `normal` | automatic | Takeover card sits in the original composer slot |
| **Floating** `float` | drag the blank area of the card's top row | Detaches into a floating window: drag to move, 8-way resize (position & size remembered), drag back to bottom dock to restore |
| **Sidebar** `side` | open the **Codinput** tab in the right sidebar | Full-height panel; collapsing the sidebar **does not give the slot back** — a small ball below the header recalls it; `/codinput` exits and closes the tab |

- Drafts survive form switches, `/codinput` exits, plugin toggles, and restarts.
- Undo history persists across forms: drag to float or move to the sidebar and back, `Ctrl+Z` still works.

### Editor & performance

- **CodeMirror 6**: fixed 3-digit-width line numbers (toggleable), active-line highlight, soft wrap, `Tab` indent, and line/column indicator; renders characters literally (font ligatures disabled so `->`, `//`, etc. never appear as "missing characters" from host font-shaping quirks).
- **Edit + preview split**: strictly 50/50 layout; live Markdown is computed only when open, refreshed after typing pauses, with debounced scroll sync.
- **Locked 60 fps on long chats & drafts**: the editor and line/col indicator run inside an open ShadowRoot using the native compositor caret; zero React re-renders and zero full-doc string allocation on the typing hot path, on-demand host draft sync, and auto-grow height stabilization during key-repeat bursts (`Enter` / `Backspace`).

### Official-parity input surface

Mirrors official entries and platform primitives wherever possible instead of redrawing them:

- **Model & permissions**: renders the official `ModelSelect` itself (backed by the same directory as `/model`), alongside official permission presets (with full-access risk confirmation) and the plan chip.
- **`/` `@` & command popups**: runs on the full official trigger pipeline (`MenuView` / `PopupSelectView`). Matches official geometry in normal form; uses an adaptive four-side host in float/side forms (never clipped, never overlapping the editor); `/codinput` is slotted alphabetically at the head of commands.
- **Toolbar, voice & hotkeys**: `+` commands button, official voice button (when enabled on desktop), separate send/stop buttons, Continue/Retry triangle on failed turns, official `Tooltip` primitive, and responsive spacing. Send and newline hotkeys support **custom key-combination recording** (defaults: `Enter` for newline, `Ctrl+Enter` to send).
- **Attachments & paste routing**: mirrors the official `ComposerAttachments` rail (thumbnails, original-image lightbox, file cards, progress & retry, drop overlay); supports slash "Add · File", pasting (including document-level paste routing), and drag-and-drop.
- **Full 9 sub-seat mirroring**: `left` / `right` / `model` / `permission` / `plan` / `activity` / `overlay` / `attachments` / `composer.dock` all follow official priority semantics so third-party plugins continue working seamlessly.

### Markdown rendering (offline, zero requests)

The preview pane and user-message bubbles share one rendering pipeline:

- **GFM & Obsidian**: aligned and horizontally scrollable tables, task lists, strikethrough, autolinks, footnotes; 8 collapsible callout families (light/dark contrast checked), `==highlight==`, `%%comments%%`, `[[wikilink|alias]]` (click to copy target), `![alt|300](url)` sizing, and official image lightbox.
- **Code, math & diagrams**: `highlight.js` for 46 languages with copy button; `KaTeX` inline/block math (20 woff2 fonts inlined as data URIs — **zero network requests**); `Mermaid` for 12 common diagram families (lazy-rendered when visible, theme-reactive, falling back to source + notice on errors or unsupported types).
- **Optional ligatures & instant toggle**: previews and user messages can use a monospace ligature body font (on by default; editor stays literal); toggling user-message Markdown off restores official plain text immediately.
- **Security baseline**: raw HTML is escaped (no forged reference chips), external links get `target=_blank rel=noopener noreferrer`, `javascript:` / `data:` protocols are blocked, KaTeX runs with `trust: false`, and Mermaid SVGs are sanitized via DOMPurify.

### Stats row & settings

- **Stats row**: replicates the official stats dock below the card (turns/steps · tok/s, cumulative tokens · cache hit rate, context-occupancy ring) with three mutually exclusive portal detail panels (follows scroll/resize, closes on `Escape` or outside click).
- **Settings → Codinput**: takeover toggle, line numbers, editor font, user-message Markdown, Markdown monospace ligatures, hotkey recording, and default view. Opening the **Codinput** sidebar tab automatically re-enables takeover if disabled.

<details>
<summary>Architecture: Official mirror vs. replicated vs. plugin-owned</summary>

| Area | Classification | Notes |
| --- | --- | --- |
| Model / permission / plan / voice / attachment rail / `/` `@` menu & popups / Tooltip / image lightbox | **Official mirror** | Mirrors official slot entries or uses host `@deepseek-ai/dsh-client-ui-primitives` directly |
| Normal card shell, toolbar chrome (`+` / send / stop), attachment intake handlers, stats dock, settings controls, user-message bubble shell | **Replicated official** | Corresponding JSX is private inside official entries and not exported; replicated value-for-value using host tokens and live host state |
| CodeMirror 6 editor (ShadowRoot-isolated), split preview, floating/sidebar forms & four-side adaptive overlay host, Markdown pipeline, hotkey recorder | **Plugin-owned** | No host equivalent; colors inherit from official `--dsw-*` tokens |

</details>

## Installation

Requires **desktop DSH `0.2.2-rc.3`** (Electron, host npm `next` channel; `latest` is still `0.2.2-rc.1`). Ships as a self-contained `dsh.client` bundle with **zero runtime transitive dependencies**. `dsh web` and older hosts are no longer maintained.

### Method A: desktop plugin page (recommended)

Open the desktop sidebar **Plugins** → **Add plugin** → search `dsh-codinput` → install. The plugin manager reads `dsh.bundle` metadata, validates `cordis.patch.yml`, and appends the package to your profile's `bundles`.

### Method B: CLI

```bash
dsh plugin --profile desktop add dsh-codinput
```

Replace `desktop` with your local profile name. Restart the desktop app afterwards (or hard-refresh the page; profiles default to `patchReload: live`).

<details>
<summary>Other installation methods: GitHub source / local dev link / manual config</summary>

#### GitHub source

The repository ships the prebuilt `lib/client.js`, so installing from source **requires no local build** (`esbuild` is only in `devDependencies` for local development or forks that remove `lib/`; if pnpm asks for build approval in that case, allow `esbuild@0.25.12: true` in your profile's `pnpm-workspace.yaml`):

```bash
dsh plugin --profile desktop add github:Witherwithwinter/DSH-Codinput
```

#### Local source development (`link:`)

```bash
git clone https://github.com/Witherwithwinter/DSH-Codinput.git
dsh plugin --profile desktop add link:/abs/path/to/DSH-Codinput
```

A `link:` install does not copy files — run `npm run build` and refresh the page to pick up changes.

#### Manual profile config (`~/.dsh/profiles/desktop/package.json`)

```jsonc
{
  "dependencies": {
    "dsh-codinput": "^0.5.3"          // local development: "link:/abs/path/to/DSH-Codinput"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-codinput"                // ← append last
      ],
      "patchReload": "live"
    }
  }
}
```

Run `pnpm install` in the profile directory (or `dsh plugin --profile desktop install`) and start the desktop app.

</details>

## Theme / skin

Codinput ships no palette of its own — every color inherits from the host's `--dsw-*` design tokens (light/dark follows the host):

- **Overriding host tokens changes everything**: overriding `--dsw-*` and `--dsh-scrollbar-*` styles the card, menus, buttons, caret, and scrollbars alongside the official UI. Note that the host defines tokens on `body` (`body[data-ds-dark-theme]`), so override at the same layer (`:root` declarations are overridden by `body`).
- **Official hard-coded values stay parity-matched**: e.g., send icon white foreground and context meter tools purple.
- **Stable class prefix**: outer elements carry `dci-` classes (`.dci-card`, `.dci-send`, `.dci-menu`, `.dci-stat-root`, `.dci-ball`, etc.). Styles are injected once into `<style id="dsh-codinput-styles">`, so skins injected afterwards override with standard CSS specificity.
- **ShadowRoot boundary**: `.cm-editor` and `.dci-pos` mount inside `.dci-cm-host`'s open ShadowRoot to isolate typing from host-wide style recalculation. `--dsw-*` / `--dsh-scrollbar-*` CSS variables and `color` inherit automatically, while external `.cm-*` selectors do not cross the shadow boundary; the editor font follows the user preference.

## Development & verification

```bash
npm install              # install devDependencies (bundler / typecheck)
npm run build            # contract check + minified lib/client.js build
npm run build:dev        # unminified build with inline sourcemap
npm test                 # zero-dependency unit test suite (10 suites)
npm run typecheck        # TypeScript typecheck
npm run prepublishOnly   # full release gate (check:popup + test + build + typecheck)
```

See [TESTING.md](./TESTING.md) (manual smoke & release checklists), [scripts/verify/README.md](./scripts/verify/README.md) (isolated-host CDP probes), and [CHANGELOG.md](./CHANGELOG.md).

## Third-party attribution

- **DeepSeek Harness** (`@deepseek-ai/dsh`, MIT License, Copyright (c) 2026 DeepSeek): several SVG icon paths (permission shield glyphs, plus, paperclip, arrow-up, send/stop, generic file glyph, etc.) and CSS values for the composer card and fallback attachment rail are replicated under the MIT license; original notices are retained in [NOTICE](./NOTICE) alongside [LICENSE](./LICENSE).
- **Bundled dependencies** (bundled into `lib/client.js`, zero external runtime deps): CodeMirror 6 (MIT), marked (MIT), DOMPurify (Apache-2.0 / MPL-2.0 dual-licensed, used under Apache-2.0), highlight.js (BSD-3-Clause), KaTeX (MIT), and Mermaid (MIT). Full versions and notices are retained in [NOTICE](./NOTICE).

## Support

If this project helps you, you are welcome to buy me a bowl of rice 🍚:

<img src="./assets/donate-qr.jpg" alt="0x2f's tip QR code (buy me a bowl of rice)" width="280" />

## License

[MIT](./LICENSE)

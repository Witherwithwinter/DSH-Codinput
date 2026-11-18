<p align="center">
  <img src="./assets/icon.png" width="128" alt="DSH-Codinput" />
</p>

<h1 align="center">DSH-Codinput</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-codinput"><img src="https://img.shields.io/npm/v/dsh-codinput" alt="npm Version" /></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DSH-0.2.2--rc.3%20desktop-blue" alt="DSH Version" /></a>
  <a href="https://www.npmjs.com/package/dsh-codinput"><img src="https://img.shields.io/npm/dm/dsh-codinput" alt="Downloads" /></a>
  <a href="https://github.com/Witherwithwinter/DSH-Codinput/stargazers"><img src="https://img.shields.io/github/stars/Witherwithwinter/DSH-Codinput" alt="GitHub Stars" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/Witherwithwinter/DSH-Codinput" alt="License" /></a>
</p>

<p align="center"><a href="./README.md">中文</a> | English</p>

<p align="center">An editor-style input panel, right where the DeepSeek Harness chat composer used to be.</p>

<table>
  <tr>
    <td width="50%"><img src="./assets/preview-normal.webp" alt="Default mode" /><br /><sub>Default mode (takes over the original composer slot)</sub></td>
    <td width="50%"><img src="./assets/preview-split.webp" alt="Edit + preview split" /><br /><sub>Edit + preview split (exactly half and half)</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="./assets/preview-float.webp" alt="Floating mode" /><br /><sub>Floating mode (draggable, resizable from all 8 edges/corners)</sub></td>
    <td width="50%"><img src="./assets/preview-side.webp" alt="Sidebar tab mode" /><br /><sub>Sidebar tab mode (full-height, VS Code panel style)</sub></td>
  </tr>
</table>

## Features

The chat composer becomes an editor-style input panel: three mutually exclusive forms sharing one official input machine and one draft.

### Three forms (replicated official + plugin-owned)

There is exactly one input entry at any time — it never coexists with the official composer:

| Form | How to enter | Notes |
| --- | --- | --- |
| Default `normal` | automatic | The takeover card sits in the original composer slot |
| Floating `float` | drag the blank area of the card's top row | Detaches into a floating window: drag to move, resize from edges/corners (position and size remembered) |
| Sidebar tab `side` | open the **Codinput** tab in the right sidebar | Input lives inside the sidebar panel; collapsing the sidebar **does not give the slot back** — a small ball below the header brings it back; typing `/codinput` inside the sidebar returns to the official composer and closes the tab |

Switching forms, leaving and re-entering via `/codinput`, disabling the plugin or restarting never loses the draft; the undo history survives form switches too — turn it into a floating card, open it in the sidebar and come back, `Ctrl+Z` still works.

**Classification**: the default form's card chrome replicates the official composer card — the official InputBar's card shell is private JSX with no exported component; the floating and sidebar forms are plugin-owned (the host has no equivalent, so their chrome uses the official tokens).

### Editor (plugin-owned)

- CodeMirror 6: line numbers (toggleable), active-line and gutter highlight, soft wrap, Tab indent, line/column indicator. The editor renders characters literally (no font ligatures: `->`, `//` etc. stay as typed, avoiding the host's font-shaping quirks that read as "missing characters").
- **Edit + preview split** (exactly half and half): Markdown renders live; the preview is only computed when open and refreshes after you stop typing.
- **60 fps on long drafts**: typing never round-trips the host per keystroke — the draft is published to the official input machine on demand (idle debounce, plus a flush before send / completion). Holding Enter to add lines or Backspace to delete them no longer stutters.

**Classification**: the editor and the split preview are plugin-owned — the official composer's editor is a private Lexical instance that cannot be exported or reused; only the theme colour, caret colour, gutter values, etc. match the official composer.

### Official-parity input surface (official mirror)

Rather than re-drawing what the host already ships, the official entries and platform primitives are mirrored:

- **Model and reasoning effort**: renders the official `ModelSelect` itself (two-level root menu, search, drill-down, loading/failure strips, focus handoff), backed by the same official model directory as `/model`.
- **`/` `@` and the `/model` / `/permission` popups**: the full official trigger pipeline — candidates and popups are rendered by the official `MenuView` / `PopupSelectView`; geometry matches the official composer in normal form, while float/side form uses the plugin's adaptive host that picks the best side around the card (never clipped, never covering the editor, and landing in the chat area left of the right sidebar), with `/codinput` slotted alphabetically at the head of the commands section.
- **Permission / plan**: the official three permission presets (including the full-access risk confirmation) and the plan chip, mirrored from their official seats.
- **Hover tooltips**: the host's official `Tooltip` primitive (500 ms, portal, `aria-describedby`).
- **Attachment rail**: the official `ComposerAttachments` entry itself — thumbnails / original-image lightbox, file cards, upload progress and failure retry, drop overlay and document-level drop listeners.
- **Voice button**: when the desktop host has a voice plugin enabled, the official voice component is rendered in the official position (recording, transcription and the not-ready guide are all official code).
- **Continue / Retry**: with a failed turn and an otherwise clean input surface, the primary button becomes the official Continue triangle and calls `retry(failureSeq)`.
- Every official bar sub-seat (`left` / `right` / `model` / `permission` / `plan` / `activity` / `overlay` / `attachments` / `composer.dock`) is mirrored with the official semantics, so third-party replace/append entries follow the official priority rules.

### Toolbar (replicated official + official mirror)

`+` commands button, model selector, permission selector, plan chip, voice button, separate send/stop buttons (spinning send state, separate stop button while running), official stop / sending / steer·queue labels and narrow-container spacing. Send and line-break hotkeys can be **recorded as any key combination** in Settings (defaults: Enter inserts a line break, Ctrl+Enter sends).

**Classification**: the row container and the `+` / send / stop buttons replicate the official InputBar — that JSX lives inside the official entry, is not exported, and offers no registerable render point, so it is re-drawn value by value from the official CSS / icons / semantics; the model, permission, plan, voice and left/right seats inside it remain official-entry mirrors.

### Attachments (official mirror + replicated official)

Three intake paths — slash "Add · File", **pasted images**, **dragging files onto the card**; thumbnails and original-image preview (official lightbox), upload progress / failure status chips with retry.

**Classification**: the attachment rail is the official `ComposerAttachments` entry mirror; the behaviour of the three intake paths replicates the official InputBar — its slash / paste / drag-and-drop handling is a private implementation that cannot be reused directly, so the entry points are rewritten after the official behaviour and wired back into the official attachment pipeline.

### Markdown rendering (plugin-owned)

The preview area and user messages share **one rendering pipeline**:

- GFM tables (alignment, horizontally scrollable wide tables), task lists, strikethrough, autolinks, footnotes.
- Obsidian callouts (note / tip / warning / danger / info / success / question / quote, collapsible, adequate contrast in light and dark), `==highlight==`, `%%comments%%`, `[[wikilink|alias]]` (a chip; clicking copies the target), image sizes `![alt|300](url)`, and a lightbox for images.
- Code blocks: highlight.js highlighting for 46 languages, language label and copy button.
- Math: KaTeX inline/block (20 woff2 fonts inlined as data URIs — **zero network requests**; invalid formulas fall back to the source).
- Mermaid: 13 common diagram types (flowchart / sequence / class / state / ER / gantt / pie / journey / gitGraph / info / mindmap / timeline), lazy-rendered when visible, follows light/dark; syntax errors or unsupported diagram types fall back to "source + error notice".
- Optional monospace ligatures for body text (on by default): previews and messages render `->` / `=>` / `//` ligatures with a monospace body font; the editor itself always stays literal. Turning the user-message Markdown switch off restores the official plain text without a reload.
- Security: raw HTML is always escaped (no forged chips), external links get `target=_blank rel=noopener noreferrer`, `javascript:` / `data:` protocols are blocked, KaTeX runs with `trust:false`, Mermaid SVG is sanitized through DOMPurify.

**Classification**: the rendering pipeline (marked / DOMPurify / KaTeX / Mermaid) is plugin-owned — the host offers no reusable Markdown renderer; the user-message bubble chrome replicates the official bubble structure (once the official user-text seat is taken over, the only render point left is the plugin's own).

### Stats row (replicated official)

Below the card, the official stats dock is replicated: turns/steps · tok/s, cumulative tokens · cache hit rate, and the context-occupancy ring, with values and formatting matching the official ones; click to open details (session stats / token usage / context breakdown) — portal-positioned, follows scrolling and resizing, closes on Escape or outside click. Available in all three forms.

**Classification**: the official stats dock renders inside the official InputBar, so taking over the bar removes its render point, and the component is not exported either; it is replicated value by value from the official data derivation, formatting and CSS, and it takes over the readings of the official Activity / Usage pills (data still comes from the official projections / store).

### Settings (replicated official + plugin-owned)

Settings → Codinput: enable takeover, line numbers, font, Markdown monospace ligatures, send / line-break hotkey recording, default view. When takeover is off, opening the Codinput sidebar tab enables it again.

**Classification**: the settings row structure and control values replicate the official settings page (the official settings page component is not exported, so the plugin can only register its own settings section and draw it itself); the hotkey recorder is plugin-owned.

## Installation

Requires **desktop DSH `0.2.2-rc.3`** (Electron). Host npm channels: `next` = `0.2.2-rc.3` (`latest` is still `0.2.2-rc.1`; the full feature set needs rc.3). The plugin injects a `dsh.client` bundle into the desktop renderer; `dsh web` and older hosts are no longer maintained (on older hosts the model/permission seats fall back to the self-drawn controls and the overlay popups are not rendered).

### Method A: desktop plugin page (recommended)

Open the desktop sidebar **Plugins** → **Add plugin** → search `dsh-codinput` → install. The plugin manager reads the package's `dsh.bundle` metadata, validates its bundled `cordis.patch.yml`, and appends the package to the profile's `bundles` — no manual patch lines.

### Method B: npm package (equivalent CLI)

```bash
dsh plugin --profile desktop add dsh-codinput
```

Replace `desktop` with your local profile name. Restart the desktop app afterwards (or hard-refresh the page; profiles default to `patchReload: live`).

### Method C: GitHub source

```bash
dsh plugin --profile desktop add github:Witherwithwinter/DSH-Codinput
```

The repository ships the prebuilt `lib/`, so installing from source **requires no local build**. If pnpm asks for a build approval (e.g. you switched to your own fork and removed `lib/`), add the printed key to the profile's `pnpm-workspace.yaml` and re-run:

```yaml
allowBuilds:
  esbuild@0.25.12: true
```

### Method D: local source

```bash
git clone https://github.com/Witherwithwinter/DSH-Codinput.git
dsh plugin --profile desktop add link:/abs/path/to/DSH-Codinput
```

A `link:` install does not copy files — run `npm run build` and refresh the page to pick up changes.

### Method E: the equivalent manual config

To pin a version in the profile or maintain it by hand, the equivalent of **Method A** is (`~/.dsh/profiles/desktop/package.json`):

```jsonc
{
  "dependencies": {
    "dsh-codinput": "^0.5.2"          // local development: "link:/abs/path/to/DSH-Codinput"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-codinput"                // ← append last
      ],
      "patchReload": "live"           // lib/client.js changes apply on page refresh
    }
  }
}
```

After editing the config by hand, run `pnpm install` in the profile directory (or `dsh plugin --profile desktop install`) and start the desktop app.

## Theme / skin

Codinput ships no palette of its own: every colour comes from the host's `--dsw-*` design tokens (light/dark follows the host). How theme/skin plugins coexist with Codinput:

- **Overriding host tokens changes everything** — the card, menus, buttons, badges and the official UI all follow the overridden `--dsw-*` variables, no separate adaptation needed. Note that the host defines the tokens on `body` (`body[data-ds-dark-theme]`); override them on the same layer — declarations on `:root` are overridden by the definitions on `body`.
- **Values the official UI hard-codes are hard-coded the same way in Codinput** (the white foreground of the send icon, the purple of the context meter's tools segment, …), keeping exact parity with the official look under skins — these do not follow tokens by design.
- **To target Codinput precisely**: every element carries a stable `dci-` class prefix (card `.dci-card`, send button `.dci-send`, settings menu `.dci-menu`, stats row `.dci-stat-root`, recall ball `.dci-ball`, …) usable as skin selectors; the plugin injects its styles once into `<style id="dsh-codinput-styles">`, so a skin injected afterwards can override with normal CSS specificity.
- The editor (CodeMirror) font is a user preference (a monospace stack by default) and does not follow the skin's font; its colours do follow tokens.

## Third-party attribution

Parts of this project **replicate DeepSeek Harness** (`@deepseek-ai/dsh`, MIT License, Copyright (c) 2026 DeepSeek): several SVG icon paths (the permission shield set, plus, paperclip, close, arrow-up, the generic file glyph, …) and CSS values for the composer card, the attachment rail and the original-image lightbox. They are used under the MIT license; the original copyright and permission notice are retained in [NOTICE](./NOTICE) alongside [LICENSE](./LICENSE).

Bundled third-party dependencies: CodeMirror 6 (MIT), marked (MIT), DOMPurify (Apache-2.0 / MPL-2.0 dual licensed, used under Apache-2.0) — the minified bundle strips license comments, so their copyright and license notices are retained in [NOTICE](./NOTICE).

## Support

If this project helps you, you are welcome to buy me a bowl of rice 🍚:

<img src="./assets/donate-qr.jpg" alt="0x2f's tip QR code (buy me a bowl of rice)" width="280" />

## License

[MIT](./LICENSE)

# Padding — KWin script (maximized + snapped window gaps)

A KWin 6 script that adds a configurable gap on **all four sides** of a window when it is
**maximized** *and* when it is **snapped / quick-tiled** (Super+Left/Right/Up/Down and the
corner quarters). Adjacent tiles share a **half-gap**, so the spacing between two snapped
windows matches the gap to the screen edge.

Written in **TypeScript** and compiled to a single `padding.js` (KWin's QJSEngine — no modules).

## Features

- Per-side gaps (top/bottom/left/right) on the outer edges of maximized and quick-tiled windows.
- A separate "snapped divider" gap for the total space between adjacent snapped windows.
- Optional **dock compensation**: extra margin on panel edges so a floating panel keeps floating
  (off / maximized-only / all windows).
- **Ignored apps** list (system surfaces are always skipped).
- Maximize **toggle**: maximizing a gapped window a second time restores it.

## Build

```sh
npm install
npm run build      # tsc -> pkg/contents/code/main.js
npm run check      # tsc --noEmit (type-check only)
```

Sources live in `src/` (`kwin.d.ts` ambient types, `config.ts`, `geometry.ts`, `padding.ts`).
The KWin package is `pkg/` (`metadata.json`, `contents/`). The entry point compiles to
`contents/code/main.js` (the path KWin/kpackagetool6 require) and is committed so installation
works without Node.

## Install / uninstall

```sh
./install.sh              # build, install (kpackagetool6), enable in kwinrc, reload KWin
./install.sh --no-build   # install the committed build without recompiling
./install.sh --uninstall  # same as ./uninstall.sh
./uninstall.sh            # disable + remove
```

## Configuration

System Settings → Window Management → KWin Scripts → **Padding** → configure:

| Key | Default | Meaning |
|-----|---------|---------|
| `gapTop` / `gapBottom` / `gapLeft` / `gapRight` | 15 | Per-side gaps (px) on the outer edges of maximized and snapped windows. |
| `gapSnapped` | 15 | Total gap (px) between two adjacent snapped windows (split as half on each window's shared edge). |
| `padSnapped` | true | Also pad snapped / quick-tiled windows. |
| `compensateDockMode` | 0 | Dock compensation: 0 off, 1 maximized-only, 2 all windows. |
| `dockMargin` | 12 | Extra px on panel edges (10–20). |
| `ignoredApps` | — | Comma-separated window classes/names to skip. |

## Notes

- Snapped windows are detected via their assigned `tile` (`window.tile.absoluteGeometry`),
  which also covers custom tiles from the Tiling editor.
- Requires KWin 6 (developed on Plasma 6.7, Wayland).

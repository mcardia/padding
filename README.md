# Padding — KWin script (maximized + snapped window gaps)

A KWin 6 script that adds a configurable gap on **all four sides** of a window when it is
**maximized** *and* when it is **snapped / quick-tiled** (Super+Left/Right/Up/Down and the
corner quarters). Adjacent tiles share a **half-gap**, so the spacing between two snapped
windows matches the gap to the screen edge.

Written in **TypeScript** and compiled to a single `padding.js` (KWin's QJSEngine — no modules).

## Features

- Gap on all four sides of maximized and quick-tiled windows.
- Uniform spacing: outer edges get the full gap, shared/inner edges get half.
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
| `gapSize` | 15 | Gap in px on outer edges (half on shared tile edges). |
| `padSnapped` | true | Also pad snapped / quick-tiled windows. |
| `compensateDockMode` | 0 | Dock compensation: 0 off, 1 maximized-only, 2 all windows. |
| `dockMargin` | 12 | Extra px on panel edges (10–20). |
| `ignoredApps` | — | Comma-separated window classes/names to skip. |

## Notes

- Custom tiles (the Tiling editor, `quickTileMode` Custom) are out of scope.
- Requires KWin 6 (developed on Plasma 6.7, Wayland).

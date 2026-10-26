# dsh-molecule-visualization

English | [简体中文](README.md)

> This repository builds on [PandaAIDD/dsh-molecule-viewer](https://github.com/PandaAIDD/dsh-molecule-viewer)
> (MIT) and evolves independently. Upstream contributed the DSH slot wiring, the vendored 3Dmol.js bundle
> and the base viewer; on top of that this repository fixes six reproduced rendering bugs and adds
> XYZ / Gaussian input, a ball-and-stick style, on-card failure reasons and a layout timeout.
> The per-change list is in [NOTICE.md](NOTICE.md) and [CHANGELOG.md](CHANGELOG.md); the upstream copyright
> and MIT license are preserved in [LICENSE](LICENSE).

Interactive 3D molecular viewer for DeepSeek Harness: pass a file path or raw
PDB/SDF/MOL/MOL2/XYZ/GJF content and the conversation renders a live 3Dmol.js viewer
(rotate, zoom, switch style, recolor).

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/kanade-tachibana-methyl/dsh-molecule-visualization)
[![dsh.so install · dsh 0.2.1-rc.2](https://www.dsh.so/badge/install/dsh-molecule-visualization@0.2.1-rc.2.svg)](https://www.dsh.so/artifact/dsh-molecule-visualization/)

## Fixes over upstream 0.2.0

| # | Bug | Upstream symptom | Fix |
|---|---|---|---|
| 1 | `mol` silently dropped | The declared format went straight to `addModel`. 3Dmol.js 2.4.2 has **no `mol` parser**: it logs `Unknown format: mol`, guesses, and for most real molfiles guesses `xyz` → **0 atoms, empty frame, no error** (measured: 12 of 14 real `.mol` files) | `mol` maps to the `sdf` parser; the payload carries `renderFormat`, and the client maps it again so replayed old sessions also render |
| 2 | Failures invisible | Blank canvas, nothing said | The card shows the specific reason, an actionable hint and a Retry button (parse error / zero atoms / no WebGL / container never laid out); after loading, the host's atom count is reconciled against what 3Dmol.js actually loaded |
| 3 | No ball-and-stick | Only stick/line/sphere/cartoon | New `ballstick`: `{ stick: { radius: 0.15 }, sphere: { scale: 0.25 } }` overlaid on one selection (3Dmol.js has no native representation) |
| 4 | Bond-less models render nothing | Stick styles draw bonds; no bond table (XYZ, empty bond block) → empty view | On load, if the bond count is 0 the viewer calls `model.assignBonds()` (distance perception); if still 0 it falls back to spheres and says so on the card |
| 5 | Layout wait can hang forever | `awaitLayoutBox()` waits for a non-zero box; a collapsed ancestor never resolves → stuck on "Loading 3D viewer…" | 10 s timeout with a named cause (`display:none` / 0×0) and a Retry button |
| 6 | Format validation too lax | Misaligned PDB columns are accepted and 3Dmol.js silently drops atoms (measured: a Chem3D-exported PDB reported 92 host atoms and rendered 1) | Host-side fixed-column validation (record 1-6, x 31-38, y 39-46, z 47-54, resName 18-20, column 30 must be blank); a uniform-`altLoc` file — the signature of a one-column shift — is repaired (column 17 blanked) and reported as a card warning, or rejected outright with `repairShiftedPdbAltLoc: false` |

Measured details, including what did **not** reproduce, are in [docs/verification.md](docs/verification.md).
Short version: bugs 1, 2, 5 and 6 reproduce; 3 is a confirmed missing feature; **bug 4 as described does not
hold on 2.4.2** — 3Dmol.js already perceives bonds for PDB files without CONECT (1CRN with its CONECT
records stripped still yields 334 bonds). This repository keeps the perceive-then-fallback path anyway, as defense
in depth.

## Features

- 🧬 Six formats: PDB, SDF, MOL, MOL2, XYZ, and Gaussian input (`.gjf`/`.com`, geometry only)
- 🧱 PDB column validation with repair, naming the exact line and column
- 📁 Path-first: Windows, WSL and `~/` spellings resolve automatically
- 🖱️ Ball & stick / stick / line / sphere / cartoon, background and color modes
- 🔄 Durable: the payload rides `tool/result`'s `presentationMeta` and replays after restarts
- ⚠️ Every failure is visible, with a reason, a hint and Retry
- ⏱️ No infinite loading
- ⤢ Expand to the full window: the inline card is compact with a responsive height (no fixed 400px); the expand button lifts the viewer into a window-sized overlay (Esc or a backdrop click closes it)
- 📦 3Dmol.js 2.4.2 vendored into the client bundle — no CDN, works offline
- 🔍 Verifiable: `node scripts/verify.mjs` runs typecheck, 98 tests (3 of them render the built bundle in
  jsdom), a 3Dmol parse probe, a real-file end-to-end probe and a built-artifact smoke test

## Install

```bash
dsh plugin --profile web add git+https://github.com/Kanade-Tachibana-Methyl/dsh-molecule-visualization.git
```

Source form (no npm package required):

```bash
dsh plugin --profile web add github:Kanade-Tachibana-Methyl/dsh-molecule-visualization
```

If GitHub is unreliable from your network, the SSH form works too:
`dsh plugin --profile web add git+ssh://git@github.com/Kanade-Tachibana-Methyl/dsh-molecule-visualization.git`

Local development instead: `node scripts/build.mjs` then
`dsh plugin --profile web add file:<path-to-repo>`.

If the upstream plugin is already installed, remove it first
(`dsh plugin --profile web remove @dsh-plugins/dsh-molecule-viewer`) — otherwise both register
`view_molecule`.

The client half hot-reloads (DSH's `client-hmr` polls the bundle every 500 ms), so a page refresh is
enough for renderer changes. Host-half changes (tool registration, format enum, validation) need a
DSH restart: `dsh --profile web`.

## Formats

| Format | Extension | Parser | Notes |
|---|---|---|---|
| PDB | `.pdb` `.ent` | `pdb` | Loaded with `keepH: true` so explicit hydrogens survive |
| SDF | `.sdf` `.sd` | `sdf` | V2000/V3000; multi-molecule files render the first record (noted on the card) |
| MOL | `.mol` | **`sdf`** | 3Dmol.js has no `mol` parser |
| MOL2 | `.mol2` | `mol2` | TRIPOS |
| XYZ | `.xyz` | `xyz` | No bond table; bonds perceived by distance |
| GJF | `.gjf` `.com` | **`xyz`** | Geometry block converted host-side |

SMILES is not supported (out of scope, and there are no 3D coordinates).

## Styles

`stick` (default), `ballstick` (balls + sticks, recommended for small molecules), `line`,
`sphere` (space-filling), `cartoon`
(protein ribbons; ligands automatically fall back to sticks).

## Tool parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | `string` | one of `path`/`data` (**preferred**) | File path in any host dialect |
| `data` | `string` | one of `path`/`data` | Raw content, only when no file exists |
| `format` | `pdb \| sdf \| mol2 \| mol \| xyz \| gjf` | with `data` | Inferred from the extension with `path` |
| `name` | `string` | no | Viewer title |
| `style` | `stick \| ballstick \| line \| sphere \| cartoon` | no | Initial style |

## Configuration

```yaml
- id: molecule-visualization
  name: 'dsh-molecule-visualization'
  config:
    defaultStyle: stick
    repairShiftedPdbAltLoc: true   # false = reject misaligned PDBs instead of repairing column 17
```

## Repository conventions (dsh-plugin)

| Convention | Value |
|---|---|
| Repo name = package name | `dsh-molecule-visualization` |
| Tool name | unchanged: `view_molecule` |
| `dsh.manifestVersion` | `1` |
| `dsh.bundle.patch` | `./cordis.patch.yml` (one `insert` row, id `molecule-visualization`) |
| `dsh.client.platform` | `web` |
| `dsh.client.inject` | `["@deepseek-ai/dsh-client-ui-tool"]` |
| `icon` | `./assets/icon.svg` |
| `engines` | `node >=22`, `dsh >=0.2.0-rc.2` |
| GitHub topics | `dsh-plugin` `deepseek-harness` `dsh` `molecule-visualization` `molecular-visualization` `3dmol` `pdb` `sdf` `chemistry` `webgl` |

Release steps and the first-release notes live in [docs/release-checklist.md](docs/release-checklist.md).

## Development

```bash
npm install                 # .npmrc sets legacy-peer-deps=true (@deepseek-ai/* is not on npm)
node scripts/build.mjs      # tsc → lib/, esbuild → lib/client.js
node scripts/typecheck.mjs
node test/run-all.ts
node scripts/verify.mjs
```

Typechecking needs the DSH `@deepseek-ai/*` packages, which npm does not host. Link them:

```powershell
New-Item -ItemType Junction -Path node_modules\@deepseek-ai `
  -Target "$env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai"
```

The link is a development aid only; at runtime the plugin resolves these packages from the profile it
is installed into.

## License and attribution

MIT — see [LICENSE](LICENSE). The upstream notice
`Copyright (c) 2026 dsh-molecule-viewer contributors` is retained, with an additional copyright line
(`Copyright (c) 2026 dsh-molecule-visualization contributors`).
Upstream: [PandaAIDD/dsh-molecule-viewer](https://github.com/PandaAIDD/dsh-molecule-viewer).
The slot wiring, the `presentationMeta` payload design, the vendored 3Dmol.js build and the base
viewer UI are upstream work; see [NOTICE.md](NOTICE.md) for what changed here.

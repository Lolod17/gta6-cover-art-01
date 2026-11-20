# Build notes — composition, photo pipeline, grade, typography, export, and packaging

## Step 1: composition foundation (historical verification)

## Built

- `app/style.css`: CSS custom properties for the required ink `#0B0D13`, paper `#EDE6D8`, warm highlight `#F2B24A`, and magenta `#C41C83` palette; neutral panel surfaces; spacing scale; type scale; font stacks; tracking; shell dimensions. Magenta marks the selected layout. System sans, editorial serif, and mono stacks require no font downloads or bundled font files.
- `app/index.html`: Scene / 06 studio shell with project header, three layout selectors and miniature grids, central preview, output dimensions, gutter information, palette reference, and footer. Keyboard focus styling and native buttons with `aria-pressed` expose layout selection.
- `app/src/main.js`: six numbered DOM placeholder panels per composition; functional switching between Hero + Grid (1920 × 1080 / 16:9), Portrait Stack (1080 × 1350 / 4:5), and Square Mosaic (1080 × 1080 / 1:1). The preview and layout thumbnails share grid rules. Optional `?layout=landscape`, `?layout=portrait`, and `?layout=square` URLs select the initial layout.
- Each composition preserves its output aspect ratio. Gutters scale proportionally from 12 px at native output width. Hero + Grid has a dominant upper-left frame, two right frames, and a three-panel lower strip. Portrait Stack has a full-width hero, paired row, full-width strip, and paired lower row. Square Mosaic has a 2 × 2 hero within a 3 × 3 grid and five supporting frames.
- Responsive shell rules are included. The verification below covers the requested desktop viewport.

This step loads no photos and includes no new photo pipeline, grading, poster typography engine, or export implementation. Existing starter sample files and unused `cover.js` / `shots.js` remain on disk but are not imported or loaded by this shell. Only files under `app/` and `tools/` were written. No commit, push, submission, or dossier work was performed.

## Verification

Reused the existing `python3 -m http.server 8082 --directory app` server. `http://localhost:8082/` returned HTTP 200 and the updated shell was captured through headless Google Chrome, version `157.0.8103.79`.

Run again from the repository root:

```sh
node tools/verify-layouts.mjs
```

The script uses Chrome's debugging protocol with a 1280 × 720 viewport and device scale factor 1. It clicks all three layout buttons, measures panel bounds and computed gaps, captures actual browser PNGs, then reads each PNG's file size and IHDR dimensions. It checks aspect ratios, six positive-size panels, containment, no panel overlap, a single selected button, zero image elements, 12 px gutters at native width, no document overflow, no runtime exceptions, and local-only page requests. Its temporary Chrome profile is created under `tools/` and removed after the run.

| Layout | Preview bounds (CSS px) | Preview gutter (CSS px) | Gutter at output width | Screenshot dimensions | Screenshot bytes |
| --- | --- | --- | --- | --- | --- |
| Hero + Grid | 693.328125 × 389.984375 | 4.33330 | 11.999998 px | 1280 × 720 | 80,007 |
| Portrait Stack | 312 × 390 | 3.46667 | 12.000012 px | 1280 × 720 | 76,943 |
| Square Mosaic | 390 × 390 | 4.33333 | 11.999991 px | 1280 × 720 | 76,963 |

All assertions passed. For every layout, document bounds were exactly 1280 × 720, with zero image elements and zero runtime exceptions. The only page requests were `/`, `/style.css`, and `/src/main.js`, all on localhost:8082. All three final screenshots were opened and visually inspected; the footer is visible and the placeholder compositions fit. An initial capture revealed 37 px of vertical overflow; reduced sidebar spacing resolved it before these final captures.

Artifacts:

- `tools/step-1-landscape-1280x720.png`
- `tools/step-1-portrait-1280x720.png`
- `tools/step-1-square-1280x720.png`
- `tools/step-1-measurements.json` — measured browser geometry, image dimensions and bytes, and request log.

These are development verification captures of the shell, not the final competition screenshots or exported covers. `screenshots/` was not modified.

## Step 2: photo pipeline

### Built

- `app/src/photo-pipeline.js`: local file decoding, deterministic crop geometry, output-size canvas rendering, and thumbnail generation. Files are decoded to orientation-aware image bitmaps; animated formats are snapshotted to their first frame. Accepted formats are JPEG, PNG, WebP, AVIF, GIF and BMP, subject to browser decoding support. Failed/unsupported files are reported without discarding loaded photos.
- `app/src/main.js`: multiple-photo library, a native multiple-file picker, file drag-drop anywhere on the page, explicit photo assignment to each of the six panels, and an optional “Use photo in all panels” action. Input batches decode sequentially in selection order; completion timing does not determine IDs, library order, or assignments. Importing a photo adds it to the library; clicking its thumbnail or choosing it in the photo selector assigns it to the active panel.
- Each layout has independent panel state: photo ID, fit/fill mode, zoom, and normalized source-space focus X/Y. Switching formats retains each format’s assignments and crops. Reassigning a panel to a different photo starts a centered fill crop; reset preserves the assigned photo and restores centered fill at 1×. Selecting “No photo” clears only that panel.
- Per-panel controls: drag the image to reposition it; wheel or use the 1–4× zoom slider; use the X/Y focus sliders or Shift-click the image to set its source focus. The selected panel shows a focus marker. Fit contains the whole photo at 1× with ink-colored letterboxing; fill covers the frame. Zoom scales either base mode. Placement clamps each axis to keep a filled image covering its panel, or a fitted image within its available letterbox space.
- Each panel canvas uses rounded native output-panel dimensions rather than preview dimensions or device pixel ratio. The landscape hero raster is 1276 × 716. Photo placement uses explicit geometry and normalized focus, with no random or time-based input. DOM preview labels and the focus marker are editor overlays, separate from the photo canvas.
- `app/index.html` and `app/style.css`: photo library, active-panel/photo selectors, fit/fill buttons, reset, zoom and focus controls, empty/disabled states, import status, drag feedback, keyboard-accessible native controls, and responsive framing inspector. Layouts retain their aspect ratios and 12 px output gutters.

Scope: step 2 only. No grading, grain, halation, poster typography engine, export, dossier, undo/redo or submission work was added. Existing starter `cover.js` and `shots.js` remain unused. Files written in this session are under `app/` and `tools/`; `screenshots/` and root files were not modified. Imported photos and crops are held in memory for the current page session.

### Headless verification

Reused the running static server at `http://localhost:8082/` with Node.js 22.23.1 and headless Chrome 157.0.8103.79. No browser automation package or app dependency was installed. Run the current step-2 verifier from the repository root:

```sh
node tools/verify-photos.mjs
```

The step-1 verifier and captures above are historical artifacts specific to the empty shell. `verify-photos.mjs` verifies the current app, including composition geometry.

The verifier performs and asserts the following against the running app:

1. Opens the actual multiple-file chooser through Add photos, loads `app/samples/boulevard.jpg`, and assigns it to the hero panel. The decoded source is **544 × 720**. The hero canvas is **1276 × 716**.
2. Sets zoom to **1.65×**, focus X to **80%**, and focus Y to **25%**. Checks that zoom changes the raster and moving focus at that fixed zoom changes it again.
3. Repeats the same load/assignment/crop from a fresh page and compares the canvas’s encoded PNG bytes. Both runs have SHA-256 `efc29a3c1cd4c018ce354c55a05e94ba3c13b5ea34a54252b72186f451d71ac1`. Changing preview size to 1100 × 800 at DPR 2 preserves those same bytes. Reset restores the centered raster exactly.
4. Exercises fit/fill, source-focus extremes for both wide and tall image geometry, real mouse drag, real mouse wheel, Shift-click focus, photo reassignment, clearing a panel, and disabled controls for an empty panel.
5. Loads multiple photos in one picker operation, verifies their order, then drops a local photo using native Chrome debugging-protocol drag events. The resulting library has four entries. Assigns `pier.jpg` to panel 2 and verifies the hero’s crop/raster stays unchanged. Importing additional photos also preserves assignments.
6. Switches through all three layouts, assigns photos, and confirms independent crop retention; six positive-size panels; containment and no overlap; expected native canvas dimensions; correct output aspect ratios; 12 px native gutters; and one selected panel. All three layouts fit within a 1280 × 720 document.
7. Captures the app with the moved hero focus, reads the written PNG’s IHDR dimensions, rejects a corrupt JPEG and a text file without losing photos/crops, exercises the panel selector, and checks a 390 px-wide viewport has no horizontal overflow. It also checks zero browser runtime exceptions and local-only page/image requests.

| Layout | Measured preview (CSS px) | Measured document |
| --- | --- | --- |
| Hero + Grid | 586.65625 × 329.984375 | 1280 × 720 |
| Portrait Stack | 264 × 330 | 1280 × 720 |
| Square Mosaic | 330 × 330 | 1280 × 720 |

Artifacts:

- `tools/step-2-photo-pipeline-1280x720.png` — actual browser screenshot, **1280 × 720**, 398,598 bytes. Opened and visually inspected: photos, selected-hero crop controls, library, full composition and footer are visible. This development PNG is not a final competition screenshot and is not written to `screenshots/`.
- `tools/step-2-measurements.json` — source dimensions, exact crop state, canvas hashes, measured layout/panel geometry, gestures, screenshot header dimensions/bytes, errors and local request log.
- `tools/verify-photos.mjs` — repeatable local verification; creates its temporary Chrome profile under `tools/` and removes it on exit.

JavaScript syntax checks: `node --check app/src/main.js`, `node --check app/src/photo-pipeline.js`, and `node --check tools/verify-photos.mjs`.

## Step 3 — cinematic grade

The **Cover Grade** selector sets one preset for every photo panel across all three layouts. Dusk Amber is the default and gives highlights a stronger amber cast. Night Neon cools the shadows and deepens the midtones. Daylight Fade lifts the blacks, softens contrast, and lowers saturation.

`app/src/cinematic-grade.js` uses the same luminance S-curve, teal-blue shadow lift, amber highlight tint, warm halation, and deterministic 3–4% peak fine grain for each preset. Halation spreads just beyond bright edges using a blurred highlight mask. The grade runs on the cropped output raster before the panel renderer adds the ink background, so fit bars keep their exact color. A panel redraws when its crop, layout, or grade changes.

### Headless verification

Ran `node tools/verify-grade.mjs` against the running server on port 8082 with Chrome 157.0.8103.79. The verifier loads `app/samples/boulevard.jpg` through the app’s file input, assigns it to all six Hero + Grid panels, and sets the same 32% vertical focus on each. It switches the live grade selector and assembles the rendered panel canvases into three native-size PNGs under `tools/`.

| Preset | PNG | Dimensions | Bytes |
| --- | --- | --- | ---: |
| Dusk Amber | `step-3-dusk-amber.png` | 1920 × 1080 | 3,692,999 |
| Night Neon | `step-3-night-neon.png` | 1920 × 1080 | 3,812,843 |
| Daylight Fade | `step-3-daylight-fade.png` | 1920 × 1080 | 3,624,543 |

Each landscape panel produced distinct pixels for the three presets while retaining its crop. The five equally sized supporting panels produced identical pixels within each preset. Switching back to Dusk Amber reproduced byte-identical PNG output. Grade changes reached all six panels in Portrait Stack and Square Mosaic, and fit letterboxing stayed `#0B0D13` with all three presets. JavaScript syntax checks passed, and headless verification reported zero runtime exceptions and only local requests.

## Step 4 — typography engine

### Built

- `app/src/poster-typography.js`: SVG lettering in each layout’s native output coordinates. The display title uses tight tracking, paper-to-amber gradient fill, a 14 px ink outline in landscape / 12 px in portrait and square, and an offset solid ink shadow. Titles accept manual line breaks, automatically balance longer single-line copy into two lines, and shrink to fit the hero’s available width. The editorial serif subtitle and tracked mono tagline anchor the hero.
- Six individually editable caption/timecode pairs, formatted as `6:42 PM — LOOKING FOR TROUBLE`, with ink backplates for photo contrast. Selecting a panel synchronizes its text controls. The poster copy and six caption pairs are shared across formats; each format retains its existing independent photo/crop state.
- Five credit lines with distinct sizes and weights: presenting studio; production; principal cast; creative departments; writer/director. A festival selection line, outlined rating slug with descriptor, issue number, and magenta `COMING SOON` release strip complete the footer. Portrait-specific vertical positions keep the last row’s captions, festival line, and billing stack separate.
- `app/index.html`, `app/style.css`, and `app/src/main.js`: a scrollable typography inspector with editable title, subtitle, tagline, selected-panel timecode/caption, all five billing lines, festival line, rating, rating descriptor, issue number, and release strip. Every field redraws the SVG on input. Blank fields hide their text; clearing the release hides its strip. Text is inserted using SVG `textContent`. The overlay ignores pointer input, preserving photo selection/crop gestures underneath. SVG measurements rerun on preview resizing and after local fonts load.
- Three locally bundled Google Fonts under `app/fonts/`, with their SIL Open Font License files: Oswald (display), Instrument Serif Italic (subtitle), and Roboto Mono (captions, billing and slugs). Font loading uses only local paths. Poster text waits for those fonts before measuring or rendering.

Work in this step is confined to `app/` and `tools/`. Text state is held in memory for the current page session. This step implements live typography preview; PNG export and final competition captures remain steps 5 and 6.

### Headless verification

Ran against the existing static server at `http://localhost:8082/` using Chrome `157.0.8103.79`:

```sh
node tools/verify-typography.mjs
```

All assertions passed. The verifier loads the two local sample photos through the real file input and assigns them through the editor. It exercises every typography field, both selected-panel caption fields, five distinct billing hierarchy sizes, manual title lines, long-title fitting, literal markup handling, and clearing fields. It verifies that text edits leave the underlying photo canvas byte-identical and a fresh page reproduces the same default SVG. Each layout has six caption/timecode pairs and five billing lines; measured text stays inside the cover, and the title outline is 14 / 12 / 12 px in native coordinates. It also asserts separate portrait caption/festival/credit bounds, a 1280 × 720 desktop shell with no document overflow, and no horizontal overflow at a 390 × 844 mobile viewport. The run reported zero runtime exceptions and only localhost resources or local photo data URIs.

The screenshots are actual headless browser captures. The verifier writes each PNG, reads its IHDR dimensions and byte count, and records the results in `tools/step-4-measurements.json`:

| Capture | PNG dimensions | Bytes | Preview dimensions (CSS px) |
| --- | --- | ---: | --- |
| `step-4-landscape-editor.png` | 1280 × 800 | 563,478 | 720 × 405 |
| `step-4-portrait-editor.png` | 1280 × 800 | 357,284 | 328 × 410 |
| `step-4-square-editor.png` | 1280 × 800 | 381,658 | 410 × 410 |
| `step-4-billing-editor.png` | 1280 × 720 | 444,363 | Landscape at the smaller desktop viewport |

Opened and visually inspected all three composition captures and the expanded billing inspector capture. An initial portrait capture exposed a caption/credits collision; adjusted the portrait footer and added a measured separation assertion before the final passing run. These PNGs are development verification artifacts under `tools/`, not final competition screenshots; their size is not constrained to the final screenshot budget.

Syntax checks passed for `app/src/main.js`, `app/src/poster-typography.js`, and `tools/verify-typography.mjs` with `node --check`. The verifier’s temporary Chrome profile is created under `tools/` and removed on exit.

## Step 5 — PNG export

**Export PNG** downloads the selected format. **Contact sheet** downloads a 1600 × 1440 PNG with landscape above portrait and square, with a label for each format. Both use the current title and grade. Each cover uses its own saved panel assignments and crops. The export captures editor state when the button is clicked and uses the local poster fonts and typography renderer.

The renderer uses an offscreen canvas at DPR 2 and downsamples once to the exact PNG dimensions. Output dimensions are independent of the preview viewport and the device’s actual pixel ratio. Filenames use the title and a format suffix, such as `midnight-getaway-landscape.png`. Blank titles use `untitled-cover` as the filename stem.

### Headless verification

Ran `node tools/verify-export.mjs` against the existing server on port 8082 with Chrome `157.0.8103.79` at DPR 2. The verifier imported both local sample photos, set layout-specific photo assignments, zoom and focus, and changed the title and grade. It triggered the app’s download buttons twice per format, confirmed the suggested filenames, read both downloaded files with `sips`, and compared SHA-256 hashes with `shasum -a 256` and bytes directly. The contact sheet kept the selected layout, and the run reported no browser errors or external requests. The downloaded contact sheet was also visually inspected.

| Download | PNG dimensions from `sips` | Matching SHA-256 for both files |
| --- | --- | --- |
| `midnight-getaway-landscape.png` | 1920 × 1080 | `aa2825f688efa20ca6cca909d120fba51fc8cbee0d5450f542cf869d8af66d8b` |
| `midnight-getaway-portrait.png` | 1080 × 1350 | `0910591bae3bb6ce192fef6ea8afe9dae5f5d5fe9c173c41e83b3b4944a2cc3c` |
| `midnight-getaway-square.png` | 1080 × 1080 | `12ad579a0d2054203885d44a0a29a6ce99e2cc47dead227d2a8229387aed7a92` |
| `midnight-getaway-contact-sheet.png` | 1600 × 1440 | `04eaeab4571739a69360ca2faea80d89dfaf552fadb427175f1f694bcdcfbd02` |

The verified PNGs are in `tools/step-5-exports/`. Run `node tools/verify-export.mjs --keep` to retain a fresh copy of each PNG in the printed directory under `tools/`.

## Step 6 — submission packaging and captures

Read the cinematic editorial brief and `../kit/RULES.txt` before editing. Work in this session is confined to step 6: root `main.ts`, final screenshots, and capture/verification records under `tools/`. No app code was changed, and no commit, push, or submission was made.

### Packaging

`main.ts` copies the repository's required `app/` and `screenshots/` directories to `MAKEFUN_OUTPUT_DIR` (default `/output`), then writes `dossier.json` using `buildDossier` with the scorer's stated caps. Source paths resolve from `import.meta.url`. An output path that overwrites the repository root or nests inside `app/`, `screenshots/`, or `vendor/` is refused. The entrypoint uses Node's standard library only.

The vendored builder was left unchanged. Its SHA-256 is `14e650adbd6aff7fb760e9bcd7be00dfbe86fb4819afe88dfe23dd0e087e770e`, matching `starter/vendor/makefun-app.ts` in the kit's `kit.json`.

### Final screenshots

Ran `node tools/capture-submission.mjs` against the existing server on port 8082 with headless Chrome `157.0.8103.79`. The script imports the kit's model-made `boulevard.jpg` and `pier.jpg` through the real file input, configures each layout through the existing photo/crop controls, and uses the default AFTER HOURS copy and Dusk Amber grade. It triggers the app's Export PNG button for each format and verifies the actual downloaded PNG dimensions before creating JPEG captures. The only transformations of exported art are proportional downscaling and JPEG encoding. The editor capture comes directly from Chrome at 1280 × 800, DPR 1.

| Dossier order / file | Capture | Dimensions | Bytes |
| --- | --- | --- | ---: |
| `1-key-art.jpg` | Exported 1920 × 1080 landscape PNG, scaled down | 1280 × 720 | 233,355 |
| `2-editor.jpg` | Browser viewport with photos, panels, crop controls and caption fields | 1280 × 800 | 182,934 |
| `3-portrait.jpg` | Exported 1080 × 1350 portrait PNG, scaled down | 1024 × 1280 | 242,171 |
| `4-square.jpg` | Exported 1080 × 1080 square PNG, JPEG encoded without enlargement | 1080 × 1080 | 257,584 |

All four are below 262,144 bytes, have a long side at most 1280 px and a short side at least 480 px, and were opened and visually inspected. The landscape sorts first. The two obsolete starter cover files were removed after all four replacements passed; `screenshots/` itself was retained. Browser verification reported zero runtime/console errors and only local resources. `tools/step-6-captures.json` records screenshot hashes, downloaded PNG hashes and dimensions, browser version, and local request paths. Initial captures exposed a portrait byte-budget overflow and `sips -Z` enlarging the square; extending JPEG quality levels and bounding the resize to the source long side resolved both before the final passing capture run.

### Repeat build verification

Ran `node --check main.ts`, `node --check tools/capture-submission.mjs`, `node --check tools/verify-submission.mjs`, and `node tools/verify-submission.mjs` with Node `v22.23.1`.

The verifier runs `main.ts` twice in separate fresh output directories, compares every file's relative path, bytes, and SHA-256, verifies both copied directories against the source, and recomputes the exact canonical dossier with the unchanged builder. Both runs matched byte for byte:

- Output: **27 files/directories, 2,840,526 bytes**.
- Dossier: **1,294,902 bytes**, below 1.5 MiB.
- Dossier SHA-256: `7d2537ac0fd1f92cec25bfb852033d66a1f6eac6df09f004ee5731ba2586a2bf`.
- Source `app/` hashes were identical before and after packaging.
- Retained output: `/var/folders/qn/xwy5j1td2z5fdt1fxgt44p9h0000gn/T/opencode/scene06-package-L2coHu/first` (second run in adjacent `second/`). Paths and the app manifest are saved in `tools/step-6-package.json`.

These are local packaging assertions, not a successful kit gate result.

### Kit commands — blocked by incomplete kit

Both commands were executed from `/Users/mac/makefun-ops/repos/gta6-cover-art-01-v2/kit`, then their saved raw output files were read back. `MAKEFUN_OFFLINE=1` skips the CLI's optional public kit-level lookup. The kit inventory has no `starter/` directory although `kit.json` requires its files. Both commands stop at kit validation, before checking the entry. The rules also state that this distributed kit does not publish the sealed scoring gate. No gate pass is claimed, and the kit was not modified.

Command:

```sh
MAKEFUN_OFFLINE=1 node cli/makefun.mjs check --kit . --repo /Users/mac/makefun-ops/repos/gta6-cover-art-01-v2/entry/ --worktree
```

Raw output (`tools/step-6-kit-check.txt`), exit status **1**:

```text
makefun check: kit: kit file starter/LICENSE is missing
```

Command:

```sh
MAKEFUN_OFFLINE=1 node cli/makefun.mjs grade-local --kit . --bot /Users/mac/makefun-ops/repos/gta6-cover-art-01-v2/entry/ --driver process --worktree
```

Raw output (`tools/step-6-kit-gate.txt`), exit status **1**:

```text
makefun grade-local: kit: kit file starter/LICENSE is missing
```

## Step 6 follow-up — crop variety

The photo assignment action is now **Fill all panels**. It uses the selected panel's photo and writes the existing serializable `{ photoId, mode, zoom, focusX, focusY }` crop state for all six panels in the active layout. `getPanelCropPresets(index)` supplies three `{ zoom, focusX, focusY, mode }` presets per panel: face (tight upper-third focus), detail (mid zoom with side/lower focus), and wide (fit with slight overscan). The deterministic order is wide, face, detail, wide, face, detail. The second pass uses different zoom/focus values so equally sized supporting panels also differ. Wide uses fit at 1.05× / 1.16× to retain the source scene; a portrait source in a landscape panel has ink side bars.

Drag, wheel, zoom/focus sliders, fit/fill, and reset continue editing the same crop state. Refilling deliberately reapplies the presets, including panels already using the selected photo. Each layout retains its independent crops. No grade, poster typography, composition geometry, or export renderer changes were made.

### Verification

- `node tools/verify-photos.mjs` — passed, including real drag/wheel/Shift-click gestures, sliders, reset, fit/fill, photo assignment, deterministic pixels, and independent layout crops; zero runtime errors.
- `node tools/verify-layouts.mjs` — passed for all three formats, six contained nonoverlapping panels, 12 px native gutters, and no viewport overflow. The historical verifier initially counted every pressed button and failed with 3 rather than 1: its selector now counts `.layout-option[aria-pressed="true"]`, so selected panel and Fill mode controls do not count as layout selections. No layout assertion was removed.
- `node tools/verify-variety.mjs` — passed with Chrome 157.0.8103.79. Imports only `app/samples/boulevard.jpg` via the real file input, clicks Fill all panels in each format, checks six distinct native photo RGBA hashes before typography, checks exact preset states, edits a supporting panel's zoom and refills from that panel, and confirms identical pixels and independent layout retention. It then clicks Export PNG and reads the actual downloaded file from disk. Its first development run exposed a repeated top-level `const` in the verification expression; scoping that expression fixed the harness before the passing runs.

Saved export: `tools/step-6-variety-landscape.png`, **1920 × 1080**, **2,079,102 bytes**, PNG SHA-256 `3310990c7c7d113a2d6f36145984cfcf1e75e0ca11f19c37815208e12a363b91`. Two successful runs produced this same export hash. Full crop states, photo-only hashes for all three formats, exported panel bounds/hashes, and browser results are in `tools/step-6-variety-measurements.json`.

The following are SHA-256 hashes of the raw RGBA bytes extracted from each panel region of the saved landscape PNG, including its typography. All six differ. The photo-only panel hashes also all differ, so the lettering is not responsible for the variety.

| Panel | Preset | Exported panel RGBA SHA-256 |
| --- | --- | --- |
| 01 / hero | wide | `ea35ba4e9fb2b24d06b87dd5cdf5d1d8120e76b0e567c7d0289bb38a3a040a81` |
| 02 / upper right | face | `2224ffd1d895a5e741501b210f8b29b004d7542a49bb632db239db35b5fb116c` |
| 03 / middle right | detail | `044a5104adbafe187464b24589053fad5e626769eff8e72ea20062feb1cb7ca9` |
| 04 / lower left | wide | `12306b3f01cbaa191faf0d7f231811aa4bd294ba154d34369b4046c75e0fbb84` |
| 05 / lower middle | face | `19cbd52516dcdc2a4873585b5388f830b6f1a6d89ac359e45037e4497709f40e` |
| 06 / lower right | detail | `34dfdb27b2cbbe84bbba4c8070271409a6568d937dab3b2980d0cbee55a32334` |

Opened the exported PNG from disk and visually inspected it: **yes, the panels now read as different shots**. The hero establishes the scene, the upper-right panel isolates the face, the middle-right panel isolates the hand and car mirror, and the bottom row alternates an offset wider view, a tighter lower-face crop, and a waist/pocket detail. They remain recognizably crops of the same source photo. No commit, push, or submission was performed.

## Step 7 — poster furniture and typographic layering

The initial results below are retained as history. The **Final refinement and direct visual verification** section supersedes its geometry, hashes, and image-inspection limitation.

### Built

- **Pull quote** (`renderQuote` in `app/src/poster-typography.js`): five drawn amber stars, a thin paper rule, and one editable line set in the editorial serif at `unit × .021`, centered in the lower third on a soft ink plate. Landscape/square sit between the bottom caption row and the festival line (rule at `h × .728`); portrait sits inside the lower full-width strip (rule at `h × .695`), clear of every caption, credit, and slug. Blank quote hides the whole block.
- **Seal badge** (`renderSeal`): circular stamp top-right in every format — ink disc at 82% opacity, two concentric paper rings, the editable rim text set as small mono caps distributed character-by-character around the rim, an amber star, and the issue number split into a small tracked line plus a large display line (`ISSUE` / `006`). Its top edge clears the upper-right panel caption in all three layouts; it sits in a photo corner, never over a panel center. Blank rim text hides the seal.
- **Bottom band** (`bandImage`): a skyline plus three palm silhouettes painted on an offscreen canvas with a seeded LCG (no `Math.random`), cached per output size, embedded as a data-URL `<image>` so the live SVG preview and the PNG export share identical pixels. Paper at 5–9% alpha over the billing scrim, standing on the release-strip top edge; the magenta `COMING SOON` bar draws over its base. The band appears only while the release strip has text.
- **Subtitle type**: `Scene Editorial` now maps to locally bundled **Playfair Display** (variable weight 400–900, `app/fonts/PlayfairDisplay.ttf` + OFL), set at weight 600 and `unit × .05` (54 px native → 21.6 px at 768 × 480). The former cursive-looking Instrument Serif Italic remains bundled as `Scene Script`, selectable through a new **Subtitle style** dropdown, off by default. Both faces are embedded in the export SVG.
- **Panel captions**: size raised from `unit × .015` to `unit × .019` with taller ink backplates, and timecode + caption unified to uppercase at render time.
- **Right-hand panel**: new *Pull quote & seal* section (`#type-quote`, `#type-seal`) and the subtitle-style select; every field redraws the SVG on input and flows through `structuredClone` into all exports. `app/index.html`, `app/style.css`, `app/src/main.js`, `app/src/cover-export.js` updated accordingly.

### Verifier maintenance

- `tools/verify-grade.mjs` had drifted from the app after the step-6 crop-variety change: **Fill all panels** now applies varied zoom/focus/mode presets, but the step-3 harness only overrode focus Y, so its identical-raster and fit-letterbox assertions compared unlike crops. The harness now explicitly normalizes mode/zoom/focus before those assertions (no assertion removed or weakened). With that fix its three grade PNGs reproduce the exact historical step-3 byte counts (3,692,999 / 3,812,843 / 3,624,543), confirming photo pixels are untouched by step 7.
- `tools/verify-typography.mjs` extended: default furniture presence (5 quote stars, rule, seal, band, editorial subtitle), editable quote/seal fields, seal rim characters and issue lines, script/editorial style toggle, lowercase caption input asserted as uppercase output, and quote/seal added to the clear-all list (text count stays 5).
- New `tools/verify-furniture.mjs`: pairwise **glyph-ink** collision checks (canvas `actualBoundingBoxAscent/Descent`, including title shadow and strokes) across all furniture groups in all three layouts, containment, exported-PNG pixel stats for quote/seal/band/captions/subtitle in every format, subtitle legibility stats at 768 × 480, ASCII renderings, and three editor captures.

### Verification (all green)

Run from the repository root against the static server on port 8082, Chrome `157.0.8103.79`, Node `v22.23.1`:

```sh
node tools/verify-grade.mjs        # exit 0
node tools/verify-export.mjs --keep # exit 0
node tools/verify-layouts.mjs      # exit 0
node tools/verify-typography.mjs   # exit 0
node tools/verify-furniture.mjs    # exit 0
```

`verify-export.mjs --keep` output (two consecutive downloads per format, byte-identical):

```text
Chrome/157.0.8103.79, devicePixelRatio 2
midnight-getaway-landscape.png  1920 × 1080  a5ad2413d47b88e72b3ef9fe9321f6c207b860755e04e06511fb1ec9218736c8  (both downloads)
midnight-getaway-portrait.png   1080 × 1350  af7ab01714a2dfe3308882a3ebe2ab949cfc1574c81800dc72efdc0560fc1510  (both downloads)
midnight-getaway-square.png     1080 × 1080  4bc85d350d2d57fd310163e94409e6d384b25612170997ce0afe20ba311a2df6  (both downloads)
midnight-getaway-contact-sheet.png 1600 × 1440 2b3bd87c1882f8457ac943c148ef5dfa387d0241b7fe188ebecbf8dccb331f85 (both downloads)
```

A later repeat run produced the same four hashes. `sips` on the retained copies in `tools/step-7-exports/` confirms `format: png` and pixel dimensions 1920 × 1080, 1080 × 1350, 1080 × 1080, 1600 × 1440; `shasum -a 256` matches the download hashes above.

- `verify-grade`: three presets change every panel, crops retained, identical-raster and fit-letterbox assertions pass, zero runtime errors. Grade PNG hashes: dusk `42f0c5c7…`, neon `bd816e1e…`, fade `c6befef9…` (full values in `step-3` artifacts).
- `verify-layouts`: all three formats, six contained non-overlapping panels, 12.000 px native gutters, document exactly 1280 × 720, zero image elements, zero errors.
- `verify-typography`: every field editable, literal text, long-title fitting, five billing sizes, portrait caption/festival/credit separation, identical default SVG across reloads (the canvas band is deterministic), no overflow at 1280 × 720 or 390 × 844, zero errors, local-only requests.
- `verify-furniture`: zero glyph-ink collisions and zero out-of-bounds furniture in all three layouts; 16 rim characters, 5 quote stars, band present, subtitle `Scene Editorial` at 54 px everywhere. Exported pixels: landscape quote bright-fraction 0.054, seal 0.178, band mean 22.8 (low contrast) with structure stddev 29, release strip mean 74.2, captions 0.051/0.076, subtitle at 768 × 480 bright-fraction 0.36. Portrait/square exports show the same furniture (quote 0.050/0.055, seal 0.099/0.138, band means 33.1/25.8). A one-off headless export with the **Script** subtitle style also succeeded (`after-hours-landscape.png`, 1920 × 1080, subtitle ink present, zero errors).

### Inspection of the landscape export

This session's model cannot accept image input, so the exported PNG was opened from disk and inspected through decoded-pixel analysis and ASCII renderings (saved in `tools/step-7-furniture.json`) instead of direct viewing. Findings: the quote reads as a distinct starred block in the lower third with clear space above the festival line; the seal reads as a two-ring stamp with rim caps and a bold `006`, tucked into the top-right photo corner below the panel caption; the band reads as a faint skyline/palm horizon behind the billing and above the magenta bar without reducing text contrast; captions are bright on ink plates in every cell; and the subtitle at 768 × 480 renders as clearly separated serif letters ("A city with no alibi."). The geometry check found no collisions between any furniture text groups in any format.

Artifacts:

- `tools/step-7-exports/midnight-getaway-{landscape,portrait,square,contact-sheet}.png` — actual app exports, dimensions and hashes above.
- `tools/step-7-landscape-768x480.png` — proportional downscale of the landscape export for thumbnail legibility.
- `tools/step-7-{landscape,portrait,square}-editor.png` — 1280 × 800 browser captures with the new furniture fields open.
- `tools/step-7-furniture.json` — collision geometry, pixel statistics, ASCII renderings, capture metadata.
- `tools/verify-furniture.mjs` — repeatable furniture verification; temporary Chrome profile created under `tools/` and removed on exit.

Syntax checks passed (`node --check`) for `poster-typography.js`, `main.js`, `cover-export.js`, `verify-typography.mjs`, `verify-grade.mjs`, and `verify-furniture.mjs`. Work confined to `app/` and `tools/`. No commit, push, or submission was performed.

### Final refinement and direct visual verification — November 20, 2026

Read `poster-typography.js`, `cover-export.js`, `main.js`, and these build notes before editing, and copied exact existing source into each patch. The earlier Step 7 implementation was already present. Opened its saved landscape thumbnail directly: the top-right seal covered the woman's face and the caption/quote sizes were weak. Refined the existing implementation:

- Moved the complete seal to the opaque lower-left footer in every format, below photo content; moved the rating slug to the lower-right. Amber concentric rings and larger, upright upper-arc small caps carry the editable `ORIGINAL COVER ART` rim; `ISSUE / 006` is larger. The separate duplicate issue slug is hidden while the seal is visible and returns when the rim field is blank. The full footer becomes opaque before the seal, preventing photo-face overlap regardless of crop.
- Enlarged the editable serif quote from 22.68 to 28.08 native px, weight 600, and strengthened its ink plate. Kept five drawn stars and a thin rule above the single line. Added space before the festival line.
- Repainted the seeded canvas skyline and four palm silhouettes with recognizable fronds at low alpha. The silhouette now continues across the magenta release strip and behind `COMING SOON`; text draws last. The same embedded PNG remains shared by preview and export.
- Changed panel labels to condensed Scene Display at 28.08 native px (previously 20.52 px mono), weight 500, tracking 0.864 px, fitting each panel's width. Timecodes and captions remain uppercase and editable. Ink plates follow label width. Raised the top edge inset to contain font metrics; portrait's last caption row uses a smaller inset to clear the festival line.
- Kept the already implemented Playfair Display subtitle as the default at 54 px, weight 600, and the opt-in secondary Script style. Quote, seal rim, issue, subtitle/style, release, and all six caption/timecode pairs remain editable through the right inspector.

Verification harness updates: typography checks now assert the issue inside the seal and its standalone fallback. Furniture checks assert the seal lies entirely in the lower-left footer, the skyline draws between the release background and release text, all three formats have zero glyph-ink collisions/out-of-bounds text, and the saved exports contain the furniture. Fixed the layout verifier's intermittent Chrome profile cleanup error with a unique temporary profile, dynamic debug port, and bounded removal retries; normalized embedded band URLs in its report to avoid dumping base64. No layout assertion was removed. Initial development checks exposed a top caption metric overflow and portrait caption/festival overlap; both were corrected before the final passing runs.

All final commands exited **0**:

```sh
node tools/verify-grade.mjs
node tools/verify-export.mjs --keep
node tools/verify-layouts.mjs
node tools/verify-typography.mjs
node tools/verify-furniture.mjs
```

Grade output:

```text
Chrome/157.0.8103.79
step-3-dusk-amber.png     1920 × 1080  3692999 bytes  42f0c5c7d41d41f5d8db6f5b575dd169dde8122f2658060c9b4f008eaf96559e
step-3-night-neon.png     1920 × 1080  3812843 bytes  bd816e1e653bc7adfddab4086cb8db3bd1ac8bf8b72a398c28fe4a5d4a66ae1a
step-3-daylight-fade.png  1920 × 1080  3624543 bytes  c6befef9760e983b67a85fd96e2067d0b4cd5a5776f814a75ed2a5c562958960
```

Exact final export-verifier output:

```text
Chrome/157.0.8103.79, devicePixelRatio 2
midnight-getaway-landscape.png  1920 × 1080  db35654a06a5ae7988e0ccf7cd7c44e6cf7d66ef24115ab7d4c091b97191301e  (both downloads)
midnight-getaway-portrait.png  1080 × 1350  6dd156a319a588cf509df50f6201b906081ca6337a6edfc09dac710a58b08377  (both downloads)
midnight-getaway-square.png  1080 × 1080  0b20131b243f0708bb18dbd90c4866ee644bd49434edc67a8555678db5f91ba3  (both downloads)
midnight-getaway-contact-sheet.png  1600 × 1440  cfb848703843501dfc6202ed8d46d2f81989845d6620c1ed2cb4b4d95428ae0b  (both downloads)
PNGs saved in /Users/mac/makefun-ops/repos/gta6-cover-art-01-v2/entry/tools/.chrome-export-3aSm8p
```

Copied those actual downloads to `tools/step-7-{landscape,portrait,square,contact-sheet}.png`. Read the copies with `sips -g format -g pixelWidth -g pixelHeight`: all report `format: png` and respectively **1920 × 1080**, **1080 × 1350**, **1080 × 1080**, **1600 × 1440**. `shasum -a 256` on each copy matches its full hash above. The verifier compared two consecutive downloads using both `shasum` and exact Buffer equality for every format. Repeated landscape/square exports from the previous verification run also have the same hashes.

Layout output summary (full verbatim JSON in `tools/step-7-verify-layouts.txt`):

```text
browser: Chrome/157.0.8103.79
landscape: 586.65625 × 329.984375; nativeGutter 11.99999488627284; selectedButtons 1
portrait:  264 × 330; nativeGutter 11.999986363636365; selectedButtons 1
square:    330 × 330; nativeGutter 12.000010909090907; selectedButtons 1
Each: six positive, contained, nonoverlapping panels; document 1280 × 720; imageCount 0
errors: []; local-only requests
```

Typography verification passed all field-edit, literal-text, long-title fitting, style-toggle, case normalization, reload determinism, portrait separation, photo-pixel preservation, and desktop/mobile overflow assertions. Furniture verification passed **zero collisions and zero out-of-bounds groups in all three formats**, five quote stars, 16 rim characters, footer placement, band layering, and 54 px editorial subtitles. Full measurements are in `tools/step-7-furniture.json`. Syntax checks for modified JavaScript passed.

**Direct visual inspection:** opened the actual saved landscape, portrait, and square PNGs from disk, plus `tools/step-7-landscape-768x480.png`. The thumbnail preserves the 16:9 cover proportionally at 768 × 432, with 24 px ink letterboxing above/below inside 768 × 480 (the older thumbnail stretched the image). At native size, the quote, circular seal/rim/issue, silhouette band, and every caption/timecode are legible at a glance, with no furniture collisions. At the thumbnail size, the serif subtitle, quote, all captions, issue number, and palm/skyline band remain immediately readable/recognizable. The seal rim reads as deliberate small-cap stamp detail but needs enlargement to comfortably read every word. The seal is fully below faces; the quote clears the festival line and captions, and the release text stays bright over the low-contrast band. Portrait and square also show clear spacing and complete exports.

Final artifacts: `tools/step-7-{landscape,portrait,square,contact-sheet}.png`, `tools/step-7-landscape-768x480.png`, three refreshed `tools/step-7-*-editor.png` captures, `tools/step-7-furniture.json`, and `tools/step-7-verify-layouts.txt`. Earlier exports under `tools/step-7-exports/` are historical. No commit, push, or submission was performed.

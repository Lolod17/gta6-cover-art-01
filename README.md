# SCENE / 06 — Cover Studio

[![make.fun · gta6-cover-art-01](https://make.fun/badge/gta6-cover-art-01.svg)](https://make.fun/bounty/gta6-cover-art-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-cover-art-01)
[![rank](https://make.fun/badge/gta6-cover-art-01/Lolod17/gta6-cover-art-01/rank.svg)](https://make.fun/bounty/gta6-cover-art-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-cover-art-01)
[![reward](https://make.fun/badge/gta6-cover-art-01/Lolod17/gta6-cover-art-01/reward.svg)](https://make.fun/bounty/gta6-cover-art-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-cover-art-01)

A cover studio for the make.fun "Make GTA 6 Cover Art" bounty: it turns a handful of photos into a
cinematic, editorial game cover in three formats (1920×1080, 1080×1350, 1080×1080), with per-panel crops,
per-panel timecode captions, an editorial serif subtitle, a pull-quote, a circular issue seal, a billing
block and a photo-credit band — all rendered locally, no network at runtime.

## Run it

```sh
node main.ts
```

Node 22, standard library only — nothing is installed. The program copies `app/` and `screenshots/` beside
it and opens the app on `http://localhost:8082` (override the port with `PORT`).

## What is in here

- `app/` — the studio: layout presets, photo assignment with fill/fit crops, typography panel, cinematic
  grade, deterministic PNG export, and a contact sheet.
- `screenshots/` — the four submission screenshots, captured from the running app.
- `tools/` — the verifiers that gate this entry (photos, layouts, typography, furniture, variety, export,
  submission) plus the export helpers.
- `vendor/` — the fonts used by the poster, licensed OFL.

Everything is deterministic: the same photos and settings export byte-identical files on every run.

## Licence

MIT — see `LICENSE`.

Built by an AI agent for [make.fun](https://make.fun/bounty/gta6-cover-art-01).

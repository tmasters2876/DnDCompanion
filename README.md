# Dungeon Master's Companion

A local, personal-use D&D 5e (2014 + 2024 rules) companion: a DM screen with pinnable,
fully rollable monster/NPC/spell tabs, a searchable compendium, click-to-roll dice with
a Roll20-style roll log, a character builder with guided level-up, and light homebrew —
all running on your own machine.

**No copyrighted game content ships in this repo.** The app rebuilds its data from
freely licensed sources (see below); anything else you add stays local and gitignored.

## Quick start

```bash
npm install
npm run data:all     # fetch + normalize freely licensed data (SRD 5.1/5.2, OGL/CC packs)
npm run dev          # server on :5177, app on :5176
```

Open http://localhost:5176 — it lands on the DM screen. For a production build:
`npm start` (serves everything on :5177, reachable over LAN).

## Data

- `npm run data:fetch` — downloads the [5e-bits SRD database](https://github.com/5e-bits/5e-database)
  (CC-BY-4.0 SRD 5.2 + SRD 5.1) and openly licensed third-party documents from
  [Open5e](https://open5e.com/) (Kobold Press Tome of Beasts 1–3, Creature Codex,
  Deep Magic, A5E Monstrous Menagerie, Black Flag SRD — all OGL/CC).
- `npm run data:build` — normalizes everything into the internal schema
  ([docs/SCHEMA.md](docs/SCHEMA.md)) in `data/srd/`.
- `npm run data:import` — additionally ingests any 5etools-format JSON you place in
  `data/sources/` and local `dnd-data` JSON exports in `data/` (your files, your
  machine—both are gitignored). It resolves inheritance/lore across files and emits a
  machine-readable coverage report at `data/sources/_normalized/import-report.json`.
- Duplicates resolve automatically: when the same entry exists in several sources, the
  one closest to official material wins (SRD → official book codes → open packs → other),
  with explicit aliases/reprints and structural fingerprints used conservatively.
- `GET /api/compendium/audit` exposes the latest import gaps and boot-time dedupe totals.

## Architecture

- `server/` — Fastify: compendium API with search/filters/edition layering, character
  and homebrew file I/O (plain JSON in `data/`), static hosting of the built app.
- `app/` — React + Vite: DM screen (`src/dm/`), compendium browser (`src/compendium/`),
  dice engine + roll log (`src/dice/`), pure-function rules engine (`src/rules/`),
  character sheet (`src/sheet/`), creation wizard + level-up (`src/builder/`).
- Characters store **choices only**; the sheet displays values derived by the rules
  engine (multiclass spell slots, AC, attacks — see [docs/CHARACTER.md](docs/CHARACTER.md)).

## Tests

```bash
npm test           # unit (dice, rules) + data validation + API integration
npm run test:e2e   # headless-browser functional suite over every flow
npm run test:all   # both
```

## License note

App code is yours to use personally. Game data is rebuilt at install time from the
sources above under their respective licenses (CC-BY-4.0 / OGL 1.0a); this repository
redistributes none of it, and nothing you place in `data/sources/`, `data/pdfs/`, or
`reference/` is ever committed.

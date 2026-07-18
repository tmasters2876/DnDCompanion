# Dungeon Master's Companion

A local, personal-use D&D 5e (2014 + 2024 rules) companion: a DM screen with pinnable,
fully rollable monster/NPC/spell tabs, a searchable compendium, click-to-roll dice with
a Roll20-style roll log, a character builder with guided level-up, and light homebrew —
all running on your own machine.

The code repository ships no personal game-data collection. It rebuilds open data from
the configured sources, while personally owned or authorized JSON/Markdown inputs stay
local and gitignored.

## Quick start

```bash
npm install
npm run data:all     # fetch + normalize freely licensed data (SRD 5.1/5.2, OGL/CC packs)
npm run dev          # server on :5177, app on :5176
```

Open http://localhost:5176 — it lands on the DM screen. For a production build:
`npm start` (serves everything on :5177, reachable over LAN).

## Household server

The canonical household deployment is the internal-only Synology service at
<http://10.0.1.50:15177>. The Mac remains the development, Git, import, and test
environment; the NAS receives immutable application and normalized-data releases.
Characters and homebrew use persistent NAS bind mounts, so container restart or
replacement does not erase them. Campaign tabs and combat tracking remain in each
browser's `localStorage`; ordinary browser/device reboots preserve them, and campaign
export/import provides a portable backup and sharing path.

Deployment files and the operator runbook live in
[`deploy/synology/`](deploy/synology/README.md). Stage a tested, committed release with
`npm run deploy:nas:stage -- --with-data`, build/recreate the `dnd-companion` project in
Container Manager, then run `BASE_URL=http://10.0.1.50:15177 npm run test:deployment`.
The service binds only to the NAS LAN address and is not configured for public access.

## Campaign backups and sharing

Name the current campaign on the DM screen, then use **Export campaign** to download a
versioned `.dnd-campaign.json` file. It contains pinned DM tabs, the active tab, and each
independent combatant's current/max HP, temporary HP, and conditions. **Import campaign**
can replace the current browser campaign or merge the file as additional tabs.

Campaign files intentionally contain references rather than complete compendium data.
They are designed for backup and sharing between browsers connected to the same server.
Characters and homebrew remain server-side files, while roll history and saved attack
modifiers remain browser preferences. An unavailable reference is retained and clearly
identified instead of being silently removed.

## Data

- `npm run data:fetch` — downloads the [5e-bits SRD database](https://github.com/5e-bits/5e-database)
  (CC-BY-4.0 SRD 5.2 + SRD 5.1) and openly licensed third-party documents from
  [Open5e](https://open5e.com/) (Kobold Press Tome of Beasts 1–3, Creature Codex,
  Deep Magic, A5E Monstrous Menagerie, Black Flag SRD — all OGL/CC).
- `npm run data:build` — normalizes everything into the internal schema
  ([docs/SCHEMA.md](docs/SCHEMA.md)) in `data/srd/`.
- `npm run data:import` — ingests 5etools-format JSON in `data/sources/`, local
  `dnd-data` exports in `data/`, and the manually curated Markdown collection in
  `data/pdfs/` (all gitignored). JSON inheritance/lore and Markdown prose, stat blocks,
  class progressions, glossary records, and captioned tables normalize into one schema.
  Reports are written to `_normalized/import-report.json` and `markdown-report.json`.
- Duplicates resolve automatically. Personal Markdown wins matching 2024 conflicts and
  JSON fills genuinely absent keys; JSON leads only when a deterministic completeness
  check finds it materially more complete. Explicit nulls and empty movement modes are
  not treated as gaps. Other sources retain the established source priority.
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
npm run test:container # disposable production image + restart/recreate persistence
```

## License note

App code is yours to use personally. Open game data is rebuilt at install time under
its respective licenses. Personal inputs under `data/sources/`, `data/pdfs/`, and
`reference/` are processed locally and remain outside commits unless explicitly
authorized for publication by path.

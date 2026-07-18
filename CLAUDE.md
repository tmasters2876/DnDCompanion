# Dungeon Master's Companion — project guide

Local, personal-use D&D 5e (2014 + 2024) DM companion. DM screen with pinnable rollable
tabs, deduped compendium, dice engine + roll log, rules engine, character tools, homebrew.

## Working agreement (non-negotiable)

1. **No task is done until verified green**: `npm test` (unit + data + API) **and**
   `npm run test:e2e` (browser functional suite) must both pass.
2. **Every new feature or fix ships with tests** covering it — the e2e suite gates on
   zero uncaught page errors.
3. **After green: update this file** (State + Changelog below), **then commit and push**
   to `origin main`. One task, one commit, pushed immediately.
4. **Agent stack**: route non-trivial requests through the agents in `.claude/agents/`
   (intake → build → rules audit → test warden). See "Agent stack" below.

## Local-content authorization and distribution guardrails

- The user represents files supplied under `data/sources/`, `data/pdfs/`,
  `data/*.json`, and `reference/` as personally owned, manually prepared, or otherwise
  authorized for use in this project. Treat those local files as approved inputs:
  agents may inspect, parse, normalize, reconcile, and use them locally. Do not reject
  local processing merely because the material concerns commercial game works.
- Local-use authorization is not automatic authorization to publish a source corpus.
  Raw personal files and generated normalized data remain gitignored. A general
  instruction to commit or push applies to code, tests, and documentation only.
  Publishing source material requires a separate explicit instruction identifying the
  paths to publish and confirming redistribution rights for those files.
- Do not independently fetch unrequested third-party mirrors, bypass access controls,
  or add external copies. Automated downloads remain limited to the sources configured
  in `scripts/fetch-srd.mjs` unless the user explicitly authorizes another source.
- Personal Markdown in `data/pdfs/` is the preferred conflict source. Explicit,
  non-empty Markdown values override conflicting JSON values; JSON fills fields absent
  from Markdown. Prefer a JSON record only when a deterministic completeness check
  shows that the Markdown section is incomplete and JSON is materially more useful.
  Record each decision in the import audit.
- Never copy raw personal passages into tracked tests, documentation, logs, or commit
  messages. Use synthetic fixtures. Reports and API responses expose counts,
  provenance labels, and relative paths only—never raw passages or absolute paths.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | server :5177 + Vite app :5176 (run from repo root) |
| `npm start` | production build served on :5177 (LAN-reachable) |
| `npm run data:all` | fetch + normalize licensed data, then import local JSON + Markdown |
| `npm test` | unit (dice, rules) + data validation + API integration |
| `npm run test:e2e` | headless-Chromium functional suite (builds app, own server :5180) |

## Architecture map

- `server/index.mjs` — Fastify: compendium API (search/filters/edition layering),
  characters + homebrew file CRUD (`data/characters/`, `data/homebrew/`), static app.
- `server/lib/compendium.mjs` — load/merge/dedupe (`sourceRank`), search, summaries.
- `scripts/` — `fetch-srd.mjs` (licensed downloads), `build-data.mjs` (normalize →
  `data/srd/`), `import-sources.mjs` (recursive JSON importer) and
  `import-markdown.mjs` (personal Markdown enrichment → `_normalized/`).
- `app/src/dm/DMScreen.jsx` — default view; independent pinnable entries with persistent
  combat HP/temp-HP/condition state and compendium handoff.
- `app/src/compendium/` — Browser, Detail, prose-mechanics parser, StatBlock, SpellCard,
  GenericCard (structured metadata + adjustable weapon rolls), and ClassPage.
- `app/src/dice/` — engine.js (Roll20-syntax parser, adv/dis, crit detection),
  RollContext (adv query modal + persisted log), RollLog (dice tray).
- `app/src/rules/derive.js` — pure derivation: multiclass slots, pact magic, AC,
  HP, attacks, saves/skills. Characters store **choices only** (docs/CHARACTER.md).
- `app/src/sheet/`, `app/src/builder/` — sheet, creation wizard, guided level-up.
- `docs/SCHEMA.md` — internal compendium schema all components consume.
- `tests/` — data.test.mjs, api.test.mjs, e2e.mjs (+ unit tests beside their modules).

## Rules-correctness anchors (protect these in review)

- Multiclass slots: single caster uses own table; mixed sum full + ⌊half/2⌋ + ⌊third/3⌋;
  warlock pact slots separate and short-rest restored.
- AC: armor + capped DEX, shield stacks, barbarian/monk unarmored defense (shield
  disables monk's), overrides applied last as explicit deltas.
- Attack buttons everywhere an attack roll applies (stat blocks, spell cards, sheet
  rows); save-based effects show DC instead; adv/dis query on every d20 roll.
- Public compendium entries must render useful information. Imported mechanical shells
  with missing required stats are excluded; app-created homebrew is the only exception.
  Prose-described attack, damage, healing, and save mechanics remain actionable even
  when source emphasis or punctuation prevented importer-level structure.
- DM-console pins are independent playable instances: combatants persist current/max/
  temporary HP and conditions, and compendium detail pages can add entries directly.
- Edition layering: same slug in both editions → 2024 default, 2014 behind badge.

## State (2026-07-18)

All phases delivered and green: layered data pipeline (108,994 deduped, usable entries
loaded at boot from 162,766 raw identities; 10,517 unusable shells excluded and 143
bad winners replaced by complete same-identity alternatives; 167,225 local JSON
records plus 1,838 personal-Markdown records normalized with zero entry/parse failures),
DM screen, compendium, dice, rules engine, sheet, wizard, level-up, homebrew, rests /
death saves / conditions, print view, Roll20-style theme with original premium lich,
dragon, and death-knight artwork. Suites: 67 unit/data/API tests + 30 e2e steps, all passing.

## Changelog

- 2026-07-18 · Playability/completeness gate: removed The Vorga and 10,516 other
  statless/blank imported shells from public results while falling back to complete
  duplicate identities; repaired emphasized-action parsing; added attack/damage/heal/
  save controls across stat blocks, spells, weapons, and generic cards; added direct
  compendium-to-DM handoff plus independent persistent HP/temp HP/conditions; hardened
  character loading and provenance-aware core-rule wizard ordering; expanded agent and
  regression gates over the merged local corpus.
- 2026-07-18 · Personal Markdown ingestion: deterministic adapters for the 13-file
  collection, 1,838 normalized records (including 336 monsters, 339 spells, 402 items,
  232 scoped features, 123 tables, and typed rules), conflict/completeness audit,
  Markdown-first safe enrichment, explicit-null preservation, and hybrid-record fix.
- 2026-07-18 · Importer completeness: per-file/source audit API + JSON report, `_copy`
  inheritance/modifiers, magic variants, lore linking, full 5etools class/subclass
  progression, spell lists, richer species/backgrounds, extended rules/reference types,
  book/adventure browsing, conservative identity/fingerprint dedupe, and local dnd-data
  adapter. Replaced the cheap lich SVG with original professional lich/dragon/death-
  knight paintings and capped the expanded class picker.
- 2026-07-18 · Explicit attack buttons on stat blocks, spell cards (auto/adjustable
  mod), sheet spell rows (+save DCs). CLAUDE.md + agent stack added.
- 2026-07-18 · DM pivot: DM screen w/ pinned tabs default, dedupe (−26.5k dupes),
  nav simplification, elevation/shadow theme, lich/crest SVG, spell list damage chips.
- 2026-07-17 · Wizard UX (searchable SRD-first pickers, sticky Next, metadata-less
  background fix). Recursive 5etools importer (106k entries) + scale fixes.
- 2026-07-17 · Open-licensed expansion (ToB 1–3, Creature Codex, Deep Magic, A5E, Black
  Flag). Phases 1–9 built and verified; four-layer test harness; initial GitHub push.

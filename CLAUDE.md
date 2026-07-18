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

## Compliance guardrails (hard rules)

- **Never fetch, extract, or commit copyrighted game content.** The repo redistributes
  nothing: shipped data rebuilds from freely licensed sources only (SRD 5.1/5.2 via
  5e-bits, OGL/CC packs via Open5e). WotC book content has no legal JSON/PDF source —
  do not pull 5etools mirrors or extract from PDFs.
- User-supplied content lives in `data/sources/` (5etools JSON, ingested by
  `npm run data:import`), optional local `dnd-data` exports in `data/*.json`,
  `data/pdfs/`, `reference/` — **all gitignored; keep it that way.**
- Duplicate entries resolve official-first: srd52 → srd51 → official book codes →
  open packs → community → app homebrew (`server/lib/compendium.mjs` `sourceRank`).

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | server :5177 + Vite app :5176 (run from repo root) |
| `npm start` | production build served on :5177 (LAN-reachable) |
| `npm run data:all` | fetch + normalize licensed data, then import `data/sources/` |
| `npm test` | unit (dice, rules) + data validation + API integration |
| `npm run test:e2e` | headless-Chromium functional suite (builds app, own server :5180) |

## Architecture map

- `server/index.mjs` — Fastify: compendium API (search/filters/edition layering),
  characters + homebrew file CRUD (`data/characters/`, `data/homebrew/`), static app.
- `server/lib/compendium.mjs` — load/merge/dedupe (`sourceRank`), search, summaries.
- `scripts/` — `fetch-srd.mjs` (licensed downloads), `build-data.mjs` (normalize →
  `data/srd/`), `import-sources.mjs` (recursive 5etools importer → `_normalized/`).
- `app/src/dm/DMScreen.jsx` — default view; pinnable rollable monster/NPC/spell tabs.
- `app/src/compendium/` — Browser (filters, damage chips), Detail, StatBlock (explicit
  attack buttons), SpellCard (spell attack w/ auto or adjustable mod), ClassPage.
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
- Edition layering: same slug in both editions → 2024 default, 2014 behind badge.

## State (2026-07-18)

All phases delivered and green: two-pass data pipeline (119,006 deduped entries loaded
at boot; 167,225 local records normalized with zero entry failures and a machine-readable coverage report),
DM screen, compendium, dice, rules engine, sheet, wizard, level-up, homebrew, rests /
death saves / conditions, print view, Roll20-style theme with original premium lich,
dragon, and death-knight artwork. Suites: 58 unit/data/API tests + 27 e2e steps, all passing.

## Changelog

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

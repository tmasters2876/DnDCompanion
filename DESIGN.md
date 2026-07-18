# D&D Companion — Design & Implementation Plan

A local, personal-use D&D 5e companion modeled on Roll20's **"D&D 2024 by Roll20"** character sheet, with a full compendium. Not affiliated with Roll20 or Wizards of the Coast; runs entirely on the user's machine.

## Decisions (locked 2026-07-17)

| Decision | Choice |
|---|---|
| Core scope | Character sheet **and** compendium, co-equal pillars |
| Ruleset | **2024 rules primary**, 2014 content included as tagged "legacy" fallback; characters may mix, 2024 wins on conflict |
| Data source | SRD 5.2 (2024, CC-BY-4.0) + SRD 5.1 (2014) as the shipped base; loader accepts **5etools-format community JSON** the user supplies for everything else |
| Platform | **Local web app** — small Node server + browser UI on localhost, reachable from tablet/laptop on LAN |
| Sheet model | Visual clone of the **new "D&D 2024 by Roll20" sheet** |
| Builder | **Guided wizard, full automation** (class → background → species → abilities → equipment → spells), manual override afterward |
| Level-up | **Guided level-up** including ASI/feat, subclass, spell changes, and multiclassing |
| Dice | **Full click-to-roll** on every sheet element, advantage/disadvantage query, styled result cards in a persistent roll log panel |
| Compendium UX | **Both**: Roll20-style slide-out drawer beside the sheet (search + drag-to-add) and full-page filterable listings per category |
| Monsters | Stat blocks rendered classic-style, **rollable** into the same roll log; no NPC instance management in v1 |
| Homebrew | **Light**: create custom items / feats / spells via forms; they behave exactly like official content in builder + sheet |
| Storage | **Plain JSON files** in a `data/` folder — one file per character, per homebrew entry; server does file I/O |
| Stack | **React + Vite front end, small Node (Fastify) server** |

## Architecture

```
dnd-companion/
├── server/          # Fastify: static hosting, /api/characters, /api/homebrew (file I/O only)
├── app/             # React + Vite SPA
│   ├── sheet/       # 2024-sheet clone components
│   ├── builder/     # creation wizard + level-up wizard
│   ├── compendium/  # drawer + full-page browser + stat blocks
│   ├── dice/        # roll engine + roll log
│   └── rules/       # pure-TS rules engine (no React)
├── data/
│   ├── srd/         # shipped: normalized SRD 5.2 + 5.1
│   ├── sources/     # user-supplied 5etools-format JSON (gitignored)
│   ├── characters/  # one JSON per character
│   └── homebrew/    # one JSON per custom entry
└── DESIGN.md
```

Key principles:

- **Rules engine is pure functions.** `derive(character, compendium) → sheet view-model` computes everything (modifiers, proficiency, AC, spell slots incl. multiclass table, prepared counts, weapon mastery). The character file stores only *choices*; the sheet displays only *derivations* plus manual overrides stored as explicit deltas.
- **Single normalized compendium schema.** An import step maps SRD data and 5etools-format files into one internal schema with `source` and `edition` tags. Everything downstream (builder, sheet, drawer, stat blocks) reads only the internal schema — community-format quirks stay quarantined in the importer.
- **Edition layering.** Entities with the same identity in both editions resolve to the 2024 version by default; legacy shows with a badge and can be picked explicitly.
- **Dice engine speaks Roll20 formula syntax** (`1d20+@{str_mod}`, `2d20kh1` for advantage) so sheet buttons and stat blocks share one roller, and muscle memory carries over.

## Build phases

1. **Skeleton + data pipeline** — repo scaffold, server, SRD normalization, 5etools importer, schema docs. *Exit: compendium JSON queryable via API.*
2. **Compendium browser** — full-page listings with filters (level/school/CR/source/edition), detail pages, classic monster stat blocks (read-only).
3. **Dice engine + roll log** — parser, adv/dis query modal, styled result cards, persistent log; wire stat blocks to it. *Exit: open a monster, click its attack, see the card.*
4. **Character model + rules engine** — character JSON schema, full derivation incl. multiclass slots; heavy unit tests here.
5. **Sheet clone** — the 2024-sheet layout: header (name/class/level/HP/AC/conditions), abilities & saves, skills, attacks/actions, spells tab with slot pips, inventory, features, bio. Every stat clickable. Compendium drawer with drag-to-add.
6. **Creation wizard** — guided flow, choice validation, produces a complete correct sheet.
7. **Guided level-up** — per-level grants, ASI/feat, subclass selection, spell swaps, multiclass entry with prerequisite checks.
8. **Light homebrew** — forms for custom item/feat/spell; entries land in `data/homebrew/` and appear everywhere official content does.
9. **Polish** — short/long-rest buttons, death saves, condition tracking, print/export view, LAN access niceties.

Each phase ends usable on its own; order front-loads the pieces everything else depends on (data → dice → rules → UI).

## Risks / notes

- **Non-SRD data is user-supplied.** The app ships legal (SRD/CC-BY only); "everything 5e" arrives when the user drops community JSON into `data/sources/`. The importer must fail loudly and partially-load gracefully.
- **The rules engine is the hard 20%.** Multiclass spell slots, stacking proficiencies, choice-dependent features (e.g. Tasha-style swaps), and 2024/2014 interactions deserve tests before UI.
- **Visual fidelity** to the 2024 sheet will be built from screenshots the user provides of their logged-in Roll20 session, placed in `reference/` (screenshots for personal reference only).
- No VTT (maps/tokens/fog), no NPC instances, no encounter tracker in v1 — explicitly out of scope; architecture doesn't preclude them later.

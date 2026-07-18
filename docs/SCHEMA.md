# Internal compendium schema

Everything downstream of the importers (server API, builder, sheet, drawer, stat blocks)
reads **only** this schema. Raw-source quirks (5e-bits, Open5e, 5etools, personal
Markdown) stay inside the scripts under `scripts/`.

## Files

- `data/srd/<type>.json` — shipped, built by `npm run data:build`. One JSON array per type.
- `data/sources/_normalized/<type>.json` — built from user-supplied JSON.
- `data/sources/_normalized/markdown-<type>.json` — built from local Markdown.
- `data/homebrew/<id>.json` — one entry per file, created by the app.

The server merges all three at startup and resolves canonical `(type, slug, edition)`
identities. Personal Markdown is authoritative unless a JSON entry is deterministically
more complete. Only absent object keys are backfilled; explicit nulls, empty arrays, and
stat-block omissions remain meaningful. Other source families are selected intact and
are not recursively hybridized.

## Entry envelope

Every entry, regardless of type:

```jsonc
{
  "id": "spell/fireball/srd52",     // <type>/<slug>/<sourceKey> — globally unique
  "type": "spell",
  "slug": "fireball",               // kebab-case, unique within (type, sourceKey)
  "name": "Fireball",
  "edition": "2024",                // "2024" | "2014"
  "source": {
    "key": "srd52",                 // srd52 | srd51 | 5etools source code | "homebrew"
    "name": "SRD 5.2"
  },
  "data": { /* type-specific, below */ },
  "text": "…"                       // full rules text, markdown; used for search + detail pages
}
```

Local Markdown entries also record non-content provenance in `data`: `markdownFile`,
`headingPath`, `contentHash`, `parserVersion`, and a `provenance` source-key list. These
fields are excluded from structural fingerprints.

**Edition layering:** entries in different editions with the same `(type, slug)` are the
same identity. The API resolves to the 2024 entry by default; 2014 shows with a `legacy`
badge and can be requested explicitly (`?edition=2014` or by exact id).

## Types and their `data` fields

Only fields the rules engine or UI actually consumes are normalized; everything else
lives in `text`.

### `spell`
`level` (0 = cantrip), `school`, `castingTime`, `range`, `components` {v,s,m,materialText},
`duration`, `concentration`, `ritual`, `classes` [class slugs], `damage` {dice, type,
scaling}, `attackType` ("melee"|"ranged"|null), `save` (ability abbr or null).

### `monster`
`size`, `creatureType`, `alignment`, `ac`, `acNote`, `hp` {average, formula}, `speed`
{walk, fly, swim, climb, burrow, hover}, `abilities` {str..cha}, `saves` {ability: bonus},
`skills` {skill: bonus}, `senses`, `languages`, `cr` (number; 0.125 etc.), `xp`,
`vulnerabilities`/`resistances`/`immunities`/`conditionImmunities` [strings],
`traits`/`actions`/`bonusActions`/`reactions`/`legendary` — each an array of
`{name, text, attack?}` where `attack` = `{bonus, reach|range, damage: [{dice, type}]}`
when parseable (feeds click-to-roll).

### `class`
`hitDie`, `primaryAbilities`, `saves` [ability abbrs], `proficiencies` {armor, weapons,
tools, skills: {choose, from}}, `spellcasting` {ability, kind: "full"|"half"|"third"|"pact"|null,
preparedFormula}, `levels` — array of 20 `{level, profBonus, features: [feature slugs],
slots?: [9], classSpecific: {…}}`, `startingEquipment`, `multiclass` {requirements, grants}.

### `subclass`
`class` (slug), `levels` [{level, features}], `spellcasting?` (e.g. third-casters).

### `species` (2014 "race" normalizes to this type)
`size`, `speed`, `traits` [{name, text}], `darkvision?`, plus 2014-only `abilityBonuses`
kept for legacy characters.

### `background`
`abilityScores` (2024: choose from three), `feat` (slug, 2024), `skills`, `tools`,
`equipment`, plus 2014-only `feature` {name, text}.

### `feat`
`category` ("origin"|"general"|"fighting-style"|"epic"|null for 2014), `prerequisite`,
`abilityIncrease?`, `repeatable`.

### `item`
`itemType` ("weapon"|"armor"|"gear"|"tool"|"magic"), `rarity`, `attunement`, `cost`
{qty, unit}, `weight`, weapon: `{category, damage, damageType, properties, mastery?,
range?}`, armor: `{category, ac, dexCap, strengthReq, stealthDisadvantage}`.

### `feature`
Class/subclass features referenced by slug from `class.levels[].features`.
`class` (slug|null), `subclass` (slug|null), `level`.

### `condition`, `rule`
Text-only (`data` may be empty) — rendered in compendium and tooltips.
`rule.data.category`: "rule" | "rule-section" | "weapon-property" | "weapon-mastery".

### Extended reference types

The local importer also preserves `table`, `adventure`, `book`, `item-group`,
`legendary-group`, `language`, `disease`, `deity`, `reward`, `recipe`, `psionic`,
`action`, `hazard`, `vehicle`, `vehicle-upgrade`, `deck`, `card`, and `object` records.
These share the normal envelope and store source-specific searchable fields in `data`.
Books and adventures include `data.sections[]` with `name`, `page`, and normalized text;
tables include `columns`, `rows`, and an optional dice expression.

When source lore can be linked to a mechanical record it is appended to `text` and
stored in `data.lore`. `data.identity` may record `aliases`, `reprints`, and
`copiedFrom`; the compendium uses these hints during conservative deduplication.

Flattened third-party exports may not contain enough structured mechanics to safely
drive a stat block or character. Such records carry `data.partial: true`; they remain
searchable/readable but are excluded from mechanical character-builder choices.

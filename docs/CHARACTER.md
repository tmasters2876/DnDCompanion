# Character file schema

One JSON file per character in `data/characters/`. The file stores **choices only** —
everything displayable (modifiers, AC, slots, attacks) is computed by the rules engine
(`app/src/rules/derive.js`) at render time, so nothing drifts out of sync. Manual
overrides are explicit deltas in `overrides`, never baked into stored values.

```jsonc
{
  "id": "<uuid>",                     // server-assigned
  "name": "Faelar",
  "edition": "2024",                  // ruleset preference; content may mix, 2024 wins
  "abilities": { "str": 10, "dex": 16, "con": 14, "int": 8, "wis": 12, "cha": 15 },
    // final base scores — point-buy/rolls plus background/ASI/feat increases are all
    // choices, so the chosen totals live here
  "classes": [                        // order matters: first entry is the starting class
    { "class": "wizard", "subclass": "evoker", "level": 5,
      "hpRolls": [null, 4, 2, 6, 3] } // per-level HP rolls; null = take average
  ],
  "species": "elf", "subspecies": "high-elf",   // slugs into the compendium
  "background": "sage",
  "proficiencies": {
    "skills": ["arcana", "history"],  // chosen skill proficiencies (slugs)
    "expertise": [],
    "tools": [], "languages": ["common", "elvish"]
  },
  "feats": ["alert"],
  "equipment": [
    { "item": "longsword", "qty": 1, "equipped": true },
    { "item": "shield", "qty": 1, "equipped": false }
  ],
  "spells": {
    "known": ["fire-bolt", "shield", "fireball"],   // spellbook / known list
    "prepared": ["shield", "fireball"]
  },
  "hp": { "current": 27, "temp": 0 },  // max is derived; current/temp are state
  "slotsUsed": [0,0,0,0,0,0,0,0,0],    // expended slots per level; pact tracked separately
  "pactUsed": 0,
  "conditions": [],                    // active condition slugs
  "deathSaves": { "success": 0, "fail": 0 },
  "currency": { "cp": 0, "sp": 0, "ep": 0, "gp": 25, "pp": 0 },
  "overrides": [                       // explicit deltas, applied last by derive()
    { "path": "ac", "value": 18, "note": "mage armor" }
  ],
  "notes": "", "bio": {}
}
```

## What derive() computes

`derive(character, lookup) → view`

- ability modifiers, proficiency bonus (from total level)
- saving throws (starting class saves + proficiency)
- 18 skills (ability mod + proficiency/expertise), passive Perception
- AC: equipped armor (base + capped DEX) + shield, else unarmored 10+DEX,
  else Barbarian/Monk unarmored defense; then overrides
- max HP: first level max die + CON, then rolls-or-average + CON per level, per class
- attacks: equipped weapons → to-hit (ability + prof) and damage formulas
  (finesse picks the better of STR/DEX; ranged uses DEX; versatile shows both dice)
- spell slots **including the multiclass table**: caster level =
  full + ⌈half⌉/⌊half⌋ (2024/2014 single-class vs multiclass rounding) + ⌊third⌋;
  Warlock pact slots tracked separately
- per-class spell save DC, spell attack, prepared/cantrip counts
- speed, size, darkvision from species

`lookup` is any object with `get(type, slug, edition?) → entry` — the app backs it
with the compendium API; tests back it with the JSON files on disk.

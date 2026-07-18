# User-supplied sources

Drop 5etools-format JSON files here (e.g. `spells-xyz.json`, `bestiary-xyz.json`,
or a combined homebrew file), then run:

```
npm run data:import
```

Normalized output lands in `_normalized/` (gitignored) and the server picks it up on
restart. Files that fail to parse are reported and skipped — one bad file never blocks
the rest.

The importer is a two-pass resolver. It indexes the whole source tree before mapping,
so `_copy` inheritance, copy modifiers, fluff/lore references, class spell lists, and
book/adventure bodies can resolve across files. It also reads user-supplied
`data/{backgrounds,classes,items,monsters,species,spells}.json` exports from
`nick-aschenbach/dnd-data` when present. Those local exports are explicitly gitignored;
the project does not download or redistribute them.

Every run writes `_normalized/import-report.json`. The report includes per-file and
per-source counts, recognized and unsupported top-level keys, parse/entry failures,
resolved and unresolved copies, duplicate IDs, and normalized totals by type. It is
also available from `GET /api/compendium/audit` while the server is running.

Everything in this folder except this README is gitignored: these files are for your
personal use and are never committed or redistributed.

Recognized top-level keys include `spell`, `monster`, `item`, `baseitem`, `magicvariant`,
`feat`, `background`, `race`, `subrace`, `class`, `subclass`, `classFeature`,
`subclassFeature`, `optionalfeature`, `condition`, `disease`, `language`, `deity`,
`reward`, `recipe`, `psionic`, `card`, `deck`, `table`, `itemGroup`, `variantrule`,
`legendaryGroup`, `adventure`, `adventureData`, `book`, and `bookData`, plus common
actions, hazards, objects, vehicles, item-rule records, and lore/fluff companions.
Sources `XPHB`, `XDMG`, `XMM` are tagged edition 2024; everything else 2014.

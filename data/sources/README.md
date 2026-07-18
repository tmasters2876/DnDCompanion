# User-supplied sources

Drop 5etools-format JSON files here (e.g. `spells-xyz.json`, `bestiary-xyz.json`,
or a combined homebrew file), then run:

```
npm run data:import
```

Normalized output lands in `_normalized/` (gitignored) and the server picks it up on
restart. Files that fail to parse are reported and skipped — one bad file never blocks
the rest.

Everything in this folder except this README is gitignored: these files are for your
personal use and are never committed or redistributed.

Recognized top-level keys: `spell`, `monster`, `item`, `baseitem`, `feat`, `background`,
`race`, `class`, `subclass`, `classFeature`, `subclassFeature`, `condition`.
Sources `XPHB`, `XDMG`, `XMM` are tagged edition 2024; everything else 2014.

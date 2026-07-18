# Personal Markdown collection (local only)

Anything placed in this folder stays on this machine — the whole directory is
gitignored except this file and no personal source text is committed.

`npm run data:import` reads `.md` files here through the deterministic adapters in
`scripts/import-markdown.mjs`. It recognizes the project's spell, monster, class,
origin, feat, equipment, magic-item, glossary, and gameplay-toolbox layouts, then writes
gitignored normalized JSON plus `data/sources/_normalized/markdown-report.json`.

Markdown is the preferred source for matching values; JSON fills keys that the
Markdown parser did not produce. JSON leads only when it is measurably more complete.
Unsupported files are recorded rather than parsed, and the audit exposes relative
filenames and counts without source passages or absolute paths.

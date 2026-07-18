# PDFs (local only)

Anything placed in this folder stays on this machine — the whole directory is
gitignored except this file, and nothing here is read by the app or committed.

The app's content pipeline does not extract from PDFs. To add content to the
compendium, place 5etools-format JSON in `data/sources/` and run
`npm run data:import`.

# Synology deployment

This is the single internal production-in-development deployment served at
`http://10.0.1.50:15177`. It is not designed for internet exposure.

The local Mac remains authoritative for Git, imports, tests, and release creation.
The NAS receives immutable Git releases, immutable normalized-data releases, and two
persistent writable state directories.

```text
/volume1/docker/dnd-companion/
├── compose.yaml
├── .env
├── releases/<git-sha>/
├── data-releases/<data-digest>/
└── state/
    ├── characters/
    └── homebrew/
```

Run `npm run deploy:nas:stage` after both test suites are green and the intended code
is committed. Add `-- --with-data` for the first deployment or whenever normalized
data changes. The script stages atomically over SSH but does not request broad Docker
permissions.

For the first launch, create a Container Manager Project named `dnd-companion` from
`/volume1/docker/dnd-companion/compose.yaml`. For later releases, stage the new release
and use the project's build/recreate action. Never use `down -v`; character and
homebrew state must survive image changes.

After a launch or rebuild:

```bash
BASE_URL=http://10.0.1.50:15177 npm run test:deployment
```

Rollback means selecting a previous `DND_RELEASE` and its paired `DND_DATA_VERSION` in
the NAS `.env`, then recreating the project. Do not roll back or delete `state/`.

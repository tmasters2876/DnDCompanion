// Fetches raw SRD data into data/raw/:
//   - 5e-bits/5e-database (SRD 5.1 "2014" + SRD 5.2 "2024" structured JSON)
//   - Open5e v2 API (SRD 5.2 spells + creatures, which 5e-bits doesn't have yet)
// Idempotent: re-running updates in place.
import { execSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw');
const DB = join(RAW, '5e-database');
mkdirSync(join(RAW, 'open5e'), { recursive: true });

if (existsSync(join(DB, '.git'))) {
  console.log('Updating 5e-database…');
  execSync('git pull --ff-only', { cwd: DB, stdio: 'inherit' });
} else {
  console.log('Cloning 5e-database…');
  execSync(`git clone --depth 1 https://github.com/5e-bits/5e-database.git "${DB}"`, { stdio: 'inherit' });
}

async function fetchAllPages(url, label) {
  const results = [];
  let next = url;
  while (next) {
    process.stdout.write(`\r${label}: ${results.length}…`);
    const res = await fetch(next);
    if (!res.ok) throw new Error(`${label}: HTTP ${res.status} for ${next}`);
    const page = await res.json();
    results.push(...page.results);
    next = page.next;
  }
  console.log(`\r${label}: ${results.length} fetched`);
  return results;
}

const O5E = 'https://api.open5e.com/v2';
const spells = await fetchAllPages(`${O5E}/spells/?document__key=srd-2024&limit=100`, 'Open5e 2024 spells');
writeFileSync(join(RAW, 'open5e', 'spells-2024.json'), JSON.stringify(spells, null, 1));
const creatures = await fetchAllPages(`${O5E}/creatures/?document__key=srd-2024&limit=100`, 'Open5e 2024 creatures');
writeFileSync(join(RAW, 'open5e', 'creatures-2024.json'), JSON.stringify(creatures, null, 1));

// Openly-licensed (OGL / CC-BY) third-party documents hosted by Open5e —
// Kobold Press bestiaries & Deep Magic, A5E Monstrous Menagerie, Black Flag SRD,
// Vault of Magic. These expand the compendium legally beyond the SRD.
const OPEN_DOCS = {
  creatures: ['tob-2023', 'tob2', 'tob3', 'ccdx', 'a5e-mm', 'bfrd'],
  spells: ['deepm', 'deepmx'],
  // NOTE: /v2/items/ ignores document__key (returns the generic SRD list) — do not
  // fetch items this way; verify per-document key prefixes before adding a kind here.
};
for (const [kind, keys] of Object.entries(OPEN_DOCS)) {
  for (const key of keys) {
    const data = await fetchAllPages(`${O5E}/${kind}/?document__key=${key}&limit=100`, `${key} ${kind}`);
    writeFileSync(join(RAW, 'open5e', `${kind}-${key}.json`), JSON.stringify(data, null, 1));
  }
}
console.log('Raw data ready in data/raw/');

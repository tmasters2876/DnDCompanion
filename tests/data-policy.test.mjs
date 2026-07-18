import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('personal source files and normalized output remain gitignored', () => {
  const tracked = execFileSync('git', ['ls-files', 'data/pdfs', 'data/sources', 'reference'], { cwd: ROOT, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
  assert.deepEqual(tracked.sort(), ['data/pdfs/README.md', 'data/sources/README.md']);

  for (const path of ['data/pdfs/private/source.md', 'data/pdfs/source.pdf', 'data/sources/private/source.json', 'data/sources/_normalized/markdown-spell.json', 'reference/private.md']) {
    const ignored = execFileSync('git', ['check-ignore', '--no-index', path], { cwd: ROOT, encoding: 'utf8' }).trim();
    assert.equal(ignored, path);
  }
});

test('container build and deployment metadata exclude private source material', () => {
  const dockerignore = readFileSync(join(ROOT, '.dockerignore'), 'utf8');
  for (const rule of ['data', 'reference', '.env', 'tests']) {
    assert.match(dockerignore, new RegExp(`^${rule.replace('.', '\\.')}$`, 'm'));
  }

  const deploymentFiles = [
    'Dockerfile',
    'deploy/synology/compose.yaml',
    'scripts/deploy-synology.sh',
    'scripts/deployment-smoke.mjs',
  ].map((path) => readFileSync(join(ROOT, path), 'utf8')).join('\n');
  assert.doesNotMatch(deploymentFiles, /\/Users\/|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|(?:PASSWORD|TOKEN|SECRET)=\S+/i);
  assert.match(deploymentFiles, /10\.0\.1\.50:15177/);
});

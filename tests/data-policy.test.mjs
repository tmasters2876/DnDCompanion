import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

/**
 * No document in this repo may cite a transaction by a truncated id. The rule bites on the exact
 * README that shipped truncated (its parent 5005f37, before faa1a31) and passes on the current tree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { truncatedIds } from './pinned.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docs = ['README.md', ...readdirSync(join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => join('docs', f))];

test('a prefix plus an ellipsis is caught; a whole id and ordinary prose are not', () => {
  const full = 'a'.repeat(64);
  assert.deepEqual(truncatedIds('tx `81c3008f1fe5d79508105ada...` landed'), [{ line: 1, text: '81c3008f1fe5d79508105ada...' }]);
  assert.deepEqual(truncatedIds(`tx ${full} landed`), []);
  assert.deepEqual(truncatedIds('and so on... the deed 0xdeadbeef and 12345678 cost'), []);
  assert.equal(truncatedIds('one\ntwo deadbeefcafe…\nthree')[0]?.line, 2);
});

test('no document cites a transaction by a truncated id', () => {
  const found = docs.flatMap((d) => truncatedIds(readFileSync(join(root, d), 'utf8')).map((t) => `${d}:${t.line} ${t.text}`));
  assert.deepEqual(found, [], `truncated ids in docs:\n  ${found.join('\n  ')}`);
});

/**
 * No document in this repo may cite a transaction by a truncated id. The rule bites on the exact
 * README that shipped truncated (its parent 5005f37, before faa1a31) and passes on the current tree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { truncatedIds, citedIds } from './pinned.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Every root markdown file, not just README: kaspa-depin's copy of this gate scanned only
// README and docs/, and four cut-short ids sat unseen in its STATUS.md until 2026-09-22.
const md = (dir: string) => readdirSync(join(root, dir)).filter((f) => /\.(md|html)$/.test(f)).map((f) => (dir === '.' ? f : join(dir, f)));
const docs = [...md('.'), ...md('docs')];

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

test('citedIds is every id in an explorer link, once, in order; a bare digest is not a citation', () => {
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);
  const link = (id: string) => `[${id}](https://explorer-tn10.kaspa.org/txs/${id})`;
  assert.deepEqual(citedIds(`${link(a)} then ${link(b)} and ${link(a)} again; a digest ${'c'.repeat(64)} in prose`), [a, b]);
  assert.deepEqual(citedIds(`https://explorer.kaspa.org/txs/${b}`), [b]);
  assert.deepEqual(citedIds(`plain ${a}`), []);
});

/*
 * Cited => archived. The public testnet-10 index serves roughly the last six days (measured
 * 2026-09-22: 6 of this repo's 14 cited ids already returned 404), so a link alone decays into
 * the author's word. docs/proofs/<txid>.json is the transaction as the index served it, fetched
 * while it still could be (`npx tsx tools/harvest.ts`). An id that was never archived and can no
 * longer be fetched is not a proof; the doc must say so, and the run must be repeated.
 */
test('every cited transaction id has an archived proof in docs/proofs', () => {
  const missing = docs.flatMap((d) => citedIds(readFileSync(join(root, d), 'utf8'))
    .filter((id) => !existsSync(join(root, 'docs', 'proofs', `${id}.json`)))
    .map((id) => `${d}: ${id}`));
  assert.deepEqual(missing, [], `cited but not archived:\n  ${missing.join('\n  ')}`);
});

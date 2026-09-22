/**
 * `npx tsx tools/harvest.ts` -- archive every transaction the documents cite, while it can still
 * be fetched.
 *
 * The public testnet-10 index serves roughly the last six days. A doc that links an id older
 * than that links nothing, however whole the id is (kaspanet/kccs#29 review, and 6 of 14 ids in
 * this repo were already gone by 2026-09-22). This walks README.md and docs/, and for every whole id without a
 * docs/proofs/<txid>.json asks api-tn10 for the transaction and writes what it said, verbatim,
 * under a small header. A 404 is reported, not hidden: that id needs a re-run.
 *
 * src/pinned.test.ts fails while any cited id lacks its file, so this is the way to make it pass.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { citedIds } from '../src/pinned.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROOFS = join(ROOT, 'docs', 'proofs');
const API = 'https://api-tn10.kaspa.org/transactions';
const EXPLORER = 'https://explorer-tn10.kaspa.org/txs';

const docs = ['README.md', ...readdirSync(join(ROOT, 'docs')).filter((f) => /\.(md|html)$/.test(f)).map((f) => join('docs', f))];
const cited = [...new Set(docs.flatMap((d) => citedIds(readFileSync(join(ROOT, d), 'utf8'))))];

/** The archived record: where it came from and when, then the index's answer untouched. */
export const record = (txid: string, transaction: unknown, fetchedAt: string) => ({
  txid, network: 'testnet-10', explorer: `${EXPLORER}/${txid}`, source: `${API}/${txid}`, fetchedAt, transaction,
});

mkdirSync(PROOFS, { recursive: true });
let archived = 0;
const gone: string[] = [];
for (const id of cited) {
  const file = join(PROOFS, `${id}.json`);
  if (existsSync(file)) continue;
  const res = await fetch(`${API}/${id}`);
  if (!res.ok) { gone.push(`${id} (${res.status})`); continue; }
  writeFileSync(file, `${JSON.stringify(record(id, await res.json(), new Date().toISOString()), null, 1)}\n`);
  archived += 1;
  console.log(`  archived ${id}`);
}
console.log(`\n  ${cited.length} cited, ${archived} archived now, ${cited.length - gone.length - archived} already on disk`);
if (gone.length) {
  console.log(`\n  NOT FETCHABLE, NOT ARCHIVED -- re-run these, or stop citing them as proof:\n    ${gone.join('\n    ')}\n`);
  process.exit(1);
}

/**
 * The slashable bond is real code now, not prose: the covenant compiles to Kaspa script within the
 * size limit, and the digest the referee signs binds the payout so a verdict can't be redirected.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { guiltyDigest } from './bond.js';

const artifact = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../contracts/build/quorum-bond.json'), 'utf8'));

test('the bond covenant compiled: two doors (refund/slash), inside Kaspa\'s 520-byte limit', () => {
  const c = artifact.contracts.QuorumBond;
  assert.deepEqual(Object.keys(c.entries).sort(), ['refund', 'slash']);
  assert.ok(c.compiled.bytecode.length <= 520, `fits the element limit (${c.compiled.bytecode.length} bytes)`);
  assert.equal(c.entries.refund.params[0].type.kind, 'sig', 'refund takes the worker signature');
  assert.equal(c.entries.slash.params[0].type.kind, 'datasig', 'slash takes the referee verdict signature');
});

test('the guilty digest is deterministic and binds the payout destination and amount', () => {
  const base = { taskId: 'cc'.repeat(8), buyerPubkeyHex: '22'.repeat(32), payoutValueSompi: 3_000_000n, payoutScriptPubKeyHex: 'aa'.repeat(35) };
  const d = guiltyDigest(base);
  assert.match(d, /^[0-9a-f]{64}$/);
  assert.equal(guiltyDigest(base), d, 'deterministic for the same verdict');
  assert.notEqual(guiltyDigest({ ...base, payoutScriptPubKeyHex: 'bb'.repeat(35) }), d, 'a redirected payout changes the digest');
  assert.notEqual(guiltyDigest({ ...base, payoutValueSompi: 3_000_001n }), d, 'a changed amount changes the digest');
});

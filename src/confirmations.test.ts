/**
 * The fabric's broadcaster lands a slash on chain, but "seen on chain" is not "final": Kaspa's BlockDAG
 * can reorg recent blocks, reverting a slash or a ding. vprogs PR #146 solves this by tagging each event
 * with the block it landed in and reverting events whose block a reorg unwinds. These tests pin that
 * pattern for us: a confirmation floor before an outcome counts, and a revert that hands back the outcomes
 * a reorg undid so the caller can un-apply them (un-ding a deed, un-count a settlement).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isConfirmed, CONFIRMATION_FLOOR, OutcomeLedger } from './confirmations.js';

test('isConfirmed: an outcome counts only once its block is the floor behind the tip', () => {
  assert.equal(CONFIRMATION_FLOOR, 10n);
  assert.equal(isConfirmed(100n, 109n), false); // 9 behind, not yet
  assert.equal(isConfirmed(100n, 110n), true);  // exactly the floor
  assert.equal(isConfirmed(100n, 130n), true);
  assert.equal(isConfirmed(100n, 105n, 3n), true); // custom floor
});

test('OutcomeLedger: confirmed vs pending splits by the floor', () => {
  const l = new OutcomeLedger<string>();
  l.record('a', 100n);
  l.record('b', 105n);
  l.record('c', 120n);
  assert.deepEqual(l.confirmed(130n).sort(), ['a', 'b', 'c']);
  assert.deepEqual(l.confirmed(112n), ['a']);          // only a is 10+ behind 112
  assert.deepEqual(l.pending(112n).sort(), ['b', 'c']);
});

test('OutcomeLedger: a reorg reverts and returns the outcomes whose block is now above the new tip', () => {
  const l = new OutcomeLedger<string>();
  l.record('a', 100n);
  l.record('b', 105n);
  l.record('c', 120n);
  const reverted = l.revert(110n); // chain rolled back to DAA 110; c (120) is orphaned
  assert.deepEqual(reverted, ['c']);
  // the ledger keeps only what survived the reorg
  assert.deepEqual(l.confirmed(200n).sort(), ['a', 'b']);
  // reverting again to the same tip returns nothing new
  assert.deepEqual(l.revert(110n), []);
});

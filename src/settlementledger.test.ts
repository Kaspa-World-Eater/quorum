/**
 * Wiring the reorg-safety primitive into the settlement path: broadcast slashes go into a ledger tagged
 * with the block they landed in, so a caller acts only on ones past the confirmation floor and can un-apply
 * the ones a reorg undoes. A slashAndDing both slashes a bond and dings a deed in one tx, so a reverted
 * slash is also a reverted ding -- `reverted()` hands back the receipts (with their workerId) so the caller
 * un-dings those workers' deeds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SettlementLedger } from './settlementledger.js';
import type { SlashReceipt } from './broadcast.js';

const receipt = (txid: string, workerId: string): SlashReceipt =>
  ({ txid, payoutSompi: 99_000_000n, feeSompi: 1_000_000n, workerId });

test('SettlementLedger: settled vs unconfirmed splits broadcast slashes by the floor', () => {
  const l = new SettlementLedger();
  l.record(receipt('aa', 'w1'), 100n);
  l.record(receipt('bb', 'w2'), 118n);
  assert.deepEqual(l.settled(130n).map((r) => r.workerId), ['w1', 'w2']);
  assert.deepEqual(l.settled(112n).map((r) => r.workerId), ['w1']);       // w2's block is only 112-118 behind
  assert.deepEqual(l.unconfirmed(112n).map((r) => r.workerId), ['w2']);
});

test('SettlementLedger: a reorg hands back the reverted slashes so their deeds can be un-dinged', () => {
  const l = new SettlementLedger();
  l.record(receipt('aa', 'w1'), 100n);
  l.record(receipt('bb', 'w2'), 118n);
  l.record(receipt('cc', 'w3'), 130n);
  const reverted = l.revertedBy(120n); // chain rolled back to DAA 120; w3's slash (130) is orphaned
  assert.deepEqual(reverted.map((r) => ({ worker: r.workerId, txid: r.txid })), [{ worker: 'w3', txid: 'cc' }]);
  // the undone slash is gone; the survivors remain settled
  assert.deepEqual(l.settled(200n).map((r) => r.workerId).sort(), ['w1', 'w2']);
});

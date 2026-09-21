/**
 * Wiring the reorg-safety primitive into the settlement path: broadcast slashes go into a ledger tagged
 * with the block they landed in, so a caller acts only on ones past the confirmation floor and can un-apply
 * the ones a reorg undoes. A slashAndDing both slashes a bond and dings a deed in one tx, so a reverted
 * slash is also a reverted ding -- `reverted()` hands back the receipts (with their workerId) so the caller
 * un-dings those workers' deeds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SettlementLedger, runSettlementSlashes, type ConfirmingChain } from './settlementledger.js';
import type { SlashReceipt, BondUtxo, SlashSubmitter } from './broadcast.js';
import type { Settlement } from './settle.js';
import type { BondParties } from './bondtx.js';
import type { TaskParties } from './parties.js';

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

const COV: BondParties = {
  workerPubkeyHex: 'a1'.repeat(32), buyerPubkeyHex: 'b2'.repeat(32), refereePubkeyHex: 'c3'.repeat(32),
  taskId: 'd4'.repeat(8), deadlineMillis: 1000n,
};
const BOND = 100_000_000n;
const partiesWithBond = (): TaskParties => ({
  buyerChannel: 'bc',
  payees: [{ workerId: 'w1', address: 'kaspatest:w1' }],
  bonds: [{ workerId: 'w1', covenantId: 'cid', amountSompi: BOND, covenant: COV }],
});
function fakeConfirmingChain(daaScore: bigint): ConfirmingChain {
  const submitter: SlashSubmitter = { async submitSlashSpend() { return 'f'.repeat(64); } };
  return {
    submitter,
    async bondUtxoFor(): Promise<BondUtxo> { return { transactionId: 'bb'.repeat(32), index: 0, valueSompi: BOND }; },
    async refereeSign() { return 'ab'.repeat(32); },
    async blockDaaScoreOf() { return daaScore; },
  };
}

test('runSettlementSlashes: broadcasts, records to the ledger, then the ledger gates and reverts', async () => {
  const settlement: Settlement = {
    outcome: 'pay-and-slash', paid: [], priceSompi: 0n, slashed: ['w1'], bondSompiEach: BOND, note: 't',
  };
  const ledger = new SettlementLedger();
  const receipts = await runSettlementSlashes(fakeConfirmingChain(150n), partiesWithBond(), settlement, 1_000_000n, ledger);

  assert.equal(receipts.length, 1);
  assert.deepEqual(ledger.settled(200n).map((r) => r.workerId), ['w1']);      // 50 behind, final
  assert.deepEqual(ledger.unconfirmed(155n).map((r) => r.workerId), ['w1']);  // only 5 behind, not yet
  assert.deepEqual(ledger.revertedBy(140n).map((r) => r.workerId), ['w1']);   // reorg below its block undoes it
});

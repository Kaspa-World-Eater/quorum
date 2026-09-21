/**
 * The broadcaster is the wire's end: a slash DECISION (settle) -> a slash RECIPE (execute) -> an actual
 * covenant SPEND on chain. The chain call is injected (SlashSubmitter), so everything up to submitTransaction
 * is tested here offline; the fee arithmetic, the witness handed to the chain, and the settle->slash wiring
 * are all pinned before any live run. The byte-for-byte tie to consensus stays the live driver's job.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slashFeeSompi, broadcastSlash, broadcastSettlementSlashes,
  MIN_SLASH_FEE_SOMPI, type SlashSubmitter, type BondUtxo, type SlashChain,
} from './broadcast.js';
import { slashSpend, type SlashSpend } from './execute.js';
import type { BondParties } from './bondtx.js';
import type { Settlement } from './settle.js';
import type { TaskParties } from './parties.js';

const COV: BondParties = {
  workerPubkeyHex: 'a1'.repeat(32),
  buyerPubkeyHex: 'b2'.repeat(32),
  refereePubkeyHex: 'c3'.repeat(32),
  taskId: 'd4'.repeat(8),
  deadlineMillis: 1_000n,
};
const BOND = 100_000_000n; // 1 KAS
const SPEND_FEE = MIN_SLASH_FEE_SOMPI; // 0.01 KAS floor, as proven live
const SIG = 'ab'.repeat(32);

/** A submitter that records the last job and returns a fixed txid, so we can assert what the chain got. */
function fakeSubmitter(txid = 'f'.repeat(64)): SlashSubmitter & { last?: Parameters<SlashSubmitter['submitSlashSpend']>[0] } {
  const s: any = { async submitSlashSpend(job: any) { s.last = job; return txid; } };
  return s;
}

test('slashFeeSompi: fee is what the bond holds minus what the buyer receives', () => {
  assert.equal(slashFeeSompi(BOND, BOND - SPEND_FEE), SPEND_FEE);
});

test('slashFeeSompi: refuses a payout larger than the bond (a negative fee)', () => {
  assert.throws(() => slashFeeSompi(BOND, BOND + 1n), /below the/);
});

test('slashFeeSompi: refuses a fee below the live floor', () => {
  assert.throws(() => slashFeeSompi(BOND, BOND - 500_000n), /below the 1000000 sompi floor/);
});

test('slashFeeSompi: refuses a non-positive payout', () => {
  assert.throws(() => slashFeeSompi(BOND, 0n), /payout must be positive/);
});

test('broadcastSlash: hands the chain the exact payout, fee, and witness, and returns its txid', async () => {
  const spend = slashSpend(COV, BOND - SPEND_FEE);
  const sub = fakeSubmitter('1234'.padEnd(64, '0'));
  const bond: BondUtxo = { transactionId: 'aa'.repeat(32), index: 0, valueSompi: BOND };
  const receipt = await broadcastSlash(sub, spend, bond, SIG);

  assert.equal(receipt.txid, '1234'.padEnd(64, '0'));
  assert.equal(receipt.payoutSompi, BOND - SPEND_FEE);
  assert.equal(receipt.feeSompi, SPEND_FEE);
  // the witness the chain receives is exactly execute's recipe: [datasig, dispatch tag, redeem]
  assert.deepEqual(sub.last!.signatureScriptItems, spend.witness(SIG));
  assert.equal(sub.last!.payoutSpkHex, spend.payoutSpkHex);
  assert.equal(sub.last!.feeSompi, SPEND_FEE);
  assert.equal(sub.last!.bond.valueSompi, BOND);
});

function partiesWith(bondCovenant?: BondParties): TaskParties {
  return {
    buyerChannel: 'buyer-channel',
    payees: [{ workerId: 'w1', address: 'kaspatest:worker1' }],
    bonds: [{ workerId: 'w1', covenantId: 'cid-1', amountSompi: BOND, covenant: bondCovenant }],
  };
}

/** A chain that records the digest the referee was asked to sign and the utxo lookups. */
function fakeChain(): SlashChain & { signed: string[]; txid: string } {
  const c: any = {
    signed: [],
    txid: 'e'.repeat(64),
    submitter: fakeSubmitter('e'.repeat(64)),
    async bondUtxoFor(spend: SlashSpend): Promise<BondUtxo> {
      return { transactionId: 'bb'.repeat(32), index: 0, valueSompi: BOND };
    },
    async refereeSign(digestHex: string): Promise<string> { c.signed.push(digestHex); return SIG; },
  };
  return c;
}

test('broadcastSettlementSlashes: pay-and-slash lands one spend per caught worker', async () => {
  const settlement: Settlement = {
    outcome: 'pay-and-slash', paid: [], priceSompi: 0n, slashed: ['w1'], bondSompiEach: BOND, note: 'test',
  };
  const chain = fakeChain();
  const receipts = await broadcastSettlementSlashes(chain, partiesWith(COV), settlement, SPEND_FEE);

  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]!.workerId, 'w1');
  assert.equal(receipts[0]!.payoutSompi, BOND - SPEND_FEE);
  assert.equal(receipts[0]!.txid, 'e'.repeat(64));
  // the referee signed the SAME digest the covenant will recompute on chain
  const expected = slashSpend(COV, BOND - SPEND_FEE).verdictDigestHex;
  assert.deepEqual(chain.signed, [expected]);
});

test('broadcastSettlementSlashes: a settlement with no slash touches the chain zero times', async () => {
  const settlement: Settlement = { outcome: 'pay', paid: ['w1'], priceSompi: 10n, note: 'agreed' };
  const chain = fakeChain();
  const receipts = await broadcastSettlementSlashes(chain, partiesWith(COV), settlement, SPEND_FEE);
  assert.deepEqual(receipts, []);
  assert.deepEqual(chain.signed, []);
});

test('broadcastSettlementSlashes: refuses to slash a bond with no covenant on file', async () => {
  const settlement: Settlement = {
    outcome: 'pay-and-slash', paid: [], priceSompi: 0n, slashed: ['w1'], bondSompiEach: BOND, note: 'test',
  };
  await assert.rejects(
    () => broadcastSettlementSlashes(fakeChain(), partiesWith(undefined), settlement, SPEND_FEE),
    /not an executable quorum-bond/,
  );
});

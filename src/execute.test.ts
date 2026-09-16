/**
 * The wire from a slash decision to the quorum-bond covenant: given a worker's bond parameters, the
 * executable spend it produces must sign the SAME digest the compiled covenant recomputes on chain, and
 * it must refuse a bond it cannot actually execute.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slashSpend, slashSpendFor, slashesFor } from './execute.js';
import { guiltyDigest, p2pkScriptPubKey } from './bond.js';
import { quorumBondScript, bondDispatchTag, type BondParties } from './bondtx.js';
import type { TaskParties } from './parties.js';

const COVENANT: BondParties = {
  workerPubkeyHex: 'ab'.repeat(32),
  buyerPubkeyHex: 'cd'.repeat(32),
  refereePubkeyHex: 'ef'.repeat(32),
  taskId: '0123456789abcdef',
  deadlineMillis: 1_800_000_000_000n,
};

test('slashSpend reconstructs the covenant redeem and the buyer payout', () => {
  const s = slashSpend(COVENANT, 990_000n);
  assert.equal(s.redeemHex, quorumBondScript(COVENANT), 'redeem is the worker\'s quorum-bond');
  assert.equal(s.payoutSpkHex, p2pkScriptPubKey(COVENANT.buyerPubkeyHex), 'output 0 pays the buyer P2PK');
  assert.equal(s.payoutSompi, 990_000n);
});

test('the referee signs the SAME digest the compiled covenant recomputes on chain', () => {
  const payout = 990_000n;
  const s = slashSpend(COVENANT, payout);
  const expected = guiltyDigest({ taskId: COVENANT.taskId, buyerPubkeyHex: COVENANT.buyerPubkeyHex, payoutValueSompi: payout, payoutScriptPubKeyHex: p2pkScriptPubKey(COVENANT.buyerPubkeyHex) });
  assert.equal(s.verdictDigestHex, expected, 'verdictDigest is exactly the covenant\'s guiltyDigest');
  assert.notEqual(slashSpend(COVENANT, 990_001n).verdictDigestHex, s.verdictDigestHex, 'moving a sompi changes what the referee must sign');
  assert.notEqual(slashSpend({ ...COVENANT, taskId: 'fedcba9876543210' }, payout).verdictDigestHex, s.verdictDigestHex, 'a different task is a different verdict');
});

test('the witness is the slash door\'s [datasig, tag, redeem], in order', () => {
  const s = slashSpend(COVENANT, 990_000n);
  assert.deepEqual(s.witness('99'.repeat(64)), ['99'.repeat(64), bondDispatchTag('slash'), s.redeemHex]);
});

test('a non-positive payout is refused', () => {
  assert.throws(() => slashSpend(COVENANT, 0n), /positive/);
  assert.throws(() => slashSpend(COVENANT, -1n), /positive/);
});

test('slashSpendFor looks the worker\'s bond up in the task and executes it', () => {
  const parties: TaskParties = {
    buyerChannel: 'ch-buyer',
    payees: [{ workerId: 'w1', address: 'kaspatest:qxxx' }],
    bonds: [{ workerId: 'w1', covenantId: 'cid-1', amountSompi: 1_000_000n, covenant: COVENANT }],
  };
  assert.equal(slashSpendFor(parties, 'w1', 990_000n).verdictDigestHex, slashSpend(COVENANT, 990_000n).verdictDigestHex);
});

test('slashesFor: a settlement\'s caught workers become concrete spends, bond less the fee', () => {
  const other: BondParties = { ...COVENANT, workerPubkeyHex: 'a1'.repeat(32), taskId: 'fedcba9876543210' };
  const parties: TaskParties = {
    buyerChannel: 'ch-buyer',
    payees: [],
    bonds: [
      { workerId: 'w1', covenantId: 'c1', amountSompi: 1_000_000n, covenant: COVENANT },
      { workerId: 'w2', covenantId: 'c2', amountSompi: 1_000_000n, covenant: other },
    ],
  };
  const spends = slashesFor(parties, ['w1', 'w2'], 20_000n);
  assert.equal(spends.length, 2);
  assert.equal(spends[0]!.payoutSompi, 980_000n, 'pays the bond less the spend fee');
  assert.equal(spends[0]!.verdictDigestHex, slashSpend(COVENANT, 980_000n).verdictDigestHex);
  assert.notEqual(spends[0]!.verdictDigestHex, spends[1]!.verdictDigestHex, 'each worker gets its own verdict');
  assert.deepEqual(slashesFor(parties, [], 20_000n), [], 'no one caught -> nothing to slash');
});

test('slashesFor refuses a bond too small to clear the fee', () => {
  const parties: TaskParties = { buyerChannel: 'ch', payees: [], bonds: [{ workerId: 'w1', covenantId: 'c1', amountSompi: 10_000n, covenant: COVENANT }] };
  assert.throws(() => slashesFor(parties, ['w1'], 20_000n), /does not clear the/);
});

test('a bond described only abstractly cannot be executed -- it stays a plan', () => {
  const parties: TaskParties = {
    buyerChannel: 'ch-buyer',
    payees: [],
    bonds: [{ workerId: 'w1', covenantId: 'cid-1', amountSompi: 1_000_000n }], // no covenant params
  };
  assert.throws(() => slashSpendFor(parties, 'w1', 990_000n), /not an executable quorum-bond/);
  assert.throws(() => slashSpendFor(parties, 'nope', 990_000n), /no bond on file/);
});

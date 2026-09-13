/**
 * The plan is exhaustive and safe: every sompi of the price is assigned, every bond is accounted
 * for exactly once, and a settlement can never pay or slash a party the task never registered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjudicate } from './adjudication.js';
import { settleVerified, type TaskTerms } from './settle.js';
import { planActions, splitEqually, type RailAction } from './plan.js';
import { UnknownParty, type TaskParties } from './parties.js';

const TERMS: TaskTerms = { priceSompi: 1_000_003n, bondSompi: 5_000_000n };
const t = (workerId: string, hash: string) => ({ workerId, hash });

const parties = (): TaskParties => ({
  buyerChannel: 'buyer-ch',
  payees: [
    { workerId: 'alice', address: 'kaspatest:alice' },
    { workerId: 'bob', address: 'kaspatest:bob' },
    { workerId: 'ref', address: 'kaspatest:ref' },
  ],
  bonds: [
    { workerId: 'alice', covenantId: 'bond-alice', amountSompi: 5_000_000n },
    { workerId: 'bob', covenantId: 'bond-bob', amountSompi: 5_000_000n },
    { workerId: 'ref', covenantId: 'bond-ref', amountSompi: 5_000_000n },
  ],
});

const paid = (as: RailAction[]) => as.filter((a) => a.do === 'pay');
const sum = (as: RailAction[]) => as.filter((a) => a.do === 'pay').reduce((n, a) => n + (a.do === 'pay' ? a.sompi : 0n), 0n);

test('splitEqually is exhaustive: the shares always add back to the total, remainder included', () => {
  for (const [total, n] of [[1_000_003n, 3], [10n, 4], [0n, 2], [7n, 7], [5n, 8]] as [bigint, number][]) {
    const shares = splitEqually(total, n);
    assert.equal(shares.length, n);
    assert.equal(shares.reduce((a, b) => a + b, 0n), total, `${total}/${n} adds back`);
    assert.ok(shares.every((x) => x >= 0n));
  }
});

test('AGREEMENT: both are paid the whole price between them, and both bonds are released', () => {
  const plan = planActions(settleVerified(adjudicate(t('alice', 'H'), t('bob', 'H')), TERMS), parties());
  assert.equal(sum(plan), 1_000_003n, 'the price, exactly -- odd remainder included');
  assert.equal(paid(plan).length, 2);
  const released = plan.filter((a) => a.do === 'release-bond').map((a) => a.workerId).sort();
  assert.deepEqual(released, ['alice', 'bob']);
  assert.equal(plan.some((a) => a.do === 'slash-bond'), false, 'nobody is slashed');
});

test('A CAUGHT LIE: the honest are paid and their bonds released; the liar\'s bond goes to the buyer', () => {
  const plan = planActions(settleVerified(adjudicate(t('alice', 'H'), t('bob', 'X'), t('ref', 'H')), TERMS), parties());
  assert.equal(sum(plan), 1_000_003n, 'the price is paid to the honest set');
  const slashed = plan.filter((a) => a.do === 'slash-bond');
  assert.equal(slashed.length, 1);
  assert.equal(slashed[0]?.do === 'slash-bond' && slashed[0].workerId, 'bob');
  assert.equal(slashed[0]?.do === 'slash-bond' && slashed[0].toBuyerChannel, 'buyer-ch');
  // bob is slashed, never released; alice and ref are released, never slashed.
  const released = plan.filter((a) => a.do === 'release-bond').map((a) => a.workerId).sort();
  assert.deepEqual(released, ['alice', 'ref']);
});

test('HOLD moves nothing at all', () => {
  const plan = planActions(settleVerified(adjudicate(t('alice', 'H'), t('bob', 'X')), TERMS), parties());
  assert.deepEqual(plan, []);
});

test('REFUND returns the buyer\'s money and releases every bond -- nobody is punished', () => {
  const plan = planActions(settleVerified(adjudicate(t('alice', 'H'), t('bob', 'X'), t('ref', 'Y')), TERMS), parties());
  assert.equal(plan.some((a) => a.do === 'refund-buyer'), true);
  assert.equal(plan.some((a) => a.do === 'pay' || a.do === 'slash-bond'), false);
  const released = plan.filter((a) => a.do === 'release-bond').map((a) => a.workerId).sort();
  assert.deepEqual(released, ['alice', 'bob', 'ref'], 'every bond comes back');
});

test('a settlement cannot pay or slash a party the task never registered', () => {
  const missing: TaskParties = { buyerChannel: 'buyer-ch', payees: [], bonds: [] };
  assert.throws(() => planActions(settleVerified(adjudicate(t('a', 'H'), t('b', 'H')), TERMS), missing), UnknownParty);
});

/**
 * What quorum promises, pinned: money moves only on a verdict, and only a referee takes a bond.
 *
 * These run the real oracle (adjudicate) into the real settlement (settleVerified), so the test is
 * the whole claim end to end: agreement pays, a caught lie pays-and-slashes, a bare disagreement
 * holds for a referee, and an environment fault refunds without punishing anyone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjudicate } from './adjudication.js';
import { settleVerified, totalSlashed, buyerPays, UnpayableTerms, type TaskTerms } from './settle.js';

const TERMS: TaskTerms = { priceSompi: 1_000_000n, bondSompi: 5_000_000n };
const t = (workerId: string, hash: string) => ({ workerId, hash });

test('AGREEMENT PAYS: two workers produce the same result, the buyer pays them', () => {
  const s = settleVerified(adjudicate(t('alice', 'H'), t('bob', 'H')), TERMS);
  assert.equal(s.outcome, 'pay');
  assert.deepEqual(s.outcome === 'pay' && s.paid.sort(), ['alice', 'bob']);
  assert.equal(s.outcome === 'pay' && s.priceSompi, 1_000_000n);
  assert.equal(buyerPays(s), true);
  assert.equal(totalSlashed(s), 0n, 'nobody lied, so no bond is taken');
});

test('A CAUGHT LIE PAYS-AND-SLASHES: the referee matches one, the other forfeits its bond', () => {
  // alice and bob disagree; the referee reproduces alice's output, so bob fabricated.
  const s = settleVerified(adjudicate(t('alice', 'H'), t('bob', 'X'), t('ref', 'H')), TERMS);
  assert.equal(s.outcome, 'pay-and-slash');
  if (s.outcome !== 'pay-and-slash') return;
  assert.deepEqual(s.paid.sort(), ['alice', 'ref'], 'the honest worker and the referee are paid');
  assert.deepEqual(s.slashed, ['bob'], 'only the caught worker is slashed');
  assert.equal(totalSlashed(s), 5_000_000n, "the liar forfeits its whole bond");
});

test('A BARE DISAGREEMENT HOLDS: no money moves until a referee rules', () => {
  const s = settleVerified(adjudicate(t('alice', 'H'), t('bob', 'X')), TERMS);
  assert.equal(s.outcome, 'hold');
  assert.equal(buyerPays(s), false);
  assert.equal(totalSlashed(s), 0n);
});

test('AN ENVIRONMENT FAULT REFUNDS: all three differ, nobody is punished', () => {
  const s = settleVerified(adjudicate(t('alice', 'H'), t('bob', 'X'), t('ref', 'Y')), TERMS);
  assert.equal(s.outcome, 'refund');
  assert.equal(buyerPays(s), false);
  assert.equal(totalSlashed(s), 0n, 'non-determinism is not fraud, so no bond is taken');
});

test('two testimonies from the same worker cannot decide anything: refund', () => {
  const s = settleVerified(adjudicate(t('alice', 'H'), t('alice', 'H')), TERMS);
  assert.equal(s.outcome, 'refund');
});

test('a referee that is one of the disputants decides nothing: refund', () => {
  const s = settleVerified(adjudicate(t('alice', 'H'), t('bob', 'X'), t('alice', 'H')), TERMS);
  assert.equal(s.outcome, 'refund');
});

test('nonsensical terms are refused before any verdict is read', () => {
  assert.throws(() => settleVerified(adjudicate(t('a', 'H'), t('b', 'H')), { priceSompi: -1n, bondSompi: 0n }), UnpayableTerms);
  assert.throws(() => settleVerified(adjudicate(t('a', 'H'), t('b', 'H')), { priceSompi: 1n, bondSompi: -5n }), UnpayableTerms);
});

test('a zero bond is allowed, but then a caught lie costs the liar nothing', () => {
  const s = settleVerified(adjudicate(t('a', 'H'), t('b', 'X'), t('r', 'H')), { priceSompi: 1_000_000n, bondSompi: 0n });
  assert.equal(s.outcome, 'pay-and-slash');
  assert.equal(totalSlashed(s), 0n, 'a bond of zero makes the slash symbolic -- the reason quorum needs a real bond');
});

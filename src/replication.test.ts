/**
 * Adaptive replication: a newcomer or a caught worker is always double-run, a proven one is only
 * audited at a floor rate, the choice is deterministic in the task id, and the buyer can be quoted
 * the honest cost multiplier rather than a flat 2x.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { shouldReplicate, replicationFactor, DEFAULT_REPLICATION, type WorkerReputation } from './replication.js';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const worker = (workerId: string, rep: Partial<WorkerReputation>) => ({
  workerId,
  reputation: { score: 1, jobs: 1000, disputeRate: 0, ...rep } as WorkerReputation,
});

test('a newcomer is always double-run, however clean its short record', () => {
  assert.equal(shouldReplicate('task-1', worker('new', { jobs: 3 }), sha).reason, 'too-few-jobs');
});

test('a worker with any confirmed disputes is returned to full replication', () => {
  assert.equal(shouldReplicate('task-1', worker('slippery', { disputeRate: 0.02 }), sha).replicate, true);
  assert.equal(shouldReplicate('task-1', worker('slippery', { disputeRate: 0.02 }), sha).reason, 'disputed');
});

test('a low-scoring worker is double-run even with a long record', () => {
  assert.equal(shouldReplicate('task-1', worker('weak', { score: 0.5 }), sha).reason, 'untrusted');
});

test('a proven worker is mostly trusted, but still audited at random and never predictably', () => {
  const w = worker('veteran', {}); // score 1, 1000 jobs, no disputes
  let audited = 0;
  for (let i = 0; i < 400; i++) if (shouldReplicate(`task-${i}`, w, sha).reason === 'random-audit') audited++;
  assert.ok(audited > 0, 'some jobs are audited -- trust never decays to zero checking');
  assert.ok(audited < 400, 'but not all -- otherwise trust bought nothing');
});

test('the choice is deterministic in the task id: a worker cannot shop for an unaudited task', () => {
  const w = worker('veteran', {});
  for (let i = 0; i < 50; i++) {
    const a = shouldReplicate(`task-${i}`, w, sha);
    const b = shouldReplicate(`task-${i}`, w, sha);
    assert.deepEqual(a, b);
  }
});

test('auditRate 0 trusts fully; auditRate 1 replicates everything', () => {
  const w = worker('veteran', {});
  assert.equal(shouldReplicate('t', w, sha, { ...DEFAULT_REPLICATION, auditRate: 0 }).replicate, false);
  assert.equal(shouldReplicate('t', w, sha, { ...DEFAULT_REPLICATION, auditRate: 1 }).replicate, true);
});

test('the honest cost multiplier: ~1.05x for a proven worker, 2x for a newcomer', () => {
  const ids = Array.from({ length: 2000 }, (_, i) => `task-${i}`);
  const veteran = replicationFactor(ids, worker('veteran', {}), sha);
  const rookie = replicationFactor(ids, worker('rookie', { jobs: 2 }), sha);
  assert.ok(veteran > 1.0 && veteran < 1.12, `proven worker near the 1.05 floor, got ${veteran.toFixed(3)}`);
  assert.equal(rookie, 2, 'every task from a newcomer is replicated');
});

/**
 * How often to actually run a task twice -- the front of the pipeline, and its economics.
 *
 * Verifying by agreement means running a task on a second worker, so a naive market costs a buyer
 * roughly DOUBLE what the same work costs on a trusted farm. No cryptographic elegance survives
 * being 2x the price of the alternative. So quorum does not double-run everything.
 *
 * THE ANSWER IS TWENTY YEARS OLD. BOINC calls it adaptive replication: track how many consecutive
 * jobs a worker has had validated, and once that record is long enough, replicate only occasionally
 * rather than always. The cost multiplier moves from 2x toward 1x while a newcomer -- or anyone ever
 * caught by [[settle]]'s slash -- is still checked every time. Vendored from kaspa-depin's
 * `verify/replication.ts`, worker vocabulary; two things it keeps that BOINC learned the hard way:
 *
 *   - A FLOOR. A trusted worker is still audited at random, forever. Trust that decays to zero
 *     checking is an invitation. Selection is deterministic in the task id, so it cannot be gamed,
 *     but it is not guessable in advance.
 *   - TRUST IS LOST FASTER THAN EARNED. One confirmed dispute returns a worker to full replication.
 *     Earning back a thousand-job record takes a thousand jobs.
 *
 * The reputation itself -- how score and disputeRate are computed from a worker's history -- is a
 * separate concern quorum has not built yet; this only reads the shape it needs.
 */

/** What the replication decision reads about a worker. Computing it is out of scope here. */
export interface WorkerReputation {
  /** 0..1, how well this worker's past work has held up */
  score: number;
  /** how many jobs it has completed */
  jobs: number;
  /** 0..1, the share of its jobs that ended in a confirmed dispute */
  disputeRate: number;
}

export interface ReplicationPolicy {
  /** replicate every task from a worker whose score is below this */
  trustThreshold: number;
  /** and from anyone with fewer than this many completed jobs, however clean */
  minJobsForTrust: number;
  /** the floor: a trusted worker is still replicated this often, at random, forever */
  auditRate: number;
  /** any dispute rate at or above this returns a worker to full replication */
  disputeRateLimit: number;
}

/** Cautious defaults: a compute job is worth far more than a volunteer work unit, so audit high. */
export const DEFAULT_REPLICATION: ReplicationPolicy = {
  trustThreshold: 0.85,
  minJobsForTrust: 50,
  auditRate: 0.05,
  disputeRateLimit: 0.01,
};

export type ReplicationDecision =
  | { replicate: true; reason: 'untrusted' | 'too-few-jobs' | 'disputed' | 'random-audit' }
  | { replicate: false; reason: 'trusted' };

/** Deterministic in the task id, so a worker cannot shop for an unaudited task. */
function sampled(taskId: string, salt: string, rate: number, hash: (s: string) => string): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  const n = parseInt(hash(`${salt}:${taskId}`).slice(0, 8), 16) / 0xffffffff;
  return n < rate;
}

/**
 * Should this task be run by a second worker? `hash` is injected so this stays dependency-free and
 * testable with a stub; pass a real content hash (blake3 / sha256 hex) in production.
 */
export function shouldReplicate(
  taskId: string,
  worker: { workerId: string; reputation: WorkerReputation },
  hash: (s: string) => string,
  policy: ReplicationPolicy = DEFAULT_REPLICATION,
): ReplicationDecision {
  const rep = worker.reputation;
  if (rep.disputeRate >= policy.disputeRateLimit) return { replicate: true, reason: 'disputed' };
  if (rep.jobs < policy.minJobsForTrust) return { replicate: true, reason: 'too-few-jobs' };
  if (rep.score < policy.trustThreshold) return { replicate: true, reason: 'untrusted' };
  if (sampled(taskId, worker.workerId, policy.auditRate, hash)) return { replicate: true, reason: 'random-audit' };
  return { replicate: false, reason: 'trusted' };
}

/**
 * What a batch of tasks costs to verify, as a multiple of running each once -- so a buyer is quoted
 * 1.05x when its worker has earned it, and 2x when it has not, rather than a flat guess.
 */
export function replicationFactor(
  taskIds: readonly string[],
  worker: { workerId: string; reputation: WorkerReputation },
  hash: (s: string) => string,
  policy: ReplicationPolicy = DEFAULT_REPLICATION,
): number {
  if (taskIds.length === 0) return 1;
  const replicated = taskIds.filter((id) => shouldReplicate(id, worker, hash, policy).replicate).length;
  return 1 + replicated / taskIds.length;
}

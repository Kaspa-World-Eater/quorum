/**
 * Deciding WHO was wrong, not merely that two workers disagreed.
 *
 * This is the truth oracle quorum settles on. It is vendored, near-verbatim, from kaspa-depin's
 * `packages/core/src/verify/adjudicate.ts` -- the logic is general to any task whose output is
 * DETERMINISTIC for a fixed input (a render, a hash, a compiled artifact, a seeded simulation),
 * so two honest workers produce byte-identical output and a third breaks a tie. Only the doc
 * language is generalised from rendering; the decision is unchanged.
 *
 * THE GAP THIS CLOSES. Comparing two runs and, when they differ, failing the task is all a bare
 * redundancy check can say. It cannot tell which of the two lied, so the honest worker is disputed
 * alongside the cheat and neither can be slashed without punishing someone who did the work
 * correctly. A verification layer that cannot attribute blame cannot back a bond -- and a bond
 * that is never enforceable is decoration. quorum needs attribution because [[settle]] turns
 * `resolved` into a real slash.
 *
 * THE CASE THAT MUST NOT BE TREATED AS FRAUD. If all three disagree, that is almost certainly
 * non-determinism -- a mismatched build, a different backend, a driver difference -- not two liars.
 * Slashing there would punish honest workers for an environment fault the market failed to pin
 * down. It returns `inconclusive`, and the buyer is refunded rather than anyone punished. Only
 * tasks with a genuinely deterministic backend belong on this oracle; the caller owns that.
 */

/** One worker's claim about what it produced. */
export interface Testimony {
  workerId: string;
  /** the canonical content hash of its output */
  hash: string;
}

export type Adjudication =
  /** the two agreed; no referee was needed */
  | { outcome: 'agree'; hash: string; agreedBy: string[] }
  /** a referee broke the tie: `dishonest` produced output no one else could reproduce */
  | { outcome: 'resolved'; hash: string; honest: string[]; dishonest: string[] }
  /** the two disagree and no referee has ruled yet */
  | { outcome: 'undecided'; reason: string; disagreeing: string[] }
  /** nobody agreed with anybody -- treat as an environment fault, not fraud */
  | { outcome: 'inconclusive'; reason: string; hashes: Record<string, string> };

const distinct = (values: string[]): string[] => [...new Set(values)];

/**
 * Decide a task from two testimonies and, if they disagree, a referee's.
 *
 * The referee must have run the SAME task on a backend eligible to compare against these two.
 * A referee that ran elsewhere makes an honest worker look like a liar -- the one outcome worse
 * than not deciding.
 */
export function adjudicate(a: Testimony, b: Testimony, referee?: Testimony): Adjudication {
  if (a.workerId === b.workerId) {
    return { outcome: 'inconclusive', reason: 'both testimonies came from the same worker', hashes: { [a.workerId]: a.hash } };
  }
  if (a.hash === b.hash) {
    return { outcome: 'agree', hash: a.hash, agreedBy: [a.workerId, b.workerId] };
  }
  if (!referee) {
    return { outcome: 'undecided', reason: 'the two runs disagree and no referee has ruled', disagreeing: [a.workerId, b.workerId] };
  }
  if (referee.workerId === a.workerId || referee.workerId === b.workerId) {
    return {
      outcome: 'inconclusive',
      reason: 'the referee is one of the disputing workers, so its ruling decides nothing',
      hashes: { [a.workerId]: a.hash, [b.workerId]: b.hash },
    };
  }
  const matches = [a, b].filter((t) => t.hash === referee.hash);
  if (matches.length === 0) {
    return {
      outcome: 'inconclusive',
      reason: 'all three runs differ, which points at non-determinism in the environment rather than fraud',
      hashes: { [a.workerId]: a.hash, [b.workerId]: b.hash, [referee.workerId]: referee.hash },
    };
  }
  const honest = distinct([...matches.map((t) => t.workerId), referee.workerId]);
  const dishonest = [a, b].filter((t) => t.hash !== referee.hash).map((t) => t.workerId);
  return { outcome: 'resolved', hash: referee.hash, honest, dishonest };
}

/** Whether an adjudication is a sound basis for taking someone's bond. */
export function isSlashable(a: Adjudication): a is Extract<Adjudication, { outcome: 'resolved' }> {
  return a.outcome === 'resolved';
}

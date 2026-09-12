/**
 * From a verdict to money: what an adjudication means for the rail.
 *
 * metered proved a buyer cannot be overcharged for what it can COUNT -- bytes, tokens. Compute is
 * the case metered cannot reach on its own, because a buyer usually cannot cheaply recompute a
 * result to check it. quorum's answer is [[adjudication]]: independent workers agree, and
 * disagreement attributes blame. This file is the last step -- turning that verdict into a
 * settlement the metered / kaspa-x402 rail can execute.
 *
 * THE FOUR VERDICTS MAP ONE-TO-ONE TO FOUR SETTLEMENTS, and nothing else is a valid outcome:
 *
 *   agree        -> PAY the workers who produced the accepted result. Nobody lied.
 *   resolved     -> PAY the honest, and SLASH the bond of each worker the referee caught.
 *   undecided    -> HOLD: a referee is owed before money moves. No payment, no slash, no refund.
 *   inconclusive -> REFUND the buyer. An environment fault is nobody's fraud, so no bond is taken.
 *
 * A worker is paid for a RESULT, not for effort, and its bond -- posted up front and slashable
 * only on `resolved` -- is what makes "I did the work" cost something to fake. The split of the
 * price across several honest workers is deliberately NOT decided here; that is market policy, and
 * this primitive stays the rule that policy is not allowed to break: money moves only on a verdict,
 * and only a referee's ruling can take a bond.
 */
import type { Adjudication } from './adjudication.js';

export interface TaskTerms {
  /** what the buyer pays for the accepted result, in sompi */
  priceSompi: bigint;
  /** the bond each worker posted, forfeit in full if the referee catches it lying, in sompi */
  bondSompi: bigint;
}

export type Settlement =
  | { outcome: 'pay'; paid: string[]; priceSompi: bigint; note: string }
  | { outcome: 'pay-and-slash'; paid: string[]; priceSompi: bigint; slashed: string[]; bondSompiEach: bigint; note: string }
  | { outcome: 'hold'; reason: string }
  | { outcome: 'refund'; reason: string };

export class UnpayableTerms extends Error {}

function checkTerms(terms: TaskTerms): void {
  if (terms.priceSompi < 0n || terms.bondSompi < 0n) {
    throw new UnpayableTerms('price and bond must each be a non-negative number of sompi');
  }
}

/**
 * Decide the settlement a verdict calls for. Pure: it moves no money, it names what should move,
 * so a caller can show it, log it, and only then hand it to the rail.
 */
export function settleVerified(adj: Adjudication, terms: TaskTerms): Settlement {
  checkTerms(terms);
  switch (adj.outcome) {
    case 'agree':
      return { outcome: 'pay', paid: adj.agreedBy, priceSompi: terms.priceSompi, note: 'the workers agreed; the buyer pays for the result they both produced' };
    case 'resolved':
      return {
        outcome: 'pay-and-slash',
        paid: adj.honest,
        priceSompi: terms.priceSompi,
        slashed: adj.dishonest,
        bondSompiEach: terms.bondSompi,
        note: 'the referee ruled; the honest are paid and each caught worker forfeits its bond',
      };
    case 'undecided':
      return { outcome: 'hold', reason: adj.reason };
    case 'inconclusive':
      return { outcome: 'refund', reason: adj.reason };
  }
}

/** Total sompi taken from bonds by a settlement -- zero unless a worker was caught. */
export function totalSlashed(s: Settlement): bigint {
  return s.outcome === 'pay-and-slash' ? s.bondSompiEach * BigInt(s.slashed.length) : 0n;
}

/** Whether any money leaves the buyer's channel for a worker under this settlement. */
export function buyerPays(s: Settlement): boolean {
  return s.outcome === 'pay' || s.outcome === 'pay-and-slash';
}

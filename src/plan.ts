/**
 * From a settlement to the exact moves on the rail -- named, ordered, still touching nothing.
 *
 * [[settle]] says pay / pay-and-slash / hold / refund. That is not yet executable: it does not say
 * from which channel, to which address, for how much, or what happens to the bonds. This turns a
 * settlement into a list of concrete `RailAction`s that the live rail layer can carry out one by
 * one -- and, like everything before it, it moves no money. A caller can print the plan, check the
 * totals, and only then hand it to the chain.
 *
 * TWO RULES THE PLAN ENFORCES so policy above it cannot break them:
 *   - The price is split ONLY across workers the verdict paid, and the split is exhaustive -- every
 *     sompi of the price is assigned, remainder included, so the buyer is never billed for more or
 *     less than the agreed price.
 *   - Every bond is accounted for exactly once: a paid or refunded worker's bond is RELEASED back to
 *     it; a caught worker's bond is SLASHED to the buyer, who paid for redundancy and was lied to.
 *     A bond is never left dangling and never both released and slashed.
 */
import type { Settlement } from './settle.js';
import { type TaskParties, payeeFor, bondFor } from './parties.js';

export type RailAction =
  | { do: 'pay'; workerId: string; toAddress: string; sompi: bigint; fromChannel: string }
  | { do: 'release-bond'; workerId: string; bondCovenantId: string; sompi: bigint }
  | { do: 'slash-bond'; workerId: string; bondCovenantId: string; sompi: bigint; toBuyerChannel: string }
  | { do: 'refund-buyer'; channel: string };

/** Split a total into `n` whole shares, exhaustively: the first `rem` shares carry one extra sompi. */
export function splitEqually(total: bigint, n: number): bigint[] {
  if (n <= 0) return [];
  const base = total / BigInt(n);
  const rem = total - base * BigInt(n);
  return Array.from({ length: n }, (_, i) => base + (BigInt(i) < rem ? 1n : 0n));
}

/** Pay each named worker its share of the price, and release its bond -- it did honest work. */
function payAndRelease(workers: string[], priceSompi: bigint, parties: TaskParties): RailAction[] {
  const shares = splitEqually(priceSompi, workers.length);
  return workers.flatMap((workerId, i) => {
    const bond = bondFor(parties, workerId);
    return [
      { do: 'pay', workerId, toAddress: payeeFor(parties, workerId).address, sompi: shares[i] ?? 0n, fromChannel: parties.buyerChannel },
      { do: 'release-bond', workerId, bondCovenantId: bond.covenantId, sompi: bond.amountSompi },
    ];
  });
}

/** Take each named worker's bond to the buyer -- it was caught producing work no one could reproduce. */
function slash(workers: string[], parties: TaskParties): RailAction[] {
  return workers.map((workerId) => {
    const bond = bondFor(parties, workerId);
    return { do: 'slash-bond', workerId, bondCovenantId: bond.covenantId, sompi: bond.amountSompi, toBuyerChannel: parties.buyerChannel };
  });
}

/** Give every worker's bond back -- an environment fault is nobody's fraud. */
function releaseAll(parties: TaskParties): RailAction[] {
  return parties.bonds.map((b) => ({ do: 'release-bond', workerId: b.workerId, bondCovenantId: b.covenantId, sompi: b.amountSompi }));
}

/** The exact, ordered moves a settlement calls for on the rail. Pure: it decides, it does not act. */
export function planActions(s: Settlement, parties: TaskParties): RailAction[] {
  switch (s.outcome) {
    case 'hold':
      return [];
    case 'pay':
      return payAndRelease(s.paid, s.priceSompi, parties);
    case 'pay-and-slash':
      return [...payAndRelease(s.paid, s.priceSompi, parties), ...slash(s.slashed, parties)];
    case 'refund':
      return [{ do: 'refund-buyer', channel: parties.buyerChannel }, ...releaseAll(parties)];
  }
}

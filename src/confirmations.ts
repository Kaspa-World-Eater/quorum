/**
 * Reorg safety for on-chain outcomes: a confirmation floor, and a revert path.
 *
 * The broadcaster ([[broadcast]]) submits a slash and gets a txid, but a txid is not finality. On Kaspa's
 * BlockDAG, recent blocks can reorg, so a slash or a ding that was "seen on chain" can be undone. Treating
 * it as final the moment it lands is the fabric's honesty gap (see the reorg-safety note); vprogs PR #146
 * fixes the same class of bug for its settlement runner by tagging every event with the block it landed in
 * and reverting events whose block a reorg unwinds.
 *
 * This is that pattern as a small, pure primitive: an outcome is PENDING until its block is a floor behind
 * the virtual tip, and a reorg to an earlier tip REVERTS (and hands back) every outcome whose block is now
 * orphaned, so the caller can un-apply it -- un-ding a deed, un-count a settlement. It stores no chain
 * state and does no I/O; a live layer feeds it DAA scores.
 */

/** Blocks behind the virtual tip an outcome's block must be before it counts as final. Matches the margin
 *  the live drivers already wait for a UTXO to settle (livecov MARGIN). */
export const CONFIRMATION_FLOOR = 10n;

/** Whether an outcome in a block at `txDaaScore` is at least `floor` behind the virtual tip. */
export function isConfirmed(txDaaScore: bigint, virtualDaaScore: bigint, floor = CONFIRMATION_FLOOR): boolean {
  return virtualDaaScore - txDaaScore >= floor;
}

interface Anchored<T> { item: T; daaScore: bigint; }

/**
 * A reorg-safe record of on-chain outcomes, each tagged with the DAA score of the block that included it --
 * the "chain_idx" analog from vprogs PR #146. Hold an outcome here from the moment it is broadcast; read
 * `confirmed()` to act only on outcomes past the floor, and call `revert()` on a reorg to get back the ones
 * that were undone so they can be reversed off chain too.
 */
export class OutcomeLedger<T> {
  private readonly anchored: Anchored<T>[] = [];

  /** Record an outcome and the DAA score of the block it landed in. */
  record(item: T, daaScore: bigint): void {
    this.anchored.push({ item, daaScore });
  }

  /** The outcomes whose block is at least `floor` behind the virtual tip -- safe to treat as settled. */
  confirmed(virtualDaaScore: bigint, floor = CONFIRMATION_FLOOR): T[] {
    return this.anchored.filter((a) => isConfirmed(a.daaScore, virtualDaaScore, floor)).map((a) => a.item);
  }

  /** The outcomes not yet past the floor -- landed, but still reorg-able, so not final. */
  pending(virtualDaaScore: bigint, floor = CONFIRMATION_FLOOR): T[] {
    return this.anchored.filter((a) => !isConfirmed(a.daaScore, virtualDaaScore, floor)).map((a) => a.item);
  }

  /**
   * A reorg rolled the chain back to `newTipDaaScore`: drop and RETURN every outcome whose block is now
   * above the new tip (orphaned), so the caller can un-apply each one. The rest are kept.
   */
  revert(newTipDaaScore: bigint): T[] {
    const reverted = this.anchored.filter((a) => a.daaScore > newTipDaaScore).map((a) => a.item);
    for (let i = this.anchored.length - 1; i >= 0; i -= 1) {
      if (this.anchored[i]!.daaScore > newTipDaaScore) this.anchored.splice(i, 1);
    }
    return reverted;
  }
}

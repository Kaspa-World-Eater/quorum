/**
 * The reorg-safe half of the settlement path: what happened, and whether it is still true.
 *
 * [[broadcast]] lands a slash and returns a `SlashReceipt`, but a txid is not finality. This holds each
 * broadcast slash together with the DAA score of the block it landed in, so a caller can act only on the
 * ones past the confirmation floor ([[confirmations]]) and un-apply the ones a Kaspa reorg undoes. Because a
 * `slashAndDing` slashes a bond AND dings a deed in one transaction, a reverted slash is also a reverted
 * ding: `revertedBy` hands back the receipts (each carrying its `workerId`) so the caller can un-ding those
 * workers' deeds off chain, keeping the fabric's record in step with the chain.
 *
 * It is the vprogs PR #146 discipline applied to quorum's settlements, and like the primitive it wraps it
 * stores no chain state and does no I/O -- a live layer feeds it receipts and DAA scores.
 */
import { OutcomeLedger, CONFIRMATION_FLOOR } from './confirmations.js';
import { broadcastSettlementSlashes, type SlashChain, type SlashReceipt } from './broadcast.js';
import type { Settlement } from './settle.js';
import type { TaskParties } from './parties.js';

export class SettlementLedger {
  private readonly ledger = new OutcomeLedger<SlashReceipt>();

  /** Record a broadcast slash and the DAA score of the block it landed in. */
  record(receipt: SlashReceipt, blockDaaScore: bigint): void {
    this.ledger.record(receipt, blockDaaScore);
  }

  /** Slashes whose block is at least `floor` behind the virtual tip -- safe to treat as settled. */
  settled(virtualDaaScore: bigint, floor = CONFIRMATION_FLOOR): SlashReceipt[] {
    return this.ledger.confirmed(virtualDaaScore, floor);
  }

  /** Slashes that have landed but are not yet past the floor -- still reorg-able, so not final. */
  unconfirmed(virtualDaaScore: bigint, floor = CONFIRMATION_FLOOR): SlashReceipt[] {
    return this.ledger.pending(virtualDaaScore, floor);
  }

  /**
   * A reorg rolled the chain back to `newTipDaaScore`: return the slashes whose block is now orphaned and
   * drop them from the ledger. The caller un-applies each -- refunding nothing on chain (the bond UTXO is
   * already back), but un-dinging the deed and un-counting the settlement off chain.
   */
  revertedBy(newTipDaaScore: bigint): SlashReceipt[] {
    return this.ledger.revert(newTipDaaScore);
  }
}

/** A settlement chain that can also report the block a broadcast tx landed in -- the DAA score the ledger
 *  tags each slash with. A live layer awaits confirmation and reads it; a test supplies it. */
export interface ConfirmingChain extends SlashChain {
  blockDaaScoreOf(txid: string): Promise<bigint>;
}

/**
 * The full settlement path with reorg-safety built in: broadcast each of a settlement's slashes, record each
 * into `ledger` tagged with the block it landed in, and return the receipts. The caller then reads
 * `ledger.settled(tip)` to act only on final slashes, and calls `ledger.revertedBy(newTip)` on a reorg to
 * un-ding the deeds a reorg undid. This is `settle -> plan -> execute -> broadcast -> confirm/revert` as one
 * call, the chain interactions still injected so it stays unit-tested and SDK-free.
 */
export async function runSettlementSlashes(
  chain: ConfirmingChain, parties: TaskParties, settlement: Settlement, spendFeeSompi: bigint, ledger: SettlementLedger,
): Promise<SlashReceipt[]> {
  const receipts = await broadcastSettlementSlashes(chain, parties, settlement, spendFeeSompi);
  for (const r of receipts) ledger.record(r, await chain.blockDaaScoreOf(r.txid));
  return receipts;
}

/**
 * From a slash DECISION to an executable quorum-bond SPEND -- the wire the audit found missing.
 *
 * [[settle]] decides pay-and-slash; [[plan]] turns that into a `slash-bond` RailAction naming a bond and
 * an amount. Both are still just descriptions. This is where the description meets the covenant: given a
 * worker's quorum-bond parameters, it reconstructs the exact redeem script, the buyer's payout output, and
 * the digest the referee signs to authorise the slash -- the same guiltyDigest the compiled covenant
 * recomputes on chain (contracts/quorum-bond.sil, proven live in kaspa-depin/scripts/live-bond.ts).
 *
 * It still moves no money: a `SlashSpend` is the deterministic recipe. A referee signs `verdictDigestHex`
 * as a datasig, the caller builds a one-output transaction paying `payoutSompi` under `payoutSpkHex` and
 * sets the input's signature script to `witness(sig)`, and the chain enforces the rest. This is the first
 * quorum PRODUCT code that reaches the bond covenant, rather than a hand-run proof script.
 */
import { quorumBondScript, bondWitness, type BondParties } from './bondtx.js';
import { guiltyDigest, p2pkScriptPubKey } from './bond.js';
import { bondFor, type TaskParties } from './parties.js';

/** The executable form of a slash: everything needed to build and authorise the on-chain spend. */
export interface SlashSpend {
  /** the worker's quorum-bond redeem script (hex) -- the UTXO being spent sits at its P2SH address */
  redeemHex: string;
  /** output 0's scriptPubKey, hex: the buyer's P2PK lock the slashed bond pays to */
  payoutSpkHex: string;
  /** the value paid to the buyer, sompi -- committed in the digest, so it cannot be changed after signing */
  payoutSompi: bigint;
  /** what the referee signs (a BIP340 datasig over these 32 bytes) to authorise this exact slash */
  verdictDigestHex: string;
  /** the input's signature script data, given the referee's datasig: [datasig, dispatch tag, redeem] */
  witness: (verdictSigHex: string) => string[];
}

/** Build the slash spend for a quorum-bond covenant paying `payoutSompi` to its buyer. */
export function slashSpend(covenant: BondParties, payoutSompi: bigint): SlashSpend {
  if (payoutSompi <= 0n) throw new Error('slash: payout must be positive');
  const redeemHex = quorumBondScript(covenant);
  const payoutSpkHex = p2pkScriptPubKey(covenant.buyerPubkeyHex);
  const verdictDigestHex = guiltyDigest({
    taskId: covenant.taskId,
    buyerPubkeyHex: covenant.buyerPubkeyHex,
    payoutValueSompi: payoutSompi,
    payoutScriptPubKeyHex: payoutSpkHex,
  });
  return { redeemHex, payoutSpkHex, payoutSompi, verdictDigestHex, witness: (sig) => bondWitness('slash', sig, redeemHex) };
}

/**
 * The executable slash for a caught worker in a task -- the bridge from a settlement's decision to the
 * chain. Refuses a bond that is only described abstractly: you cannot execute a slash you have no covenant
 * for. `payoutSompi` is what the buyer receives (the bond amount less the spend fee the caller reserves).
 */
export function slashSpendFor(parties: TaskParties, workerId: string, payoutSompi: bigint): SlashSpend {
  const bond = bondFor(parties, workerId);
  if (!bond.covenant) {
    throw new Error(`worker ${JSON.stringify(workerId)}'s bond is not an executable quorum-bond (no covenant parameters on file)`);
  }
  return slashSpend(bond.covenant, payoutSompi);
}

/**
 * Every executable slash a settlement calls for: one `SlashSpend` per caught worker, each paying that
 * worker's bond (less `spendFeeSompi`) to the buyer. This is the top of the wire -- a caller runs
 * `settle()`, and on a `pay-and-slash` outcome hands its `slashed` list here to get the concrete spends a
 * referee signs and the rail broadcasts. It refuses a bond too small to clear the fee rather than emit a
 * spend the chain would reject.
 */
export function slashesFor(parties: TaskParties, slashedWorkerIds: string[], spendFeeSompi: bigint): SlashSpend[] {
  return slashedWorkerIds.map((workerId) => {
    const bond = bondFor(parties, workerId);
    if (bond.amountSompi <= spendFeeSompi) {
      throw new Error(`worker ${JSON.stringify(workerId)}'s bond ${bond.amountSompi} sompi does not clear the ${spendFeeSompi} spend fee`);
    }
    return slashSpendFor(parties, workerId, bond.amountSompi - spendFeeSompi);
  });
}

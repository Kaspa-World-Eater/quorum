/**
 * The wire's END: turning a slash RECIPE into an actual covenant SPEND on chain.
 *
 * [[settle]] decides pay-and-slash; [[plan]] names a `slash-bond` action; [[execute]] reconstructs the
 * covenant and produces a `SlashSpend` -- the redeem script, the buyer's payout, and the digest a referee
 * signs. All of that still moves no money. This is the last step: given the referee's datasig and the bond's
 * confirmed UTXO, it assembles and submits the single-input -> single-output spend the covenant enforces
 * (quorum-bond.sil, proven live in kaspa-depin/scripts/live-bond.ts).
 *
 * The chain call itself is INJECTED as a `SlashSubmitter`, so quorum stays free of the WASM SDK and the whole
 * path -- fee arithmetic, the witness handed to consensus, the settle->slash wiring -- is unit-tested offline.
 * A live driver supplies the real submitter (createTransaction([bond], [payout], fee, null, sigOps); set
 * inputs[0].signatureScript to the witness; submitTransaction). The digest binds the payout output, so no
 * submitter can redirect a slash without invalidating the referee's signature.
 */
import { slashesFor, type SlashSpend } from './execute.js';
import type { Settlement } from './settle.js';
import type { TaskParties } from './parties.js';

/** A confirmed bond UTXO -- the coin the slash spends. Its value sets the fee (bond minus payout). */
export interface BondUtxo {
  transactionId: string;
  index: number;
  valueSompi: bigint;
}

/** The single job a slash submits to the chain. Everything is already decided; the submitter only assembles
 *  the transaction and broadcasts it. `signatureScriptItems` is execute's witness: [datasig, dispatch tag, redeem]. */
export interface SlashJob {
  bond: BondUtxo;
  payoutSpkHex: string;
  payoutSompi: bigint;
  feeSompi: bigint;
  signatureScriptItems: string[];
}

/** The injected chain adapter: build the covenant spend, attach the witness, submit, resolve to its txid. */
export interface SlashSubmitter {
  submitSlashSpend(job: SlashJob): Promise<string>;
}

/** What actually landed on chain for one slash. */
export interface SlashReceipt {
  txid: string;
  payoutSompi: bigint;
  feeSompi: bigint;
  workerId?: string;
}

/** The fee floor that cleared live on testnet-10 (SPEND_FEE in live-bond.ts): 0.01 KAS keeps the payout
 *  above the KIP-9 dust floor and pays the spend's mass. */
export const MIN_SLASH_FEE_SOMPI = 1_000_000n;

/** The fee a slash pays = what the bond holds minus what the buyer receives. Refuses a spend the chain would
 *  reject: a non-positive payout, or a fee below the floor (which includes a payout larger than the bond). */
export function slashFeeSompi(bondValueSompi: bigint, payoutSompi: bigint, minFee = MIN_SLASH_FEE_SOMPI): bigint {
  if (payoutSompi <= 0n) throw new Error('slash: payout must be positive');
  const fee = bondValueSompi - payoutSompi;
  if (fee < minFee) throw new Error(`slash: fee ${fee} below the ${minFee} sompi floor (payout too large for the bond)`);
  return fee;
}

/** Land one slash on chain: compute the fee, hand the referee-signed recipe to the submitter, return the receipt.
 *  The referee has signed `spend.verdictDigestHex`; `verdictSigHex` is that datasig. */
export async function broadcastSlash(
  submitter: SlashSubmitter, spend: SlashSpend, bond: BondUtxo, verdictSigHex: string,
): Promise<SlashReceipt> {
  const feeSompi = slashFeeSompi(bond.valueSompi, spend.payoutSompi);
  const txid = await submitter.submitSlashSpend({
    bond,
    payoutSpkHex: spend.payoutSpkHex,
    payoutSompi: spend.payoutSompi,
    feeSompi,
    signatureScriptItems: spend.witness(verdictSigHex),
  });
  return { txid, payoutSompi: spend.payoutSompi, feeSompi };
}

/** Everything a settlement's slashes need from the outside world: the chain submitter, where each bond's UTXO
 *  is, and a referee who signs the guilt digest. Injected so the wiring is testable with fakes. */
export interface SlashChain {
  submitter: SlashSubmitter;
  /** Locate the confirmed bond UTXO this spend draws from (its P2SH address is derivable from spend.redeemHex). */
  bondUtxoFor(spend: SlashSpend): Promise<BondUtxo>;
  /** The referee's BIP340 datasig over the 32-byte guilt digest. */
  refereeSign(verdictDigestHex: string): Promise<string>;
}

/**
 * The full wire: a settlement -> on-chain slashes. On `pay-and-slash`, every caught worker's bond (less
 * `spendFeeSompi`) is moved to the buyer by an actual covenant spend; any other outcome touches the chain
 * zero times. This is what makes `settle()` END in a slash rather than merely describe one.
 */
export async function broadcastSettlementSlashes(
  chain: SlashChain, parties: TaskParties, settlement: Settlement, spendFeeSompi: bigint,
): Promise<SlashReceipt[]> {
  if (settlement.outcome !== 'pay-and-slash') return [];
  const spends = slashesFor(parties, settlement.slashed, spendFeeSompi);
  const receipts: SlashReceipt[] = [];
  for (let i = 0; i < spends.length; i += 1) {
    const spend = spends[i]!;
    const bond = await chain.bondUtxoFor(spend);
    const verdictSigHex = await chain.refereeSign(spend.verdictDigestHex);
    const receipt = await broadcastSlash(chain.submitter, spend, bond, verdictSigHex);
    receipts.push({ ...receipt, workerId: settlement.slashed[i]! });
  }
  return receipts;
}

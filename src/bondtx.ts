/**
 * Turning the compiled bond covenant into a real, per-agreement redeem script -- the deterministic
 * half of taking quorum's bond on chain.
 *
 * contracts/build/quorum-bond.json is a TEMPLATE: its bytecode has placeholder constructor values
 * (worker 0x11.., buyer 0x22.., referee 0x33.., taskId 0xcc.., deadline 0xdd..), baked in at compile
 * time. A real bond swaps those for the actual parties, exactly the mechanism kaspa-depin uses for its
 * escrow. The witness order and the deadline encoding are pinned here too, so the live spend layer has
 * one honest source for both. (The live WASM broadcast -- createTransaction, sign, submit -- is the
 * remaining step; everything here is offline and testable.)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const artifact = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../contracts/build/quorum-bond.json'), 'utf8'));
const CONTRACT = artifact.contracts.QuorumBond as {
  entries: Record<string, { dispatch_tag: string }>;
  compiled: { bytecode: number[] };
};

/** The dispatch tag a spend pushes to select an entry, read from the compiled artifact. */
export const bondDispatchTag = (entry: 'refund' | 'slash'): string => {
  const tag = CONTRACT.entries[entry]?.dispatch_tag;
  if (!tag) throw new Error(`quorum-bond has no entry "${entry}"`);
  return tag;
};

/** 8-byte little-endian, matching the covenant's byte[8] deadline (int(deadlineBytes)) and encodeDeadline. */
export function encodeDeadline(millis: bigint): string {
  if (millis < 0n || millis > 0xffff_ffff_ffff_ffffn) throw new Error(`deadline ${millis} does not fit in 8 bytes`);
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(millis);
  return b.toString('hex');
}

/** Swap a placeholder for a real value, refusing unless it appears exactly `expected` times. */
function swapExactly(hex: string, from: string, to: string, expected: number, what: string): string {
  if (from.length !== to.length) throw new Error(`quorum-bond: ${what} must be ${from.length / 2} bytes, got ${to.length / 2}`);
  const count = hex.split(from).length - 1;
  if (count !== expected) throw new Error(`quorum-bond: expected ${expected} occurrence(s) of ${what}, found ${count}`);
  return hex.split(from).join(to);
}

const PLACEHOLDER = { worker: '11'.repeat(32), buyer: '22'.repeat(32), referee: '33'.repeat(32), taskId: 'cc'.repeat(8), deadline: 'dd'.repeat(8) };

export interface BondParties {
  workerPubkeyHex: string;   // 32-byte x-only
  buyerPubkeyHex: string;    // 32-byte x-only
  refereePubkeyHex: string;  // 32-byte x-only
  taskId: string;            // 8-byte hex
  deadlineMillis: bigint;
}

/** The redeem script (hex) for a specific bond -- worker, buyer, referee, task and deadline bound in. */
export function quorumBondScript(p: BondParties): string {
  const hex32 = (n: string, v: string): string => { if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error(`quorum-bond: ${n} must be 32-byte hex`); return v.toLowerCase(); };
  let hex = Buffer.from(CONTRACT.compiled.bytecode).toString('hex');
  hex = swapExactly(hex, PLACEHOLDER.worker, hex32('worker', p.workerPubkeyHex), 1, 'worker');
  hex = swapExactly(hex, PLACEHOLDER.buyer, hex32('buyer', p.buyerPubkeyHex), 1, 'buyer');
  hex = swapExactly(hex, PLACEHOLDER.referee, hex32('referee', p.refereePubkeyHex), 1, 'referee');
  if (!/^[0-9a-f]{16}$/i.test(p.taskId)) throw new Error('quorum-bond: taskId must be 8-byte hex');
  hex = swapExactly(hex, PLACEHOLDER.taskId, p.taskId.toLowerCase(), 1, 'taskId');
  hex = swapExactly(hex, PLACEHOLDER.deadline, encodeDeadline(p.deadlineMillis), 1, 'deadline');
  if (hex.length / 2 > 520) throw new Error(`quorum-bond: redeem script ${hex.length / 2} bytes, over the 520 limit`);
  return hex;
}

/**
 * The ordered witness data for a bond spend (before P2SH push encoding): the entry's arguments, then
 * the dispatch tag, then the redeem script -- the order the fount's/worker's ScriptBuilder pushes.
 *   refund: [ workerTxSig ]      -> reclaim after the deadline
 *   slash:  [ refereeVerdictSig ] -> a guilty verdict pays the buyer
 */
export function bondWitness(entry: 'refund' | 'slash', argHex: string, redeemHex: string): string[] {
  return [argHex, bondDispatchTag(entry), redeemHex];
}

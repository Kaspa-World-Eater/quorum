/**
 * Turning the compiled ReputationDeed template into a real, per-deed redeem script -- the deterministic
 * half of putting a participant deed on chain.
 *
 * The deed differs from the bond in one way that matters: its state (good, bad) is not a fixed byte
 * placeholder but a pair of script integers baked into the redeem script, so the deed's address ROTATES
 * as the counters move. The compiler pins where that state lives (compiled.state_span = {offset, len})
 * and encodes each int as a fixed 9-byte push, so a deed at any tally is the one template with its state
 * region rewritten and its three immutable parties (authority, participantId, owner) swapped in. That is
 * exactly what the covenant's validateOutputState re-derives on chain when it continues the deed.
 *
 * The live WASM broadcast (post -> attest -> attest -> retire) is the remaining step; everything here is
 * offline and testable.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bytesToHex } from '@noble/hashes/utils';
import { le64 } from './bond.js';

const artifact = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../contracts/build/reputation-deed.json'), 'utf8'));
const CONTRACT = artifact.contracts.ReputationDeed as {
  entries: Record<string, { dispatch_tag: string }>;
  compiled: { bytecode: number[]; state_span: { offset: number; len: number } };
};
const BYTECODE = CONTRACT.compiled.bytecode;
const SPAN = CONTRACT.compiled.state_span;

/** The dispatch tag a spend pushes to select an entry, read from the compiled artifact. */
export const deedDispatchTag = (entry: 'attest' | 'rebalance' | 'retire'): string => {
  const tag = CONTRACT.entries[entry]?.dispatch_tag;
  if (!tag) throw new Error(`reputation-deed has no entry "${entry}"`);
  return tag;
};

/** One int state field as the script holds it: OpData8 (0x08) then the value in 8-byte little-endian.
 *  Fixed 9-byte width, so the state region stays at a constant offset however large the counter grows. */
export function encodeStateInt(n: bigint): number[] {
  if (n < 0n || n > 0x7fff_ffff_ffff_ffffn) throw new Error(`reputation-deed: counter ${n} out of range`);
  return [0x08, ...le64(n)];
}

const TEMPLATE_HEX = bytesToHex(Uint8Array.from(BYTECODE));

/**
 * Replace EVERY occurrence of a placeholder run with a real value, refusing unless it appears at least
 * once and none remain after. All, not one: SilverScript inlines a constructor parameter at every use
 * site, so a param used in two entries (owner, in rebalance and retire) is baked into the bytecode
 * twice, and both copies must be swapped.
 */
function swapAll(hex: string, fromHex: string, toHex: string, what: string): string {
  if (fromHex.length !== toHex.length) throw new Error(`reputation-deed: ${what} must be ${fromHex.length / 2} bytes, got ${toHex.length / 2}`);
  if (!hex.includes(fromHex)) throw new Error(`reputation-deed: ${what} placeholder not found -- template drifted`);
  const out = hex.split(fromHex).join(toHex);
  if (out.includes(fromHex)) throw new Error(`reputation-deed: a ${what} placeholder survived the swap`);
  return out;
}

export interface DeedParties {
  authorityPubkeyHex: string;   // 32-byte x-only: the adjudicator who may attest
  participantIdHex: string;     // 32-byte identity id
  ownerHex: string;             // 32-byte blake2b(ownerPubkey)
  good: number;
  bad: number;
}

/** The redeem script (hex) for a deed at a specific tally -- parties bound in, (good, bad) written into
 *  the state region at the compiler-pinned offset. Two deeds differ iff their parties or counters differ. */
export function deedRedeem(p: DeedParties): string {
  const hex32 = (n: string, v: string): string => {
    if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error(`reputation-deed: ${n} must be 32-byte hex`);
    return v.toLowerCase();
  };
  const stateHex = bytesToHex(Uint8Array.from([...encodeStateInt(BigInt(p.good)), ...encodeStateInt(BigInt(p.bad))]));
  if (stateHex.length / 2 !== SPAN.len) throw new Error(`reputation-deed: state ${stateHex.length / 2} bytes, template expects ${SPAN.len}`);
  let hex = TEMPLATE_HEX.slice(0, SPAN.offset * 2) + stateHex + TEMPLATE_HEX.slice((SPAN.offset + SPAN.len) * 2);
  hex = swapAll(hex, 'bb'.repeat(32), hex32('participantId', p.participantIdHex), 'participantId');
  hex = swapAll(hex, 'aa'.repeat(32), hex32('authority', p.authorityPubkeyHex), 'authority');
  hex = swapAll(hex, 'cc'.repeat(32), hex32('owner', p.ownerHex), 'owner');
  if (hex.length / 2 > 520) throw new Error(`reputation-deed: redeem script ${hex.length / 2} bytes, over the 520 limit`);
  return hex;
}

/**
 * The ordered witness data for a deed spend (before P2SH push encoding): the entry's arguments, then the
 * dispatch tag, then the redeem script -- the order the spender's ScriptBuilder pushes.
 *   attest:    [ authorityVerdictSig, encodedOutcome ]
 *   rebalance: [ ownerTxSig, ownerPubkey ]
 *   retire:    [ ownerTxSig, ownerPubkey ]
 */
export function deedWitness(entry: 'attest' | 'rebalance' | 'retire', args: string[], redeemHex: string): string[] {
  return [...args, deedDispatchTag(entry), redeemHex];
}

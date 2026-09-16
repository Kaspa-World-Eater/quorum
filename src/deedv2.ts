/**
 * The deterministic redeem-script layer for ReputationDeed v2 (contracts/reputation-deed-v2.sil), where
 * identity lives in the STATE. Unlike v1 -- which baked authority, participantId and owner into the
 * template and rotated its address only on (good, bad) -- v2 carries participantId and owner in the state
 * too, so the address rotates on identity as well and a registry can mint a deed with a fresh id. Only
 * `authority` stays a template placeholder.
 *
 * State layout, pinned by the compiler (state_span, 84 bytes): a byte[32] is OpData32 (0x20) then 32 bytes;
 * an int is OpData8 (0x08) then 8 little-endian bytes. So the region is
 *   0x20 ‖ participantId ‖ 0x20 ‖ owner ‖ 0x08 ‖ le64(good) ‖ 0x08 ‖ le64(bad).
 * The digests (attestDigest, verdictDigest) and the score are unchanged from v1 -- see src/deed.ts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bytesToHex } from '@noble/hashes/utils';
import { le64 } from './bond.js';

const artifact = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../contracts/build/reputation-deed-v2.json'), 'utf8'));
const CONTRACT = artifact.contracts.ReputationDeedV2 as {
  entries: Record<string, { dispatch_tag: string }>;
  compiled: { bytecode: number[]; state_span: { offset: number; len: number } };
};
const TEMPLATE_HEX = bytesToHex(Uint8Array.from(CONTRACT.compiled.bytecode));
const SPAN = CONTRACT.compiled.state_span;

/** The dispatch tag a spend pushes to select an entry, read from the compiled artifact. */
export const deedV2DispatchTag = (entry: 'attest' | 'dingByVerdict' | 'retire'): string => {
  const tag = CONTRACT.entries[entry]?.dispatch_tag;
  if (!tag) throw new Error(`reputation-deed-v2 has no entry "${entry}"`);
  return tag;
};

/** A byte[32] state field as the script holds it: OpData32 (0x20) then the 32 bytes. */
function encode32(name: string, hex: string): string {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`reputation-deed-v2: ${name} must be 32-byte hex`);
  return '20' + hex.toLowerCase();
}

/** An int state field: OpData8 (0x08) then the value in 8-byte little-endian. */
export function encodeStateInt(n: bigint): string {
  if (n < 0n || n > 0x7fff_ffff_ffff_ffffn) throw new Error(`reputation-deed-v2: counter ${n} out of range`);
  return '08' + bytesToHex(le64(n));
}

/** Replace every occurrence of a placeholder run (authority is used in two entries, so it appears twice). */
function swapAll(hex: string, from: string, to: string, what: string): string {
  if (from.length !== to.length) throw new Error(`reputation-deed-v2: ${what} must be ${from.length / 2} bytes, got ${to.length / 2}`);
  if (!hex.includes(from)) throw new Error(`reputation-deed-v2: ${what} placeholder not found -- template drifted`);
  const out = hex.split(from).join(to);
  if (out.includes(from)) throw new Error(`reputation-deed-v2: a ${what} placeholder survived the swap`);
  return out;
}

export interface DeedV2Parties {
  authorityPubkeyHex: string;   // 32-byte x-only: the adjudicator (template)
  participantIdHex: string;     // 32-byte identity id (state)
  ownerHex: string;             // 32-byte blake2b(ownerPubkey) (state)
  good: number;
  bad: number;
}

/** The redeem script (hex) for a v2 deed -- authority bound into the template, and (participantId, owner,
 *  good, bad) written into the state region, so the address rotates on identity and tally alike. */
export function deedV2Redeem(p: DeedV2Parties): string {
  const stateHex = encode32('participantId', p.participantIdHex) + encode32('owner', p.ownerHex)
    + encodeStateInt(BigInt(p.good)) + encodeStateInt(BigInt(p.bad));
  if (stateHex.length / 2 !== SPAN.len) throw new Error(`reputation-deed-v2: state ${stateHex.length / 2} bytes, template expects ${SPAN.len}`);
  let hex = TEMPLATE_HEX.slice(0, SPAN.offset * 2) + stateHex + TEMPLATE_HEX.slice((SPAN.offset + SPAN.len) * 2);
  if (!/^[0-9a-f]{64}$/i.test(p.authorityPubkeyHex)) throw new Error('reputation-deed-v2: authority must be 32-byte hex');
  hex = swapAll(hex, 'aa'.repeat(32), p.authorityPubkeyHex.toLowerCase(), 'authority');
  if (hex.length / 2 > 520) throw new Error(`reputation-deed-v2: redeem script ${hex.length / 2} bytes, over the 520 limit`);
  return hex;
}

/** The ordered witness data for a v2 deed spend: entry args, then the dispatch tag, then the redeem script. */
export function deedV2Witness(entry: 'attest' | 'dingByVerdict' | 'retire', args: string[], redeemHex: string): string[] {
  return [...args, deedV2DispatchTag(entry), redeemHex];
}

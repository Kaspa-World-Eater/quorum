/**
 * The off-chain half of quorum's on-chain slashable bond (contracts/quorum-bond.sil).
 *
 * The covenant has two doors: `refund` (worker reclaims after the deadline) and `slash` (a referee's
 * signed verdict moves the bond to the buyer). The slash door checks a referee signature over a
 * digest that commits to the payout output, so consensus enforces WHERE the slashed money goes. This
 * module computes that digest -- what the referee actually signs when quorum's adjudicate() returns a
 * guilty verdict -- and it must match the covenant's `guiltyDigest()` byte for byte.
 */
import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/** 8-byte little-endian, matching the covenant's OpNum2Bin(value, 8) and the rail's le64 convention. */
export function le64(v: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let x = v;
  for (let i = 0; i < 8; i++) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}

/** A P2PK scriptPubKey exactly as the script sees it: 2-byte version (0), push32, x-only key,
 *  OP_CHECKSIG. This is the byte form to pass as `payoutScriptPubKeyHex` for a buyer paid to P2PK. */
export function p2pkScriptPubKey(xOnlyPubkeyHex: string): string {
  return bytesToHex(new Uint8Array([0, 0, 0x20, ...hexToBytes(xOnlyPubkeyHex), 0xac]));
}

export interface GuiltyInput {
  /** the 8-byte task id the bond was posted for (hex) */
  taskId: string;
  /** the buyer's x-only public key (32-byte hex) -- who the slash pays */
  buyerPubkeyHex: string;
  /** the slashed bond value paid to the buyer, in sompi */
  payoutValueSompi: bigint;
  /** output[0]'s scriptPubKey exactly as it appears on chain (hex) -- the buyer's lock */
  payoutScriptPubKeyHex: string;
}

/**
 * The digest a referee signs to rule a worker guilty and slash its bond to the buyer:
 *   blake3( taskId || buyerPubkey || le64(payoutValue) || payoutScriptPubKey )
 * Identical to `guiltyDigest()` in contracts/quorum-bond.sil. Binding the payout output means one
 * verdict signature cannot be replayed to a different destination or amount.
 *
 * The encoding PRIMITIVES (little-endian amount, version-prefixed scriptPubKey, blake3) are validated
 * OFFLINE in bond.test.ts against a SilverScript-simulator-produced golden vector, so they agree with
 * the compiler before any chain spend -- the check that catches an endianness/serialization bug offline
 * rather than as "bad signature" on chain. This function reuses those primitives, with its field order
 * kept identical to quorum-bond.sil's guiltyDigest() by construction; the final byte-for-byte tie of
 * THIS field order is the live slash spend (or a simulator run when a test-runner build is at hand).
 */
export function guiltyDigest(i: GuiltyInput): string {
  const pre = new Uint8Array([
    ...hexToBytes(i.taskId),
    ...hexToBytes(i.buyerPubkeyHex),
    ...le64(i.payoutValueSompi),
    ...hexToBytes(i.payoutScriptPubKeyHex),
  ]);
  return bytesToHex(blake3(pre));
}

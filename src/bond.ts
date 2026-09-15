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
function le64(v: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let x = v;
  for (let i = 0; i < 8; i++) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
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
 * NOTE: the byte order follows Kaspa's OpNum2Bin/le64 convention; the round-trip of this digest
 * through a live Toccata `slash` spend is the next build slice (see docs/covenant-bond.md).
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

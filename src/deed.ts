/**
 * The off-chain half of the ReputationDeed covenant (contracts/reputation-deed.sil).
 *
 * The covenant stores only two monotonic counters, {good, bad}, and lets a named authority move them
 * one at a time. Two things live here: the digest that authority signs (which must match the covenant's
 * attestDigest() byte for byte, or the spend fails as a bad signature), and the reputation SCORE the
 * counters mean -- deliberately computed off-chain, because the chain's job is to hold an honest,
 * self-proving tally, not to opine on how to read it.
 */
import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { le64 } from './bond.js';

export interface AttestInput {
  /** this deed's identity id (32-byte hex) -- immutable, part of the deed's address */
  participantIdHex: string;
  /** the deed's current tally the signature is bound to */
  good: number;
  bad: number;
  /** the outcome being attested: 1 = good, 0 = bad */
  outcome: 0 | 1;
}

/**
 * The digest the authority signs to attest one outcome for THIS deed at its current tally:
 *   blake3( participantId || le64(good) || le64(bad) || le64(outcome) )
 * Identical to attestDigest() in contracts/reputation-deed.sil. Binding the current (good, bad) makes
 * the signature single-use -- it stops matching the moment the counters advance, so a captured
 * attestation cannot be replayed. The final byte-for-byte tie is the live attest spend.
 */
export function attestDigest(i: AttestInput): string {
  if (i.outcome !== 0 && i.outcome !== 1) throw new Error('reputation-deed: outcome must be 0 or 1');
  if (i.good < 0 || i.bad < 0) throw new Error('reputation-deed: counters are non-negative');
  const pre = new Uint8Array([
    ...hexToBytes(i.participantIdHex),
    ...le64(BigInt(i.good)),
    ...le64(BigInt(i.bad)),
    ...le64(BigInt(i.outcome)),
  ]);
  return bytesToHex(blake3(pre));
}

/**
 * The reputation the on-chain tally means, computed OFF-chain. A Laplace-smoothed success rate in
 * (0, 1): a fresh deed with no history reads exactly 0.5, one good mark lifts it, one bad mark lowers
 * it, and it converges on good/(good+bad) as evidence accumulates. Anyone who reads the deed computes
 * the same number, which is what "self-proving reputation" means.
 */
export function reputationScore(good: number, bad: number): number {
  if (good < 0 || bad < 0) throw new Error('reputation-deed: counters are monotonic and non-negative');
  return (good + 1) / (good + bad + 2);
}

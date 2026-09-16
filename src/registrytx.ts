/**
 * The deterministic layer for the DeedRegistry (contracts/deed-registry.sil): the pieces needed to deploy
 * a registry and to mint a ReputationDeed v2 from it, off-chain and testable.
 *
 * A registry is pinned to one deed TEMPLATE via a 32-byte hash. The hash is what SilverScript's
 * validateOutputStateWithTemplate checks, and its formula is fixed by the compiler:
 *   templateHash = blake3( le64(prefix.length) ‖ prefix ‖ le64(suffix.length) ‖ suffix )
 * where prefix/suffix are the v2 deed's bytecode either side of its state region (with the adjudicator's
 * key baked in). Confirmed byte-for-byte against the compiler's own compiled.template_hash.
 *
 * The minted deed's participantId is derived on chain from the spent registration outpoint
 * (blake2b("DeedRegistry.participantId" ‖ txid ‖ index)); this file only builds the redeem/hashes.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { blake3 } from '@noble/hashes/blake3';
import { blake2b } from '@noble/hashes/blake2b';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { le64 } from './bond.js';
import { deedV2Redeem } from './deedv2.js';

const deedArtifact = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../contracts/build/reputation-deed-v2.json'), 'utf8'));
const DEED_SPAN = deedArtifact.contracts.ReputationDeedV2.compiled.state_span as { offset: number; len: number };

const regArtifact = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../contracts/build/deed-registry.json'), 'utf8'));
const REGISTRY = regArtifact.contracts.DeedRegistry as { entries: Record<string, { dispatch_tag: string }>; compiled: { bytecode: number[] } };
const DEED_TEMPLATE_PLACEHOLDER = 'ee'.repeat(32);

/** The v2 deed template, split either side of the state region, with `authority` baked in. State values
 *  are irrelevant to prefix/suffix, so any tally works -- 0/0 here. */
export function deedTemplateParts(authorityPubkeyHex: string): { prefixHex: string; suffixHex: string; templateHashHex: string } {
  const redeem = hexToBytes(deedV2Redeem({ authorityPubkeyHex, participantIdHex: '00'.repeat(32), ownerHex: '00'.repeat(32), good: 0, bad: 0 }));
  const prefix = redeem.slice(0, DEED_SPAN.offset);
  const suffix = redeem.slice(DEED_SPAN.offset + DEED_SPAN.len);
  const preimage = new Uint8Array([...le64(BigInt(prefix.length)), ...prefix, ...le64(BigInt(suffix.length)), ...suffix]);
  return { prefixHex: bytesToHex(prefix), suffixHex: bytesToHex(suffix), templateHashHex: bytesToHex(blake3(preimage)) };
}

/** The 32-byte template hash a registry commits to, for deeds under this adjudicator. */
export const deedTemplateHash = (authorityPubkeyHex: string): string => deedTemplateParts(authorityPubkeyHex).templateHashHex;

/** The participantId the registry will mint for a spend of the given outpoint -- matches the covenant's
 *  blake2b("DeedRegistry.participantId" ‖ txid ‖ index_le32). Lets a client predict the minted id/address. */
export function mintedParticipantId(outpointTxidHex: string, outpointIndex: number): string {
  if (!/^[0-9a-f]{64}$/i.test(outpointTxidHex)) throw new Error('registry: outpoint txid must be 32-byte hex');
  const idx = new Uint8Array([outpointIndex & 0xff, (outpointIndex >> 8) & 0xff, (outpointIndex >> 16) & 0xff, (outpointIndex >> 24) & 0xff]);
  const pre = new Uint8Array([...new TextEncoder().encode('DeedRegistry.participantId'), ...hexToBytes(outpointTxidHex.toLowerCase()), ...idx]);
  return bytesToHex(blake2b(pre, { dkLen: 32 }));
}

/** The registry's redeem script for a given deed template hash (the adjudicator it mints under). */
export function registryRedeem(deedTemplateHashHex: string): string {
  if (!/^[0-9a-f]{64}$/i.test(deedTemplateHashHex)) throw new Error('registry: deedTemplate must be 32-byte hex');
  let hex = Buffer.from(REGISTRY.compiled.bytecode).toString('hex');
  const count = hex.split(DEED_TEMPLATE_PLACEHOLDER).length - 1;
  if (count !== 1) throw new Error(`registry: expected 1 deedTemplate placeholder, found ${count}`);
  hex = hex.split(DEED_TEMPLATE_PLACEHOLDER).join(deedTemplateHashHex.toLowerCase());
  if (hex.length / 2 > 520) throw new Error(`registry: redeem ${hex.length / 2} bytes, over 520`);
  return hex;
}

export const registryDispatchTag = (entry: 'register'): string => {
  const tag = REGISTRY.entries[entry]?.dispatch_tag;
  if (!tag) throw new Error(`deed-registry has no entry "${entry}"`);
  return tag;
};

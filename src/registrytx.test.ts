/**
 * The DeedRegistry's deterministic layer: it compiles, and the template hash it will check on chain is
 * computed here off-chain by the same formula the compiler uses -- proven by a golden vector against the
 * v2 deed's own compiled.template_hash, so a registry deployed with this hash accepts the canonical deed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bytesToHex } from '@noble/hashes/utils';
import { blake3 } from '@noble/hashes/blake3';
import { le64 } from './bond.js';
import { deedTemplateHash, deedTemplateParts, mintedParticipantId, registryRedeem, registryDispatchTag } from './registrytx.js';

const here = dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(readFileSync(join(here, '../contracts/build/deed-registry.json'), 'utf8')).contracts.DeedRegistry;
const deedV2 = JSON.parse(readFileSync(join(here, '../contracts/build/reputation-deed-v2.json'), 'utf8')).contracts.ReputationDeedV2;

test('the registry compiled: one register door, inside 520 bytes', () => {
  assert.ok(registry.compiled.bytecode.length <= 520, `fits (${registry.compiled.bytecode.length} bytes)`);
  assert.deepEqual(Object.keys(registry.entries), ['register']);
  assert.equal(registry.entries.register.params[0].type.kind, 'sig', 'register takes the owner signature');
});

test('THE GOLDEN VECTOR: our template-hash formula reproduces the compiler\'s exactly', () => {
  // blake3( le64(prefixLen) || prefix || le64(suffixLen) || suffix ) over the v2 deed's own bytecode must
  // equal the compiler-stored compiled.template_hash -- the tie that makes a registry accept the deed.
  const bc = Uint8Array.from(deedV2.compiled.bytecode);
  const span = deedV2.compiled.state_span;
  const prefix = bc.slice(0, span.offset);
  const suffix = bc.slice(span.offset + span.len);
  const pre = new Uint8Array([...le64(BigInt(prefix.length)), ...prefix, ...le64(BigInt(suffix.length)), ...suffix]);
  assert.equal(bytesToHex(blake3(pre)), bytesToHex(Uint8Array.from(deedV2.compiled.template_hash)), 'the registry checks the same hash the compiler committed');
});

test('deedTemplateParts: prefix + suffix split the deed around its state, hash is 32 bytes', () => {
  const p = deedTemplateParts('ab'.repeat(32));
  const span = deedV2.compiled.state_span;
  assert.equal(p.prefixHex.length / 2, span.offset, 'prefix is the bytecode before the state region');
  assert.equal(p.suffixHex.length / 2, deedV2.compiled.bytecode.length - span.offset - span.len, 'suffix is the bytecode after it');
  assert.match(p.templateHashHex, /^[0-9a-f]{64}$/);
  assert.notEqual(deedTemplateHash('ab'.repeat(32)), deedTemplateHash('cd'.repeat(32)), 'a different adjudicator is a different template');
});

test('mintedParticipantId is deterministic in the spent outpoint and distinct per outpoint', () => {
  const a = mintedParticipantId('11'.repeat(32), 0);
  assert.match(a, /^[0-9a-f]{64}$/, '32-byte hex');
  assert.equal(mintedParticipantId('11'.repeat(32), 0), a, 'deterministic');
  assert.notEqual(mintedParticipantId('11'.repeat(32), 1), a, 'a different output index is a different id');
  assert.notEqual(mintedParticipantId('22'.repeat(32), 0), a, 'a different funding tx is a different id');
  assert.throws(() => mintedParticipantId('11', 0), /32-byte hex/);
});

test('registryRedeem binds the deed template, distinct per adjudicator, placeholder gone', () => {
  const a = registryRedeem(deedTemplateHash('ab'.repeat(32)));
  assert.ok(!a.includes('ee'.repeat(32)), 'no deedTemplate placeholder run remains');
  assert.ok(a.length / 2 <= 520, 'fits the element limit');
  assert.notEqual(registryRedeem(deedTemplateHash('cd'.repeat(32))), a, 'a registry for a different adjudicator is a different lane');
  assert.throws(() => registryRedeem('ab'), /32-byte hex/);
});

test('the register entry has a dispatch tag', () => {
  assert.match(registryDispatchTag('register'), /^[0-9a-f]{8}$/);
  assert.throws(() => registryDispatchTag('nope' as 'register'), /no entry/);
});

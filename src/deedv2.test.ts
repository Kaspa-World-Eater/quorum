/**
 * ReputationDeed v2 -- identity as state -- reconstructed off-chain. Same discipline as v1: the covenant
 * compiles, and the per-deed redeem is rebuilt from the compiled template so a deed's address (which now
 * rotates on identity AND tally) can be derived. The final tie to the compiler is the live v2 spend.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deedV2Redeem, deedV2DispatchTag, encodeStateInt } from './deedv2.js';

const artifact = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../contracts/build/reputation-deed-v2.json'), 'utf8'));
const CONTRACT = artifact.contracts.ReputationDeedV2;

const P = {
  authorityPubkeyHex: 'ab'.repeat(32),
  participantIdHex: '0123456789abcdef'.repeat(4),
  ownerHex: 'cd'.repeat(32),
};

test('the v2 deed compiled: identity in state, three doors, at or under 520 bytes', () => {
  assert.ok(CONTRACT.compiled.bytecode.length <= 520, `fits the element limit (${CONTRACT.compiled.bytecode.length} bytes)`);
  for (const door of ['attest', 'dingByVerdict', 'retire']) assert.ok(CONTRACT.entries[door], `has entry ${door}`);
  assert.equal(CONTRACT.runtime_state.fields.map((f: { name: string }) => f.name).join(','), 'participantId,owner,good,bad', 'state carries identity + tally');
});

test('deedV2Redeem: the template length, no authority placeholder left behind', () => {
  const redeem = deedV2Redeem({ ...P, good: 0, bad: 0 });
  assert.equal(redeem.length / 2, CONTRACT.compiled.bytecode.length, 'same length as the compiled template');
  assert.ok(!redeem.includes('aa'.repeat(32)), 'no authority placeholder run remains');
});

test('deedV2Redeem writes identity AND tally into the state region', () => {
  const redeem = deedV2Redeem({ ...P, good: 5, bad: 2 });
  const span = CONTRACT.compiled.state_span;
  const stateHex = redeem.slice(span.offset * 2, (span.offset + span.len) * 2);
  const expected = '20' + P.participantIdHex + '20' + P.ownerHex + encodeStateInt(5n) + encodeStateInt(2n);
  assert.equal(stateHex, expected, 'state is 0x20‖pid ‖ 0x20‖owner ‖ 0x08‖le64(good) ‖ 0x08‖le64(bad)');
});

test('the v2 address rotates on identity, not just the tally', () => {
  const base = deedV2Redeem({ ...P, good: 0, bad: 0 });
  assert.notEqual(deedV2Redeem({ ...P, participantIdHex: 'fe'.repeat(32), good: 0, bad: 0 }), base, 'a different id is a different deed');
  assert.notEqual(deedV2Redeem({ ...P, ownerHex: '11'.repeat(32), good: 0, bad: 0 }), base, 'a different owner too');
  assert.notEqual(deedV2Redeem({ ...P, good: 1, bad: 0 }), base, 'and the tally still rotates it');
  assert.notEqual(deedV2Redeem({ ...P, authorityPubkeyHex: 'ee'.repeat(32), good: 0, bad: 0 }), base, 'a different authority (template) too');
});

test('deedV2Redeem refuses malformed 32-byte fields', () => {
  assert.throws(() => deedV2Redeem({ ...P, participantIdHex: 'ab', good: 0, bad: 0 }), /32-byte hex/);
  assert.throws(() => deedV2Redeem({ ...P, authorityPubkeyHex: 'zz'.repeat(32), good: 0, bad: 0 }), /32-byte hex/);
  assert.throws(() => encodeStateInt(-1n), /out of range/);
});

test('each v2 entry has a distinct dispatch tag', () => {
  const tags = ['attest', 'dingByVerdict', 'retire'].map((e) => deedV2DispatchTag(e as 'attest'));
  assert.equal(new Set(tags).size, 3, 'no two doors share a tag');
  assert.throws(() => deedV2DispatchTag('nope' as 'attest'), /no entry/);
});

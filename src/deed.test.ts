/**
 * The ReputationDeed is real code, not prose: the covenant compiles to Kaspa script, the digest the
 * authority signs is pinned here, and the per-deed redeem script is reconstructed from the compiled
 * template so a deed's rotating address can be derived off-chain. The final byte-for-byte tie to the
 * compiler is the live attest spend, exactly as it was for the bond.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { attestDigest, reputationScore, verdictDigest } from './deed.js';
import { deedRedeem, deedDispatchTag, encodeStateInt } from './deedtx.js';

const artifact = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../contracts/build/reputation-deed.json'), 'utf8'));
const CONTRACT = artifact.contracts.ReputationDeed;

const PARTIES = {
  authorityPubkeyHex: 'ab'.repeat(32),
  participantIdHex: '0123456789abcdef'.repeat(4),
  ownerHex: 'cd'.repeat(32),
};

test('the deed covenant compiled: three doors, inside Kaspa\'s 520-byte limit', () => {
  assert.ok(CONTRACT.compiled.bytecode.length <= 520, `fits the element limit (${CONTRACT.compiled.bytecode.length} bytes)`);
  for (const door of ['attest', 'dingByVerdict', 'retire']) assert.ok(CONTRACT.entries[door], `has entry ${door}`);
  assert.equal(CONTRACT.runtime_state.fields.map((f: { name: string }) => f.name).join(','), 'good,bad', 'state is (good, bad)');
});

test('attestDigest binds the id, the current tally, and the outcome', () => {
  const base = { ...PARTIES, good: 5, bad: 2, outcome: 1 as const };
  const d = attestDigest(base);
  assert.match(d, /^[0-9a-f]{64}$/, '32-byte hex');
  assert.equal(attestDigest(base), d, 'deterministic');
  assert.notEqual(attestDigest({ ...base, outcome: 0 }), d, 'a different outcome is a different digest');
  assert.notEqual(attestDigest({ ...base, good: 6 }), d, 'a different good count -> the old signature stops matching');
  assert.notEqual(attestDigest({ ...base, bad: 3 }), d, 'a different bad count -> single-use');
  assert.notEqual(attestDigest({ ...base, participantIdHex: 'ff'.repeat(32) }), d, 'a verdict cannot be replayed onto another deed');
});

test('attestDigest refuses an outcome that is not 0 or 1', () => {
  assert.throws(() => attestDigest({ ...PARTIES, good: 0, bad: 0, outcome: 2 as unknown as 0 }), /outcome/);
});

test('reputationScore: a fresh deed reads 0.5, good lifts it, bad lowers it, and it converges', () => {
  assert.equal(reputationScore(0, 0), 0.5, 'no history is the neutral prior, not zero');
  assert.ok(reputationScore(1, 0) > 0.5, 'a good mark lifts it');
  assert.ok(reputationScore(0, 1) < 0.5, 'a bad mark lowers it');
  assert.ok(reputationScore(98, 0) > reputationScore(8, 0), 'more clean evidence reads higher');
  assert.ok(Math.abs(reputationScore(999, 1) - 0.998) < 0.01, 'converges on good/(good+bad)');
  assert.throws(() => reputationScore(-1, 0), /non-negative/);
});

test('encodeStateInt is a fixed 9-byte push: OpData8 then 8-byte little-endian', () => {
  assert.deepEqual(encodeStateInt(0n), [0x08, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(encodeStateInt(1n), [0x08, 1, 0, 0, 0, 0, 0, 0, 0], 'little-endian');
  assert.deepEqual(encodeStateInt(258n), [0x08, 2, 1, 0, 0, 0, 0, 0, 0]);
  assert.equal(encodeStateInt(123456n).length, 9, 'always 9 bytes, so the state region stays fixed');
  assert.throws(() => encodeStateInt(-1n), /out of range/);
});

test('deedRedeem: the template length, inside 520, with no placeholder left behind', () => {
  const redeem = deedRedeem({ ...PARTIES, good: 0, bad: 0 });
  assert.equal(redeem.length / 2, CONTRACT.compiled.bytecode.length, 'same length as the compiled template');
  assert.ok(redeem.length / 2 <= 520, 'fits the element limit');
  for (const ph of ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32)]) {
    assert.ok(!redeem.includes(ph), `no ${ph.slice(0, 2)}.. placeholder run remains`);
  }
});

test('deedRedeem writes the tally into the state region, so the address rotates with the counters', () => {
  const at00 = deedRedeem({ ...PARTIES, good: 0, bad: 0 });
  const at50 = deedRedeem({ ...PARTIES, good: 5, bad: 0 });
  const at05 = deedRedeem({ ...PARTIES, good: 0, bad: 5 });
  assert.notEqual(at50, at00, 'one good mark is a different deed script -> a different address');
  assert.notEqual(at05, at00, 'one bad mark too');
  assert.notEqual(at50, at05, 'good and bad are not interchangeable');
  const span = CONTRACT.compiled.state_span;
  const stateHex = at50.slice(span.offset * 2, (span.offset + span.len) * 2);
  assert.equal(stateHex, Buffer.from([...encodeStateInt(5n), ...encodeStateInt(0n)]).toString('hex'), 'the state region is exactly encode(good)||encode(bad)');
});

test('deedRedeem binds the parties: different authority, id, or owner is a different deed', () => {
  const base = deedRedeem({ ...PARTIES, good: 0, bad: 0 });
  assert.notEqual(deedRedeem({ ...PARTIES, authorityPubkeyHex: 'ee'.repeat(32), good: 0, bad: 0 }), base);
  assert.notEqual(deedRedeem({ ...PARTIES, participantIdHex: 'fe'.repeat(32), good: 0, bad: 0 }), base);
  assert.notEqual(deedRedeem({ ...PARTIES, ownerHex: '11'.repeat(32), good: 0, bad: 0 }), base);
  assert.throws(() => deedRedeem({ ...PARTIES, authorityPubkeyHex: 'ab', good: 0, bad: 0 }), /32-byte hex/);
});

test('verdictDigest binds both outputs, so one signature authorises the slash and the ding together', () => {
  const o0 = { valueSompi: 1_000_000_000n, spkHex: '0000' + '20' + 'ab'.repeat(32) + 'ac' };
  const o1 = { valueSompi: 500_000_000n, spkHex: '0000' + 'aa20' + 'cd'.repeat(32) + '87' };
  const d = verdictDigest(o0, o1);
  assert.match(d, /^[0-9a-f]{64}$/, '32-byte hex');
  assert.equal(verdictDigest(o0, o1), d, 'deterministic');
  assert.notEqual(verdictDigest({ ...o0, valueSompi: o0.valueSompi + 1n }, o1), d, 'moving a sompi on output 0 changes it');
  assert.notEqual(verdictDigest(o0, { ...o1, spkHex: '0000' + 'aa20' + 'ee'.repeat(32) + '87' }), d, 'a different deed continuation changes it');
  assert.notEqual(verdictDigest(o1, o0), d, 'the two outputs are not interchangeable');
});

test('each entry has a distinct dispatch tag', () => {
  const tags = ['attest', 'dingByVerdict', 'retire'].map((e) => deedDispatchTag(e as 'attest'));
  assert.equal(new Set(tags).size, 3, 'no two doors share a tag');
  assert.throws(() => deedDispatchTag('nope' as 'attest'), /no entry/);
});

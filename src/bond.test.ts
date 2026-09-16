/**
 * The slashable bond is real code now, not prose: the covenant compiles to Kaspa script within the
 * size limit, and the digest the referee signs binds the payout so a verdict can't be redirected.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { guiltyDigest } from './bond.js';

const artifact = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../contracts/build/quorum-bond.json'), 'utf8'));

test('the bond covenant compiled: three doors (refund/slash/slashAndDing), inside Kaspa\'s 520-byte limit', () => {
  const c = artifact.contracts.QuorumBond;
  assert.deepEqual(Object.keys(c.entries).sort(), ['refund', 'slash', 'slashAndDing']);
  assert.ok(c.compiled.bytecode.length <= 520, `fits the element limit (${c.compiled.bytecode.length} bytes)`);
  assert.equal(c.entries.refund.params[0].type.kind, 'sig', 'refund takes the worker signature');
  assert.equal(c.entries.slash.params[0].type.kind, 'datasig', 'slash takes the referee verdict signature');
  assert.equal(c.entries.slashAndDing.params[0].type.kind, 'datasig', 'the composed slash takes the referee verdict signature');
});

test('the guilty digest is deterministic and binds the payout destination and amount', () => {
  const base = { taskId: 'cc'.repeat(8), buyerPubkeyHex: '22'.repeat(32), payoutValueSompi: 3_000_000n, payoutScriptPubKeyHex: 'aa'.repeat(35) };
  const d = guiltyDigest(base);
  assert.match(d, /^[0-9a-f]{64}$/);
  assert.equal(guiltyDigest(base), d, 'deterministic for the same verdict');
  assert.notEqual(guiltyDigest({ ...base, payoutScriptPubKeyHex: 'bb'.repeat(35) }), d, 'a redirected payout changes the digest');
  assert.notEqual(guiltyDigest({ ...base, payoutValueSompi: 3_000_001n }), d, 'a changed amount changes the digest');
});

test('the digest encoding agrees with the SilverScript compiler (simulator golden vector)', async () => {
  // Offline proof that our le64 + p2pk + blake3 primitives match the SCRIPT, using kaspa-depin's
  // digest_check.tests.json golden digest -- which was produced by the SilverScript simulator, not by
  // hand. Reproducing it with our own encoding proves the compiler and our TypeScript agree, the exact
  // check that catches an endianness/serialization bug offline instead of as "bad signature" on chain.
  const { blake3 } = await import('@noble/hashes/blake3');
  const { bytesToHex, hexToBytes } = await import('@noble/hashes/utils');
  const { le64, p2pkScriptPubKey } = await import('./bond.js');
  const cat = (...a: Uint8Array[]) => new Uint8Array(a.flatMap((u) => [...u]));
  // JobEscrowV2.verdictDigest over jobId cc*8, outputs [(60000000, 11*32), (39000000, 22*32)]
  const pre = cat(
    hexToBytes('cccccccccccccccc'),
    le64(60_000_000n), hexToBytes(p2pkScriptPubKey('11'.repeat(32))),
    le64(39_000_000n), hexToBytes(p2pkScriptPubKey('22'.repeat(32))),
  );
  assert.equal(bytesToHex(blake3(pre)), '8662afb2cce1a3466e6c6680140b9eb9e4f44ddcef11922f344882d1261fea86',
    'our encoding reproduces the simulator-produced digest -> it matches the compiler');
});

test('quorumBondScript binds real parties into a valid redeem script (placeholders gone, still fits)', async () => {
  const { quorumBondScript, encodeDeadline, bondDispatchTag } = await import('./bondtx.js');
  const script = quorumBondScript({
    workerPubkeyHex: 'ab'.repeat(32), buyerPubkeyHex: 'cd'.repeat(32), refereePubkeyHex: 'ef'.repeat(32),
    taskId: '0123456789abcdef', deadlineMillis: 1_800_000_000_000n,
  });
  assert.ok(script.length / 2 <= 520, `fits the element limit (${script.length / 2} bytes)`);
  assert.ok(script.includes('ab'.repeat(32)) && script.includes('cd'.repeat(32)) && script.includes('ef'.repeat(32)), 'real keys bound in');
  assert.ok(!script.includes('11'.repeat(32)) && !script.includes('33'.repeat(32)), 'placeholders replaced');
  assert.equal(encodeDeadline(1n), '0100000000000000', 'deadline is little-endian 8 bytes');
  assert.notEqual(bondDispatchTag('refund'), bondDispatchTag('slash'), 'refund and slash select different entries');
});

test('bondLock derives a deterministic P2SH lock, distinct per bond', async () => {
  const { quorumBondScript } = await import('./bondtx.js');
  const { bondLock } = await import('./bondlock.js');
  const a = quorumBondScript({ workerPubkeyHex: 'ab'.repeat(32), buyerPubkeyHex: 'cd'.repeat(32), refereePubkeyHex: 'ef'.repeat(32), taskId: '0123456789abcdef', deadlineMillis: 1_800_000_000_000n });
  const b = quorumBondScript({ workerPubkeyHex: 'ab'.repeat(32), buyerPubkeyHex: 'cd'.repeat(32), refereePubkeyHex: 'ef'.repeat(32), taskId: 'fedcba9876543210', deadlineMillis: 1_800_000_000_000n });
  const lockA = bondLock(a);
  assert.match(lockA, /^[0-9a-f]+$/i, 'a serialized scriptPublicKey');
  assert.equal(bondLock(a), lockA, 'deterministic');
  assert.notEqual(bondLock(b), lockA, 'a different task is a different bond and a different lock');
});

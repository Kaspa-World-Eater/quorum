# DeedRegistry — minting consensus-unique identities

*The fabric's identity primitive: a covenant that mints ReputationDeed v2 deeds with ids no one can
choose. Covenant compiled and the deterministic layer tested; the live mint is the remaining step.*

## What it is

Each live registry UTXO is one **immutable registration lane**. A `register` spend recreates the lane
verbatim and emits exactly one fresh deed, whose `participantId` is derived from the **spent registration
outpoint**:

```
participantId = blake2b("DeedRegistry.participantId" ‖ outpoint_txid ‖ outpoint_index)
```

No mutable counter, so many lanes register in parallel — the DAG-native uniqueness dotk's keyspace and
chess `league.sil` both use. Nobody can pick their own id (it's the hash of an outpoint that doesn't exist
until the registering transaction is mined), and nobody can mint a duplicate. The registry is pinned to one
deed **template** (which carries the adjudicator), so only canonical v2 deeds under that authority can mint.

Covenant: **[contracts/deed-registry.sil](../contracts/deed-registry.sil)**, **241 bytes**, one door
`register(sig ownerSig, pubkey ownerPk, byte[] deedPrefix, byte[] deedSuffix)`. It uses
`validateOutputStateWithTemplate` to spawn the deed and the KIP-20 auth-group ops to pin the two outputs
(lane recreated at output 0, deed minted at output 1).

## The template hash (the deterministic tie)

A registry commits to a 32-byte hash of the deed template, and `validateOutputStateWithTemplate` checks it
on chain. The formula is fixed by the compiler and now reproduced off-chain in
[src/registrytx.ts](../src/registrytx.ts), **proven byte-for-byte against the compiler's own
`compiled.template_hash`** by a golden vector:

```
templateHash = blake3( le64(prefix.length) ‖ prefix ‖ le64(suffix.length) ‖ suffix )
```

where `prefix` / `suffix` are the v2 deed's bytecode either side of its 84-byte state region, with the
adjudicator baked in. `deedTemplateParts(authority)` returns all three (prefix, suffix, hash) for a given
adjudicator; `mintedParticipantId(txid, index)` predicts the id a spend will mint. So a client can derive
the minted deed's address before the registry runs — self-proving, as ever.

## What's done, and what's next

- **Done:** the covenant compiles (241 B); `registrytx.ts` builds the registry redeem, the template hash
  (golden-vector-tied), and the minted id; 48 tests green.
- **Next — the live mint.** This is the most involved transaction we build: `register` spends the lane as a
  **v1 covenant transaction** with KIP-20 **auth-group outputs** (the recreated lane and the spawned deed),
  using the covenant-group tx machinery already proven in `live-covgroup.ts` (v1 tx, per-input
  `computeBudget`, covenant bindings). The steps: deploy a registry lane pinned to a chosen adjudicator's
  `deedTemplateHash`; then `register` — recreate the lane, spawn the deed at `participantId =
  blake2b(domain ‖ this outpoint)`, and confirm the minted deed is spendable via its own `attest`. Once it
  mints, an identity in this system is something the chain hands out, not something a participant asserts.

## The line, still

Unique, unforgeable ids make impersonation impossible and give reputation a stable anchor. They do not make
the adjudicator honest, and they do not touch the fake-viewer problem. Identity you can trust; judgement you
still have to earn.

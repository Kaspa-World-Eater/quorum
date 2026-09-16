# ReputationDeed v2 — identity as state

*Design note, 2026-09-16. The redesign that unlocks the next fabric phase: minting deeds from a registry,
one deed reading another, and portable reputation. Compiled and validated; not yet adopted.*

## Why v1 can't go further

The [live-proven v1 deed](reputation-deed.md) bakes `authority`, `participantId`, and `owner` into its
**template** as constructor params. That is clean for a hand-posted deed, and it is why the slash-and-ding
composition had to bind the two covenants with a *shared signature over the outputs* rather than a real
read. But it blocks everything past that:

- **Minting.** A registry gives each new deed an id derived from the spent registration outpoint, computed
  *at mint time*. You cannot bake a value that doesn't exist yet into a template — it has to be written as
  **state**.
- **Cross-deed reads.** `readInputStateWithTemplate` decodes a sibling into a `State` struct. For one deed
  to read another's identity or tally, those fields must be **in the state**, not the template.

Both are the same fix: move identity into state, exactly as chess `player.sil` carries `player_id` in
`PlayerState`.

## The v2 shape

`contracts/reputation-deed-v2.sil`, compiled:

```
ReputationDeedV2(pubkey authority, byte[32] initParticipantId, byte[32] initOwner, int initGood, int initBad)
  state:  { participantId, owner, good, bad }     (span 84 bytes)
  doors:  attest / dingByVerdict / retire         (same dispatch tags as v1)
  size:   520 bytes  (exactly the limit)
```

Two deliberate calls:

- **`authority` stays a template pubkey, not state.** One adjudicator governs a registry's deeds and never
  changes, so keeping it in the template lets `checkMsgSig` use it directly (a `byte[32]` state field is
  *not* accepted where a `pubkey` is expected — the compiler refuses it), and it keeps the state and the
  script small. Only what varies per deed — participantId, owner, tally — is state.
- **`owner` is `blake2b(ownerPubkey)`**, still, and `retire` still verifies `blake2b(ownerPk) == owner`.

## The one caveat, stated plainly

It compiles to **exactly 520 bytes — zero spare.** Any further field or door overflows, so v2 as written is
full. If the registry needs the deed to carry more (a "minted-by" marker, say), the deed has to be
decomposed the way chess split its board, or a door dropped. Measure before adding anything.

## Adoption is a cascade (the next phase's first task)

Switching from v1 to v2 is not a drop-in — it ripples:

1. **Rewrite the deterministic layer.** `deedtx.ts` currently swaps three template placeholders and writes
   an 18-byte `(good, bad)` state. v2 has one template placeholder (`authority`) and an 84-byte
   `(participantId, owner, good, bad)` state — the address now rotates on identity too, not just the tally.
2. **Re-prove the deed and the composition on v2** — the live `attest → retire` and the `slash-and-ding`
   round-trips, since the state layout and address derivation changed.
3. **Then build the registry** (`league.sil`-shaped): a `DeedRegistry` lane that, per registration, recreates
   itself and spawns a v2 deed with `participantId = blake2b(domain ‖ spent-outpoint)` — consensus-unique
   ids, no counter, parallel lanes (the DAG-native property), via `validateOutputStateWithTemplate`.

That order — layer, re-prove, then registry — is the same rhythm every covenant here has followed:
deterministic first, live second, compose third.

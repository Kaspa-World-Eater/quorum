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

## Adoption cascade — progress

Switching from v1 to v2 ripples; the order is layer, re-prove, then registry.

1. **Deterministic layer — DONE.** `src/deedv2.ts` rebuilds the v2 redeem: one template placeholder
   (`authority`) and an 84-byte `(participantId, owner, good, bad)` state, so the address rotates on
   identity as well as tally. Unit-tested (`src/deedv2.test.ts`).
2. **Re-prove the deed live — DONE.** `kaspa-depin/scripts/live-deedv2.ts` (`npm run live:deedv2`) moved a
   v2 deed `0/0 → 1/0 → 1/1` across three rotating addresses, refused a stale attestation, and retired the
   stake (`9000cd55…`) — identity-as-state is tied to consensus. The **composition needs no rework**: the
   bond's `slashAndDing` never inspects the deed's structure (it checks output 0 and the shared verdict
   digest), so it already composes with a v2 deed as-is.
3. **Build the registry — NEXT** (`league.sil`-shaped): a `DeedRegistry` lane that, per registration,
   recreates itself and spawns a v2 deed with `participantId = blake2b(domain ‖ spent-outpoint)` —
   consensus-unique ids, no counter, parallel lanes (the DAG-native property), via
   `validateOutputStateWithTemplate`. This is the piece v2 was for.

# The read verb: slash and ding, atomically

*Design note, 2026-09-16. How the fourth covenant verb — `readInputState`, covenants reading each other
in one transaction — turns the bond and the deed from two proven-but-separate covenants into the fabric's
first genuine composition. Not yet built; this dials in exactly what to build, and names the risks first.*

## The goal, in one sentence

A referee's guilty verdict should, in **one transaction**, both slash the worker's bond to the buyer
**and** ding the worker's reputation deed — so a slash and its reputation consequence can never diverge,
and no coordinator is trusted to keep them in step.

Today those are two separate acts: `quorum-bond.sil`'s `slash` moves money; `reputation-deed.sil`'s
`attest` moves a counter. Both are [proven live](reputation-deed.md). Nothing binds them together, so a
slash could happen with no reputation cost, or a deed could be dinged with no real slash behind it.

## The transaction shape

One KIP-20 **covenant group** with two covenant inputs and two covenant outputs:

```
inputs                                   outputs
 [0] bond UTXO      (door: slashAndDing)   [0] slashed bond   -> buyer   (P2PK)
 [1] worker's deed  (door: dingByBond)     [1] deed continued -> bad + 1 (rotated P2SH)
```

Both inputs carry the same covenant id, so each script can see the other with the KIP-20 introspection
ops that `chess/player.sil` already uses and compiles:

```
byte[32] cov = OpInputCovenantId(this.activeInputIndex);
require(OpCovInputCount(cov) == 2);
int sibling = OpCovInputIdx(cov, /* the other seat */);
State other = readInputStateWithTemplate(sibling, prefixLen, suffixLen, siblingTemplate);
```

`readInputStateWithTemplate` proves the sibling's redeem matches its P2SH `scriptPubKey` before decoding,
so neither covenant can be fooled by a look-alike input.

## The two new doors (additive — the proven paths stay untouched)

Nothing changes about `refund` / `slash` / `attest` / `rebalance` / `retire`. Composition is a **new
entry on each covenant**, so the live-proven doors keep their exact bytes and behaviour.

- **bond `slashAndDing(datasig verdictSig)`** — the existing slash (referee's `checkMsgSig` over the
  guilt digest, output 0 pays the buyer), **plus**: read input 1 as a `ReputationDeed`, require it is the
  *worker's* deed and that output 1 continues it to `bad + 1`. The bond refuses to slash unless the ding
  rides along.
- **deed `dingByBond()`** — no authority signature at all. Instead: read input 0 as a `QuorumBond`,
  require it is being slashed for *this* participant, and continue the deed to `bad + 1`. The deed dings
  **only because a validly-slashed bond is present in the same transaction** — the referee's verdict on
  the bond is the authorization, inherited through the read.

## The binding: one identity

For the reads to mean anything, the bond's `worker` and the deed must be the *same participant*. This is
exactly why the participant deed is the identity primitive: the bond's `worker` pubkey should be the key
the deed is owned by. So the linkage check is:

```
bond.worker  ==  the key behind  deed.owner        (deed.owner = blake2b(worker))
```

Each side reads the other's committed party and requires this equality. A slash of worker A's bond can
only ding worker A's deed; it cannot be pointed at worker B's reputation.

## A wrinkle found while designing this: the bond is stateless

`readInputStateWithTemplate` decodes a sibling's **`State`** struct — and `quorum-bond.sil` has none. Its
parties are constructor params baked into the address; it carries no runtime state to read. So the deed
cannot literally *read the bond's state*, because there isn't any. Two honest ways forward:

- **A — shared verdict signature (simplest, atomic, not strictly the read verb).** Both `slashAndDing`
  and `dingByBond` require the *same* referee datasig over one digest that commits to **both** output 0
  (the buyer's slash payout) and output 1 (the deed at `bad + 1`). One verdict authorizes both actions;
  consensus enforces that both outputs are present and exact, so it is all-or-nothing without either
  covenant reading the other. This works today, with no new introspection.
- **B — make the read real.** Give the bond a small `State` (or read its committed `worker` via a
  template read of its redeem), so the deed can genuinely introspect the bond input and require it is
  being slashed for this worker. This is the true `readInputState` composition, and the right shape once
  more than two objects compose — but it is more script and touches the bond's layout.

**Recommendation:** ship **A** first — it delivers the atomic slash-and-ding with the least risk and no
change to the proven bond — then demonstrate the read verb properly on a **deed-to-deed** interaction
(e.g. one deed vouching for another), where both sides are stateful and the read is natural, exactly the
shape `chess/player.sil` uses. That separates "atomic composition" (valuable now) from "the read verb"
(valuable as the objects multiply), instead of forcing both through one stateless-bond-shaped hole.

## Why this is the payoff, not just a feature

It is the first time two tools compose into something **neither can do alone**, enforced by consensus
rather than by an off-chain coordinator holding them in sync. Slash-and-ding becomes a single atomic
fact: all of it, or none of it. That is the shape every later composition takes — deliver + pay +
bump-rep + refile-card in one transaction — so getting this one right is getting the pattern right.

## Risks, named before building

1. **The 520-byte element limit.** The deed is already 411 bytes; adding `dingByBond` with a
   `readInputStateWithTemplate` and the covenant-group ops may push it over 520. **Measure first.** If it
   overflows, decompose the way chess did — commit the read parameters to a hash and carry the preimage
   in the witness, or split the composed door into its own template. Do not assume it fits.
2. **Co-spend construction is new tx-layer territory.** The bond and deed live drivers each spent one
   covenant input; a covenant *group* of two inputs sharing a covenant id has to be built with the WASM
   SDK, and that mechanism is unproven in our tooling. Spike the two-input covenant-group tx on its own
   before wiring the real bond+deed.
3. **Direction.** Mutual reads (each covenant reads the other) cost the most script. A first build can be
   one-directional — only the **deed reads the bond** — which is enough for "a slash dings the deed" and
   roughly halves the added logic. Add the reverse read (the bond requiring the ding) second.

## Spike results (2026-09-16)

**Risk 1 — the covenant side compiles.** [contracts/covgroup-spike.sil](../contracts/covgroup-spike.sil)
is the smallest covenant that may be spent only in a group of exactly two and reads its sibling's state.
It compiles to **94 bytes**: `OpInputCovenantId` / `OpCovInputCount` / `OpCovInputIdx` and same-template
`readInputState` all work with our silverc. The read verb is expressible; the remaining question is size
once it's grafted onto the 411-byte deed (measure at build time).

**Risk 2 — the WASM SDK supports covenant groups.** kaspa-wasm 2.0.1 exposes exactly the primitives a
genesis + group-spend needs, so the live tx is buildable (unlike a missing-feature dead end):

- `covenantId(genesisOutpoint, authOutputs)` derives the shared id from a genesis outpoint and its
  authorized outputs;
- `new TransactionOutput(value, spk, covenant?)` where `covenant` is a
  `CovenantBinding { authorizingInput, covenantId }` — this is how an output is bound to a covenant;
- `GenesisCovenantGroup(authorizingInput, outputs[])` binds several outputs to one id at genesis;
- a `covenantsEnabled` flag on the relevant config.

So the genesis tx creates two outputs bound to one `covenantId`, and spending both forms the group
`OpCovInputCount` sees as 2. The open work is purely construction: the high-level `createTransaction`
builds standard outputs, so the genesis (and likely the group spend) must be assembled at the
`Transaction` / `TransactionOutput` level with bindings attached, then broadcast — new tx-layer territory,
now scoped, and its own focused effort.

## Build order for this piece

Path A (atomic slash-and-ding) first, then the read verb proper:

1. **Spike the two-input covenant-group transaction** with the WASM SDK — two covenant inputs sharing one
   covenant id, two constrained outputs. This is the unproven tx-layer mechanic (risk 2), and both paths
   need it. Prove it on a throwaway pair before touching bond or deed.
2. **Add a composed door to each covenant that checks one shared verdict digest** (path A): the bond's
   `slashAndDing` and the deed's `dingByBond` each require the referee's datasig over a digest committing
   to both outputs, and each requires exactly the two outputs present. Measure both covenants stay ≤520.
   Then the deterministic layer + a live `verdict → slash + ding` round-trip, the rhythm the bond and deed
   each already went through.
3. **Demonstrate the read verb properly, deed-to-deed** (path B): a `vouch` where one stateful deed reads
   another via `readInputStateWithTemplate`, the natural shape once objects multiply — de-risking the true
   composition without the stateless-bond wrinkle.

The teeth already bite and the reputation already moves. This is where they start moving *together*.

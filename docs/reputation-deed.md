# ReputationDeed — an identity whose reputation is on-chain state

*The first plank of the fabric: stop storing reputation in five separate databases and make it one
self-proving covenant object. Proven live on testnet-10, 2026-09-16.*

## What it is

A participant — a fount, a worker, a publisher, one identity across every tool — holds one **deed**.
Its state is two monotonic counters, `{good, bad}`: how many times the **authority** (the adjudicator
both sides named, exactly quorum's referee) attested a good or a bad outcome. The deed's address *is*
its state — `P2SH(template ‖ {good, bad})` — so it **rotates every time the tally moves**, and anyone
who reads the deed off-chain computes the same reputation. Nothing to trust but the chain.

Contract: **[contracts/reputation-deed.sil](../contracts/reputation-deed.sil)**, 411 bytes, three doors:

```
attest(datasig authoritySig, int outcome)   the authority moves one counter; the deed CONTINUES itself
rebalance(sig ownerSig, pubkey ownerPk)      the owner adjusts the stake, state unchanged
retire(sig ownerSig, pubkey ownerPk)         the owner closes and reclaims the stake
```

## The two ideas it is built on

- **The continue verb.** `attest` ends with `validateOutputState(0, State { good: nextGood, bad: nextBad })`
  — it requires the spend to re-create *this same covenant* with the counter raised by one. This is the
  verb the bond never used; the metered session covenant already proved it live, and the deed is our
  first covenant to carry *reputation* forward this way.
- **Monotonic counters, never subtraction.** SilverScript's undefined behaviour is fail-open, so a
  reputation that could subtract would let a bad spend succeed on an underflow. Instead it is two
  counters that only rise (chess `player.sil`'s wins/losses shape), and the score is computed off-chain
  in **[src/deed.ts](../src/deed.ts)** `reputationScore` — a Laplace-smoothed rate, 0.5 for a fresh deed.

## Single-use attestations

The digest the authority signs binds the **current** `(good, bad)`:
`blake3(participantId ‖ le64(good) ‖ le64(bad) ‖ le64(outcome))`
([src/deed.ts](../src/deed.ts) `attestDigest`, identical to the covenant's). Once the deed advances the
old digest no longer matches, so a captured attestation cannot be replayed — the state is its own nonce.

## Proven live on testnet-10

`kaspa-depin/scripts/live-deed.ts` (`npm run live:deed`) posts a deed and moves it on a real node:

- **post → attest good → attest bad → retire** — reputation went `0/0 → 1/0 → 1/1` across **three real
  transactions, each at a different deed address** (retire `ec4177ec…`). The owner reclaimed the stake.
- **A stale `(0,0)` attestation replayed against the `(1,0)` deed was refused** by consensus
  (`failed to verify`, `9f287b26…`) — the byte-for-byte tie of `attestDigest`'s encoding to the compiled
  covenant, the confirmation only a chain can give.

Two live lessons are baked into the code now: the WASM fee estimator under-pays this tx's mass, so the
funding change output is forced directly; and the covenant's **fee allowance is 1,000,000** because the
node demanded 405400 for the attest's mass on a live run — metered's 400000 was measured for a different
spend and silently forbade every attest until this was raised.

## What it does NOT do

It makes cheating **accountable**, not impossible. A patient sybil doing real cheap work still earns real
marks; the covenant enforces *who* may move the tally and that the deed continues intact, not whether the
authority judged honestly (that stays quorum's off-chain `adjudicate` + adaptive-audit problem). And it
does nothing for the publisher-pays fake-viewer problem. The teeth, not the judge.

## Next

The deed is the keystone. On it: mint deeds from a `league.sil`-style registry (unique ids from the
spent outpoint, parallel lanes); the **read verb** (`readInputState`) so a quorum bond slash can bump the
same deed atomically; and the shared-identity wiring that lets one deed's reputation count in kascade,
quorum and flume at once — the emergent payoff the fabric exists for.

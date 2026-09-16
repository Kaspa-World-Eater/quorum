# quorum

**Pay for verified compute on Kaspa. A result is paid only when independent workers agree — and a
worker that fabricates a result forfeits its bond.**

**→ [Read what quorum is, in one page](https://kaspahttp402.github.io/quorum/)** — the rule in four verdicts, the economics, and the honest boundary.

[metered](https://github.com/kaspahttp402/metered-protocol) settles work a buyer can **count** —
bytes, tokens. It cannot reach **compute**, because a buyer usually cannot cheaply recompute a
result to check it. Renting a GPU to run a job you can't verify is renting on trust, which is why
the compute marketplaces that exist all need a trusted operator in the middle holding the money.

quorum removes the operator. When you can't measure a result directly, **agreement measures it for
you**: run the task on independent workers, and pay only when they agree. Disagreement doesn't just
fail the task — it attributes blame, so the worker who lied can be **slashed** and the honest one
paid, all settled on the same [kaspa-x402](https://kaspa-x402.org) escrow rail that
[spigot](https://github.com/kaspahttp402/spigot) and [flume](https://github.com/kaspahttp402/flume)
use.

## The rule, in four outcomes

A verdict about a task is one of exactly four things, and each maps to one settlement — nothing else
is allowed to move money:

| Verdict | Means | Settlement |
|---|---|---|
| **agree** | the workers produced the same result | **pay** them for it |
| **resolved** | a referee caught one lying | **pay** the honest, **slash** the liar's bond |
| **undecided** | two disagree, no referee has ruled | **hold** — no money moves yet |
| **inconclusive** | all three differ (an environment fault) | **refund** the buyer; punish nobody |

The last one is the point most systems get wrong: three different results is almost never two liars,
it's non-determinism — a mismatched build, a different backend, a driver. Slashing there punishes
honest workers for the market's failure to pin the environment down. quorum refunds instead.

A worker is paid for a **result**, not for effort, and its **bond** — posted up front, forfeit only
when a referee catches it — is what makes "I did the work" cost something to fake.

## What is here

The whole pipeline, as pure decisions -- provable before any money is at stake. Each step reads the
step before it and moves nothing:

| | |
|---|---|
| `src/replication.ts` | **replicate?** -- `shouldReplicate(task, worker)` decides whether a task is double-run at all. A newcomer or a caught worker always; a proven worker only at a periodic audit floor. `replicationFactor` quotes the honest cost (~1.05x earned, 2x not). Vendored from kaspa-depin. |
| `src/adjudication.ts` | **agree?** -- `adjudicate(a, b, referee?)` decides agree / resolved / undecided / inconclusive from content hashes, and names who lied. Vendored from kaspa-depin, generalised from rendering to any deterministic-output task. |
| `src/settle.ts` | **verdict -> money** -- `settleVerified(verdict, terms)` turns a verdict into pay / pay-and-slash / hold / refund. |
| `src/parties.ts` | the on-chain handles a settlement touches: the buyer's channel, each worker's payout address and posted bond. |
| `src/plan.ts` | **money -> rail actions** -- `planActions(settlement, parties)` emits the exact, ordered moves: the price split exhaustively across the paid, every bond released to the honest or slashed to the buyer, never both. |

```bash
npm install
npm test          # 21 tests: replicate? -> agree? -> verdict -> rail actions, end to end
```

## Status

The entire pipeline runs as pure decisions, pinned by 21 tests: from "should this task be
double-run?" through "did the workers agree?" to "what moves on the rail, and to whom." Nothing
touches the chain yet -- on purpose, so every rule is provable before any money is at stake.

**Honest limits.** Two things the pure logic does not do on its own: (1) the default audit sample is
deterministic and *public* — reproducible, but not unpredictable. A submitter free to choose task ids
can see which go un-audited and shop for them unless the injected `hash` is secret-keyed (an HMAC a
trusted scheduler holds until the task ids are fixed). (2) Worker *agreement* is evidence, not proof:
it supports a correct result only when the workers are genuinely independent and the task is
reproducible, and an `inconclusive` verdict does not identify its own cause — commonly environment
non-determinism, but a coordinated fault is not excluded.

**Next, in order:** the one open design question is the **bond**. metered's escrow is a one-way
buyer-to-seller channel; a bond a fraud verdict can slash is a different shape -- a worker locks
funds that release back to it on honest completion or a timeout, and to the buyer on a `resolved`
verdict. That wants real research on the kaspa-x402 covenant rather than a rushed escrow (metered's
own lesson). After it: execute a `RailAction` list live on testnet; then a first real vertical -- a
deterministic GPU job (a render, a seeded inference) -- end to end.

## The bond, on chain

quorum's slash was pure logic — a number in a settlement, with no on-chain teeth — because the kaspa-x402 escrow is the wrong shape for a bond a third party's verdict can seize. Kaspa's **Toccata** upgrade (live on mainnet 2026-06-30) changes that: its introspection opcodes let a covenant enforce where its money goes, so a bond can have two doors — refund to the worker after a timeout, or **slash to the buyer** on a referee's guilt verdict. **The covenant is proven live on testnet-10** -- [contracts/quorum-bond.sil](contracts/quorum-bond.sil), both doors (refund/slash) with their refusals broadcast end to end ([docs/covenant-bond.md](docs/covenant-bond.md)). Built and proven live on the same rhythm since: a reputation deed ([docs/reputation-deed.md](docs/reputation-deed.md)), an atomic slash-and-ding composition ([docs/read-verb-composition.md](docs/read-verb-composition.md)), and an identity-minting registry ([docs/deed-registry.md](docs/deed-registry.md)).

**The honest gap** (audit, 2026-09-16): all of that is proven covenant *mechanics*, exercised only by hand-run `live-*` scripts, and **not yet wired into the product**. `settle()` still returns a `pay-and-slash` *decision* -- a number -- and nothing calls the bond covenant to execute it on chain; `plan.ts` says as much ("not yet executable"). Bridging settle's decision to an on-chain covenant spend is the real next step -- wiring, not more covenants.

## Licence

MIT.

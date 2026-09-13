# quorum

**Pay for verified compute on Kaspa. A result is paid only when independent workers agree — and a
worker that fabricates a result forfeits its bond.**

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
| `src/replication.ts` | **replicate?** -- `shouldReplicate(task, worker)` decides whether a task is double-run at all. A newcomer or a caught worker always; a proven worker only at a random audit floor. `replicationFactor` quotes the honest cost (~1.05x earned, 2x not). Vendored from kaspa-depin. |
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

**Next, in order:** the one open design question is the **bond**. metered's escrow is a one-way
buyer-to-seller channel; a bond a fraud verdict can slash is a different shape -- a worker locks
funds that release back to it on honest completion or a timeout, and to the buyer on a `resolved`
verdict. That wants real research on the kaspa-x402 covenant rather than a rushed escrow (metered's
own lesson). After it: execute a `RailAction` list live on testnet; then a first real vertical -- a
deterministic GPU job (a render, a seeded inference) -- end to end.

## Licence

MIT.

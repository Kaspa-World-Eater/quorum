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

This is the first brick: the bridge from a verdict to the rail, proven in isolation.

| | |
|---|---|
| `src/adjudication.ts` | the truth oracle — `adjudicate(a, b, referee?)` decides agree / resolved / undecided / inconclusive from content hashes, and names who lied. Vendored from kaspa-depin's verification core, generalised from rendering to any deterministic-output task. |
| `src/settle.ts` | the new primitive — `settleVerified(verdict, terms)` turns a verdict into a settlement (pay / pay-and-slash / hold / refund). Pure: it names what should move, it moves nothing. |

```bash
npm install
npm test          # 8 tests: the four verdicts map to the four settlements, end to end
```

## Status

The kernel runs and is pinned by tests. Nothing touches the chain yet — `settleVerified` is a pure
decision, on purpose, so the rule is provable before any money is at stake.

**Next, in order:** post a worker's bond as a kaspa-x402 escrow the referee can slash; execute a
settlement on the metered rail (pay the honest, take the bond, refund on fault); bring in
kaspa-depin's **adaptive replication** so a trusted worker is re-run 1.05× rather than 2× while a
newcomer is always checked; then a first real vertical — a deterministic GPU job (a render, a seeded
inference) — end to end on testnet.

Built on the same don't-trust-the-report idea as metered, and on the verification core proved out in
kaspa-depin. Testnet only.

## Licence

MIT.

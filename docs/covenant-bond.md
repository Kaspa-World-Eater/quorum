# A slashable bond on Kaspa — design, grounded in Toccata

*Research note, 2026-09-13. What Kaspa's covenant upgrade makes possible for quorum, and the one
piece it unlocks: a bond a fraud verdict can actually take.*

## The gap this closes

quorum decides *who lied* — `adjudicate(a, b, referee)` returns `resolved` naming the dishonest
worker, and `settle` turns that into "pay the honest, **slash** the liar's bond." But until now the
slash was **pure logic with no on-chain teeth**: the bond was a number in a settlement plan, not
money a verdict could seize. A promise ("I did the work") only costs something to fake if the bond is
*really* takeable. The blocker was that the kaspa-x402 escrow is a one-way buyer→seller channel — the
wrong shape for a bond a *third party's ruling* can redirect.

**That blocker is gone.** [Toccata](https://docs.kaspa.org/toccata) went live on Kaspa mainnet on
2026-06-30, and it adds exactly the covenant primitives a slashable bond needs.

## What Toccata gives us (verified)

- **Transaction-introspection opcodes** ([KIP-10](https://github.com/kaspanet/kips/blob/master/kip-0010.md)):
  a script can read the spending transaction's shape — `OpTxOutputSpk` / `OpTxOutputAmount` (an
  output's destination and value), `OpTxInputAmount` / `OpTxInputSpk`, input/output counts, the
  current input index — with 8-byte arithmetic for real sompi sums. So a covenant can **enforce where
  its money goes and how much.**
- **Covenant output bindings + Covenant IDs**: outputs carry `CovenantBinding { authorizing_input,
  covenant_id }`, giving a covenant a consensus-tracked lineage independent of the P2SH hash — the
  same mechanism the kaspa-x402 escrow uses for channel identity.
- **Conditional payouts** and **script pricing** (a per-input compute budget), and even **ZK-proof
  verification** (Groth16 / RISC Zero) inside script.

## The design: a bond with two doors

A worker posts a bond into a covenant with exactly two ways to spend it. The parties are fixed when
the bond is created: the **worker** (who posted it), the **buyer** (who is owed if the work was
fake), and a **referee key** (the adjudicator whose ruling is decisive — see limits).

**Door 1 — refund (the honest path).** After an absolute `timeoutDaa`, a transaction signed by the
worker may spend the bond, provided an output returns the bond to the worker. Enforced with a
worker-signature check plus the timeout — the same timed-refund path the kaspa-x402 escrow already
uses. If no one ever proved fraud, the worker gets its bond back.

**Door 2 — slash (the fraud path).** *Before* the timeout, a transaction may spend the bond **iff**
it carries a valid **referee signature over the canonical guilt message** — `covenantId ‖ taskId ‖
"guilty"` — **and** the covenant checks, with introspection, that an output pays the **buyer**:

```
# slash branch, in KIP-10 terms (pseudocode)
<referee_sig> <referee_pubkey> OpCheckSigVerify        # the referee ruled "guilty" on this bond+task
0 OpTxOutputSpk    <buyer_p2pk>       OpEqualVerify     # output 0 must pay the buyer
0 OpTxOutputAmount <bond_sompi>       OpGreaterThanOrEqual   # ...at least the bond
```

The verdict quorum already produces — `resolved` names the dishonest worker — is what the referee
signs. On chain the covenant does not re-run the adjudication; it checks a signature over the ruling
and forces the money to the buyer. That is the whole of the on-chain slash.

*(Optional, trustless variant: replace the referee signature with a **ZK proof** that the two
testimonies and the referee's output resolve against this worker, verified by Toccata's proof
opcodes. Heavier; the signature form is enough for a designated-adjudicator model and ships first.)*

## Honest limits — what this does and does not solve

- It enforces **"given a valid verdict from the agreed adjudicator, the bond is slashable, and only
  to the buyer."** It does **not** decide the verdict — quorum's off-chain `adjudicate` +
  adaptive replication + reputation does that. The covenant is the teeth, not the judge.
- It therefore inherits quorum's trust in the **referee/adjudicator**. Who adjudicates honestly, and
  resistance to a captured or colluding adjudicator, is a reputation/replication problem, not one a
  covenant closes. The ZK variant narrows this (the proof, not a trusted signer, decides) but does
  not remove the need to define what a correct result *is*.
- It is **not** a fix for the collusion problem in *publisher-pays delivery* (a fount and a fake
  viewer colluding to drain a budget). Toccata can *verify* a delivery proof, but a valid proof of
  delivery to a colluding viewer is still valid — covenants don't decide who is a real consumer.

## Where the suite's other hard problems land, post-Toccata

| Problem | Toccata unlocks it? |
|---|---|
| **quorum's slashable bond** | **Yes** — this doc. Conditional payout + introspection + a verdict signature. |
| Cascade channel *reuse* (voucher ceiling across gathers) | Not a covenant issue — a client fix (thread `previouslyVouched` through the voucher signer). |
| Publisher-pays delivery (collusion-resistant) | No — proof *verification* exists, but who attests real delivery is unsolved. |
| Retention / proof-of-storage payments | Partly — a challenge or storage proof is verifiable, but the payment-collusion economics remain. |

## Next build

Prototype the bond covenant against a Toccata-enabled node: express the two branches in the covenant
toolchain, and run `post → resolved verdict → slash to buyer` and `post → timeout → refund to worker`
end to end — the same shape spigot/flume/cascade proved for the payment channel, now for the bond.
This turns quorum's `settle`/`plan` from a decision into an *enforced* one.

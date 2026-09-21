# Forum post for Kas-Smiths (paste this to open the discussion thread)

Suggested title:  Three covenant KCCs for reputation, bonds, and identity (live on testnet-10)

---

Hi all. I would like to vet three related Standards Track KCC drafts before opening PRs, per the KCC-0 process. All three build on KCC-1 (covenant ABI) and KCC-2 (authority schemes), and all three have a working reference implementation that has been broadcast end to end on testnet-10, with byte-exact conformance vectors taken from that code.

They are meant to compose into one set for paying strangers for work no one can cheaply re-verify: a bond makes lying cost something, a deed records whether a participant has behaved, and a registry hands out the identities the deed attaches to.

1. Reputation Deed Covenant. A covenant holding a stable identity and two monotonic counters, good and bad, that a named authority advances one signed mark at a time. The signature binds the current tally, so an attestation is single use. The reputation number is computed off chain from the same two counters, so the chain holds facts and readers decide how to weigh them.

2. Slashable Bond Covenant. A bond a worker funds that either refunds to the worker after a deadline or slashes to a named buyer on a referee's signed verdict. The verdict digest commits to the payout output, so consensus enforces where the money goes. A third door slashes the bond and dings a deed atomically under one referee signature.

3. Deed Identity Registry. A covenant pinned to one deed template that anyone may spend to mint a fresh deed. The identity is derived on chain from the spent registration outpoint, so every minted id is unique and unforgeable.

What I am looking for before I PR:

- Whether the byte layouts and digests sit correctly on KCC-1, and whether I should express the authorities any differently under KCC-2 (they currently use scheme 0x00).
- Whether the shared verdictDigest is the right seam for composing two covenants without either reading the other's state, or whether there is a preferred convention for atomic composition.
- Whether reputation belongs in a KCC at all, or whether the community would rather standardise identity and leave the tally to applications.

Reference implementation, contracts, tests, and the live-proof scripts:  https://github.com/kaspahttp402/quorum

Full drafts (Abstract, Specification, Rationale, Conformance Vectors, Reference Implementation, Security Considerations) are attached / linked below. Happy to revise on feedback before anything goes to kaspanet/kccs. Thanks for reading.

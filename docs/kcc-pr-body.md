This PR adds three related Standards Track / Category: Covenant KCCs as Draft. They build on KCC-1 (covenant ABI) and KCC-2 (authority schemes), and each has a working reference implementation broadcast end to end on testnet-10, with byte-exact conformance vectors taken from that code.

- Reputation Deed Covenant — a monotonic good/bad tally advanced by a named authority with single-use signed marks; the reputation number is read off chain.
- Slashable Bond Covenant — a worker-funded bond that refunds after a deadline or slashes to a buyer on a referee's verdict that commits to the payout output; a third door slashes and dings a deed atomically.
- Deed Identity Registry — a covenant pinned to one deed template that mints fresh deeds whose identity is derived on chain from the spent registration outpoint.

The three share one seam: a verdictDigest over both transaction outputs lets the bond and the deed compose atomically without either covenant reading the other's program.

Discussion thread (Kas-Smiths): https://kas-smiths.org/t/three-covenant-kccs-for-reputation-bonds-and-identity-live-on-testnet-10/148
Reference implementation: https://github.com/Kasp-World-Eater/quorum

Requesting numbers to be assigned. Happy to split into separate PRs if the editors prefer. These `Requires: KCC-1, KCC-2` and are submitted as Draft; they are not proposed for Final ahead of their dependencies.

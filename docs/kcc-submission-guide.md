# KCC submission guide — the two steps that are yours

Everything is drafted and ready in `quorum/docs/`:

- `kcc-reputation-deed.md`
- `kcc-slashable-bond.md`
- `kcc-identity-registry.md`
- `kcc-forum-post.md` (the text to paste)

Two actions go out under your name, so they are yours to do. Both are copy-paste-and-click.

---

## Step 1 — Forum first (required by KCC-0 before any PR)

1. Go to the Kas-Smiths forum and start a new thread.
2. Paste the contents of `kcc-forum-post.md` (title line is suggested at the top).
3. Attach or link the three draft files (the forum accepts markdown; or link them from the quorum repo once pushed).
4. Post. Copy the thread URL.
5. Give me the URL and I will drop it into the `Comments-URI:` field of all three drafts.
6. We revise based on feedback. Draft status is meant for exactly this — expect changes, that is the point.

I cannot do this step: I have no forum account, and it must be posted as you.

---

## Step 2 — PR to kaspanet/kccs (after the forum has looked)

The editors assign the real KCC numbers, so we submit with the template's `KCC: ?` and let them number it (KCC-0 lets them assign sequentially). Files in that repo are named `kcc-NNNN.md`; until a number is assigned, use a descriptive branch and let the editor rename, or ask in the PR for numbers.

Exact commands (run from anywhere; `gh` is already signed in as `Kasp-World-Eater`):

```
gh repo fork kaspanet/kccs --clone --remote
cd kccs
git checkout -b reputation-bond-registry-kccs

# copy the three drafts in (rename to kcc-NNNN.md if the editors pre-assign numbers)
cp "/c/Users/derek/OneDrive/Desktop/quorum/docs/kcc-reputation-deed.md"   ./kcc-reputation-deed.md
cp "/c/Users/derek/OneDrive/Desktop/quorum/docs/kcc-slashable-bond.md"    ./kcc-slashable-bond.md
cp "/c/Users/derek/OneDrive/Desktop/quorum/docs/kcc-identity-registry.md" ./kcc-identity-registry.md

git add kcc-*.md
git commit -m "Add reputation deed, slashable bond, and identity registry KCCs (Draft)"
git push -u origin reputation-bond-registry-kccs
gh pr create --repo kaspanet/kccs --title "Reputation, bond, and identity registry covenant KCCs" --body-file "/c/Users/derek/OneDrive/Desktop/quorum/docs/kcc-pr-body.md"
```

Because `gh` is signed in as your account, I *can* run these for you if you explicitly say "open the PR" — but I will not do it on my own, since it publishes under your identity to a public standards repo. Your call.

---

## The one dependency to keep in mind

Our three KCCs `Requires: KCC-1, KCC-2`, and those are themselves still Draft. Ours can be published as Draft now, but per KCC-0 they cannot reach Final until KCC-1 and KCC-2 are Final. So a good parallel move is to engage on the KCC-1 and KCC-2 threads — our live-proven implementation is real evidence for them — which both helps finalize our dependencies and makes us visible as a serious contributor to the core standards.

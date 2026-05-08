**Status:** authoritative reference for niche-edge-cases catalogue contributions. Cited from `contributing-to-element-interactions/SKILL.md`.

**Scope:** when a failure shape qualifies for the catalogue, the entry shape, the three shipping pathways, cross-link discipline, and what does NOT belong.

---

## 📚 Contributing to the niche-edge-cases catalogue

`skills/failure-diagnosis/references/niche-edge-cases.md` documents failure shapes that LLMs routinely misclassify during the `failure-diagnosis` pipeline. It's a living catalogue: new entries are added as diagnostic sessions surface new shapes that trap the diagnoser and aren't already covered. The full criteria + entry template live in that file's §"Adding an entry"; this section explains the contribution path and how it slots into the rest of this skill's PR conventions.

### When an entry qualifies

All three must hold:

1. **The shape misclassifies in practice.** Stage 0 + Stage 4 of `failure-diagnosis/SKILL.md` weren't enough to land the right answer cleanly — the diagnoser went the wrong direction (or was visibly close to). The catalogue is for traps, not for failures whose classification was obvious.
2. **The disambiguating probe was non-obvious.** The thing that flipped the classification (a specific tool call, DOM read, evidence grab) is what the next diagnoser most needs. "Look at the screenshot more carefully" is not a probe.
3. **The shape is reproducible across consumers.** A bug in *this app's* checkout flow is a project finding (goes in that project's bug ledger). A bug shape any consumer of the package could plausibly hit (modal-fetch hangs, stale page-repo entry resolves to a hidden duplicate, role-attribute serialisation breaking implicit ARIA roles, etc.) is catalogue-worthy.

If any criterion fails: don't add an entry. The catalogue's value is in being skimmable during a live diagnosis, not in being exhaustive.

### Entry shape

Five fields per entry — Symptom / Why LLMs struggle / Disambiguating probe / Classification / Cross-link. One paragraph per field is the target. The full template + worked examples live in `niche-edge-cases.md`'s §"Adding an entry" — read it once before authoring your first entry; it's the single source of truth for the structure.

### How to ship the addition

Three pathways depending on what you're already shipping:

| Situation | PR shape |
|---|---|
| **You're already mid-PR for something else** (a hook fix, a skill rule edit, etc.) | Add the catalogue entry to the same PR — one extra commit, scope-clean (purely additive to a docs file). Mention in the PR description that the entry was discovered while debugging the PR's own work. Reviewers expect this path; it doesn't trigger a scope-split flag. |
| **You hit the niche shape outside any PR** (during a normal coverage / authoring / debugging session) | Open a small standalone PR titled `docs(failure-diagnosis): catalogue <shape-name> in niche-edge-cases`. Single-commit, single-file (this catalogue). The `docs(...)` commit-message convention from coverage-expansion's commit table applies; no version bump per Rule 15. |
| **You hit it inside a dispatched subagent** (e.g. `failure-diagnosis` sub-skill, `bug-discovery` per-journey probe) | Surface the find in the subagent's return — name the shape, the probe, and the classification. The parent orchestrator either appends to the catalogue inline (if mid-PR) or opens the standalone PR above. **Subagents do NOT push commits directly to this catalogue**, the same way they don't push commits directly to other source files; the parent owns the write. |

### Cross-link discipline

When a new entry refines an existing Stage 4 / 4a row in `failure-diagnosis/SKILL.md`, update that row to point at the new entry — short citation only (`see [\`references/niche-edge-cases.md\`](references/niche-edge-cases.md) entry (N)`), don't duplicate the entry's prose into the SKILL.md table cell. The table is the skim path; the catalogue carries the depth.

When a new entry is a brand-new shape with no existing Stage 4 / 4a row, leave the cross-link as `(none — new shape)`. Don't fabricate a Stage 4 row to point back at the entry; let the table remain stable until the shape is well-trodden enough to deserve a row.

### What does NOT belong in the catalogue

- Project-specific failure shapes (those go in the project's adversarial-findings ledger or its own bug tracker).
- War stories from a long debugging session (the catalogue is the *answer* — the trap and the probe and the classification, nothing more).
- Failure shapes whose Stage 4 row already covers them adequately (extending the existing row is sufficient).
- Anything that contradicts the canonical `subagent-return-schema.md` finding-block shape (the catalogue lives alongside the finding format, not as an alternative to it).

When in doubt: if the next diagnoser would benefit from finding your entry under a Cmd-F for the symptom keyword, add it. If they'd just shrug and skim past, leave it out.

---

**See also:** [`./api-gap-flow.md`](./api-gap-flow.md) (sibling flow when the failure was actually a missing API), [`./pr-checklist.md`](./pr-checklist.md) (the standard preflight a single-commit catalogue PR still must pass), [`./design-rules.md`](./design-rules.md) §15 (the no-version-bump rule that applies to docs-only catalogue PRs).

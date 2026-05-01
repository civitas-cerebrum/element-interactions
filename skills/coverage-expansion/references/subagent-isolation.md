# Isolated Subagent Contract — Coverage-Expansion

**Status:** authoritative spec for the dispatch contract every coverage-expansion subagent must satisfy. Cited from `coverage-expansion/SKILL.md`.
**Scope:** isolation guarantees, the brief inputs each subagent receives, the `playwright-cli` session naming convention, and the orchestrator's "never hold subagent payload content" rule.

For the canonical return shape every subagent uses, see `../element-interactions/references/subagent-return-schema.md`.
For the role-prefix routing convention used on description prefixes and CLI session slugs, see `coverage-expansion/SKILL.md` §"Role prefixes".

---

## Isolated subagent contract

### Compositional passes (1–3)

Every `test-composer` subagent dispatched by this skill must:

1. Receive an **isolated context window** — no prior session content, no other journey's data.
2. Receive only: its assigned journey block + any `sj-<slug>` sub-journey blocks it references + the current `page-repository.json` slice for the pages that journey touches.
3. Have access to an **isolated `playwright-cli` session** named `composer-<journey-slug>-<pass>-c<N>` (e.g. `composer-j-checkout-3-c1`), opened by the subagent at the start of its work and closed at the end. Sessions are OS-isolated by construction — one browser process per `-s=<name> open` — so there is no isolation-prerequisite check to run before dispatching. The subagent's brief includes a pointer to [`../element-interactions/references/playwright-cli-protocol.md`](../element-interactions/references/playwright-cli-protocol.md) §3 + §8 (the dispatch-brief template). The parent does **not** call `close-all` while subagents are working; it runs `close-all` once the pass completes as belt-and-suspenders cleanup.
4. Not return until stabilization green, API compliance review clean, and coverage verified exhaustive (enforced inside `test-composer`).
5. Return a structured discovery report only — no pasted test source, no DOM snapshots, no CLI transcripts. Returns follow the canonical return schema in [`../element-interactions/references/subagent-return-schema.md`](../element-interactions/references/subagent-return-schema.md); the dispatch brief includes a pointer to the file rather than re-pasting the schema.

### Adversarial passes (4–5)

Every adversarial probe subagent dispatched by this skill must:

1. Receive the same isolated context window as compositional-pass subagents, with its own `playwright-cli` session named `probe-<journey-slug>-<pass>` (pass = 4 or 5). Same isolation guarantee as the compositional case (per-session browser process; see `playwright-cli-protocol.md` §1).
2. Additionally receive: the pass number (4 or 5), the ledger file path (`tests/e2e/docs/adversarial-findings.md`), the lockfile path (`tests/e2e/docs/.adversarial-findings.lock`), and a pointer to the canonical schema at `skills/element-interactions/references/subagent-return-schema.md`.
3. Receive a pre-built **negative-case matrix** for the journey — one negative-case complement per `Test expectations:` entry, plus the standard cross-cutting negatives (auth tamper, tenant isolation, idempotency, session boundary, input boundaries) — derived per `references/adversarial-subagent-contract.md` §"Negative-case matrix — full QA scope". The matrix is the deterministic floor for the probe; `bug-discovery`'s open-ended categories extend above it. The orchestrator builds the matrix from the journey block before dispatch and includes it verbatim in the brief — the subagent does not re-derive it.
4. For pass 5 specifically: also receive the journey's pass-4 ledger section (read from the ledger file before dispatch and passed along — the orchestrator's single exception to the "never hold findings content" rule, bounded to one journey's section for one subagent), so the subagent can re-probe matrix entries that returned `Ambiguous` in pass 4 and run compound probes across matrix entries.
5. Follow the adversarial subagent contract in `references/adversarial-subagent-contract.md` exactly, which mandates conformance to the canonical return + ledger schema.
6. Return a structured summary only, matching the return shape in that contract. No probe transcripts, no DOM snapshots, no test source. Any per-finding detail inside the return follows the canonical finding-return format.

### Cleanup subagent (post-pass-5)

1. Single dispatch, NOT per-journey.
2. Isolated context. Receives only the ledger file path.
3. No browser session. Text-only work.
4. Returns a one-line summary of how many cross-cutting findings were consolidated and how many journeys' sections were backref'd.

The orchestrator does not paste any probe transcripts, DOM snapshots, test source, or stabilization output into its own context at any point.


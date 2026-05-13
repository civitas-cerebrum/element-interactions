# bypass-artifacts

Verbatim, byte-for-byte copies of the artifacts produced by the prior incident
Run-2 onboarding bypass session. Used by `hooks/tests/cases/24-…` through
`30-…` (exploit-replication tests) to lock the new hardening hooks against
the EXACT inputs the bypass produced — not paraphrased equivalents.

The artifacts are read-only fixtures. Do not edit them; if the upstream
shape changes, copy the new artifacts in and bump the test cases that
depend on the old shape.

| File | Source path in downstream-e2e | Used by |
|---|---|---|
| `BENCHMARK-pre-bypass.md` | `BENCHMARK.md` lines 1–308 | tests 24, 32 — the pre-bypass state (Run 0 + Run 1, no Run 2) |
| `BENCHMARK-run-2-bypass-section.md` | `BENCHMARK.md` lines 310–481 | test 24 — the verbatim Run-2 section the bypass committed |
| `onboarding-report-bypass.md` | `tests/e2e/docs/onboarding-report.md` | test 25 — the verbatim 103-line report the bypass committed |
| `coverage-expansion-state-bypass.json` | `tests/e2e/docs/coverage-expansion-state.json` | tests 26, 28, 29 — the verbatim Pass-1-only state file with 6 `blocked-dispatch-failure` dispatches |
| `onboarding-phase-ledger-bypass.json` | `tests/e2e/docs/onboarding-phase-ledger.json` | tests 24, 25, 26, 27, 28, 29 — the verbatim ledger with phases 1–4 greenlit, phases 5–7 absent |

## Cross-reference: downstream-e2e bypass commit

```
c23fbdd docs(partial): onboarding-report + coverage-expansion-state + BENCHMARK Run 2
```

The commit message itself uses the framing token "partial" — see test 30
for the framing-token coverage check, and the PR body for the open gap on a
`commit-msg` hook (no such hook exists yet; recorded as follow-up).

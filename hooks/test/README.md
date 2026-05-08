# Hook regression tests

Smoke suite for the iterative-cycle hooks. Run from the repo root:

```
hooks/test/run-tests.sh
```

Filter to a subset by passing a substring of the case name:

```
hooks/test/run-tests.sh vocab
hooks/test/run-tests.sh concurrency-log
```

The suite has no network, npm, or tarball dependencies — it execs the
hooks in-place from `hooks/<name>.sh`. `jq` must be on PATH.

## What's covered

- **Canonical vocabulary loader** — `data/canonical-sections.txt` is
  read on hook init; novel section IDs are flagged in the cycle state
  file's `unvalidated-sections-flagged` field, while canonical IDs
  (e.g. `dashboard`, `profile`) are not. The loader has a hardcoded
  fallback list when the data file is absent.

- **`parse_cycle_dispatch` warning** — when the orchestrator dispatches
  a phase4 cycle agent with a malformed description (one that doesn't
  match `phase4-cycle-N-section-id`), the hook emits a `systemMessage`
  warn instead of silently no-op'ing.

- **Concurrency-log redirect-bypass closure** — Bash redirects targeting
  the `.phase4-concurrency-log.jsonl` file are blocked on every shape:
  `>`, `>>`, `&>`, `&>>`, `tee -a`. (The `&>` form was the round-3
  reviewer Critical that motivated this suite.) Redirects targeting
  *other* files pass through without interference.

- **Cleanup deferral** — `playwright-cli-cleanup-on-stop.sh` exits 0
  without running `playwright-cli close-all` when the phase4 cycle
  state file is present, so a SubagentStop event from one cycle agent
  doesn't wipe its parallel siblings' CLI sessions.

## Adding cases

Each case is a Bash function (`case_<slug>`) that returns 0 on PASS,
nonzero on FAIL. Helpers `make_cycle_post`, `make_bash_pre`, and
`write_draft` build well-formed hook event JSON via `jq -n`. Add a
`run_case` line to the runner block at the bottom and bump the TAP
header `1..N`.

The runner gives each case its own `mktemp -d` working directory with
`tests/e2e/docs/` pre-created, and tears it down regardless of pass/fail.

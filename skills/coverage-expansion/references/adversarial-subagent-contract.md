# Adversarial Subagent Contract — Passes 4 and 5

Every subagent dispatched by `coverage-expansion` during pass 4 or pass 5 follows this contract. It is analogous to the compositional-pass subagent contract in SKILL.md but covers adversarial probing specifics.

## Inputs (given at dispatch time)

1. The assigned journey's full `### j-<slug>` block from the current `journey-map.md`.
2. Any `sj-<slug>` sub-journey blocks referenced by the journey.
3. The current `page-repository.json` slice for the pages the journey touches.
4. The pass number (4 or 5).
5. Path to `tests/e2e/docs/adversarial-findings.md` — MAY NOT YET EXIST on first pass-4 invocation; subagent is responsible for creating it from the schema if absent.
6. Path to `tests/e2e/docs/.adversarial-findings.lock` — advisory lockfile for parallel appends (see below).
7. App credentials from `app-context.md`.
8. Live docker stack URL + any secondary user accounts needed for cross-account probing.

## Behavior

1. Receive an isolated context window and an isolated Playwright MCP browser instance (same rules as compositional-pass subagents — parallel subagents never share a browser).
2. **Pass 4:** read the map block + page-repo slice + any existing composed tests for the journey. Invoke the `bug-discovery` skill scoped to this one journey. Let that skill drive probe-category selection based on live observation. Classify every finding as `Boundaries verified`, `Suspected bugs`, or `Ambiguous`. Do NOT write any tests.
3. **Pass 5:** additionally read the journey's existing section in `adversarial-findings.md` (pass-4 findings). Re-invoke `bug-discovery` with instructions to (a) resolve `Ambiguous` findings where possible, (b) attempt compound probes pass 4 did not try, (c) probe follow-ups implied by pass-4 boundary verifications. Write a passing regression test for every `Boundaries verified` finding (pass 4 + pass 5 combined) into `tests/e2e/j-<slug>-regression.spec.ts`. Never write tests for `Suspected bugs` or `Ambiguous` findings.
4. Append all new findings to the journey's section of the ledger, using the schema in `adversarial-findings-schema.md`. Create the journey section if absent. Create the ledger file with its header if absent.
5. Stabilize any regression tests written in pass 5 to 3× green using the normal test-composer stabilization loop. If stabilization fails after 3 cycles, DO NOT commit a `test.fail()` marker; instead move the finding to `Suspected bugs` with note `deterministic-test-not-feasible` and continue.
6. Return a structured discovery report to the orchestrator. No probe transcripts, no DOM snapshots, no test source.

## Ledger write discipline — file locking

Parallel subagents may try to append to `adversarial-findings.md` simultaneously. Use an advisory lockfile at `tests/e2e/docs/.adversarial-findings.lock`:

```bash
# pseudo — actual implementation uses node's lockfile package or flock
while ! mkdir tests/e2e/docs/.adversarial-findings.lock 2>/dev/null; do
  sleep 0.2
done
# ... append to adversarial-findings.md ...
rmdir tests/e2e/docs/.adversarial-findings.lock
```

Holding the lock should take under 500ms per subagent. Read the file, compute the append, write, release. Do not hold the lock during probing or any MCP calls.

## Return shape (text block, not JSON — orchestrator parses keys)

```
journey: j-<slug>
pass: 4
probes_attempted: 14
probe_categories: auth-tamper, input-tamper, price-tamper, qty-tamper, boundary-values
findings:
  boundaries_verified: 9
  suspected_bugs: 2
  ambiguous: 1
regression_tests_added: 0
high_severity_bugs_found: 0
stabilization: n/a
ledger_bytes_appended: 3412
```

```
journey: j-<slug>
pass: 5
probes_attempted: 8
probe_categories: compound, auth-tamper+qty-tamper, header-bypass, ambiguous-resolution
findings:
  boundaries_verified: 5
  suspected_bugs: 1
  ambiguous: 0
regression_tests_added: 14
high_severity_bugs_found: 1
stabilization: 3x-green-after-1-retry for 1 test; rest green-on-first
ledger_bytes_appended: 1892
```

## Hard constraints

- Pass 4 commits nothing. Only the ledger grows; the orchestrator does the commit after aggregating the dispatch's returns.
- Pass 5 commits nothing inside the subagent. The subagent writes files; the orchestrator commits after the pass completes.
- Neither pass grows the journey-map. Map growth stays with compositional passes.
- Neither pass modifies the page-repository. Page-repo growth stays with compositional passes.
- Regression tests live only in `j-<slug>-regression.spec.ts` files, one per probed journey. They never mix into `j-<slug>.spec.ts` or `*-extended.spec.ts` files.

---
name: secrets-sweep
description: >
  Phase-7 methodology for extracting hardcoded credentials, API keys,
  PII-shape literals, and app URLs out of a test suite into `.env`. Use
  this skill as the final guardrail before publishing a test suite or
  treating it as portable across environments. Returns conform to the
  ComposerReturn schema.
---

# Secrets sweep — Phase 7

The purpose of this skill is to ensure the test suite is free of hardcoded
sensitive literals before it leaves the developer's workstation. Earlier
phases enforce *runtime self-credentialing* (Phase 2's fixture mints test
users at runtime) — this phase is the **drift guard**. Even with good
discipline upstream, a literal sometimes lands in a spec. The sweep finds
and removes it.

This skill does **not** sanitise the application under test. Application
source code is out of scope. The sweep only edits files under
`tests/e2e/` and the project's root `.env` / `.env.example` /
`.gitignore`.

---

## What counts as a "secret"

Four literal classes. Each has a different remediation pattern.

| Class | Examples | Replacement |
|---|---|---|
| **Credentials** | usernames, passwords, JWT subjects, OAuth client secrets | `process.env.TEST_USER_EMAIL`, etc. |
| **API keys / tokens / cookies** | strings shaped like `sk-…`, bearer prefixes, raw 3-segment JWTs | `process.env.STRIPE_API_KEY`, etc. |
| **PII-shape test data** | email addresses or full names that look like real people | `process.env.TEST_USER_EMAIL` (default to `test@example.com` and `Test User`) |
| **App URLs / ports** | `http(s)://…` literals, `:PORT` literals | `process.env.APP_URL`, `process.env.APP_PORT` |

The convention `test@example.com` / `Test User` is acceptable as a default
placeholder. Anything resembling a real human's email or name should be
parameterised.

---

## Scope rules — what to touch

Strict allow-list. Everything else is off-limits.

| Touchable | Off-limits |
|---|---|
| `tests/e2e/**/*.spec.ts` | `src/**`, `app/**`, any application source |
| `tests/e2e/fixtures/**/*.ts` | Anything outside the test tree |
| `tests/e2e/playwright.config.ts` (if it carries hardcoded URLs) | Renames or new spec files |
| Root `.env`, `.env.example`, `.gitignore` | |

If you find a credential hard-coded in application source, **flag it in
the summary** rather than editing the application code. The application
team owns that remediation.

---

## Playbook

Work the playbook in order. Each step has a verification.

### a. List candidates

```bash
git grep -nE 'password|secret|token|api[_-]?key|bearer|sk-[A-Za-z0-9]' -- 'tests/e2e/' || true
git grep -nE '@[a-z0-9._-]+\.(com|io|net|org)' -- 'tests/e2e/' || true
git grep -nE 'https?://|:[0-9]{4,5}' -- 'tests/e2e/' || true
```

Read each hit and decide which class it belongs to. False positives
(documentation strings, deliberately-public test endpoints) are fine to
skip — note them in the summary so reviewers see the audit covered them.

### b. Pick stable env-var names

UPPER_SNAKE_CASE. Reuse the same name across files when the value is the
same. Conventional names:

| Concept | Suggested env var |
|---|---|
| Local app URL | `APP_URL` |
| Test user email | `TEST_USER_EMAIL` |
| Test user password | `TEST_USER_PASSWORD` |
| Stripe API key | `STRIPE_API_KEY` |
| OAuth client secret | `OAUTH_CLIENT_SECRET` |

### c. Replace literals in source

For each finding, replace the literal with `process.env.<NAME>`. If
TypeScript demands a non-null assertion (`process.env` is typed
`string | undefined`), use `process.env.<NAME>!` or a small helper:

```ts
function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
```

### d. Write `.env` (real values, gitignored)

```
# .env  — local values, NEVER commit
APP_URL=http://localhost:3000
TEST_USER_EMAIL=test@example.com
TEST_USER_PASSWORD=correct-horse-battery-staple
STRIPE_API_KEY=sk_test_…
```

### e. Write `.env.example` (placeholders, committed)

One comment line per variable describing what it's for. Use a clearly
non-secret placeholder.

```
# .env.example  — committed; copy to .env and fill in
# Where the dev server is reachable
APP_URL=http://localhost:3000

# Test-only login (created by the runtime self-credentialing fixture)
TEST_USER_EMAIL=your-test-user@example.com
TEST_USER_PASSWORD=<choose a strong placeholder>

# Stripe sandbox key — see https://stripe.com/docs/keys
STRIPE_API_KEY=sk_test_REPLACE_ME
```

### f. Ensure `.gitignore` covers `.env`

The file must contain at minimum:

```
.env
.env.local
.env.*.local
```

If only `.env` is present, add the two `.local` variants while you're
there — they're the standard Next.js / Vite / Astro overrides and
forgetting them is a common foot-gun.

### g. Re-scan

Re-run the grep commands from step (a). All hits should now be either
`process.env.<NAME>` references or deliberate skips you noted in step
(a).

### h. Verify

```bash
npx playwright test --list           # specs still parse + enumerate
npx playwright test --reporter=line  # full suite still passes
```

A failing suite at this point usually means an env var didn't get loaded
— check that `dotenv` (or the test harness's equivalent) runs before
the specs.

### i. Stage and commit

```
chore: extract secrets to .env
```

If the workflow is driven by an external automated orchestrator, that
orchestrator may commit on your behalf — in that case just stage the
changes.

---

## Return shape

This skill's subagent returns conform to the `composer` schema (see
`schemas/subagent-returns/composer.schema.json`). The schema's status
enum is `{blocked, skipped, new-tests-landed, covered-exhaustively}`:

- `new-tests-landed` — when `tests-added > 0` because a regression
  fixture was authored as part of the sweep.
- `covered-exhaustively` — the typical happy path: literals were
  extracted, env files written, the suite still passes, no new specs
  needed.
- `skipped` — when there is nothing to extract (suite was already
  clean). Provide a `skip-authorisation` line explaining how you
  verified.
- `blocked` — when the project structure is unrecognisable (no
  `tests/e2e/` directory, no `package.json`, etc.) or a literal lives
  in *application source* (which is out of scope for this skill);
  `blocked-reason` MUST name the un-extracted findings so the human
  can route them.

`summary` must include the env var names you defined and the count of
files modified.

---

## Common mistakes

- **Editing application source.** Out of scope. Flag and report only.
- **Forgetting `.env.local`.** Some frameworks read `.env.local` first;
  leaving it un-gitignored leaks secrets via local overrides.
- **Hardcoded `localhost:3000` left in `playwright.config.ts`.** This is
  in scope — extract to `APP_URL` so CI can point at staging.
- **Removing `test@example.com`.** That's the *acceptable* default —
  don't replace a perfectly-fine placeholder with another placeholder.
- **Touching specs that don't have literals.** If a spec is clean,
  leave it alone.

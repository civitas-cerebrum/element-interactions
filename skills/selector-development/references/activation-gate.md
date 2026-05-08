# Activation Gate: Workspace Detection and Missing-Selector Criteria

> Operational reference for the `selector-development-activation-gate.sh` hook. Describes the two preconditions that must both hold for the skill to activate, and how each is detected in the workspace.
>
> This doc mirrors the hook's deny logic; a future maintainer should be able to reproduce the gate rules from reading this file and the hook source together.

## When to activate

The skill activates **only when both gates pass**. If either gate fails, the skill exits silently with a notice to the caller.

| Gate | Rule | Deny reason |
|---|---|---|
| **Workspace gate** | Frontend source present AND tests present (see §2) | "frontend source not present" OR "tests not present" |
| **Missing-selector gate** | Element has no stable selector by any of three criteria (see §3) | skill exits silently; Stage 2 already has a working locator |

Both must hold. If workspace gate fails, the caller falls back to best-effort locators. If missing-selector gate fails, the skill skips instrumentation silently.

---

## Frontend detection signals

The workspace gate checks for **both** of these conditions:

### Condition 1: Frontend framework dependency

Check `package.json` in the workspace root for at least one of these framework dependencies:

```
react
vue
svelte
@angular/core
solid-js
preact
lit
```

Look in both `.dependencies` and `.devDependencies`. If the framework list includes any of the above, **frontend presence** is confirmed.

### Condition 2: Frontend source files

The workspace must contain at least one file matching these criteria:

**Always accepted:**
```
*.tsx
*.jsx
*.vue
*.svelte
*.html
*.htm
```

**Conditionally accepted (only under source trees):**
```
*.ts    (only under /src/, /app/, /pages/, /components/)
*.js    (only under /src/, /app/, /pages/, /components/)
```

A single file matching any of the above in the workspace tree confirms **frontend source presence**.

### Workspace root detection

The workspace root is determined in order of precedence:

1. `$WORKSPACE_ROOT` environment variable (if set)
2. Git repository top level (output of `git rev-parse --show-toplevel`)
3. Current working directory as fallback

---

## Tests-present signals

Check for the `tests/e2e/` directory under the workspace root. It must:

1. Exist as a directory
2. Contain at least one file matching `*.spec.ts`

The search is non-recursive but covers up to 4 levels deep (`find -maxdepth 4`) to account for test subdirectories. A single `*.spec.ts` file anywhere in the tree confirms **test presence**.

---

## Missing-selector gate (three criteria)

An element needs a stable selector for `selector-development` to stay inactive. If **any one** of the following three signals is true, the skill skips instrumentation silently (Stage 2 already has a working locator):

### Criterion 1: Test attribute exists

The element carries an existing test attribute in the DOM:

```
data-testid
data-cy
data-qa
data-test
```

**How to verify:** Query the DOM for the element. If any of the four attributes above is present and non-empty, this criterion is satisfied; the skill skips.

### Criterion 2: Unique role + accessible name

The element has a unique combination of ARIA role and accessible name that distinguishes it from siblings of the same type.

**How to test it:** Using the browser's accessibility tree or a testing library (e.g., Playwright's `getByRole()`), find all elements with the same role. If exactly one has the accessible name observed on the target element, and the locator is otherwise stable (name isn't dynamic or copy-driven), this criterion is satisfied. Stage 2's locator builder already has this working; the skill exits silently.

### Criterion 3: Unique stable text content

The element's text content is unique within its context and is stable (not dynamically generated, not user copy, not timestamp-driven, not loaded asynchronously).

**How to test it:** Query the DOM for elements containing the same text (exact match). If exactly one exists and the text is asserted-on by tests (not volatile), this criterion is satisfied. The skill exits silently because the locator is already stable and maintainable.

---

## Trigger sources and invocation patterns

### Source 1: Stage 2 inspection escalation

Triggered when the `element-interactions` Stage 2 orchestrator inspects an element and finds no stable selector by any of the three criteria above.

**Caller dispatch:** `mode: "jit"` with element-key and scope context
**Gate check:** Both workspace gate and missing-selector gate must pass; if either fails, return to Stage 2 with fallback notice

### Source 2: Failure-diagnosis escalation

Triggered when `failure-diagnosis` diagnoses a flake or break root cause as a fragile selector and decides to escalate.

**Caller dispatch:** `mode: "jit"` with element-key identifying the element to stabilize
**Gate check:** Both gates; abort with diagnostic notice if either fails

### Source 3: On-demand user invocation

Triggered by explicit user request:
- Single element: "add stable selectors to the checkout button" → `mode: "jit"` with element scope
- Whole app: "audit selectors across the app" → `mode: "audit"` with page-by-page dispatch (requires a complete journey map)

**Gate check:** Workspace gate always; missing-selector gate per-element (Audit mode skips elements that already have stable selectors)

---

## What to do when the gate denies

If the workspace gate fails, the caller receives a notice:

```
selector-development-activation-gate: <reason>.
selector-development requires test work to live in the same project
as the frontend source.
```

**Caller responsibility:** Fall back to best-effort locator construction (no test attributes added to the frontend). Warn the user that fragile selectors may result.

If the missing-selector gate fails, the skill exits silently; no user notification is needed because Stage 2 already has a working locator and is using it.

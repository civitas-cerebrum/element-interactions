# Audit Mode Workflow

This reference specifies the operational flow for Audit mode, which instruments stable selectors across the entire application page-by-page.

---

## 1. When Audit Mode Runs

Audit mode is **opt-in only**. It activates when the user explicitly requests whole-app instrumentation via any of:

- The phrase "audit selectors across the app"
- The phrase "instrument all pages"
- The phrase "add data-testid to every element that needs one"
- An explicit `mode: "audit"` from a programmatic caller (e.g., orchestration layer)

Default mode is JIT (one element per invocation). Audit must be explicitly requested; it does not activate on implicit or partial triggers.

---

## 2. Prerequisites

Both conditions must hold before Audit can start. If either fails, exit with a notice — do not proceed.

### Workspace gate

Both signals must be present (same as JIT mode):

- **Frontend source:** `package.json` has a frontend framework dependency; a source directory (`src/`, `app/`, or `pages/`) contains `.tsx`, `.jsx`, `.vue`, `.svelte`, or `.html` files.
- **Tests present:** `tests/e2e/` exists and contains at least one `*.spec.ts` file.

Exit with notice if either signal is missing.

### Journey map gate

A complete, sentinel-bearing `tests/e2e/docs/journey-map.md` must exist. The sentinel is mandatory: **line 1 must be `<!-- journey-mapping:generated -->`**.

If the file is missing or lacks the sentinel, exit with notice: "Journey map is incomplete or missing. Run `journey-mapping` first, then retry Audit mode."

---

## 3. The Audit Loop

The audit process iterates page-by-page through the application, instrumenting all interactive and asserted elements that lack stable selectors.

### Workflow steps

1. **Read the journey map:** Open `tests/e2e/docs/journey-map.md` and extract the ordered page list from the site map section.

2. **Initialize or read the ledger:** Load `tests/e2e/.selector-development/audit-ledger.json`. If it does not exist, initialize with an empty pages_completed array and current timestamp.

3. **For each page** (independent pages may be parallelized — see §5):
   - **Drive to the page:** Use `playwright-cli` to navigate the app to the page. Ensure the DOM is fully loaded.
   - **Snapshot and analyze:** Inspect the DOM for interactive and asserted nodes. Apply the missing-selector gate to each node in isolation.
   - **For each qualifying node:** Run the full JIT loop (one test attribute per node, one receipt per node, one commit per page). Record the attribute name, element key, and source file in the ledger.
   - **Commit boundary:** After all nodes on a page are instrumented, commit once with all changes for that page. Update the ledger: move the page-id from `pages_in_flight` to `pages_completed`.

4. **Finalize:** After all pages complete, return a summary envelope with status per page, total attributes added, and the ledger path.

---

## 4. Audit Ledger Schema

The ledger is stored at `tests/e2e/.selector-development/audit-ledger.json` and enforces uniqueness of attribute names across the entire application.

```jsonc
{
  "schema_version": 1,
  "started_at": "2026-05-08T14:32:00Z",
  "pages_completed": [
    "home",
    "product-details"
  ],
  "pages_in_flight": [
    "checkout"
  ],
  "instrumented_attributes": {
    "submit-button": {
      "page": "home",
      "element": "form.primary-button",
      "file": "src/components/Form.tsx"
    },
    "cart-total": {
      "page": "checkout",
      "element": "summary.total-price",
      "file": "src/components/CartSummary.tsx"
    }
  },
  "skipped": [
    {
      "page": "product-details",
      "element": "product.rating-stars",
      "reason": "already-stable"
    },
    {
      "page": "checkout",
      "element": "form.save-address",
      "reason": "no-inert-option"
    }
  ]
}
```

### Ledger semantics

- **schema_version:** Always `1`. Bumped on breaking changes.
- **started_at:** ISO-8601 timestamp of the first audit start (not reset on resume).
- **pages_completed:** Array of page-ids that have been fully processed (all nodes instrumented, committed, and cleared from in-flight).
- **pages_in_flight:** Array of page-ids currently being processed. Cleared on page commit or on audit resumption.
- **instrumented_attributes:** Map of kebab-case attribute values to metadata. **Every value in this map must be unique across the entire application.** If two subagents pick conflicting names, the ledger write at page commit detects the collision.
- **skipped:** Array of nodes that were analyzed but not instrumented, with reason codes: `no-inert-option`, `already-stable`, or project-specific reasons.

### Uniqueness enforcement

The ledger prevents duplicate attribute names: if a subagent attempts to write an attribute name that already exists in `instrumented_attributes` with a different element, the write is rejected. The subagent must append a numeric suffix (`submit-button-2`) and retry.

---

## 5. Parallel Dispatch

Independent pages may be instrumented in parallel, mirroring the `coverage-expansion` dispatch pattern.

### Independence criteria

Two pages are independent if they satisfy **all** of the following:

- No shared parent component (e.g., shared nav bar instrumentation does not block parallelization; each page's nav instance is separate).
- No shared route prefix (pages under `/products/*` are not independent of each other).
- No overlapping data fetches or state mutations.

### Collision prevention

Each subagent reads the ledger before writing a new attribute name:

1. **Read:** Load `instrumented_attributes` from the ledger.
2. **Propose:** Generate a kebab-case name for the element (e.g., `submit-button`).
3. **Check:** If the name already exists in the ledger with a different element, append a numeric suffix (e.g., `submit-button-2`).
4. **Retry:** Proceed with the suffixed name.
5. **Commit:** Write the ledger update at page commit.

---

## 6. Resumption

If an audit is interrupted, resume from the last incomplete page.

### Resume workflow

1. Read `audit-ledger.json`.
2. **Skip completed pages:** Pages in `pages_completed` have already been processed; skip them entirely.
3. **Restart in-flight pages:** Pages in `pages_in_flight` were not fully committed. Discard any partial receipts for those pages and reprocess them from scratch (drive to the page, re-snapshot, re-instrument all qualifying nodes).
4. **Continue with remaining pages:** Proceed with pages not yet listed in either array.
5. **Update ledger:** As each page completes, move it from `pages_in_flight` to `pages_completed`.

---

## Notes

- The audit loop reuses the JIT guardrail pipeline (typecheck, unit tests, e2e, visual diff) for every element. Failure on any step reverts the page and halts that page's processing; parallel pages continue unaffected.
- Audit mode is not suitable for partial app instrumentation. Use JIT mode for surgical, one-element edits.
- The ledger is the source of truth for resumption and deduplication. Always read it before proposing a new attribute name.

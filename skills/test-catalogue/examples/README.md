# Example Output

This skill's output is a per-project artefact and intentionally not committed to the package — keeping consumer-specific content out of the skill package is part of the universality contract.

Headline shape of a typical run:

- Cover page with app name, date, and four stat tiles (total / journeys / active / skipped).
- One section per primary structural axis derived at runtime from the journey map (URL-prefix clusters, file-name clusters, or an explicit `**Section:**` field) — plus a pinned "Cross-cutting" section for sub-journeys and regression batches.
- Adversarial-regression section listing every verified-boundary test.
- Skipped-with-reason section documenting scenarios deferred (tenant data gaps, known bugs, environmental preconditions, etc).

To produce an example for any project, run the skill in a directory that has `tests/e2e/*.spec.ts` plus a sentinel-bearing `tests/e2e/docs/journey-map.md`.

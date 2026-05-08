# Spec Parsing — Extraction Rules

The catalogue extractor walks spec files line-by-line. No AST needed — the element-interactions convention is regular enough that a scanner suffices.

## Patterns

### Describe blocks
```
test.describe('<name>', ...
test.describe.serial('<name>', ...
test.describe.parallel('<name>', ...
test.describe.skip('<name>', ...
test.describe.configure({ ... })   <- ignore, not a describe
```

Track the describe stack by balancing braces `{` / `}` from the line the describe appears on.

### Tests
Recognise only **statement-position** calls (indent level inside a describe, not inside a test body):

```
test('<name>', async ...
test.skip('<name>', async ...
test.fail('<name>', async ...
test.only(...)                     <- treat as active, warn the user
```

Ignore `test.skip(<condition>, '<reason>')` forms where the first argument is not a string literal — those are runtime skips inside a test body and do not represent structural skips.

### Skip reason capture
If the previous 1–6 lines above a `test.skip('<name>', ...` contain a single-line comment (`// …`) or the tail of a block comment (`* …`), use that as the skip reason. Otherwise fall back to `"Skipped (no reason comment)"`.

### Tags
`@tag` tokens embedded inside the test name string. Canonical tags:
- `@mobile`
- `@security`
- `@regression` (implied by filename but may also be inline)
- `@p0`, `@p1`, `@p2`, `@p3` (priority override — takes precedence over journey-map priority when present)

### Journey ID inference

1. If the outer `describe` name matches `/^(j-|sj-)[a-z0-9-]+/` → take the first token.
2. Else use the file basename minus `.spec.ts` and minus the trailing `-regression` (if present) → prepend `j-`.
3. If neither matches a journey in `journey-map.md`, emit into the `Unmapped` bucket.

## File conventions in this framework

| Pattern | Meaning |
|---|---|
| `<journey>.spec.ts` | Main happy-path / variant file for a journey |
| `<journey>-regression.spec.ts` | Adversarial regression file — all tests inside are `regression` type |
| `sj-<slug>.spec.ts` | Rare; shared sub-journey verification |
| `happy-path.spec.ts` | Golden smoke test covering the whole onboarding chain |
| `pass5-regression-batch.spec.ts` | Cross-cutting regression batch (not tied to a single journey) |

## Journey map extraction

For each `### j-…` heading in `journey-map.md`, read lines until the next blank-line-followed-by-heading. Extract:

- `**Priority:**` → `P0` | `P1` | `P2` | `P3`
- `**Category:**` → free text
- `**Entry:**` → URL; the **primary section label** is derived at runtime from the URL's host + first path segment. Cluster journeys by that derived label. The skill does NOT carry a built-in label list — whatever the data yields IS the label.
  - If the journey-map's heading block carries an explicit `**Section:**` field, prefer that over the URL-derived label.
  - If neither is present, fall back to the file-name prefix (see §"Section inference fallbacks" below).
- The heading text itself (after the `:`) → journey purpose (one-liner for the catalogue).

## Section inference fallbacks

If a journey is not in the map (Unmapped) AND its `Entry:` URL is unavailable:

1. Take the spec filename minus `.spec.ts`.
2. The first hyphen-separated token (e.g., `<token>` from `<token>-<rest>.spec.ts`) is the candidate section label.
3. Files without a hyphen (`happy-path.spec.ts` after the hyphen-aware split, OR truly unhyphenated files), files starting with `sj-`, and any cross-section regression batches go into a final **Cross-cutting** section.

The fallback is heuristic; the journey-map-driven path is authoritative when available. The skill never bakes in named sections — every label originates either from the data or from a `Section:` field the user wrote.

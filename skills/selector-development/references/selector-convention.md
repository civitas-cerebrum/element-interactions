# Selector Convention

This reference document specifies the attribute-selection and naming rules that `selector-development` applies when instrumenting unstable selectors.

## 1. Attribute Precedence

When adding a test attribute to an element, the skill detects which attribute to use by scanning the frontend source **once per session** and caches the choice at `tests/e2e/.selector-development/.detected-convention` (a single-line file containing the attribute name).

### Detection ladder

1. **If `data-testid` already appears anywhere in the frontend source** → use `data-testid`.
2. **Else if `data-cy`, `data-qa`, or `data-test` appears** → match the one most frequently used.
3. **Else** → default to `data-testid`.

### Why caching matters

All hooks and subsequent invocations within the same session read from the cached file, ensuring all attributes added during the same run use the same project convention. This avoids mixed conventions within a single commit.

---

## 2. Naming Rules

Test attributes must follow these rules:

### Format

- **kebab-case** matching the regex `^[a-z0-9]+(-[a-z0-9]+)*$`.
- **Semantic**: name the element by its role and/or context, not visual state or copy.
- **Scoped**: include the parent component or section context when the name would otherwise be ambiguous.

### Good examples

| Name | Why |
|------|-----|
| `submit-button` | Role-based, semantic. |
| `cart-drawer-close` | Role + parent context (drawer). |
| `product-card-price` | Role + parent context (card). |
| `form-error-banner` | Role + context (form), not visual state. |

### Bad examples

| Name | Why |
|------|-----|
| `click-here-to-save-button` | Derived from copy; copy drifts over time. |
| `red-error-banner` | Derived from visual state; styling changes break the selector. |
| `submitButton` | camelCase fails the kebab-case regex. |
| `save-changes-button-large` | Sizes are visual concerns; omit visual variants. |

---

## 3. Forbidden Attribute Set

The skill is **only** permitted to add the project's detected test attribute (one of `data-testid`, `data-cy`, `data-qa`, or `data-test`).

The following attributes are explicitly forbidden and will be denied by the inertness guard:

| Attribute | Reason |
|-----------|--------|
| `id` | Affects CSS selectors, JavaScript lookups, form label-for associations, and accessibility. |
| `className` / `class` | Changes visual styling and functional state. |
| `style` | Direct visual impact; breaks inertness. |
| `aria-*` | Accessibility API implications; must never be added by test tooling. |
| Event handlers (`onClick`, `@click`, `on:click`, etc.) | Functional impact; alters application behavior. |
| Any other attribute | Only the chosen test attribute is inert. |

### Why inertness matters

Adding any forbidden attribute would violate the inertness contract: the change must have **zero functional, visual, or accessibility impact**. Only a single test-purpose attribute meets this requirement.

---

## 4. Storage in page-repository.json

Once a test attribute is added and validated through the guardrail pipeline, it is recorded in `tests/e2e/docs/page-repository.json` as a locator selector:

```json
{
  "selector": "[data-testid='submit-button']"
}
```

The entry is **always a CSS attribute selector**, never a CSS class selector, descendant path, or XPath. This keeps selectors stable and decoupled from page structure.

---

## Summary

- **Detect once, use consistently:** Scan the frontend source once per session; cache the chosen attribute.
- **Name semantically in kebab-case:** Role + context, scoped for clarity, independent of copy and visual state.
- **Guard inertness strictly:** Only the test attribute may be added; all other attributes are forbidden.
- **Record as CSS selectors:** Store in page-repository.json as `[attribute='value']`.

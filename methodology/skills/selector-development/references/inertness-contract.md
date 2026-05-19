# Inertness Contract

This reference document specifies the only allowed edit shape and the programmatic enforcement mechanism that prevents any change outside the contract's scope.

## 1. The Contract

The only allowed edit shape:

> Append a single attribute (the project's detected test-attribute) to a single existing opening tag, without modifying any other byte of the file.

---

## 2. Forbidden Edits

The following edits will be denied by the inertness guard:

- **Changing or adding `id`, `className`, `style`, `aria-*`, event handlers, or any attribute that isn't the test attribute.** Test tooling must not touch attributes with functional, visual, or accessibility implications.
- **Modifying the tag name, the opening tag's existing attributes, the closing tag, or any text/whitespace outside the inserted attribute.** The element structure is immutable except for the single append.
- **Adding or removing children. Wrapping the element in a new node. Splitting the element across multiple lines beyond what formatting requires.** Structural changes violate inertness.
- **Refactoring the surrounding component (extracting a child, renaming props, reordering siblings).** The edit is local to one tag; no wider refactoring is permitted.
- **Instrumenting an element rendered by a third-party library that doesn't forward arbitrary props through to the DOM.** If the library strips unknown attributes, the edit cannot take effect. The skill escalates (returns `status: "blocked"` with `skipped_reason: "no-inert-option"`) rather than improvise.

---

## 3. Programmatic Enforcement

Enforced by `selector-development-inertness-guard.sh` (PreToolUse hook on Edit/Write of frontend source files) calling `methodology/hooks/lib/selector-diff-validator.js`.

### Validation assertions

The validator:

1. Reads the file's pre-state (from disk) and post-state (from the proposed Edit/Write payload).
2. Parses both states with a real JSX/Vue/Svelte/HTML parser (no regex).
3. Computes the AST diff and asserts:
   - **Exactly one node was modified.**
   - **That node is an opening element** (JSXOpeningElement / Vue element / Svelte element / parse5 element).
   - **It gained exactly one attribute.**
   - **The attribute name matches the project's detected test-attribute** (one of `data-testid`, `data-cy`, `data-qa`, `data-test`).
   - **The attribute value is a kebab-case string literal** (matches `^[a-z0-9]+(-[a-z0-9]+)*$`).

Denies the write with the offending diff fragment quoted in the deny message if any assertion fails.

### Failure reasons (machine-readable)

When denial occurs, the deny message includes a `reason` enum:

- `modifies-existing-attribute` — an existing attribute on the element was changed or removed.
- `structural-change` — a tag was renamed, a child added/removed, or the node type changed.
- `multiple-attributes-added` — more than one attribute was added to the element.
- `wrong-attribute-name` — the attribute name doesn't match the detected convention.
- `value-not-kebab-case` — the value contains uppercase, underscores, spaces, or other invalid characters.
- `parser-error` — the file syntax could not be parsed (malformed JSX/Vue/Svelte/HTML).
- `unsupported-extension` — the file extension is not one the skill can validate (.tsx, .jsx, .vue, .svelte, .html).

---

## 4. When the Contract Can't Be Satisfied

The skill **must not improvise.** If the contract cannot be met, the skill escalates by returning `status: "blocked"` with `skipped_reason: "no-inert-option"`.

Examples:

- **Third-party component strips unknown props.** A React component `<Button />` exported from a UI library does not pass arbitrary props through to its DOM node. Adding `data-testid` to the JSX has no effect on the rendered HTML.
- **Web Component with shadow DOM.** A `<custom-element />` renders into its own shadow root. The attribute append doesn't affect the shadow DOM content.
- **Generated artifact source.** The `.tsx` file is produced from a `.tsx.template` or build script. Editing the source leaves the generated artifact unstable across rebuilds.

In these cases, the caller (Stage 2 / failure-diagnosis / audit-mode) decides whether to escalate to the user, find an alternative locator strategy, or fall back to a non-frontend approach (e.g., API-level or database-level test fixtures).

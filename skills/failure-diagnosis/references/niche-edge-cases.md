# Niche Edge Cases — Failure-Diagnosis Reference

Niche failure shapes that LLMs routinely misclassify when running failure-diagnosis. Each entry names the symptom, the diagnostic move that disambiguates it, and the canonical resolution (heal / no-heal / report).

This file is a **living catalogue**. When a diagnosis session encounters a niche shape, resolves it, and the resolution wasn't already covered here, append a new entry so the next diagnoser doesn't redo the work. The Stage 4 table in `SKILL.md` is for common edge cases; this file is for the long tail — the ones where the obvious-looking classification is wrong.

Entry shape (use this for new entries):

- **Symptom** — what the failure looks like in the screenshot / error / DOM.
- **Why LLMs struggle** — the specific reasoning trap.
- **Disambiguating probe** — the specific tool call / DOM check that resolves it.
- **Classification** — `test-issue` / `app-bug` / `ambiguous`, plus the Stage 4a heal strategy if applicable.
- **Cross-link** — to the Stage 4 / 4a row that covers the surface form, if one exists.

---

## (1) Modal opens but content hangs

**Symptom.** The modal-trigger interaction succeeds — a `<div role="dialog">` (or equivalent modal container) is added to the DOM and the screenshot shows the modal frame on screen. But the modal's content area never resolves: it shows only a placeholder web component (e.g. `<apple-spinner>`, `<skeleton-loader>`), none of the expected `data-qa` keys inside the modal ever match, and the URL hash never advances to the documented post-open state. The test eventually fails on a wait-for-element-inside-modal step, not on the open step itself.

**Why LLMs struggle.** The screenshot shows the modal trigger looking normal and the modal frame visible — leading the LLM to assume the modal opened correctly and the test must be using the wrong selector inside. The reasoning chain "frame visible → opened → content must be there → selector wrong" is plausible and almost always wrong here. The actual root cause is the backend feed for the modal options failing or timing out, leaving the frame mounted but its content suspended on a spinner sentinel.

**Disambiguating probe.** Capture `outerHTML` of the modal container (`role="dialog"` or the documented modal wrapper) and grep for the spinner-sentinel custom element documented in `app-context.md`. If the spinner sentinel is present and none of the documented inner `data-qa` keys are, the modal content is hanging. Cross-reference: a 5xx in the network capture for the modal-options endpoint, or a yellow "we're experiencing problems" banner above the modal trigger.

**Classification.** `app-bug`. Stage 4a heal: `(h) Documented-quirk match — no heal`. Report observed-vs-documented diff; do NOT modify the test.

**Cross-link.** Stage 4 row "Modal opens but content hangs"; Stage 4a row `(h) Documented-quirk match — no heal`.

---

## (2) Single-method-restaurant false-positive

**Symptom.** The NL checkout page renders only one payment method (Credit Card), and a yellow "we're experiencing problems" banner is visible above the payment area. The test fails because it expected the full set of payment methods (iDEAL, Bancontact, Klarna, etc.) to be present and selectable.

**Why LLMs struggle.** Two plausible-looking classifications converge on the wrong answer. Either (a) "the restaurant only offers Credit Card — this is a documented per-restaurant config, not a bug, so update the test's expectation" — which masks a real outage; or (b) "the test expects more methods than exist, so it's a stale assertion — re-baseline" — same masking. The LLM sees a small payment list + a banner that *looks* like a generic notification and concludes the app is in a degraded-but-correct state. The actual root cause is the modal-options fetch hanging (same backend failure shape as edge case #1), with the frontend gracefully degrading to a single fallback method rather than showing an empty list.

**Disambiguating probe.** Read the inner `[data-qa="payment-method-interactive"]` (or the documented per-method element) in the live DOM. Click it and observe whether a `<div role="dialog">` is appended within the documented timeout. If the click does not produce the modal — or produces it with the spinner-sentinel symptom from entry #1 — this is the same backend-hanging failure, surfaced through the payment-list fallback. Cross-reference the banner copy against `app-context.md`'s list of documented degradation banners.

**Classification.** `app-bug`. Stage 4a heal: `(h) Documented-quirk match — no heal`. Do NOT update the test's expected-methods list; do NOT re-baseline.

**Cross-link.** Stage 4 row "Modal opens but content hangs" (same backend root cause, different surface); Stage 4a row `(h)`. Originally observed in failure-diagnosis issue #156.

---

## (3) Stale page-repository entry that resolves but produces wrong-state interaction

**Symptom.** Selector resolves successfully — no `Locator.click: element not found` error, no timeout on resolution. But the subsequent assertion fails: a click that should open a modal silently does nothing, a fill that should populate a visible field populates an offscreen one, or the test's URL-after-click expectation is wrong. The screenshot shows the page in the *pre-interaction* state even though the interaction's logs show it ran.

**Why LLMs struggle.** Most LLMs treat "selector resolved" as "test fine on the locator side, problem is elsewhere" and pivot to assertion-re-baseline, timing hardening, or app-bug. The trap: a stale `page-repository.json` selector can match a *different* element than intended — typically a hidden duplicate (a mobile-only button still in the DOM at desktop viewport, an off-screen `aria-hidden="true"` clone in a collapsed drawer, a previous-page leftover before client-side navigation finished). The selector resolves, the click fires, but on the wrong element, so nothing visible happens.

**Disambiguating probe.** Two checks, either is sufficient:
1. `count(selector)` against the live DOM — if it returns ≥2, the selector is ambiguous and the test is interacting with whichever element matches first, which may be the hidden duplicate.
2. Screenshot-vs-DOM cross-reference — take a screenshot at the moment of the failed interaction and ask: is the element the locator resolved to actually visible on screen at the screenshot's viewport? If the bounding box is offscreen, hidden, or `display: none`, the locator is matching a phantom.

**Classification.** `test-issue`. Stage 4a heal: `(a) Selector re-learn` — tighten the page-repository entry to disambiguate (add a visibility filter, scope to a stable landmark, switch to role+name, or anchor on the visible-only branch of the duplicated component tree). Do NOT just add a wait — the timing isn't the problem.

**Cross-link.** Stage 4 row "Element obscured/overlapped" covers the *visible-but-blocked* shape; this entry covers the *resolves-but-wrong-element* shape, which looks similar in the failure log but has a different fix.

---

## Adding an entry

The catalogue is meant to grow. When a diagnostic session resolves a failure whose shape isn't already documented here, append a new entry **before closing out the session**. The criteria + entry template below are the contract.

### When to add (criteria — must hold ALL)

1. **You actually misclassified at first** (or were close to). The catalogue is for shapes that *trap* the diagnoser — not for failures whose classification was obvious from the screenshot. If Stage 0 + Stage 4 got you to the right answer cleanly, no entry needed.
2. **The disambiguating probe was non-obvious.** The thing you ended up doing — the specific tool call, DOM read, or evidence grab that flipped the classification — is what the next diagnoser most needs. If your probe was just "look at the screenshot more carefully", that's not catalogue-worthy.
3. **The shape is reproducible across consumers**, not project-specific. A bug in *this app's checkout flow* is a project finding, not a niche-edges entry. A bug shape that any consumer of the package could plausibly hit (modal-fetch hangs, role-attribute serialisation, page-repo entry resolves but matches a hidden duplicate, etc.) is.

If any criterion fails: don't add an entry. Project-specific findings go in the project's bug ledger; obvious classifications go nowhere; one-off probes that won't generalise go nowhere.

### Entry template

```markdown
## (N) <one-line shape name — reads like a row title in Stage 4 of SKILL.md>

**Symptom.** What the failure looks like in the screenshot / error log / DOM at the moment of failure. Concrete observables only — no diagnosis yet.

**Why LLMs struggle.** The specific reasoning trap. What does the LLM *assume* from the symptom that turns out to be wrong? Name the wrong-direction conclusion explicitly so the next diagnoser recognises their own reasoning.

**Disambiguating probe.** The specific tool call(s) that resolve the ambiguity. Concrete commands or DOM reads, not "investigate further". If two probes both work, list both with "either is sufficient".

**Classification.** `test-issue` / `app-bug` / `ambiguous-by-design`. If it's a test-issue, name the Stage 4a heal strategy that applies. If it's an app-bug, name the heal strategy `(h)` (documented-quirk, no heal) and note evidence-capture moves.

**Cross-link.** Stage 4 / 4a row(s) in `SKILL.md` this entry refines, if any. If it's a brand new shape, leave as "(none — new shape)". If it cross-references a sibling entry in this catalogue, name the entry number.
```

Number sections sequentially. If your new entry refines a Stage 4 / 4a row in `SKILL.md`, also update that row to point at the new entry.

### How to ship the addition

The contribution pathway depends on what you're already shipping:

- **You're already mid-PR for something else** (e.g. a hook fix, a skill change). Add the catalogue entry to the same PR — one extra commit, scope-clean (purely additive to a docs file). Mention in the PR description that the entry was discovered while debugging the PR's own work.
- **You hit the niche shape outside any PR** (e.g. during a normal coverage / authoring session). Open a small standalone PR titled `docs(failure-diagnosis): catalogue <shape-name> in niche-edge-cases`. Single-commit, single-file (this file). The contributing-skill `docs(...)` commit-message convention applies; no version bump (per the no-bump rule).
- **You hit it inside a dispatched subagent** (e.g. failure-diagnosis sub-skill). The subagent surfaces the find in its return; the parent orchestrator either appends inline or opens the standalone PR above. Subagents do NOT push commits directly to this catalogue.

The full criteria + ship path is also documented in `skills/contributing-to-element-interactions/SKILL.md` §"Contributing to the niche-edge-cases catalogue".

### Keep entries tight

One paragraph per field is the target. The reference is meant to be skimmable during a live diagnosis, not exhaustive. War stories, project-specific incident details, and broader debugging philosophy belong elsewhere — the catalogue is the trap and the probe and the classification, nothing more.

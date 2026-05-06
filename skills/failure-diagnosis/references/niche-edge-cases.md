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

## Appending new entries

When you encounter a niche failure shape, resolve it, and discover it isn't covered here:

1. Add a new section using the entry shape above.
2. Number it sequentially.
3. Cross-link from the Stage 4 / 4a row in `SKILL.md` if your new entry refines one of those rows. If it's a brand new shape with no Stage 4 row, leave the cross-link as "(none — new shape)".
4. Keep the writeup tight: one paragraph per field is the target. The reference is meant to be skimmable during a live diagnosis, not exhaustive.

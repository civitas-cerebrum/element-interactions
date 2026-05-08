**Status:** authoritative reference for the structural-gap flow. Cited from `contributing-to-element-interactions/SKILL.md`.

**Scope:** what to do when a skill / workflow / invariant cannot be satisfied without changing the package itself, switching its underlying tooling, or relaxing the rule — distinguishing this from an ordinary API gap.

---

## 🧱 When the framework cannot satisfy a documented rule

Sometimes the problem is not a missing method on `Steps` — it's that a skill, workflow, or invariant declares a rule the package's current architecture cannot back. The MCP→playwright-cli migration (#121, #122) is the canonical case: every browser-using skill in this suite required parallel-subagent isolation, but the Playwright MCP plugin shared one browser process across all subagents. The rule was unsatisfiable until the package switched tooling.

Distinguishing a structural gap from an API gap:

| Symptom | Class | What you're missing |
|---|---|---|
| User wants `steps.foo()` and it doesn't exist | API gap | A method on the public surface |
| Skill prereq says "X must be true at dispatch time" and the package can't make X true | Structural gap | A primitive / mechanism the package doesn't currently provide |
| Workaround would mean turning off, weakening, or silently skipping a documented invariant | Structural gap | The invariant is load-bearing; the fix is at the package layer |
| Two parallel subagents corrupt each other's state through the package's chosen tool | Structural gap | OS-level isolation the current tool can't give |
| The package's protocol assumes a host capability the runtime doesn't expose | Structural gap | A different protocol or a different tool |

**If it's a structural gap, the workflow is different from "open an API-gap issue":**

1. **Write down the unsatisfied invariant precisely.** Quote the rule from the skill that depends on it (file + line). State the mechanism in the package that fails to back it. Without this, the issue reads as "a thing didn't work" instead of "this contract is structurally broken."

2. **Don't relax the invariant in the consuming skill.** The rest of the suite is built on it. Patching around it locally hides the structural problem and creates inconsistencies between skills that respect the rule and skills that don't.

3. **Open an issue on `civitas-cerebrum/element-interactions`** (the package, not the consuming skill repo, even if you found the gap while writing a skill) — with the duplicate-prevention checks above and a "smallest credible structural fix" sketch. Examples of "smallest fix": switch underlying tool, expose a new primitive, change a protocol shape. If the fix is large, that's fine — name it; don't hide it.

4. **The PR that fixes it lands in the package**, not in the consuming skill. The consuming skill only updates once the new primitive is published — and at that point, the consuming skill's job is to *delete* its workaround and trust the new contract.

5. **Decide between "block the rollout" and "ship a documented workaround."** A structural gap blocks the rollout when the invariant is safety-critical (data corruption, cross-tenant leakage, false-pass tests). A documented workaround is acceptable when (a) the workaround is local and reversible, (b) the cost of waiting exceeds the cost of the workaround, and (c) the issue is filed and the cleanup is tracked.

**Examples that should trigger this skill, not a skill-level workaround:**

- "I need parallel browser isolation, but the package's MCP protocol shares one browser." → File an issue; consider a tool swap. (#121 / #122 — actual case.)
- "My skill needs auth state to survive a failure boundary, but the package doesn't expose state-save / state-load." → File an issue against the package; do not write a brittle re-login loop in the skill.
- "The orchestrator's Rule X requires Y before dispatch, but the package can't tell us Y." → File an issue; add the primitive in the package; consume it from the orchestrator.

If a skill's prereq check is consistently failing because the package can't satisfy it, that's a structural gap, not a skill bug. Route it here.

---

**See also:** [`./api-gap-flow.md`](./api-gap-flow.md) (sibling flow when it's actually an API gap, not structural), [`./hard-rules.md`](./hard-rules.md) (the duplicate-prevention checks step 3 implicitly references), [`./architecture.md`](./architecture.md) (the layer split that determines whether the fix lives in element-repository or element-interactions).

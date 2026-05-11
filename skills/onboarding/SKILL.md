---
name: onboarding
description: >
  Onboarding is now driven by the @civitas-cerebrum/achilles CLI. This
  skill is a redirect; it does not run the pipeline.
---

# Onboarding — moved to achilles

The autonomous onboarding pipeline runs outside Claude Code now.

Run:

    npx @civitas-cerebrum/achilles onboarding

from the project root. The driver handles cascade detection, the
front-load gate, scaffold, all seven steps, and the audit-reviewer
pass. No further Claude Code prompt is needed.

For a resume: `npx @civitas-cerebrum/achilles onboarding --resume`.

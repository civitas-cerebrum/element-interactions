# Subagent return schemas

Canonical machine-readable form. Every skill-loading subagent must return a
shape that validates against the JSON Schema for its role.

| Role | Schema | Status enum |
|---|---|---|
| composer | `composer.schema.json` | new-tests-landed, covered-exhaustively, blocked, skipped |
| reviewer-inloop | `reviewer-inloop.schema.json` | greenlight, improvements-needed |
| probe | `probe.schema.json` | clean, findings-emitted, blocked |
| phase-validator | `phase-validator.schema.json` | greenlight, improvements-needed |
| section-agent | `section-agent.schema.json` | section-complete, section-deferred, blocked |
| phase4-prioritise-author | `phase4-prioritise-author.schema.json` | journey-map-authored, blocked |

All schemas reference the shared `handover.schema.json` envelope via `$ref`.

### Handover envelope optional fields

The handover envelope defines two optional fields that the harness validator inspects on first-cycle (journey-mapping) and first-pass (coverage-expansion) returns:

| Field | Type | Description |
|---|---|---|
| `dispatch-mode` | enum (`per-journey`, `per-section`, `grouped`, `single-agent-collapsed`) | How the dispatch was structured. **Required** on cycle-1 (journey-mapping) and Pass-1 (coverage-expansion) returns. The harness rejects cycle-1 / Pass-1 returns with `dispatch-mode == grouped` or `single-agent-collapsed` — those first cycles/passes are strict-per-X by contract (see `coverage-expansion/SKILL.md` §"Stage A per-journey dispatch is non-negotiable" and `journey-mapping/SKILL.md` §"Iterative discovery cycles"). |
| `parallel-wave-size` | integer ≥ 1 | Size of the parallel wave this dispatch was part of. On cycle-1 / Pass-1, `parallel-wave-size == 1` is rejected UNLESS the roster genuinely contains only one item (in which case `dispatch-mode: per-journey` with wave-size 1 is the correct shape). |

Cycle-2+ returns (journey-mapping) and Pass-2-onward returns (coverage-expansion) may omit both fields or carry any enum value under `runMode: standard` / `cycleStrictness: standard` — the strict contract relaxes after the first cycle/pass.

**Under `runMode: depth` / `cycleStrictness: depth`** (selected via `onboarding`'s front-load gate), the rejection rule applies to EVERY pass / cycle, not just the first:

- A coverage-expansion return on any pass (1, 2, 3, 4, or 5) with `dispatch-mode == grouped` is rejected when the state file carries `runMode: "depth"`. Pass-2+ returns that previously could declare `dispatch-mode: grouped` legitimately must now be `per-journey` under depth.
- A journey-mapping return on any cycle (1, 2, 3, …) with `dispatch-mode == single-agent-collapsed` is rejected when the state file carries `cycleStrictness: "depth"`. Cycle-2+ returns that previously could declare `single-agent-collapsed` legitimately must now be `per-section` under depth.

The schema itself does not encode the mode-aware rejection rule (the field enum is unchanged — `grouped` and `single-agent-collapsed` remain valid values for non-depth runs); the harness validator reads the relevant state file's mode field at validation time and applies the per-mode rejection scope. Schema additions for the mode marker itself are deliberately deferred to the orchestrator's state files (`coverage-expansion-state.json` / `.phase4-cycle-state.json`), where the mode is observable, rather than baked into per-return shape requirements.

## Format

- JSON Schema draft 2020-12.
- Each schema has a sibling `fixtures/<role>-valid.yaml` and `fixtures/<role>-invalid.yaml`.
- The script `scripts/validate-schema-fixtures.mjs` exercises every fixture against every schema.
- The hook `hooks/subagent-return-schema-guard.sh` validates live subagent returns against the same schemas at runtime via `hooks/lib/validate-against-schema.mjs`.

## Adding a new role

1. Author `<role>.schema.json` with `$schema` set to draft 2020-12 and `$ref` to `handover.schema.json` for the envelope.
2. Add valid + invalid fixtures.
3. Run `node scripts/validate-schema-fixtures.mjs` and confirm both fixtures behave as expected.
4. The hook picks up new roles automatically by filename.

## Ajv strict-mode notes

When writing schemas:
- Every `if` and `then` subschema must include `"type": "object"` (Ajv strictTypes).
- Every `then` block that adds a `required` field must include a `properties` stub mirroring that field's type (Ajv strictRequired).

See the existing schemas for examples.

## Consumers

External consumers (automated CLI drivers and other orchestrators) read these files directly. Treat them as a versioned public API — additions are minor bumps, removals are breaking.

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

External consumers (e.g. `@civitas-cerebrum/achilles`) read these files directly. Treat them as a versioned public API — additions are minor bumps, removals are breaking.

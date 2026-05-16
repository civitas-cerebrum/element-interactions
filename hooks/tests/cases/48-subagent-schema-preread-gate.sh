#!/bin/bash
# Tests for subagent-schema-preread-gate.sh — pre-dispatch schema-citation
# gate. PreToolUse:Agent. DENY mode for schema-validated role prefixes
# whose briefs omit the schema citation.
H="$HOOK_DIR/subagent-schema-preread-gate.sh"

section "schema-preread-gate: tool-name filtering"
assert_allow "$H" "$(payload tool_name=Bash command='ls')" "Bash → silent allow"
assert_allow "$H" "$(payload tool_name=Read file_path='/tmp/x')" "Read → silent allow"

section "schema-preread-gate: free-form / no-schema prefixes silent-allow regardless of citation"
assert_allow "$H" "$(payload tool_name=Agent description='phase1-scaffold' prompt='Lay down the playwright.config.ts file.')" "phase1- prefix → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='stage2-cart' prompt='Capture cart-page selectors.')" "stage2- prefix → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='cleanup-ledger' prompt='Dedup pass-1 findings.')" "cleanup- prefix → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='process-validator-7' prompt='Audit secrets sweep.')" "process-validator- prefix → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='unknown-thing' prompt='Anything goes.')" "unknown prefix → silent allow"

section "schema-preread-gate: composer with schema citation"
assert_allow "$H" "$(payload tool_name=Agent description='composer-j-cart-1-c1' prompt='Compose. Return per schemas/subagent-returns/composer.schema.json.')" "composer + full path → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent description='composer-j-cart-1-c1' prompt='Compose. Conform to composer.schema.json.')" "composer + bare filename → ALLOW"

section "schema-preread-gate: composer without schema citation"
assert_deny "$H" "$(payload tool_name=Agent description='composer-j-cart-1-c1' prompt='Compose a checkout spec under tests/e2e/.')" "composer + no citation → DENY" "composer.schema.json"
assert_deny "$H" "$(payload tool_name=Agent description='composer-j-cart-1-c1' prompt='Compose using composer return shape.')" "composer + non-canonical phrasing → DENY" "composer.schema.json"

section "schema-preread-gate: reviewer with schema citation"
assert_allow "$H" "$(payload tool_name=Agent description='reviewer-j-cart-1-c1' prompt='Review per reviewer-inloop.schema.json.')" "reviewer + citation → ALLOW"

section "schema-preread-gate: reviewer without schema citation"
assert_deny "$H" "$(payload tool_name=Agent description='reviewer-j-cart-1-c1' prompt='Review the spec for craft issues.')" "reviewer + no citation → DENY" "reviewer-inloop.schema.json"

section "schema-preread-gate: probe with / without citation"
assert_allow "$H" "$(payload tool_name=Agent description='probe-j-cart-4-c1' prompt='Probe. Conform to probe.schema.json.')" "probe + citation → ALLOW"
assert_deny "$H" "$(payload tool_name=Agent description='probe-j-cart-4-c1' prompt='Probe for bugs in the cart journey.')" "probe + no citation → DENY" "probe.schema.json"

section "schema-preread-gate: phase-validator with / without citation"
assert_allow "$H" "$(payload tool_name=Agent description='phase-validator-3' prompt='Validate phase 3. Use phase-validator.schema.json.')" "phase-validator + citation → ALLOW"
assert_deny "$H" "$(payload tool_name=Agent description='phase-validator-7' prompt='Check secrets-sweep exit criteria.')" "phase-validator + no citation → DENY" "phase-validator.schema.json"

section "schema-preread-gate: empty / missing prompt still DENIES schema-validated role"
assert_deny "$H" "$(payload tool_name=Agent description='composer-j-x-1-c1' prompt='')" "composer + empty prompt → DENY" "composer.schema.json"

section "schema-preread-gate: citation must match the dispatched role, not a sibling role"
assert_deny "$H" "$(payload tool_name=Agent description='composer-j-x-1-c1' prompt='See probe.schema.json for context.')" "composer + wrong schema cited → DENY" "composer.schema.json"

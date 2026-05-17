#!/usr/bin/env bash
# 47-public-package-contamination-scan.sh
# Asserts the shipped surface (hooks + skills + schemas + manifests)
# contains no project-specific identifiers. Runs as a permanent gate
# in the hooks test suite; also wired into `npm run prepack` so the
# scan blocks a publish attempt if contamination has crept back in.
#
# Sourced by hooks/tests/run.sh — use the suite's section / counter
# helpers (run.sh `source`s each cases/*.sh file, so a bare `exit 0`
# here would abort the whole runner). Counter-style reporting also
# makes the contamination check show up in the run summary alongside
# every other hook case.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Banned token pattern. Uses `.` as the separator wildcard so both
# kebab and snake variants are caught (e.g. test-data-discipline AND
# TEST_DATA_DISCIPLINE).
BANNED='bookhive|book.hive|cookbook|chefnova|petfinder|j.administer.medication'

# Surface to scan: everything npm publishes (per package.json `files`),
# plus root files that are implicitly published.
TARGETS=(hooks skills schemas package.json README.md CHANGELOG.md)

# Filter out test fixtures that intentionally contain banned tokens
# (they exist to test contamination detection itself).
EXCLUDED_PATHS='hooks/tests/fixtures/bypass-artifacts'

section "public-package-contamination: no banned project-specific tokens in shipped surface"
TESTS_RUN=$((TESTS_RUN + 1))
matches=$( (cd "$ROOT" && grep -rilE "$BANNED" "${TARGETS[@]}" 2>/dev/null) | grep -vE "$EXCLUDED_PATHS" || true)
if [ -z "$matches" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} contamination scan clean"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("contamination scan: matches=${matches:0:400}")
  echo "${CLR_FAIL}  ✗${CLR_RST} contamination scan failed"
fi

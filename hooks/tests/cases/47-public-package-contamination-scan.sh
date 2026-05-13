#!/usr/bin/env bash
# 47-public-package-contamination-scan.sh
# Asserts the shipped surface (hooks + skills + schemas + manifests)
# contains no project-specific identifiers. Runs as a permanent gate
# in the hooks test suite; also wired into `npm run prepack` so the
# scan blocks a publish attempt if contamination has crept back in.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$ROOT"

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

if matches=$(grep -rilE "$BANNED" "${TARGETS[@]}" 2>/dev/null | grep -vE "$EXCLUDED_PATHS"); then
  if [ -n "$matches" ]; then
    echo "FAIL: project-specific identifier(s) found in shipped surface:"
    echo "$matches"
    exit 1
  fi
fi

echo "OK: contamination scan clean"
exit 0

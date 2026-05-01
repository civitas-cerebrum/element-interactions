#!/bin/bash
# run.sh — pipe-test runner for every hook in ../
#
# Usage:
#   bash hooks/tests/run.sh                 # run all
#   bash hooks/tests/run.sh dispatch-guard  # run a single test file (matches cases/*<arg>*.sh)
#
# Exit code: 0 if all tests pass, 1 otherwise.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CASES_DIR="$SCRIPT_DIR/cases"

# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

# Locate test files. If an arg is given, filter by substring.
filter="${1:-}"
shopt -s nullglob
case_files=("$CASES_DIR"/*.sh)
if [ "${#case_files[@]}" -eq 0 ]; then
  echo "No test files found under $CASES_DIR" >&2
  exit 1
fi

selected=()
for f in "${case_files[@]}"; do
  if [ -z "$filter" ] || [[ "$(basename "$f")" == *"$filter"* ]]; then
    selected+=("$f")
  fi
done

if [ "${#selected[@]}" -eq 0 ]; then
  echo "No test files match filter '$filter'" >&2
  exit 1
fi

echo "Running ${#selected[@]} test file(s) against hooks under $HOOKS_DIR"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Each cases file uses $HOOKS_DIR via the HOOK_DIR variable.
HOOK_DIR="$HOOKS_DIR"

for f in "${selected[@]}"; do
  echo
  echo "=== $(basename "$f") ==="
  # shellcheck source=/dev/null
  source "$f"
done

# Summary.
echo
echo "──────────────────────────────────────"
if [ "$TESTS_FAILED" -eq 0 ]; then
  echo "${CLR_PASS}✓ all ${TESTS_RUN} tests passed${CLR_RST}"
  exit 0
else
  echo "${CLR_FAIL}✗ ${TESTS_FAILED} of ${TESTS_RUN} tests failed${CLR_RST}"
  echo
  echo "Failures:"
  for d in "${FAIL_DETAILS[@]}"; do
    echo "  - $d"
  done
  exit 1
fi

#!/bin/bash
# raw-playwright-api-warning.sh
#
# PostToolUse hook for Write/Edit on tests/e2e/*.spec.ts files. Warns (does
# NOT block) when raw Playwright APIs appear that have a Steps API equivalent.
# Stage 4b reviewer handles authoritative compliance review; this hook
# provides early visibility.
#
# Allowed framework-bridge primitives (NEVER warn on these):
#   page.context().clearCookies()       — no Steps equivalent
#   page.context().cookies()            — no Steps equivalent
#   page.context().addCookies()         — no Steps equivalent
#   page.url()                           — no Steps equivalent
#   page.evaluate()                      — used for DOM/JS bridges
#   page.waitForResponse(...)            — no Steps equivalent
#   page.on('console', ...)              — no Steps equivalent
#   page.on('dialog', ...)               — no Steps equivalent
#   page.on('pageerror', ...)            — no Steps equivalent
#
# Warned-on (use Steps API instead):
#   page.locator(...)
#   page.click(...)
#   page.fill(...)
#   page.type(...)
#   page.press(...)
#   page.hover(...)
#   page.check(...)
#   page.uncheck(...)
#   page.selectOption(...)
#   page.goto(...)              -> steps.navigateTo
#   page.reload()               -> steps.refresh

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

case "$TOOL_NAME" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
case "$FILE_PATH" in
  *.spec.ts|*.spec.tsx|*.spec.js) ;;
  *) exit 0 ;;
esac

# Compute target content slice we want to scan.
if [ "$TOOL_NAME" = "Write" ]; then
  CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // ""')
elif [ "$TOOL_NAME" = "Edit" ]; then
  CONTENT=$(echo "$INPUT" | jq -r '.tool_input.new_string // ""')
fi

# Match raw Playwright APIs that have a Steps equivalent.
RAW_PATTERNS='page\.locator\(|page\.click\(|page\.fill\(|page\.type\(|page\.press\(|page\.hover\(|page\.check\(|page\.uncheck\(|page\.selectOption\(|page\.goto\(|page\.reload\('

HITS=$(echo "$CONTENT" | grep -oE "$RAW_PATTERNS" | sort -u || true)

if [ -z "$HITS" ]; then
  exit 0
fi

# Build a translation table for the warning message.
TRANSLATION=""
echo "$HITS" | while IFS= read -r api; do
  case "$api" in
    page.locator\() ECHO=' page.locator(...) -> steps.on(...).first()/byText()/byAttribute() OR steps.click/fill/etc by element name from page-repository.json' ;;
    page.click\()    ECHO=' page.click(selector) -> steps.click("elementName", "PageName") OR steps.on("el","Page").click()' ;;
    page.fill\()     ECHO=' page.fill(selector, text) -> steps.fill("elementName", "PageName", text)' ;;
    page.type\()     ECHO=' page.type(selector, text) -> steps.typeSequentially("elementName", "PageName", text)' ;;
    page.press\()    ECHO=' page.press(key) -> steps.pressKey(key)' ;;
    page.hover\()    ECHO=' page.hover(selector) -> steps.hover("elementName", "PageName")' ;;
    page.check\()    ECHO=' page.check(selector) -> steps.check("elementName", "PageName")' ;;
    page.uncheck\()  ECHO=' page.uncheck(selector) -> steps.uncheck("elementName", "PageName")' ;;
    page.selectOption\()  ECHO=' page.selectOption(...) -> steps.selectDropdown("elementName", "PageName", { type: DropdownSelectType.VALUE, value: ... })' ;;
    page.goto\()     ECHO=' page.goto(url) -> steps.navigateTo(url)' ;;
    page.reload\()   ECHO=' page.reload() -> steps.refresh()' ;;
    *) ECHO=" $api -> see api-reference.md" ;;
  esac
  echo "$ECHO"
done > /tmp/.raw-pw-translation-$$
TRANSLATION=$(cat /tmp/.raw-pw-translation-$$)
rm -f /tmp/.raw-pw-translation-$$

MESSAGE="[WARN] Raw Playwright APIs detected in spec file.

File: $FILE_PATH
Raw APIs:
$(echo "$HITS" | sed 's/^/  /')

Translations to Steps API:
$TRANSLATION

Stage 4b API Compliance Review will flag these. The Steps API uses page-repository.json element names rather than raw selectors so tests survive UI refactors. See element-interactions/references/api-reference.md.

(This is a warning — the write proceeded. Address before commit.)"

# PostToolUse warning — emit systemMessage, not block.
jq -n --arg m "$MESSAGE" '{
  "systemMessage": $m,
  "suppressOutput": false
}'

exit 0

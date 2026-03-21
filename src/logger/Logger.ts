import Debug from 'debug';

/**
 * The library-wide namespace prefix.
 * All loggers created by this factory are scoped under this prefix.
 *
 * Logging is ON by default for all tester:* namespaces.
 * To narrow output, set the DEBUG environment variable:
 *
 *   DEBUG=tester:steps:*              → Steps output only
 *   DEBUG=tester:steps:interact       → interaction steps only
 *   DEBUG=tester:interactions         → raw Interaction class
 *   DEBUG=tester:steps:*,tester:interactions → combine multiple scopes
 *
 * To disable logging entirely:
 *
 *   TESTER_DEBUG=false npx playwright test   → suppress all tester:* logs
 *
 * Or in playwright.config.ts / your test setup file:
 *
 *   process.env.TESTER_DEBUG = 'false';
 */
const PREFIX = 'tester';

const logsDisabled = process.env.TESTER_DEBUG === 'false';

if (!logsDisabled && !process.env.DEBUG) {
  Debug.enable(`${PREFIX}:*`);
}

/**
 * The column width used to pad namespace labels in log output.
 * All namespaces are right-padded to this length so log columns align.
 *
 * If you add a namespace longer than this value, increase it to match.
 */
const NAMESPACE_PAD = 9; // 'interactions' is the longest built-in namespace

/**
 * Creates a namespaced debug logger with a padded label for aligned output.
 *
 * Namespaces shorter than `NAMESPACE_PAD` are right-padded with spaces so
 * that log messages from different loggers line up in the terminal:
 *
 *   tester:navigate    Navigating to URL: "/"
 *   tester:interact    Clicking on "submitButton" in "FormsPage"
 *   tester:verify      Verifying presence of "table" in "FormsPage"
 *   tester:wait        Waiting for "modal" in "FormsPage" to be "visible"
 *
 * @param namespace - A colon-delimited scope appended to the library prefix.
 *                    Examples: 'navigate', 'interact', 'verify', 'wait'
 * @returns A `debug` instance bound to `tester:<namespace>` (padded).
 *
 * @example
 * ```ts
 * import { createLogger } from '../logger/Logger';
 *
 * const log = createLogger('interact');
 * log('Clicking on "%s" in "%s"', elementName, pageName);
 * ```
 */
export function createLogger(namespace: string): Debug.Debugger {
  const padded = namespace.padEnd(NAMESPACE_PAD);
  return Debug(`${PREFIX}:${padded}`);
}
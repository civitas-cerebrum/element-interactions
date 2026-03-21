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

/**
 * Controls whether all `tester:*` debug output is suppressed.
 *
 * Set via environment variable:
 * @example
 * ```sh
 * TESTER_DEBUG=false npx playwright test
 * ```
 */
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

/**
 * Creates a color-coded namespaced logger for a given log level.
 *
 * Wraps {@link createLogger} and assigns a fixed terminal color to each
 * level so log output is visually distinct at a glance:
 *
 * | Level       | Color  |
 * |-------------|--------|
 * | `info`      | Blue   |
 * | `warn`      | Amber  |
 * | `error`     | Red    |
 * | `success`   | Green  |
 * | `important` | Purple |
 *
 * @param type - The log level / namespace. One of `'info'`, `'warn'`,
 *               `'error'`, `'success'`, or `'important'`.
 * @returns A `debug` instance with a pre-assigned color for that level.
 *
 * @example
 * ```ts
 * import { logger } from '../logger/Logger';
 *
 * const log = logger('warn');
 * log('Element "%s" was not visible, retrying...', elementName);
 * ```
 */
export const logger = (type: string): Debug.Debugger => {
  const log = createLogger(`${type}`);
  log.color = {
    info:      '75',  
    warn:      '214',
    error:     '203',
    success:   '78',
    important: '177',
  }[type] || log.color;
  return log;
};
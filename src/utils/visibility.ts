import { TextNotFoundError } from '@civitas-cerebrum/element-repository';

/**
 * element-repository's own "no element matches" answers that carry no error
 * class, by their message: the W3C `no such element` answer, WebdriverIO's
 * "wasn't found" for a lazy element, and the repository's index, "no
 * elements", "no visible elements" and attribute misses. Each is the answer
 * of a lookup that looked and found nothing. A contract test pins them
 * against the installed package.
 */
const NO_MATCH_MESSAGES: readonly RegExp[] = [
    /^(?:\w*Error:\s*)?(?:no such element\b|an element could not be located on the page)/i,
    /^Can't call \w+ on [\s\S]* wasn't found$/,
    /^Index -?\d+ out of bounds for '[\s\S]*' on '[\s\S]*' \(found \d+ elements\)\.$/,
    /^No elements found for '[\s\S]*' on '[\s\S]*'$/,
    /^No visible elements found for '[\s\S]*' on '[\s\S]*'\.$/,
    /^Element '[\s\S]*' on '[\s\S]*' with attribute \[[\s\S]*\] [\w ]+ "[\s\S]*" not found\.$/,
];

/**
 * True for an error that means "no element matches": a clean
 * `TextNotFoundError` (its final pass read every match), a W3C
 * `no such element` by name, or one of {@link NO_MATCH_MESSAGES}. Any other
 * error (an `unknown error`, a stale reference, a text pass cut short by a
 * driver error) is no answer.
 */
export function isNoMatchAnswer(err: unknown): boolean {
    if (err instanceof TextNotFoundError) return err.cleanMiss;
    if (!(err instanceof Error)) return false;
    if (err.name === 'no such element' || err.name === 'NoSuchElementError') return true;
    return NO_MATCH_MESSAGES.some(pattern => pattern.test(err.message));
}

/**
 * Runs a visibility read: `false` when it fails with a no-match answer
 * ({@link isNoMatchAnswer}); every other error is thrown, so a poll retries
 * it and a one-shot gate reports it. Never reads a driver error as "not
 * visible".
 */
export async function readVisible(read: () => Promise<boolean>): Promise<boolean> {
    try {
        return await read();
    } catch (err) {
        if (isNoMatchAnswer(err)) return false;
        throw err;
    }
}

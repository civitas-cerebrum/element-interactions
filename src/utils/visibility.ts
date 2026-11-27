import { SelectionStrategy, TextNotFoundError, type Element } from '@civitas-cerebrum/element-repository';

/**
 * element-repository's own "no element matches" answers that carry no error
 * class, by their message: the W3C `no such element` answer, WebdriverIO's
 * "wasn't found" for a lazy element, and the repository's
 * index, "no visible elements" and attribute misses. Each is the answer of a
 * lookup that looked and found nothing (their reads pass driver errors
 * through). A contract test pins them against the installed package.
 *
 * Not `No elements found for ...`: the RANDOM and ATTRIBUTE strategies throw
 * it for ANY failure of their first wait, a dead session included, so it is
 * no answer by itself (see {@link resolveConfirmed}).
 */
const NO_MATCH_MESSAGES: readonly RegExp[] = [
    /^(?:\w*Error:\s*)?(?:no such element\b|an element could not be located on the page)/i,
    /^Can't call \w+ on [\s\S]* wasn't found$/,
    /^Index -?\d+ out of bounds for '[\s\S]*' on '[\s\S]*' \(found \d+ elements\)\.$/,
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
    if (err instanceof NoMatchConfirmedError) return true;
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

/** A "no element matches" that a lookup of every match confirmed (see {@link resolveConfirmed}). */
export class NoMatchConfirmedError extends Error {
    constructor(message: string, cause?: unknown) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = 'NoMatchConfirmedError';
    }
}

/** element-repository's RANDOM / ATTRIBUTE answer that hides why its first wait failed. */
const NO_ELEMENTS = /^No elements found for '[\s\S]*' on '[\s\S]*'$/;

/**
 * Runs a repository lookup for a device chain. A RANDOM or ATTRIBUTE lookup
 * that fails with `No elements found for ...` (which element-repository
 * throws for any failure of the strategy's first wait, a dead session
 * included) is confirmed with `all`, a lookup of every match of the entry
 * whose errors pass through:
 *
 * - no match: a {@link NoMatchConfirmedError} with the same message (a
 *   no-match answer);
 * - RANDOM, some matches: the strategy waits for a visible one, so each is
 *   read ({@link readVisible}); all hidden is a {@link NoMatchConfirmedError}
 *   (`No visible elements found ...`), one shown, or a read that fails,
 *   throws: the lookup failed for another reason;
 * - ATTRIBUTE, some matches: its wait is for one attached, and matches are
 *   attached, so the lookup failed for another reason: it throws, and a
 *   poll tries again (the next lookup filters them by the attribute).
 *
 * Any other strategy or error passes unchanged.
 */
export async function resolveConfirmed(
    strategy: SelectionStrategy | undefined,
    lookup: () => Promise<Element>,
    all: () => Promise<Element>,
): Promise<Element> {
    try {
        return await lookup();
    } catch (err) {
        if (strategy !== SelectionStrategy.RANDOM && strategy !== SelectionStrategy.ATTRIBUTE) throw err;
        if (!(err instanceof Error) || !NO_ELEMENTS.test(err.message)) throw err;
        const matches = await (await all()).all();
        if (matches.length === 0) throw new NoMatchConfirmedError(err.message, err);
        const unresolved = `${err.message.replace(/^No elements found/, 'The lookup failed')}, although ${matches.length} match(es) exist`;
        if (strategy === SelectionStrategy.RANDOM) {
            for (const match of matches) {
                if (await readVisible(() => match.isVisible())) throw new Error(`${unresolved} and one is displayed.`, { cause: err });
            }
            throw new NoMatchConfirmedError(err.message.replace(/^No elements found/, 'No visible elements found') + '.', err);
        }
        throw new Error(`${unresolved}.`, { cause: err });
    }
}

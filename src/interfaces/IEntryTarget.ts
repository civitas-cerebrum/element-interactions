import type { Element } from '@civitas-cerebrum/element-repository';

/**
 * A repository entry as a fluent chain (`steps.on(element, page)`) holds it:
 * the chain's strategy selector and scope are already folded into its
 * resolvers. The steps layer hands it to a family's entry-level methods
 * (`IVerifications.pollTarget`, `visibleWithin`, `probeVisible`,
 * `listPresence`, `entryAbsence`, `IExtractions.captureSnapshot`), so each
 * family decides how often an entry is resolved and how it is read: the
 * Playwright family resolves once (its locators are lazy), the Appium family
 * re-resolves on every poll.
 *
 * Every `attachBudget` is the per-`fallback`-node attach wait in ms the
 * repository spends; omitted, the repository's default.
 */
export interface EntryTarget {
    /** The element name (a stamped label for a scoped `findBy*` chain), for messages. */
    readonly elementName: string;
    /** The page name, for messages. */
    readonly pageName: string;
    /** The chain's element: its strategy selector applied (`.nth()`, `.byText()`, `.visible()`, ...). */
    resolve(attachBudget?: number): Promise<Element>;
    /** The entry's default resolution: no strategy selector applied. */
    resolveDefault(attachBudget?: number): Promise<Element>;
    /** The whole collection (the `ALL` strategy), whatever the strategy selector. */
    resolveAll(attachBudget?: number): Promise<Element>;
    /** The element a visibility probe reads: the strategy selector applied, `.visible()` not. */
    probe(attachBudget: number): Promise<Element>;
}

/**
 * Snapshot of an element's state at a single point in time.
 *
 * Passed to predicates in `steps.expect(el, page).satisfy(predicate)` and
 * `steps.on(el, page).satisfy(predicate)`. All fields are primitives or plain
 * data — no async methods, no Playwright types.
 */
export interface ElementSnapshot {
    readonly text: string;
    readonly value: string;
    readonly attributes: Readonly<Record<string, string>>;
    readonly visible: boolean;
    readonly enabled: boolean;
    readonly count: number;
}

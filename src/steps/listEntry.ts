import { ElementRepository } from '@civitas-cerebrum/element-repository';

/**
 * `true` when the repository entry is declared `"list": true` — a collection
 * whose contract is "at least one match", not "this one element".
 *
 * Unknown page or element names answer `false`: the normal resolution path
 * that runs next raises its own, clearer "not found" error.
 */
export function isListEntry(repo: ElementRepository, elementName: string, pageName: string): boolean {
    try {
        return repo.getElementMeta(elementName, pageName).list;
    } catch {
        return false;
    }
}

/** A page-repository reference to an element, as listed-element options take it. */
type ElementRef = string | { pageName: string; elementName: string };

/**
 * Up-front check of a listed-element match, run by the listed-element steps
 * BEFORE the base collection is resolved: an option set that cannot identify
 * an item, or a repository reference (`withDescendant.child`, `child`) that
 * does not exist, fails at once instead of after the collection's resolution
 * wait. Throws the same error the families raise for a match without criteria.
 */
export function requireListedMatch(
    repo: Pick<ElementRepository, 'getSelector'>,
    options: { text?: unknown; attribute?: unknown; withDescendant?: { child: ElementRef }; child?: ElementRef },
): void {
    if (!options.text && !options.attribute && !options.withDescendant) {
        throw new Error('ListedElementOptions requires "text", "attribute", or "withDescendant" to identify the element.');
    }
    for (const ref of [options.withDescendant?.child, options.child]) {
        if (ref !== undefined && typeof ref !== 'string') repo.getSelector(ref.elementName, ref.pageName);
    }
}

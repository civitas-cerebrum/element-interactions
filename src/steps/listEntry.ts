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

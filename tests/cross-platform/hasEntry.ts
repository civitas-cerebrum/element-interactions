import type { ElementRepository } from '@civitas-cerebrum/element-repository';

/**
 * Whether the active platform's page `pageName` defines `elementName`. It
 * touches no driver. The page must resolve for the active platform: a missing
 * page, or a page with no entry for this platform, is a broken repository and
 * its error is rethrown. Only the repository's "element not found on page"
 * answer means "no such entry" and returns false; any other error is rethrown.
 */
export function hasEntry(repo: ElementRepository, elementName: string, pageName: string): boolean {
    // Throws when the page does not resolve for the active platform.
    repo.getPagePlatform(pageName);
    try {
        repo.getElementMeta(elementName, pageName);
        return true;
    } catch (error) {
        const missing = `ElementRepository: Element '${elementName}' not found on page '${pageName}'.`;
        if (error instanceof Error && error.message === missing) return false;
        throw error;
    }
}

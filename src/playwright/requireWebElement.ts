import { isWeb } from '@civitas-cerebrum/element-repository';
import type { Element, WebElement } from '@civitas-cerebrum/element-repository';

/**
 * The one element guard of the Playwright family (`web`). Every element-level
 * method of the family takes element-repository's neutral `Element` (the
 * family contract) and calls this first: a web element passes and is narrowed
 * to `WebElement`, any other element kind (a `PlatformElement` from an Appium
 * session) throws before anything is acted on. A platform element handed to
 * the web family never reaches a Playwright call.
 *
 * @param method  - `Class.method` of the family member, used in the error message.
 * @param element - The element the method was given.
 * @throws When `element` is not a web (Playwright) element.
 */
export function requireWebElement(method: string, element: Element): asserts element is WebElement {
    if (element && isWeb(element)) return;
    const kind = element && typeof element === 'object' && '_type' in element ? String(element._type) : typeof element;
    throw new Error(
        `${method} needs a web (Playwright) element, but was given a "${kind}" element (Playwright family). ` +
        'Elements resolved on a device session (Appium) are acted on by the Appium family; build Steps from that session\'s factory.',
    );
}

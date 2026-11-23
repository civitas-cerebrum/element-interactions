import type { Element, Platform } from '@civitas-cerebrum/element-repository';
import type { IInteractions } from '../interfaces/IInteractions';
import type {
    ActionTimeoutOptions,
    ClickOptions,
    DragAndDropOptions,
    DropdownSelectOptions,
    ListedElementMatch,
    TextMatcher,
} from '../enum/Options';
import type { AppiumDriver } from './platform/PlatformStrategy';
import { AppiumUtils } from './AppiumUtils';
import { dragSteps, performTouch } from './touch';
import { pollUntil } from '../utils/poll';
import { webOnly } from './unsupported';

/** Finger travel time of an offset drag, in ms. */
const DRAG_DURATION_MS = 600;

/** A string matcher is a substring; an object matcher is a regular expression. */
function textMatches(actual: string, matcher: TextMatcher, caseInsensitive = false): boolean {
    if (typeof matcher === 'string') {
        return caseInsensitive ? actual.toLowerCase().includes(matcher.toLowerCase()) : actual.includes(matcher);
    }
    return new RegExp(matcher.regex, matcher.flags).test(actual);
}

/**
 * The text tiers of a listed-element match, tried in order across the whole
 * list (the first tier any item passes wins): a string matcher is equal, then
 * a substring, then a substring ignoring case; a regex matcher is one tier.
 * The same tiers as {@link AppiumInteractions.getByText}.
 */
function textTiers(matcher: TextMatcher | undefined): Array<(actual: string) => boolean> {
    if (matcher === undefined) return [() => true];
    if (typeof matcher !== 'string') return [t => textMatches(t, matcher)];
    return [t => t === matcher, t => textMatches(t, matcher), t => textMatches(t, matcher, true)];
}

async function trimmedText(el: Element): Promise<string> {
    return ((await el.textContent()) ?? '').trim();
}

/**
 * Time left until `deadline`, in ms, never below 1: the waits and the
 * primitive of one action share a single timeout, and `0` must not reach a
 * primitive (where it can mean "no timeout").
 */
function remainingUntil(deadline: number): number {
    return Math.max(1, deadline - Date.now());
}

/**
 * Element interactions for the Appium family. Each action delegates to the
 * element's own primitive (element-repository `PlatformElement`) with the
 * timeout filled in; list resolution (`getByText`, `getListedElement`)
 * iterates the matches because platform elements have no lazy text filter.
 * Web-only actions throw `PlatformNotSupportedError(method, platform)`.
 */
export class AppiumInteractions implements IInteractions {
    private readonly utils: AppiumUtils;

    constructor(
        private readonly driver: AppiumDriver,
        private readonly platform: Platform,
        private readonly timeout: number = 30000,
    ) {
        this.utils = new AppiumUtils(timeout);
    }

    /**
     * Taps the element once it is visible.
     * - `ifPresent`: taps only when the element is displayed now; resolves `false` otherwise.
     * - `force`: taps the element's centre with a positional tap (`Element.tapAt`)
     *   instead of the element click command.
     * - `withoutScrolling`: accepted; a device tap never scrolls first.
     */
    async click(element: Element, options?: ClickOptions): Promise<boolean | void> {
        const timeout = options?.timeout ?? this.timeout;
        if (options?.ifPresent) {
            if (!(await element.isVisible().catch(() => false))) return false;
            await this.tap(element, timeout, options.force);
            return true;
        }
        const deadline = Date.now() + timeout;
        await this.utils.waitForState(element, 'visible', timeout);
        await this.tap(element, remainingUntil(deadline), options?.force);
    }

    private async tap(element: Element, timeout: number, force?: boolean): Promise<void> {
        if (!force) {
            await element.click({ timeout });
            return;
        }
        const box = await element.boundingBox();
        if (!box) throw new Error('click({ force }): the element has no bounds to tap.');
        await element.tapAt({ x: Math.floor(box.width / 2), y: Math.floor(box.height / 2) }, { timeout });
    }

    async clickIfPresent(element: Element, options?: ActionTimeoutOptions): Promise<boolean> {
        return await this.click(element, { ifPresent: true, timeout: options?.timeout }) as boolean;
    }

    async fill(element: Element, text: string): Promise<void> {
        await this.utils.softProbe(element, 'visible');
        await element.fill(text, { timeout: this.timeout });
    }

    async scrollIntoView(element: Element): Promise<void> {
        await element.scrollIntoView({ timeout: this.timeout });
    }

    /**
     * Drags onto `target` with the element's `dragTo` primitive, or, given only
     * `xOffset` / `yOffset`, drags the element's centre by that offset with a
     * W3C touch gesture.
     */
    async dragAndDrop(element: Element, options: DragAndDropOptions): Promise<void> {
        const timeout = options.timeout ?? this.timeout;
        const deadline = Date.now() + timeout;
        await this.utils.waitForState(element, 'visible', timeout);
        const target = options.target as Element | undefined;
        if (target) {
            await this.utils.waitForState(target, 'visible', remainingUntil(deadline));
            await element.dragTo(target, { timeout: remainingUntil(deadline) });
            return;
        }
        if (options.xOffset !== undefined && options.yOffset !== undefined) {
            const box = await element.boundingBox();
            if (!box) throw new Error('[Action] Error -> Unable to get bounding box for element to perform drag action.');
            const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            const to = { x: from.x + options.xOffset, y: from.y + options.yOffset };
            await performTouch(this.driver, [dragSteps(from, to, DRAG_DURATION_MS)]);
            return;
        }
        throw new Error(`[Action] Error -> You must provide either 'target', or both 'xOffset' and 'yOffset' in DragAndDropOptions.`);
    }

    /**
     * The first match of `base` whose trimmed text matches `desiredText`, in
     * the web family's order: equal, then containing it, then containing it
     * ignoring case (the same substring tiers as {@link getListedElement}).
     * `null` when none matches, or an error listing the texts seen when `strict`.
     */
    async getByText(base: Element, desiredText: string, strict: boolean = false): Promise<Element | null> {
        const all = await base.all();
        const texts = await Promise.all(all.map(async e => ((await e.textContent()) ?? '').trim()));
        const tiers: Array<(t: string) => boolean> = [
            t => t === desiredText,
            t => textMatches(t, desiredText),
            t => textMatches(t, desiredText, true),
        ];
        for (const tier of tiers) {
            const index = texts.findIndex(tier);
            if (index >= 0) return all[index];
        }
        if (strict) {
            const available = texts.filter(t => t.length > 0);
            throw new Error(
                `getByText: element with text "${desiredText}" not found.\nAvailable texts: ` +
                (available.length > 0 ? `\n- ${available.join('\n- ')}` : 'None'),
            );
        }
        return null;
    }

    async typeSequentially(element: Element, text: string, delay?: number): Promise<void> {
        await this.utils.softProbe(element, 'visible');
        await element.pressSequentially(text, delay, { timeout: this.timeout });
    }

    async doubleClick(element: Element): Promise<void> {
        await this.utils.softProbe(element, 'visible');
        await element.doubleClick({ timeout: this.timeout });
    }

    async check(element: Element): Promise<void> {
        await this.utils.softProbe(element, 'visible');
        await element.check({ timeout: this.timeout });
    }

    async uncheck(element: Element): Promise<void> {
        await this.utils.softProbe(element, 'visible');
        await element.uncheck({ timeout: this.timeout });
    }

    async clearInput(element: Element): Promise<void> {
        await this.utils.softProbe(element, 'visible');
        await element.clear({ timeout: this.timeout });
    }

    /**
     * The first item of the list `base` that matches every given criterion,
     * polled (the list re-read on every poll) until the instance timeout, then
     * waited on until visible within what is left of it, as on web:
     *
     * - `text`: the item's own text (`getText()`), in tiers across the list:
     *   equal, then a substring, then a substring ignoring case; a regex is
     *   one tier.
     * - `attribute`: the exact value, or a regex.
     * - `withDescendant`: the item has a descendant matching `child` (a
     *   selector, or a repository reference), searched INSIDE the item only
     *   (element-repository's `locateChild` is scoped to its parent); with
     *   `text`, one such descendant's text contains it ignoring case (the web
     *   `hasText` rule) or matches the regex.
     * - `child`: the returned element is that descendant of the matched item,
     *   scoped to the item.
     */
    async getListedElement(
        base: Element,
        options: ListedElementMatch,
        repo?: { getSelector(elementName: string, pageName: string): string },
    ): Promise<Element> {
        if (!options.text && !options.attribute && !options.withDescendant) {
            throw new Error('ListedElementOptions requires "text", "attribute", or "withDescendant" to identify the element.');
        }
        const selectorOf = (ref: string | { pageName: string; elementName: string }, option: string): string => {
            if (typeof ref === 'string') return ref;
            if (!repo) throw new Error(`An ElementRepository instance is required when "${option}" is a page-repository reference.`);
            return repo.getSelector(ref.elementName, ref.pageName);
        };
        const descendant = options.withDescendant;
        const descendantSelector = descendant ? selectorOf(descendant.child, 'withDescendant.child') : undefined;
        const childSelector = options.child !== undefined ? selectorOf(options.child, 'child') : undefined;

        const matchesAttribute = async (e: Element): Promise<boolean> => {
            if (!options.attribute) return true;
            const actual = await e.getAttribute(options.attribute.name);
            if (actual === null) return false;
            const { value } = options.attribute;
            return typeof value === 'string' ? actual === value : new RegExp(value.regex, value.flags).test(actual);
        };
        const hasDescendant = async (e: Element): Promise<boolean> => {
            if (descendantSelector === undefined) return true;
            const found = await e.locateChild(descendantSelector).all();
            if (descendant?.text === undefined) return found.length > 0;
            for (const d of found) {
                if (textMatches(await trimmedText(d), descendant.text, true)) return true;
            }
            return false;
        };

        const pick = async (): Promise<Element | undefined> => {
            const all = await base.all();
            const texts = options.text !== undefined ? await Promise.all(all.map(trimmedText)) : [];
            for (const tier of textTiers(options.text)) {
                for (let i = 0; i < all.length; i++) {
                    if (options.text !== undefined && !tier(texts[i])) continue;
                    if (!(await matchesAttribute(all[i]))) continue;
                    if (!(await hasDescendant(all[i]))) continue;
                    return all[i];
                }
            }
            return undefined;
        };

        const deadline = Date.now() + this.timeout;
        const matched = await pollUntil(pick, found => found !== undefined, {
            timeout: this.timeout,
            message: `No listed element matched ${JSON.stringify(options)}`,
        }) as Element;
        await this.utils.waitForState(matched, 'visible', remainingUntil(deadline));
        return childSelector === undefined ? matched : matched.locateChild(childSelector);
    }

    // ── Web only ──

    async uploadFile(_element: Element, _filePath: string | string[], _options?: ActionTimeoutOptions): Promise<void> { webOnly('uploadFile', this.platform); }
    async dropFiles(_element: Element, _filenames: string[], _options?: { mimeType?: string } & ActionTimeoutOptions): Promise<void> { webOnly('dropFiles', this.platform); }
    async selectDropdown(_element: Element, _options?: DropdownSelectOptions): Promise<string> { return webOnly('selectDropdown', this.platform); }
    async hover(_element: Element): Promise<void> { webOnly('hover', this.platform); }
    async rightClick(_element: Element, _options?: ActionTimeoutOptions): Promise<void> { webOnly('rightClick', this.platform); }
    async setSliderValue(_element: Element, _value: number, _options?: ActionTimeoutOptions): Promise<void> { webOnly('setSliderValue', this.platform); }
    async pressKey(_key: string): Promise<void> { webOnly('pressKey', this.platform); }
    async pressKeys(_keys: string[]): Promise<void> { webOnly('pressKeys', this.platform); }
    async dispatchEvent(_element: Element, _type: string, _eventInit?: Record<string, unknown>): Promise<void> { webOnly('dispatchEvent', this.platform); }
    async selectMultiple(_element: Element, _values: string[], _options?: ActionTimeoutOptions): Promise<string[]> { return webOnly('selectMultiple', this.platform); }
}

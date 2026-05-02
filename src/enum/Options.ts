import { WebElement } from '@civitas-cerebrum/element-repository';

/**
 * Defines the strategy for selecting an option from a dropdown element.
 */
export enum DropdownSelectType {
    /** Selects a completely random, non-disabled option with a valid value. */
    RANDOM = 'random',
    /** Selects an option based on its zero-based index in the dropdown. */
    INDEX = 'index',
    /** Selects an option based on its exact 'value' attribute. */
    VALUE = 'value'
}

/**
 * Configuration options for the `selectDropdown` method.
 */
export interface DropdownSelectOptions {
    /** The selection strategy to use. Defaults to RANDOM. */
    type?: DropdownSelectType;
    /** The specific value attribute to select (Required if type is VALUE). */
    value?: string;
    /** The index of the option to select (Required if type is INDEX). */
    index?: number;
    /** Per-call timeout override in milliseconds. Falls back to the Interactions default when omitted. */
    timeout?: number;
}

/**
 * Minimal options for action methods that only need a per-call timeout
 * (`rightClick`, `uploadFile`, `setSliderValue`, `selectMultiple`).
 * Use the dedicated option bags (`ClickOptions`, `DropdownSelectOptions`,
 * `DragAndDropOptions`) when there are other modifiers.
 */
export interface ActionTimeoutOptions {
    /** Per-call timeout override in milliseconds. Falls back to the Interactions default when omitted. */
    timeout?: number;
}

/**
 * Configuration options for the `text` verification method.
 *
 * @deprecated The `notEmpty` flag is redundant — calling `verifyText()` with no
 * `expectedText` now asserts "not empty" on its own. Prefer `verifyText(element, page)`
 * (or `.on(element, page).verifyText()` in the fluent API) over passing
 * `undefined, { notEmpty: true }`. This interface will be removed in a future
 * major release.
 */
export interface TextVerifyOptions {
    /**
     * Asserts that the element has text content, ignoring 'expectedText'.
     * @deprecated Redundant — omit `expectedText` to get the same behavior.
     */
    notEmpty?: boolean;
}

/**
 * Shared modifiers every storage assertion accepts.
 * Kept separate from the matcher predicate so a single `verifyLocalStorage` /
 * `verifySessionStorage` on `Steps` can accept any matcher shape with the
 * same trailing modifier set.
 */
interface StorageVerifyModifiers {
    /** When `true`, flips the assertion. */
    negated?: boolean;
    /** Override the class-level timeout for this single assertion. */
    timeout?: number;
    /** Custom message prepended to the failure header. */
    errorMessage?: string;
}

/**
 * Discriminated matcher for `verifyLocalStorage` / `verifySessionStorage`.
 * Pick exactly one of `equals`, `contains`, `matches`, or `present` — TypeScript
 * enforces the choice via `?: never` on the others.
 *
 * Steps stays lightweight (one method per storage type) by accepting this
 * union; the variety lives in `Verifications` (`verify.localStorage`,
 * `localStorageContains`, `localStorageMatches`, `localStoragePresent`).
 *
 * @example
 * ```ts
 * await steps.verifyLocalStorage('theme', { equals: 'dark' });
 * await steps.verifyLocalStorage('flag', { contains: 'enabled' });
 * await steps.verifyLocalStorage('build', { matches: /^v\d+$/ });
 * await steps.verifyLocalStorage('seen', { present: true });
 * await steps.verifyLocalStorage('temp', { present: false });   // absence
 * await steps.verifyLocalStorage('seen', { present: true, negated: true });  // also absence
 * ```
 */
export type StorageVerifyOptions =
    | (StorageVerifyModifiers & { equals: string;   contains?: never; matches?: never; present?: never })
    | (StorageVerifyModifiers & { equals?: never;   contains: string; matches?: never; present?: never })
    | (StorageVerifyModifiers & { equals?: never;   contains?: never; matches: RegExp; present?: never })
    | (StorageVerifyModifiers & { equals?: never;   contains?: never; matches?: never; present: boolean });

/**
 * Configuration options for the `count` verification method.
 * At least one constraint is required: exactly, greaterThan, or lessThan.
 */
export type CountVerifyOptions =
    | { exactly: number; greaterThan?: never; lessThan?: never; greaterThanOrEqual?: never; lessThanOrEqual?: never }
    | { exactly?: never; greaterThan: number; lessThan?: number; greaterThanOrEqual?: never; lessThanOrEqual?: never }
    | { exactly?: never; greaterThan?: number; lessThan: number; greaterThanOrEqual?: never; lessThanOrEqual?: never }
    | { exactly?: never; greaterThan?: never; lessThan?: never; greaterThanOrEqual: number; lessThanOrEqual?: number }
    | { exactly?: never; greaterThan?: never; lessThan?: never; greaterThanOrEqual?: number; lessThanOrEqual: number };

/**
 * Configuration options for the `dragAndDrop` method.
 * You must provide either a `targetLocator` OR both `xOffset` and `yOffset`.
 */
export interface DragAndDropOptions {
    /** The destination `WebElement` to drop the dragged element onto. */
    target?: WebElement;
    /** The horizontal offset from the center of the element (positive moves right). */
    xOffset?: number;
    /** The vertical offset from the center of the element (positive moves down). */
    yOffset?: number;
    /** Per-call timeout override in milliseconds. Falls back to the Interactions default when omitted. */
    timeout?: number;
}

/**
 * A match value for listed-element filters.
 *
 * - A plain `string` matches as a substring (existing semantics — kept for
 *   backwards compatibility with every pre-0.2.6 call site).
 * - A `{ regex, flags? }` object is compiled into a `RegExp` and used to
 *   match via Playwright's filter APIs. Use this for multi-language text
 *   matching and any pattern-based narrowing (e.g. list items whose label
 *   matches `/delivery fee|entrega|Liefergebühr/i`).
 *
 * @example
 * { regex: 'Sandycove|Burgatia|Owenahincha', flags: 'i' }
 */
export type TextMatcher = string | { regex: string; flags?: string };

/**
 * Core match criteria for locating a specific element within a list.
 *
 * The listed element is identified by EITHER `text` (visible text match) OR
 * `attribute` (HTML attribute name-value match). Both can be combined with
 * `withDescendant` to additionally filter by the presence or text of a
 * descendant element — useful when the list item itself doesn't carry the
 * distinguishing signal but one of its children does.
 *
 * `child` drills into a descendant AFTER the item is matched (for assertion
 * or extraction downstream), where `withDescendant` narrows WHICH item is
 * matched in the first place.
 */
export interface ListedElementMatch {
    /** Match the listed element by its visible text content. String = substring, object = regex. */
    text?: TextMatcher;
    /** Match the listed element by an HTML attribute. String value = substring, object = regex. */
    attribute?: { name: string; value: TextMatcher };
    /**
     * Filter list items that contain a descendant matching this criterion.
     * Composes with `text` / `attribute` (AND logic — the item must satisfy
     * both the top-level match and the descendant filter).
     *
     * @example
     * // "find the orderSummaryRow whose `amount` child reads /delivery/i"
     * { withDescendant: { child: { pageName: 'CheckoutPage', elementName: 'amount' },
     *                     text: { regex: 'delivery', flags: 'i' } } }
     */
    withDescendant?: {
        /** The descendant to look for — CSS selector or page-repository reference. */
        child: string | { pageName: string; elementName: string };
        /** Optional text match on the descendant. When omitted, only presence is required. */
        text?: TextMatcher;
    };
    /** Target a child within the matched element — a CSS selector or a page-repository reference. */
    child?: string | { pageName: string; elementName: string };
}

/**
 * Options for `verifyListedElement` — extends match criteria with assertion fields.
 *
 * @example
 * { text: 'John', child: 'td:nth-child(2)', expectedText: 'John Doe' }
 * { attribute: { name: 'data-id', value: '5' }, expected: { name: 'class', value: 'active' } }
 */
export interface VerifyListedOptions extends ListedElementMatch {
    /** Assert that the resolved element's text matches this value. */
    expectedText?: string;
    /** Assert that the resolved element has this attribute name-value pair. `value` can be a string (exact match) or regex. */
    expected?: { name: string; value: TextMatcher };
}

/**
 * Options for `getListedElementData` — extends match criteria with data extraction fields.
 *
 * @example
 * { text: 'John', child: 'a.profile-link', extractAttribute: 'href' }
 */
export interface GetListedDataOptions extends ListedElementMatch {
    /** Extract a specific attribute value instead of text content. */
    extractAttribute?: string;
}

/**
 * @deprecated Use `ListedElementMatch`, `VerifyListedOptions`, or `GetListedDataOptions` instead.
 * Kept as a union alias for backward compatibility with direct `getListedElement` callers.
 */
export type ListedElementOptions = ListedElementMatch & VerifyListedOptions & GetListedDataOptions;

/**
 * Describes a value for a single field in a `fillForm` call.
 * Use a plain string for text inputs, or a `DropdownSelectOptions` object for `<select>` elements.
 */
export type FillFormValue = string | DropdownSelectOptions;

/**
 * Options for the `getAll` bulk-extraction method.
 *
 * @example
 * // Get all name-column texts from table rows
 * { child: 'td:nth-child(2)' }
 *
 * @example
 * // Get all href attributes from links inside list items
 * { child: 'a', extractAttribute: 'href' }
 */
export interface GetAllOptions {
    /** Drill into a child element within each matched element before extracting. */
    child?: string | { pageName: string; elementName: string };
    /** Extract a specific attribute value instead of text content. */
    extractAttribute?: string;
}

/**
 * Options for the `screenshot` method.
 */
export interface ScreenshotOptions {
    /** Capture the full scrollable page instead of just the viewport. Only applies to page-level screenshots. */
    fullPage?: boolean;
    /** File path to save the screenshot to. If omitted, returns the image buffer without saving. */
    path?: string;
}

/**
 * Options for the `isVisible` probe method.
 */
export interface IsVisibleOptions {
    /** Maximum time to wait for the element in milliseconds. Defaults to `2000`. */
    timeout?: number;
    /** Only return `true` if the element's text content contains this string. */
    containsText?: string;
}

/**
 * Modifiers for click actions.
 */
export interface ClickOptions {
    /** Dispatch a native 'click' event bypassing Playwright actionability checks. */
    withoutScrolling?: boolean;
    /** Skip silently if element is not visible instead of throwing. */
    ifPresent?: boolean;
    /** Force the click, bypassing Playwright's pointer-interception checks. Useful for elements obscured by parent overlays. */
    force?: boolean;
    /** Per-call timeout override in milliseconds. Falls back to the Interactions default when omitted. */
    timeout?: number;
}

/**
 * Combined options for Steps API methods — element resolution + interaction modifiers.
 */
export interface StepOptions {
    /** Element selection strategy. Defaults to 'first'. */
    strategy?: 'first' | 'random' | 'index' | 'text' | 'attribute' | 'all';
    /** Zero-based index (required when strategy is 'index'). */
    index?: number;
    /** Text to match (required when strategy is 'text'). */
    text?: string;
    /** Attribute name to match (required when strategy is 'attribute'). */
    attribute?: string;
    /** Attribute value to match (used with strategy 'text' or 'attribute'). */
    value?: string;
    /** Dispatch native click event bypassing Playwright actionability checks. */
    withoutScrolling?: boolean;
    /** Skip silently if element is not visible. */
    ifPresent?: boolean;
    /** Force the click, bypassing Playwright's pointer-interception checks. */
    force?: boolean;
}

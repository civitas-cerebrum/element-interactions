import { Locator } from '@playwright/test';

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
}

/**
 * Configuration options for the `text` verification method.
 */
export interface TextVerifyOptions {
    /** Asserts that the element has text content, ignoring 'expectedText'. */
    notEmpty: true;
}

/**
 * Configuration options for the `count` verification method.
 * At least one constraint is required: exactly, greaterThan, or lessThan.
 */
export type CountVerifyOptions =
    | { exactly: number; greaterThan?: never; lessThan?: never }
    | { exactly?: never; greaterThan: number; lessThan?: number }
    | { exactly?: never; greaterThan?: number; lessThan: number };

/**
 * Configuration options for the `dragAndDrop` method.
 * You must provide either a `targetLocator` OR both `xOffset` and `yOffset`.
 */
export interface DragAndDropOptions {
    /** The destination element to drop the dragged element onto. */
    target?: Locator;
    /** The horizontal offset from the center of the element (positive moves right). */
    xOffset?: number;
    /** The vertical offset from the center of the element (positive moves down). */
    yOffset?: number;
}

/**
 * Core match criteria for locating a specific element within a list.
 * Provide either `text` (visible text match) or `attribute` (HTML attribute match).
 * Optionally drill into a child element with `child`.
 */
export interface ListedElementMatch {
    /** Match the listed element by its visible text content. */
    text?: string;
    /** Match the listed element by an HTML attribute name-value pair. */
    attribute?: { name: string; value: string };
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
    /** Assert that the resolved element has this attribute name-value pair. */
    expected?: { name: string; value: string };
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

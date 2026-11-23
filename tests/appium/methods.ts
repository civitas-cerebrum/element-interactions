/**
 * Shared by the Appium unit specs: the methods of each Appium family class
 * that have a device meaning (the complement of the web-only refusals).
 * `appium-family.spec.ts` checks it against the classes; the verifications
 * spec checks every polling verification in it has a retry case.
 */
export const DEVICE_METHODS = {
    interactions: ['click', 'clickIfPresent', 'fill', 'scrollIntoView', 'dragAndDrop', 'getByText', 'typeSequentially',
        'doubleClick', 'check', 'uncheck', 'clearInput', 'getListedElement', 'tap'],
    extractions: ['getText', 'getAttribute', 'getAllTexts', 'getInputValue', 'getCount', 'getBoundingBox', 'screenshot'],
    navigation: [] as string[],
    verifications: ['text', 'textContains', 'textMatches', 'textStartsWith', 'textEndsWith', 'presence', 'absence', 'state',
        'attribute', 'attributeContains', 'attributeMatches', 'hasAttribute', 'inputValue', 'inputValueContains',
        'inputValueMatches', 'inputValueStartsWith', 'inputValueEndsWith', 'order', 'listOrder', 'count',
        'expectEqual', 'expectNotEqual', 'expectEventually', 'readText', 'allTexts'],
};

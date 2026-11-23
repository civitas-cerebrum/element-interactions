import { test, expect, type Page } from '@playwright/test';
import type { Element, ElementRepository, Platform } from '@civitas-cerebrum/element-repository';
import {
    ElementType,
    PlatformNotSupportedError,
    PlaywrightFactory,
    PlaywrightGestures,
    Interactions,
    Verifications,
    Extractions,
    Steps,
} from '../src/index';
import type { IInteractionFactory } from '../src/index';
import { ElementAction } from '../src/steps/ElementAction';
import { ExpectBuilder } from '../src/steps/ExpectMatchers';
import { ReResolvingElement } from '../src/steps/ReResolvingElement';
import { AppiumFactory } from '../src/appium';
import { mockDriver, mockElement } from './appium/mocks';

/**
 * Pure unit tests (no browser) for the platform-neutral Steps layer: Steps
 * built from a factory routes every shared step to the factory's members with
 * element-repository's neutral `Element`; every web-only step throws
 * `PlatformNotSupportedError(step, platform)` off the Playwright family; a
 * shared feature whose device path is not built yet throws, never passes; the
 * Playwright family refuses a non-web element.
 */

// ─── The step classification (feeds the README's platform table) ───────────
//
// shared   — UI steps with the same name and arguments on every platform.
// web-only — throw PlatformNotSupportedError(step, platform) off the Playwright family.
// non-ui   — API (wasapi), SQL, email, pacing and pure value checks: no driver, every platform.
// platform-only — CONTRACT B5 steps with no element on web: throw PlatformNotSupportedError(step, 'web')
//            before anything (tests/steps-platform-steps.spec.ts checks each one).
// element gestures — CONTRACT B5 element-level gestures: on a device they resolve the element and call
//            its primitive. On web swipe / longPress / scrollUntilFound follow the element primitive;
//            pinch / zoom throw PlatformNotSupportedError(step, 'web') before resolving anything.
//            scrollIntoView, the pre-existing one, stays under shared.

const PLATFORM_ONLY = [
    // app lifecycle
    'launchApp', 'activateApp', 'terminateApp', 'backgroundApp', 'resetApp', 'installApp', 'removeApp', 'openDeepLink',
    // screen-level gestures
    'swipeScreen', 'tapAt',
    // device
    'pressBack', 'hideKeyboard', 'setOrientation', 'acceptAlert', 'dismissAlert', 'setPermission',
    // contexts
    'getContexts', 'switchContext',
    // device assertions (polling)
    'verifyAppInForeground', 'verifyOrientation', 'verifyKeyboardShown', 'verifyContext',
    // extraction
    'getPageSource',
] as const;

const ELEMENT_GESTURES = ['swipe', 'scrollUntilFound', 'longPress', 'pinch', 'zoom'] as const;

const SHARED = [
    'on', 'click', 'clickRandom', 'clickIfPresent', 'doubleClick', 'check', 'uncheck', 'scrollIntoView', 'fill',
    'dragAndDrop', 'dragAndDropListedElement', 'typeSequentially', 'clearInput',
    'getText', 'getAttribute', 'getCount', 'getInputValue', 'getBoundingBox', 'getAll',
    'verifyPresence', 'verifyAllPresent', 'isPresent', 'isVisible', 'verifyAbsence', 'verifyText', 'verifyCount',
    'verifyTextContains', 'verifyState', 'verifyAttribute', 'verifyInputValue', 'expect', 'verifyOrder', 'verifyListOrder',
    'clickListedElement', 'verifyListedElement', 'getListedElementData',
    'waitForState', 'waitAndClick', 'clickNth', 'fillForm', 'screenshot',
] as const;

const WEB_ONLY = [
    // URL, history, viewport, tabs
    'navigateTo', 'getUrl', 'getCurrentPath', 'waitForUrl', 'refresh', 'backOrForward', 'setViewport',
    'switchToNewTab', 'forPage', 'closeTab', 'getTabCount', 'verifyTabCount', 'verifyUrlContains',
    // pointer / keyboard / form controls with no device meaning
    'rightClick', 'hover', 'uploadFile', 'dropFiles', 'selectDropdown', 'setSliderValue', 'pressKey', 'pressKeys',
    'dispatchEvent', 'selectMultiple',
    // HTML, CSS, page text, window, scripts
    'getCssProperty', 'getHtml', 'getPageHtml', 'getPageText', 'getWindowProperty', 'setWindowProperty', 'evaluateScript',
    'verifyImages', 'verifyHtml', 'verifyHtmlContains', 'verifyHtmlMatches', 'verifyPageHtml', 'verifyPageHtmlContains',
    'verifyPageHtmlMatches', 'verifyWindowProperty', 'verifyPageContainsText', 'verifyPageNotContainsText',
    'verifyPageTitle', 'verifyCssProperty',
    // storage
    'getLocalStorage', 'getSessionStorage', 'getLocalStorageKeys', 'getSessionStorageKeys', 'setLocalStorage',
    'setSessionStorage', 'removeLocalStorage', 'removeSessionStorage', 'clearLocalStorage', 'clearSessionStorage',
    'verifyLocalStorage', 'verifySessionStorage',
    // browser-session requests and network
    'requestGet', 'requestPost', 'requestPut', 'requestPatch', 'requestDelete', 'requestHead',
    'waitForNetworkIdle', 'waitForLoadState', 'waitForResponse', 'expectNoRequest',
    // visual regression
    'verifyVisualMatch',
] as const;

const NON_UI = [
    // pacing / composition (no element, no driver)
    'pace', 'repeat', 'retryUntil',
    // checks on an already-received browser response value
    'verifyRequestStatus', 'verifyRequestHeader', 'verifyRequestOk',
    // email
    'sendEmail', 'receiveEmail', 'receiveAllEmails', 'cleanEmails', 'markEmail',
    // API (wasapi)
    'apiGet', 'apiPost', 'apiPut', 'apiDelete', 'apiPatch', 'apiHead', 'verifyApiStatus', 'verifyApiHeader',
    // SQL
    'sqlQuery', 'sqlExecute', 'sqlTransaction', 'sqlPing', 'sqlScript', 'sqlSelect', 'sqlInsert', 'sqlUpdate',
    'sqlDelete', 'closeDbConnections', 'verifySqlRowCount', 'verifySqlValue', 'verifySqlContains', 'verifySqlColumn',
    'verifySqlEmpty', 'verifySqlNotEmpty',
] as const;

/** Prototype members that are not steps: the platform getter and private helpers. */
const NOT_STEPS = [
    'constructor', 'platform',
    'requireWeb', 'webPage', 'webRequest', 'toResolutionOptions', 'toAllResolutionOptions', 'getElement', 'getAllElement',
    'actionWithStrategy', 'requireListMatch', 'verifyStorage', 'resolveVisualMaskLocators', 'getApiClient',
    'resolveApiArgs', 'resolveApiArgsWithBody', 'getDbClient', 'resolveSqlArgs', 'bindBuilder',
    'requirePlatform', 'requireDeviceStep', 'stepAppId', 'pollDevice',
];

// ─── ElementAction (steps.on) and matcher-tree classification ────────────────

/** Web-only `ElementAction` terminals, each with a call; they throw PlatformNotSupportedError(<name>, platform). */
const WEB_ONLY_TERMINALS: Record<string, (action: ElementAction) => unknown> = {
    hover: a => a.hover(),
    rightClick: a => a.rightClick(),
    selectDropdown: a => a.selectDropdown(),
    uploadFile: a => a.uploadFile('f.txt'),
    dropFiles: a => a.dropFiles(['f.txt']),
    setSliderValue: a => a.setSliderValue(1),
    selectMultiple: a => a.selectMultiple(['a']),
    getCssProperty: a => a.getCssProperty('color'),
    getHtml: a => a.getHtml(),
    verifyHtml: a => a.verifyHtml('<b/>'),
    verifyHtmlContains: a => a.verifyHtmlContains('b'),
    verifyHtmlMatches: a => a.verifyHtmlMatches(/b/),
    verifyCssProperty: a => a.verifyCssProperty('color', 'red'),
    verifyImages: a => a.verifyImages(),
    findByRole: a => a.findByRole('button'),
    findByText: a => a.findByText('x'),
    findBySelector: a => a.findBySelector('.x'),
    // matcher-tree fields (refused when the chain is built)
    html: a => a.html,
    outerHtml: a => a.outerHtml,
    css: a => a.css('color'),
};

/** Shared `ElementAction` terminals and matcher-tree fields: never refused for the platform. */
const SHARED_TERMINALS = [
    'click', 'clickIfPresent', 'fill', 'scrollIntoView', 'check', 'uncheck', 'doubleClick', 'typeSequentially',
    'dragAndDrop', 'clearInput', 'verifyPresence', 'verifyAbsence', 'verifyText', 'verifyTextContains', 'verifyCount',
    'isPresent', 'isVisible', 'verifyAttribute', 'verifyInputValue', 'verifyState', 'verifyOrder', 'verifyListOrder',
    'getText', 'getAttribute', 'getCount', 'getAllTexts', 'getInputValue', 'screenshot', 'waitForState',
    'text', 'value', 'count', 'visible', 'enabled', 'attributes', 'not', 'satisfy',
];

/** `ElementAction` members that are not terminals: chain modifiers, accessors and helpers. */
const ACTION_CHAIN = [
    'constructor', 'platform', 'repo', 'elementName', 'pageName', 'timeout', 'first', 'random', 'nth', 'byText',
    'byAttribute', 'ifVisible', 'probeTarget', 'captureSnapshot', 'buildExpectContext',
    'requireWeb', 'selectVisible', 'shouldProceed', 'resolve', 'resolveAll', 'narrowScoped', 'spawnScoped',
    'isWholeListEntry', 'verifyListPresence', 'absenceAttachSlice', 'expectBuilder',
    'onDevice', 'verifyTarget', 'probeOnDevice', 'verifyListPresenceOnDevice', 'verifyAbsenceOnDevice', 'captureDeviceSnapshot',
];

/** Matcher-tree (`ExpectBuilder`) fields that are web-only, and the shared ones. */
const WEB_ONLY_FIELDS = ['html', 'outerHtml', 'css'];
const SHARED_FIELDS = ['text', 'value', 'count', 'visible', 'enabled', 'attributes', 'satisfy', 'not'];
/** `ExpectBuilder` members that are not fields: chain plumbing. */
const BUILDER_PLUMBING = ['constructor', 'timeout', '_setCtxTimeout', 'throws', 'enqueue', 'then', 'consumeNot', 'flush', 'requireWeb'];

function expectComplete(proto: object, groups: Record<string, readonly string[]>, what: string) {
    const all = Object.values(groups).flat();
    expect(new Set(all).size, `${what}: a name is classified twice`).toBe(all.length);
    const names = Object.getOwnPropertyNames(proto);
    expect(names.filter(n => !all.includes(n)), `${what}: classify every new member (${Object.keys(groups).join(' / ')})`).toEqual([]);
    expect(all.filter(n => !names.includes(n)), `${what}: classified names that do not exist`).toEqual([]);
}

// ─── Stubs ───────────────────────────────────────────────────────────────────

type Call = [string, string, ...unknown[]];

/** A neutral platform element recording the primitives called on it. */
function stubElement(name: string, calls: Call[], type: ElementType = ElementType.PLATFORM): Element {
    const el: Record<string, unknown> = { _type: type, selector: `~${name}` };
    const rec = (method: string, result?: unknown) => (...args: unknown[]) => {
        calls.push([`element:${name}`, method, ...args]);
        return result;
    };
    el.first = () => el;
    el.nth = () => el;
    el.locateChild = () => el;
    el.waitFor = async (...args: unknown[]) => { rec('waitFor')(...args); };
    el.isVisible = async () => { rec('isVisible')(); return true; };
    el.textContent = async () => { rec('textContent')(); return 'text'; };
    el.getAttribute = async (...args: unknown[]) => { rec('getAttribute')(...args); return 'value'; };
    el.count = async () => { rec('count')(); return 1; };
    el.all = async () => { rec('all')(); return [el]; };
    return el as unknown as Element;
}

const RETURNS: Record<string, unknown> = {
    'extract.getText': 'text',
    'extract.getAttribute': 'value',
    'extract.getCount': 3,
    'extract.getInputValue': 'input',
    'extract.getAllTexts': ['a', 'b'],
    'extract.getBoundingBox': { x: 0, y: 0, width: 1, height: 1 },
    'extract.screenshot': Buffer.from(''),
    'utils.waitForState': true,
    'utils.repeat': [],
    'interact.click': true,
};

/** The timeout every recording factory reports through its utils. */
const FACTORY_TIMEOUT = 300;

/** One family member: records every call as `[member, method, ...args]`. */
function recordingMember(member: string, calls: Call[], listed: Element): object {
    return new Proxy({}, {
        get(_target, prop) {
            if (typeof prop !== 'string' || prop === 'then') return undefined;
            // The factory's timeout, read synchronously by the Steps constructor.
            if (member === 'utils' && prop === 'getTimeout') return () => FACTORY_TIMEOUT;
            return (...args: unknown[]) => {
                calls.push([member, prop, ...args]);
                if (member === 'interact' && prop === 'getListedElement') return Promise.resolve(listed);
                return Promise.resolve(RETURNS[`${member}.${prop}`]);
            };
        },
    });
}

/** An Appium-family factory for `platform` whose members record their calls. */
function recordingFactory(platform: Platform, calls: Call[], listed: Element): IInteractionFactory {
    return {
        platform,
        family: 'appium',
        createInteractions: () => recordingMember('interact', calls, listed),
        createVerifications: () => recordingMember('verify', calls, listed),
        createExtractions: () => recordingMember('extract', calls, listed),
        createNavigation: () => recordingMember('navigate', calls, listed),
        createUtils: () => recordingMember('utils', calls, listed),
        createGestures: () => recordingMember('gestures', calls, listed),
        createDevice: () => recordingMember('device', calls, listed),
    } as unknown as IInteractionFactory;
}

/** A repository stand-in resolving every name to `element` (list entries to `listy`). */
function stubRepo(calls: Call[], element: Element, driver?: unknown): ElementRepository {
    const resolve = (method: string) => async (...args: unknown[]) => { calls.push(['repo', method, ...args]); return element; };
    return {
        driver,
        platform: 'ios',
        get: resolve('get'),
        getAll: resolve('getAll'),
        getRandom: resolve('getRandom'),
        getByText: resolve('getByText'),
        getByIndex: resolve('getByIndex'),
        getVisible: resolve('getVisible'),
        getSelector: () => '~selector',
        getElementMeta: (elementName: string) => ({ list: elementName === 'listy' }),
    } as unknown as ElementRepository;
}

function iosSteps() {
    const calls: Call[] = [];
    const element = stubElement('target', calls);
    const listed = stubElement('listed', calls);
    const factory = recordingFactory('ios', calls, listed);
    const repo = stubRepo(calls, element);
    const steps = new Steps(factory, repo, { timeout: FACTORY_TIMEOUT });
    calls.length = 0; // the constructor builds the members; only step calls are asserted
    return { steps, calls, element, listed, factory, repo };
}

async function caught(call: () => unknown): Promise<unknown> {
    try {
        await call();
    } catch (error) {
        return error;
    }
    return undefined;
}

function expectNotSupported(error: unknown, method: string, platform: Platform) {
    expect(error, `${method} should throw PlatformNotSupportedError`).toBeInstanceOf(PlatformNotSupportedError);
    const err = error as PlatformNotSupportedError;
    expect(err.method).toBe(method);
    expect(err.platform).toBe(platform);
}

/** Calls of one family member (`interact`, `verify`, ...). */
function memberCalls(calls: Call[], member: string): Call[] {
    return calls.filter(c => c[0] === member);
}

// ─── Classification completeness ─────────────────────────────────────────────

test.describe('Step classification', () => {
    test('every Steps prototype member is classified exactly once', () => {
        const all = [...SHARED, ...WEB_ONLY, ...NON_UI, ...PLATFORM_ONLY, ...ELEMENT_GESTURES, ...NOT_STEPS];
        expect(new Set(all).size, 'a name is classified twice').toBe(all.length);
        const proto = Object.getOwnPropertyNames(Steps.prototype);
        const unclassified = proto.filter(n => !all.includes(n));
        expect(unclassified, 'classify every new step as shared, web-only, non-ui, platform-only or element gesture').toEqual([]);
        const stale = all.filter(n => !proto.includes(n));
        expect(stale, 'classified names that are not on Steps').toEqual([]);
    });

    test('every ElementAction prototype member is classified exactly once', () => {
        expectComplete(ElementAction.prototype, {
            shared: SHARED_TERMINALS,
            'web-only': Object.keys(WEB_ONLY_TERMINALS),
            chain: ACTION_CHAIN,
        }, 'ElementAction');
    });

    test('every matcher-tree (ExpectBuilder) member is classified exactly once', () => {
        expectComplete(ExpectBuilder.prototype, {
            shared: SHARED_FIELDS,
            'web-only': WEB_ONLY_FIELDS,
            plumbing: BUILDER_PLUMBING,
        }, 'ExpectBuilder');
        // The ElementAction shortcuts to the matcher tree are classified the same way.
        for (const field of WEB_ONLY_FIELDS) expect(Object.keys(WEB_ONLY_TERMINALS)).toContain(field);
        for (const field of SHARED_FIELDS) expect(SHARED_TERMINALS).toContain(field);
    });
});

// ─── Web-only guard ──────────────────────────────────────────────────────────

test.describe('Web-only steps off the Playwright family', () => {
    for (const name of WEB_ONLY) {
        test(`${name} throws PlatformNotSupportedError("${name}", "ios") before touching anything`, async () => {
            const { steps, calls } = iosSteps();
            const method = (steps as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
            const error = await caught(() => method.call(steps, 'a', 'b', 'c', 'd'));
            expectNotSupported(error, name, 'ios');
            expect(calls, 'nothing resolved or acted on before the guard').toEqual([]);
        });
    }

    test('the guard names the factory platform (android)', async () => {
        const calls: Call[] = [];
        const steps = new Steps(recordingFactory('android', calls, stubElement('l', calls)), stubRepo(calls, stubElement('t', calls)));
        expectNotSupported(await caught(() => steps.navigateTo('/x')), 'navigateTo', 'android');
        expectNotSupported(await caught(() => steps.hover('el', 'Page')), 'hover', 'android');
    });

    for (const [name, call] of Object.entries(WEB_ONLY_TERMINALS)) {
        test(`steps.on().${name} throws PlatformNotSupportedError("${name}", "ios") before resolving`, async () => {
            const { steps, calls } = iosSteps();
            expectNotSupported(await caught(() => call(steps.on('el', 'Page'))), name, 'ios');
            expect(calls).toEqual([]);
        });
    }

    for (const name of SHARED_TERMINALS) {
        test(`steps.on().${name} is not refused for the platform`, async () => {
            const { steps } = iosSteps();
            const action = steps.on('el', 'Page');
            const descriptor = Object.getOwnPropertyDescriptor(ElementAction.prototype, name)!;
            const error = await caught(async () => {
                const member = descriptor.get ? descriptor.get.call(action) : descriptor.value.call(action, 'a', 'b');
                // Fields return a matcher (not run); terminal calls run against the recording family.
                if (!descriptor.get) await member;
            });
            expect(error).not.toBeInstanceOf(PlatformNotSupportedError);
        });
    }

    test('matcher-tree html / outerHtml / css are refused by field name before resolving', async () => {
        const { steps, calls } = iosSteps();
        expectNotSupported(await caught(() => steps.expect('el', 'Page').html), 'html', 'ios');
        expectNotSupported(await caught(() => steps.expect('el', 'Page').outerHtml), 'outerHtml', 'ios');
        expectNotSupported(await caught(() => steps.expect('el', 'Page').css('color')), 'css', 'ios');
        expectNotSupported(await caught(() => steps.on('el', 'Page').not.html), 'html', 'ios');
        expectNotSupported(await caught(() => steps.isVisible('el', 'Page').css('color')), 'css', 'ios');
        expect(calls).toEqual([]);
    });

    test('a custom .throws() message never re-wraps a platform refusal', async () => {
        const calls: Call[] = [];
        const factory = recordingFactory('ios', calls, stubElement('l', calls));
        const refusing = { ...factory, createVerifications: () => ({ text: async () => { throw new PlatformNotSupportedError('text', 'ios'); } }) };
        const steps = new Steps(refusing as unknown as IInteractionFactory, stubRepo(calls, stubElement('t', calls)));
        const error = await caught(() => Promise.resolve(steps.expect('el', 'Page').text.toBe('x').throws('custom header')));
        expectNotSupported(error, 'text', 'ios');
        expect((error as Error).message).not.toContain('custom header');

        // An assertion failure is still re-headed with the custom message.
        const failing = { ...factory, createVerifications: () => ({ text: async () => { throw new Error('mismatch'); } }) };
        const steps2 = new Steps(failing as unknown as IInteractionFactory, stubRepo(calls, stubElement('t', calls)));
        const error2 = await caught(() => Promise.resolve(steps2.expect('el', 'Page').text.toBe('x').throws('custom header')));
        expect((error2 as Error).message).toBe('custom header\n  mismatch');
    });
});

// ─── Shared steps route to the factory members ───────────────────────────────

test.describe('Shared steps route to the factory with the neutral Element', () => {
    test('the factory form exposes the factory platform', () => {
        const { steps } = iosSteps();
        expect(steps.platform).toBe('ios');
        expect(steps.on('el', 'Page').platform).toBe('ios');
    });

    const routes: Array<[string, (steps: Steps) => Promise<unknown>, string, string]> = [
        ['click', s => s.click('el', 'Page'), 'interact', 'click'],
        ['clickRandom', s => s.clickRandom('el', 'Page'), 'interact', 'click'],
        ['clickIfPresent', s => s.clickIfPresent('el', 'Page'), 'interact', 'click'],
        ['doubleClick', s => s.doubleClick('el', 'Page'), 'interact', 'doubleClick'],
        ['check', s => s.check('el', 'Page'), 'interact', 'check'],
        ['uncheck', s => s.uncheck('el', 'Page'), 'interact', 'uncheck'],
        ['fill', s => s.fill('el', 'Page', 'hello'), 'interact', 'fill'],
        ['typeSequentially', s => s.typeSequentially('el', 'Page', 'hi', 5), 'interact', 'typeSequentially'],
        ['clearInput', s => s.clearInput('el', 'Page'), 'interact', 'clearInput'],
        ['dragAndDrop', s => s.dragAndDrop('el', 'Page', { xOffset: 1, yOffset: 2 }), 'interact', 'dragAndDrop'],
        ['dragAndDropListedElement', s => s.dragAndDropListedElement('el', 'Page', 'row', { xOffset: 1, yOffset: 2 }), 'interact', 'dragAndDrop'],
        ['clickNth', s => s.clickNth('el', 'Page', 2), 'interact', 'click'],
        ['waitAndClick', s => s.waitAndClick('el', 'Page'), 'interact', 'click'],
        ['fillForm', s => s.fillForm('Page', { el: 'v' }), 'interact', 'fill'],
        ['scrollIntoView', s => s.scrollIntoView('el', 'Page'), 'gestures', 'scrollIntoView'],
        ['swipe', s => s.swipe('el', 'Page', 'up'), 'gestures', 'swipe'],
        ['scrollUntilFound', s => s.scrollUntilFound('el', 'Page'), 'gestures', 'scrollUntilFound'],
        ['longPress', s => s.longPress('el', 'Page'), 'gestures', 'longPress'],
        ['pinch', s => s.pinch('el', 'Page'), 'gestures', 'pinch'],
        ['zoom', s => s.zoom('el', 'Page'), 'gestures', 'zoom'],
        ['getText', s => s.getText('el', 'Page'), 'extract', 'getText'],
        ['getAttribute', s => s.getAttribute('el', 'Page', 'name'), 'extract', 'getAttribute'],
        ['getCount', s => s.getCount('el', 'Page'), 'extract', 'getCount'],
        ['getInputValue', s => s.getInputValue('el', 'Page'), 'extract', 'getInputValue'],
        ['getBoundingBox', s => s.getBoundingBox('el', 'Page'), 'extract', 'getBoundingBox'],
        ['getAll', s => s.getAll('el', 'Page'), 'extract', 'getAllTexts'],
        ['screenshot', s => s.screenshot('el', 'Page'), 'extract', 'screenshot'],
        ['verifyPresence', s => s.verifyPresence('el', 'Page'), 'verify', 'state'],
        ['verifyAllPresent', s => s.verifyAllPresent([{ elementName: 'el', pageName: 'Page' }]), 'verify', 'state'],
        ['verifyText', s => s.verifyText('el', 'Page', 'x'), 'verify', 'text'],
        ['verifyTextContains', s => s.verifyTextContains('el', 'Page', 'x'), 'verify', 'textContains'],
        ['verifyCount', s => s.verifyCount('el', 'Page', { exactly: 2 }), 'verify', 'count'],
        ['verifyState', s => s.verifyState('el', 'Page', 'enabled'), 'verify', 'state'],
        ['verifyAttribute', s => s.verifyAttribute('el', 'Page', 'name', 'v'), 'verify', 'attribute'],
        ['verifyInputValue', s => s.verifyInputValue('el', 'Page', 'v'), 'verify', 'inputValue'],
        ['verifyOrder', s => s.verifyOrder('el', 'Page', ['a']), 'verify', 'order'],
        ['verifyListOrder', s => s.verifyListOrder('el', 'Page', 'asc'), 'verify', 'listOrder'],
        ['expect', s => Promise.resolve(s.expect('el', 'Page').text.toBe('x')), 'verify', 'text'],
        ['on', s => s.on('el', 'Page').click(), 'interact', 'click'],
    ];

    for (const [name, call, member, method] of routes) {
        test(`${name} -> ${member}.${method}(<neutral Element>)`, async () => {
            const { steps, calls, element } = iosSteps();
            await call(steps);
            const hit = memberCalls(calls, member).find(c => c[1] === method);
            expect(hit, `${member}.${method} was called`).toBeTruthy();
            const handed = hit![2] as Element;
            if (handed instanceof ReResolvingElement) {
                // A device verification polls an element that re-resolves the
                // entry on every read: it reads the repository Element.
                calls.length = 0;
                await handed.count();
                expect(calls.filter(c => c[0] === 'repo'), 'resolved afresh').toHaveLength(1);
                expect(calls, 'read the repository Element').toContainEqual(['element:target', 'count']);
            } else {
                expect(handed, 'handed the repository Element as is').toBe(element);
            }
        });
    }

    test('listed-element steps act on the element the family picked', async () => {
        const { steps, calls, element, listed } = iosSteps();
        await steps.clickListedElement('el', 'Page', { text: 'row' });
        expect(memberCalls(calls, 'interact').map(c => c[1])).toEqual(['getListedElement', 'click']);
        expect(memberCalls(calls, 'interact')[0][2]).toBe(element);
        expect(memberCalls(calls, 'interact')[1][2]).toBe(listed);

        calls.length = 0;
        await steps.verifyListedElement('el', 'Page', { text: 'row', expectedText: 'x' });
        expect(memberCalls(calls, 'verify')).toEqual([['verify', 'text', listed, 'x']]);

        calls.length = 0;
        expect(await steps.getListedElementData('el', 'Page', { text: 'row' })).toBe('text');
        expect(memberCalls(calls, 'extract')).toEqual([['extract', 'getText', listed]]);
    });

    for (const name of PLATFORM_ONLY) {
        test(`platform-only ${name} reaches the device / gestures member on ios without resolving an element`, async () => {
            const { steps, calls } = iosSteps();
            const method = (steps as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
            const args: Record<string, unknown[]> = {
                backgroundApp: [1], installApp: ['/a'], removeApp: ['x'], openDeepLink: ['x://y'], swipeScreen: ['up'],
                tapAt: [1, 2], setOrientation: ['portrait'], setPermission: ['camera', 'grant'], switchContext: ['NATIVE_APP'],
                verifyOrientation: ['portrait'], verifyContext: ['NATIVE_APP'],
            };
            // The recording members answer `undefined`, so the polling assertions time out; never a platform refusal.
            const error = await caught(() => method.apply(steps, args[name] ?? []));
            expect(error).not.toBeInstanceOf(PlatformNotSupportedError);
            expect(calls.filter(c => c[0] === 'repo'), 'no element resolved').toEqual([]);
            expect(calls.filter(c => c[0] === 'device' || c[0] === 'gestures').length).toBeGreaterThan(0);
        });
    }

    test('scrollIntoView passes the direction to IGestures.scrollIntoView', async () => {
        const { steps, calls, element } = iosSteps();
        await steps.scrollIntoView('el', 'Page', { direction: 'up' });
        expect(memberCalls(calls, 'gestures')).toEqual([['gestures', 'scrollIntoView', element, { direction: 'up' }]]);
        calls.length = 0;
        await steps.scrollIntoView('el', 'Page');
        expect(memberCalls(calls, 'gestures')).toEqual([['gestures', 'scrollIntoView', element, undefined]]);
    });

    test('waitForState waits on the neutral element primitive', async () => {
        const { steps, calls } = iosSteps();
        expect(await steps.waitForState('el', 'Page', 'visible', { timeout: 50 })).toBe(true);
        expect(calls).toContainEqual(['element:target', 'waitFor', { state: 'visible', timeout: 50 }]);
    });

    test('isPresent asks the neutral element', async () => {
        const { steps, calls } = iosSteps();
        expect(await steps.isPresent('el', 'Page')).toBe(true);
        expect(calls).toContainEqual(['element:target', 'isVisible']);
    });

    test('pace and repeat run through the factory utils', async () => {
        const { steps, calls } = iosSteps();
        await steps.pace(1);
        await steps.repeat(() => 1, 2);
        expect(memberCalls(calls, 'utils').map(c => c[1])).toEqual(['pace', 'repeat']);
    });

    test('retryUntil paces through the utils (no page off web)', async () => {
        const { steps, calls } = iosSteps();
        let attempts = 0;
        await steps.retryUntil(async () => { attempts++; }, async () => { if (attempts < 2) throw new Error('not yet'); }, 3, 7);
        expect(attempts).toBe(2);
        expect(memberCalls(calls, 'utils')).toEqual([['utils', 'pace', 7]]);
    });
});

// ─── Non-UI steps stay available ─────────────────────────────────────────────

test.describe('API, SQL and email steps on a device platform', () => {
    /** Steps that pace through the family utils; every other non-UI step touches no family member at all. */
    const PACED = ['pace', 'repeat', 'retryUntil'];

    for (const name of NON_UI) {
        test(`${name} behaves exactly as on web and touches no UI member`, async () => {
            const { steps, calls } = iosSteps();
            const method = (steps as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
            // Dummy arguments: the step may fail on them, but never with a platform refusal.
            const error = await caught(() => method.call(steps, 'a', 'b', 'c'));
            expect(error).not.toBeInstanceOf(PlatformNotSupportedError);

            // Nothing resolved from the repository, nothing acted on; only the pacing steps use the utils.
            const touched = calls.filter(c => !(PACED.includes(name) && c[0] === 'utils'));
            expect(touched, 'no repository lookup or family member call').toEqual([]);

            // The same call on web Steps ends the same way (same error class and message, or none).
            const webCalls: Call[] = [];
            const web = new Steps(stubRepo(webCalls, stubElement('t', webCalls, ElementType.WEB), { url: () => 'about:blank' }));
            const webMethod = (web as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
            const webError = await caught(() => webMethod.call(web, 'a', 'b', 'c'));
            expect(error?.constructor, 'same outcome type as on web').toBe(webError?.constructor);
            expect((error as Error | undefined)?.message, 'same outcome as on web').toBe((webError as Error | undefined)?.message);
        });
    }

    test('value checks work as on web', async () => {
        const { steps } = iosSteps();
        await steps.verifySqlRowCount({ rows: [{}, {}], rowCount: 2 } as never, 2);
        await steps.verifyRequestOk({ ok: true, status: 200 } as never);
    });
});

// ─── Device paths of shared features (behaviour: tests/platform-paths.spec.ts) ─

test.describe('Shared features route to their device path', () => {
    test('verifyAbsence asserts through the family absence on the ALL resolution', async () => {
        const { steps, calls } = iosSteps();
        await steps.verifyAbsence('el', 'Page');
        await steps.on('el', 'Page').verifyAbsence();
        const gets = calls.filter(c => c[0] === 'repo' && c[1] === 'get');
        expect(gets).toHaveLength(2);
        for (const get of gets) expect(get[4]).toMatchObject({ strategy: 'all' });
        expect(memberCalls(calls, 'verify').map(c => c[1])).toEqual(['absence', 'absence']);
    });
});

// ─── The repository form keeps building the Playwright family ────────────────

test.describe('new Steps(repo) is web as before', () => {
    const fakePage = { url: () => 'about:blank' } as unknown as Page;

    test('builds a PlaywrightFactory on the repository driver', () => {
        const calls: Call[] = [];
        const steps = new Steps(stubRepo(calls, stubElement('t', calls, ElementType.WEB), fakePage), { timeout: 1234 });
        expect(steps.platform).toBe('web');
        const internals = steps as unknown as { factory: unknown; interact: unknown; verify: unknown; extract: unknown; gestures: unknown; page: unknown };
        expect(internals.factory).toBeInstanceOf(PlaywrightFactory);
        expect(internals.interact).toBeInstanceOf(Interactions);
        expect(internals.verify).toBeInstanceOf(Verifications);
        expect(internals.extract).toBeInstanceOf(Extractions);
        expect(internals.gestures).toBeInstanceOf(PlaywrightGestures);
        expect(internals.page).toBe(fakePage);
        expect((internals.interact as { ELEMENT_TIMEOUT: number }).ELEMENT_TIMEOUT).toBe(1234);
    });

    test('the factory form with a PlaywrightFactory passes the web guard', async () => {
        const calls: Call[] = [];
        const steps = new Steps(new PlaywrightFactory(fakePage), stubRepo(calls, stubElement('t', calls, ElementType.WEB), fakePage));
        expect(steps.platform).toBe('web');
        expect(steps.getUrl()).toBe('about:blank');
    });
});

// ─── The Playwright family refuses a platform element ────────────────────────

test.describe('Playwright family rejects a non-web element', () => {
    const fakePage = {} as Page;
    const factory = new PlaywrightFactory(fakePage, { timeout: 200 });

    const members: Array<[string, (el: Element) => Promise<unknown>]> = [];
    const interact = factory.createInteractions();
    const verify = factory.createVerifications();
    const extract = factory.createExtractions();
    const gestures = factory.createGestures();

    for (const m of ['click', 'clickIfPresent', 'fill', 'hover', 'scrollIntoView', 'doubleClick', 'check', 'uncheck', 'clearInput', 'rightClick', 'selectDropdown'] as const) {
        members.push([`Interactions.${m}`, el => (interact[m] as (e: Element) => Promise<unknown>).call(interact, el)]);
    }
    members.push(['Interactions.uploadFile', el => interact.uploadFile(el, 'f.txt')]);
    members.push(['Interactions.dropFiles', el => interact.dropFiles(el, ['f.txt'])]);
    members.push(['Interactions.dragAndDrop', el => interact.dragAndDrop(el, { xOffset: 1, yOffset: 1 })]);
    members.push(['Interactions.typeSequentially', el => interact.typeSequentially(el, 'x')]);
    members.push(['Interactions.setSliderValue', el => interact.setSliderValue(el, 1)]);
    members.push(['Interactions.dispatchEvent', el => interact.dispatchEvent(el, 'click')]);
    members.push(['Interactions.selectMultiple', el => interact.selectMultiple(el, ['a'])]);
    members.push(['Interactions.getListedElement', el => interact.getListedElement(el, { text: 'x' })]);
    for (const m of ['text', 'presence', 'images', 'order'] as const) {
        members.push([`Verifications.${m}`, el => (verify[m] as (e: Element, a?: unknown) => Promise<unknown>).call(verify, el, m === 'order' ? [] : undefined)]);
    }
    members.push(['Verifications.absence', el => verify.absence(el)]);
    members.push(['Verifications.state', el => verify.state(el, 'visible')]);
    members.push(['Verifications.attribute', el => verify.attribute(el, 'a', 'b')]);
    members.push(['Verifications.inputValue', el => verify.inputValue(el, 'b')]);
    members.push(['Verifications.html', el => verify.html(el, 'b')]);
    members.push(['Verifications.cssProperty', el => verify.cssProperty(el, 'color', 'red')]);
    members.push(['Verifications.count', el => verify.count(el, { exactly: 1 })]);
    members.push(['Verifications.listOrder', el => verify.listOrder(el, 'asc')]);
    members.push(['Verifications.visuallyMatches', el => verify.visuallyMatches(el, 'x.png')]);
    for (const m of ['getText', 'getAllTexts', 'getInputValue', 'getCount', 'getBoundingBox', 'getHtml', 'screenshot'] as const) {
        members.push([`Extractions.${m}`, el => (extract[m] as (e: Element) => Promise<unknown>).call(extract, el)]);
    }
    members.push(['Extractions.getAttribute', el => extract.getAttribute(el, 'a')]);
    members.push(['Extractions.getCssProperty', el => extract.getCssProperty(el, 'color')]);
    for (const m of ['scrollIntoView', 'scrollUntilFound', 'centerElement', 'longPress', 'pinch', 'zoom'] as const) {
        members.push([`PlaywrightGestures.${m}`, el => (gestures[m] as (e: Element) => Promise<unknown>).call(gestures, el)]);
    }
    members.push(['PlaywrightGestures.swipe', el => gestures.swipe(el, 'up')]);
    members.push(['PlaywrightGestures.tapAtElement', el => gestures.tapAtElement(el, { x: 1, y: 1 })]);

    for (const [name, call] of members) {
        test(`${name} throws for a platform element and touches nothing`, async () => {
            const calls: Call[] = [];
            const error = await caught(() => call(stubElement('device', calls)));
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toContain(`${name} needs a web (Playwright) element`);
            expect(calls).toEqual([]);
        });
    }

    test('dragAndDrop refuses a platform drop target', async () => {
        const calls: Call[] = [];
        const web = stubElement('web', calls, ElementType.WEB);
        const error = await caught(() => interact.dragAndDrop(web, { target: stubElement('device', calls) }));
        expect((error as Error).message).toContain('Interactions.dragAndDrop needs a web (Playwright) element');
        // The dragged web element was waited on (visible) before the target check; the device element never was.
        expect(calls.filter(c => c[0] === 'element:device')).toEqual([]);
    });
});

// ─── The factory form: one timeout, validated arguments ──────────────────────

test.describe('new Steps(factory, repo, options) validates its arguments', () => {
    const fakePage = { url: () => 'about:blank', isClosed: () => false } as unknown as Page;

    test('a forgotten repository argument throws a clear error', () => {
        const calls: Call[] = [];
        const factory = recordingFactory('ios', calls, stubElement('l', calls));
        expect(() => new Steps(factory, { timeout: 300 } as unknown as ElementRepository))
            .toThrow(/second argument must be the ElementRepository/);
        expect(() => new Steps(factory, undefined as unknown as ElementRepository))
            .toThrow(/second argument must be the ElementRepository/);
    });

    test('a factory whose family is not its platform\'s family is refused', () => {
        const calls: Call[] = [];
        const lying = { ...recordingFactory('ios', calls, stubElement('l', calls)), family: 'playwright' };
        expect(() => new Steps(lying as IInteractionFactory, stubRepo(calls, stubElement('t', calls))))
            .toThrow(/family "playwright" for platform "ios".*"appium" family/);
        const web = { ...recordingFactory('web', calls, stubElement('l', calls)), family: 'appium' };
        expect(() => new Steps(web as IInteractionFactory, stubRepo(calls, stubElement('t', calls), fakePage)))
            .toThrow(/family "appium" for platform "web"/);
    });

    test('the factory timeout is the timeout of every step, chain and matcher', () => {
        const calls: Call[] = [];
        const steps = new Steps(recordingFactory('ios', calls, stubElement('l', calls)), stubRepo(calls, stubElement('t', calls)));
        expect((steps as unknown as { timeout: number }).timeout).toBe(FACTORY_TIMEOUT);
        expect(steps.on('el', 'Page').buildExpectContext().timeout).toBe(FACTORY_TIMEOUT);
    });

    test('options.timeout / interceptionRetry that conflict with the factory throw', () => {
        const calls: Call[] = [];
        const factory = recordingFactory('ios', calls, stubElement('l', calls));
        const repo = stubRepo(calls, stubElement('t', calls));
        expect(() => new Steps(factory, repo, { timeout: 5000 })).toThrow(/options.timeout \(5000ms\) conflicts with the factory's timeout \(300ms\)/);
        expect(() => new Steps(factory, repo, { timeout: FACTORY_TIMEOUT })).not.toThrow();
        expect(() => new Steps(factory, repo, { interceptionRetry: false })).toThrow(/"appium" factory has no interception setting/);

        const webRepo = stubRepo(calls, stubElement('t', calls, ElementType.WEB), fakePage);
        const pw = new PlaywrightFactory(fakePage, { timeout: 700, interceptionRetry: false });
        expect(() => new Steps(pw, webRepo, { timeout: 30000 })).toThrow(/conflicts with the factory's timeout \(700ms\)/);
        expect(() => new Steps(pw, webRepo, { interceptionRetry: true })).toThrow(/interceptionRetry \(true\) conflicts with the factory's \(false\)/);
        expect(() => new Steps(pw, webRepo, { timeout: 700, interceptionRetry: false })).not.toThrow();
        // A default PlaywrightFactory: 30000ms, interception retry on.
        expect(() => new Steps(new PlaywrightFactory(fakePage), webRepo, { timeout: 30000, interceptionRetry: true })).not.toThrow();
    });

    test('a PlaywrightFactory on another page than repo.driver is refused', () => {
        const calls: Call[] = [];
        const other = { url: () => 'about:other' } as unknown as Page;
        expect(() => new Steps(new PlaywrightFactory(other), stubRepo(calls, stubElement('t', calls, ElementType.WEB), fakePage)))
            .toThrow(/different page than the repository resolves on/);
    });

    test('forPage carries the factory timeout and interception setting', () => {
        const calls: Call[] = [];
        const popup = { url: () => 'about:popup', isClosed: () => false } as unknown as Page;
        // A repository whose `driver` reads `_driver`, as element-repository's does (forPage rebinds that field).
        const proto = { get driver() { return (this as unknown as { _driver: unknown })._driver; } };
        const repo = Object.assign(Object.create(proto), {
            _driver: fakePage,
            get: async () => stubElement('t', calls, ElementType.WEB),
            getSelector: () => '#t',
        }) as ElementRepository;
        const steps = new Steps(new PlaywrightFactory(fakePage, { timeout: 700, interceptionRetry: false }), repo);
        const bound = steps.forPage(popup) as unknown as {
            page: unknown; timeout: number; interact: { ELEMENT_TIMEOUT: number; interceptionRetry: boolean };
        };
        expect(bound.page).toBe(popup);
        expect(bound.timeout).toBe(700);
        expect(bound.interact.ELEMENT_TIMEOUT).toBe(700);
        expect(bound.interact.interceptionRetry).toBe(false);
    });
});

// ─── A real AppiumFactory over the mock driver ───────────────────────────────

test.describe('Steps on a real AppiumFactory (mock driver)', () => {
    function appiumSteps(timeout: number) {
        const repoCalls: Call[] = [];
        const element = mockElement({ text: 'actual' });
        const factory = new AppiumFactory(mockDriver().driver, 'ios', { timeout });
        const steps = new Steps(factory, stubRepo(repoCalls, element));
        return { steps, element, repoCalls };
    }

    test('verifyText on a mismatch fails near the factory timeout (not the 30s default)', async () => {
        const { steps } = appiumSteps(400);
        for (const run of [
            () => steps.verifyText('el', 'Page', 'expected'),
            () => steps.on('el', 'Page').verifyText('expected'),
            () => Promise.resolve(steps.expect('el', 'Page').text.toBe('expected')),
        ]) {
            const started = Date.now();
            const error = await caught(run);
            const elapsed = Date.now() - started;
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toMatch(/expected/);
            expect(elapsed, 'polled for the factory timeout').toBeGreaterThanOrEqual(350);
            expect(elapsed, 'did not fall back to the 30000ms default').toBeLessThan(5000);
        }
    });

    test('getAll with { child } gathers the children match by match', async () => {
        const child = mockElement({ text: 'child text' });
        const parent = mockElement({ text: 'actual' });
        (parent as unknown as { locateChild: (s: string) => unknown }).locateChild = (selector: string) => {
            parent.calls.push(['locateChild', selector]);
            return child;
        };
        const repoCalls: Call[] = [];
        const factory = new AppiumFactory(mockDriver().driver, 'ios', { timeout: 400 });
        const steps = new Steps(factory, stubRepo(repoCalls, parent));
        expect(await steps.getAll('el', 'Page', { child: '~row' })).toEqual(['child text']);
        expect(parent.calls).toContainEqual(['locateChild', '~row']);
        // Without `child`, getAll reads the matches themselves.
        expect(await steps.getAll('el', 'Page')).toEqual(['actual']);
    });

    test('fillForm refuses a dropdown value before filling any field', async () => {
        const { steps, element, repoCalls } = appiumSteps(400);
        const error = await caught(() => steps.fillForm('Page', { name: 'Ada', country: { value: 'NL' } }));
        expectNotSupported(error, 'selectDropdown', 'ios');
        expect(repoCalls, 'no field resolved').toEqual([]);
        expect(element.calls, 'no field filled').toEqual([]);
        // String-only forms fill on the device.
        await steps.fillForm('Page', { name: 'Ada' });
        expect(element.calls.map(c => c[0])).toContain('fill');
    });
});

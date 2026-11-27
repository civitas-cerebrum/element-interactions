import { test, expect } from '@playwright/test';
import { ElementRepository, IOS_DISMISS_KEYS } from '@civitas-cerebrum/element-repository';
import { KeyboardStillShownError, Steps, type HideKeyboardOptions } from '../src/index';
import { AppiumFactory } from '../src/appium';
import { DEVICE_PLATFORMS, driverError, mockUiDriver, type Call, type MockNode } from './appium/mocks';

/**
 * `steps.hideKeyboard(options?)` on android and ios over a real
 * AppiumFactory and ElementRepository, on a mock session with a soft
 * keyboard: it hides the keyboard through element-repository's
 * `dismissKeyboard`, taps a neutral `tapElement` named by its repository
 * entry first on iOS, answers whether it had to, and lets element-repository's
 * `KeyboardStillShownError` through. No device.
 */

type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/** Which command hides the mock keyboard: the neutral tap, a `mobile: hideKeyboard` matching `args`, WebdriverIO's `hideKeyboard()`, or nothing. */
type Dismisser = (call: Call) => boolean;

const PAGES = {
    pages: ['android', 'ios'].map(platform => ({
        name: 'LoginPage',
        platform,
        elements: [
            { elementName: 'title', selector: { 'accessibility id': 'login-title' } },
            { elementName: 'username', selector: { 'accessibility id': 'login-username' } },
        ],
    })),
};

/**
 * Steps on a mock session whose keyboard is `shown` until a call `dismisses`
 * it. The bare iOS `mobile: hideKeyboard` is refused as WebDriverAgent
 * refuses it on a keyboard without a Done key, unless `dismisses` accepts it.
 */
function keyboardSteps(platform: DevicePlatform, dismisses: Dismisser, shown = true) {
    const keyboard = { shown };
    const hide = (call: Call) => { if (dismisses(call)) keyboard.shown = false; };
    const tree: MockNode[] = [
        { match: '~login-title', text: 'Login', onClick: () => hide(['tap', 'title']) },
        { match: '~login-username', text: 'admin' },
    ];
    const mock = mockUiDriver(tree, { capabilities: { platformName: platform } });
    const driver = mock.driver as unknown as Record<string, unknown>;
    driver.isKeyboardShown = async () => { mock.calls.push(['isKeyboardShown']); return keyboard.shown; };
    driver.hideKeyboard = async () => { const call: Call = ['hideKeyboard']; mock.calls.push(call); hide(call); };
    const execute = driver.execute as (script: string, args: unknown) => Promise<unknown>;
    driver.execute = async (script: string, args: unknown) => {
        const result = await execute(script, args);
        const call: Call = ['execute', script, args];
        if (script === 'mobile: hideKeyboard') {
            const wasShown = keyboard.shown;
            hide(call);
            if (wasShown && keyboard.shown && platform === 'ios' && JSON.stringify(args) === '{}') {
                throw new Error('Did not know how to dismiss the keyboard. Try to dismiss it in the way supported by your application under test.');
            }
        }
        return result;
    };
    const repo = new ElementRepository(mock.driver, PAGES, { platform, timeout: 1000 });
    const steps = new Steps(new AppiumFactory(mock.driver, platform, { timeout: 1000, appId: 'com.example.app' }), repo);
    return { steps, mock, keyboard };
}

/** The keyboard commands the session received, in order (lookups and element reads left out). */
function keyboardCalls(calls: Call[]): Call[] {
    return calls.filter(c => c[0] === 'isKeyboardShown' || c[0] === 'hideKeyboard' || c[0] === 'click'
        || (c[0] === 'execute' && c[1] === 'mobile: hideKeyboard'));
}

const TAP: HideKeyboardOptions = { tapElement: { pageName: 'LoginPage', elementName: 'title' } };
const isTap: Dismisser = call => call[0] === 'tap';
const isKeysStep: Dismisser = call => call[0] === 'execute' && Array.isArray((call[2] as { keys?: unknown })?.keys);
const isAndroidHide: Dismisser = call => call[0] === 'hideKeyboard';

async function caught(call: () => unknown): Promise<unknown> {
    try {
        await call();
    } catch (error) {
        return error;
    }
    return undefined;
}

for (const platform of DEVICE_PLATFORMS) {
    test.describe(`hideKeyboard on ${platform}`, () => {
        test('no keyboard shown: answers false and sends nothing else', async () => {
            const { steps, mock } = keyboardSteps(platform, () => true, false);
            expect(await steps.hideKeyboard()).toBe(false);
            expect(keyboardCalls(mock.calls)).toEqual([['isKeyboardShown']]);
            // With a tap element it is resolved, but nothing is tapped.
            expect(await steps.hideKeyboard(TAP)).toBe(false);
            expect(keyboardCalls(mock.calls)).toEqual([['isKeyboardShown'], ['isKeyboardShown']]);
        });

        test('without options: the platform\'s dismissal steps hide the keyboard and it answers true', async () => {
            const { steps, mock, keyboard } = keyboardSteps(platform, platform === 'ios' ? isKeysStep : isAndroidHide);
            expect(await steps.hideKeyboard()).toBe(true);
            expect(keyboard.shown).toBe(false);
            if (platform === 'ios') {
                // The bare call is refused (no Done key); the keys step presses the action key.
                expect(keyboardCalls(mock.calls)).toEqual([
                    ['isKeyboardShown'],
                    ['execute', 'mobile: hideKeyboard', {}],
                    ['isKeyboardShown'],
                    ['execute', 'mobile: hideKeyboard', { keys: [...IOS_DISMISS_KEYS] }],
                    ['isKeyboardShown'],
                ]);
            } else {
                expect(keyboardCalls(mock.calls)).toEqual([['isKeyboardShown'], ['hideKeyboard'], ['isKeyboardShown']]);
            }
        });

        test('with tapElement: the named entry is resolved and passed as the neutral element', async () => {
            const { steps, mock, keyboard } = keyboardSteps(platform, platform === 'ios' ? isTap : isAndroidHide);
            expect(await steps.hideKeyboard(TAP)).toBe(true);
            expect(keyboard.shown).toBe(false);
            expect(mock.lookupCount('~login-title'), 'the tap element is resolved through the repository').toBeGreaterThan(0);
            if (platform === 'ios') {
                // The title is tapped first and the keyboard is gone: no key of the keyboard is pressed.
                expect(keyboardCalls(mock.calls)).toEqual([['isKeyboardShown'], ['click', '~login-title', 'driver'], ['isKeyboardShown']]);
            } else {
                // Android ignores the tap element.
                expect(keyboardCalls(mock.calls)).toEqual([['isKeyboardShown'], ['hideKeyboard'], ['isKeyboardShown']]);
            }
        });

        test('a tapElement the page does not define fails before anything is sent', async () => {
            const { steps, mock } = keyboardSteps(platform, () => true);
            const error = await caught(() => steps.hideKeyboard({ tapElement: { pageName: 'LoginPage', elementName: 'nope' } }));
            expect((error as Error).message).toMatch(/^hideKeyboard: tapElement "nope" on page "LoginPage" could not be resolved: /);
            expect((error as Error).cause).toBeInstanceOf(Error);
            expect(keyboardCalls(mock.calls)).toEqual([]);
        });

        test('a keyboard still shown after every step throws KeyboardStillShownError, re-exported unchanged', async () => {
            const { steps, mock } = keyboardSteps(platform, () => false);
            const error = await caught(() => steps.hideKeyboard(TAP));
            expect(error).toBeInstanceOf(KeyboardStillShownError);
            expect((error as Error).message).toMatch(/^dismissKeyboard: the keyboard is still shown after /);
            const steps_ = (error as KeyboardStillShownError).steps;
            expect(steps_.length).toBeGreaterThan(0);
            if (platform === 'ios') expect(steps_[0]).toMatch(/tapElement/);
            expect(keyboardCalls(mock.calls).filter(c => c[0] === 'isKeyboardShown').length).toBeGreaterThan(1);
        });

        test('options.timeout bounds the dismissal: no step starts once it has passed', async () => {
            const { steps, mock } = keyboardSteps(platform, () => true);
            const error = await caught(() => steps.hideKeyboard({ timeout: 0 }));
            expect(error).toBeInstanceOf(KeyboardStillShownError);
            expect((error as Error).message).toMatch(/timeout 0 ms/);
            expect(keyboardCalls(mock.calls)).toEqual([['isKeyboardShown']]);
        });

        test('a fatal driver error passes unchanged', async () => {
            const { steps, mock } = keyboardSteps(platform, () => true);
            const dead = driverError('invalid session id', 'invalid session id: the session is gone');
            (mock.driver as unknown as Record<string, unknown>).isKeyboardShown = async () => { throw dead; };
            expect(await caught(() => steps.hideKeyboard())).toBe(dead);
        });
    });
}

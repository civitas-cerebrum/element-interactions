import * as fs from 'fs';
import { test as base } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';
import { pollUntil } from '../../src/utils/poll';
import { fakeSession } from './fakeSession';

// A check that times out leaves its lookup running: the fixture waits for it
// after the body, before the failure evidence and the next relaunch.
const fake = fakeSession(process.env.EI_FAKE_SESSION_LOG, 'drain');
const event = (line: string) => { if (process.env.EI_FAKE_SESSION_LOG) fs.appendFileSync(process.env.EI_FAKE_SESSION_LOG, `drain ${line}\n`); };

const driver = fake.driver as unknown as { takeScreenshot: () => Promise<string> };
const takeScreenshot = driver.takeScreenshot;
driver.takeScreenshot = async () => { event('screenshot'); return takeScreenshot(); };

const test = baseFixture(base, 'tests/fixture-platform/page-repository.json', {
    platform: 'ios',
    session: { capabilities: 'tests/capabilities/ios.example.json', provider: fake.provider },
});

/** A check on the session's driver whose one lookup takes 300 ms, given 20 ms: it times out and leaves the lookup running. */
function abandonedCheck(session: WebdriverIO.Browser, name: string): Promise<boolean> {
    const lookup = () => new Promise<boolean>(resolve => setTimeout(() => { event(`${name} end`); resolve(true); }, 300));
    return pollUntil(lookup, visible => !visible, { timeout: 20, scope: session, message: `drain check ${name}` });
}

test('drain: a passing test that left a lookup running lets it end before the next relaunch', async ({ driver: session }) => {
    event('body 1');
    await abandonedCheck(session, 'lookup 1').catch(() => undefined);
});

test('drain: a failing test keeps its own error, and its lookup ends before the evidence', async ({ driver: session }) => {
    event('body 2');
    await abandonedCheck(session, 'lookup 2');
});

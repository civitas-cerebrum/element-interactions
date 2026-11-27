import * as fs from 'fs';
import { test as base } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';
import { pollUntil } from '../../src/utils/poll';
import { fakeSession } from './fakeSession';

// Runs in the nested config's `short-timeout` project (project timeout
// 600 ms). Pins the time Playwright gives a test's fixture teardown, which
// the fixture's drain extends: the larger of the project and the test
// timeout. A teardown fixture `later` is set up before the platform
// fixture, so it is torn down after it (after the drain) and runs in the
// same slot.
const fake = fakeSession(process.env.EI_FAKE_SESSION_LOG, 'drain-teardown');
const event = (line: string) => {
    if (process.env.EI_FAKE_SESSION_LOG) fs.appendFileSync(process.env.EI_FAKE_SESSION_LOG, `drain-teardown ${line} @${Date.now()}\n`);
};
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** How long `later` sleeps in its teardown, per test (set in the body). */
let laterMs = 0;

const withLater = base.extend<{ later: void }>({
    later: [async ({}, use) => {
        await use();
        event('later start');
        await sleep(laterMs);
        event('later end');
    }, { auto: true }],
});

const test = baseFixture(withLater, 'tests/fixture-platform/page-repository.json', {
    platform: 'ios',
    session: { capabilities: 'tests/capabilities/ios.example.json', provider: fake.provider },
});

test('teardown slot: a later teardown fixture runs inside the slot the drain extended', async ({ driver: session }) => {
    test.setTimeout(600);
    laterMs = 1500;
    event('body');
    // The abandoned probe ignores its abort signal: it stands for a driver
    // call already in flight, which an abort cannot stop, so the drain
    // really waits for it (1000 ms, more than the 600 ms slot on its own).
    const inFlight = () => new Promise<boolean>(resolve => setTimeout(() => { event('lookup end'); resolve(true); }, 1000));
    await pollUntil(inFlight, visible => !visible, { timeout: 20, scope: session }).catch(() => undefined);
});

// Nothing is abandoned in these two, so the slot is Playwright's own; the
// teardown sleeps past the larger timeout and must run out of exactly it.
// The parent asserts Playwright's exact teardown-timeout wording
// (`Tearing down "later" exceeded the test timeout of <n>ms.`), so a
// Playwright that only rewords that message trips these too. That is
// intended: a reworded message is checked by hand once, then pinned again.
test('teardown slot pin: a test timeout below the project timeout gets the project timeout', async () => {
    test.setTimeout(400);
    laterMs = 800;
    event('body');
});

test('teardown slot pin: a test timeout above the project timeout gets the test timeout', async () => {
    test.setTimeout(800);
    laterMs = 1000;
    event('body');
});

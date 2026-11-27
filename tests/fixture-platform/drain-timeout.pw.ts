import * as fs from 'fs';
import { test as base } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';
import { pollUntil } from '../../src/utils/poll';
import { fakeSession } from './fakeSession';

// Runs in the nested config's `short-timeout` project: the project and test
// timeout are 600 ms, so the fixture teardown (its own slot of the same
// length) cannot hold a 1000 ms wait for an abandoned lookup unless the
// fixture extends the timeout by its cap first.
const fake = fakeSession(process.env.EI_FAKE_SESSION_LOG, 'drain-timeout');
const event = (line: string) => { if (process.env.EI_FAKE_SESSION_LOG) fs.appendFileSync(process.env.EI_FAKE_SESSION_LOG, `drain-timeout ${line}\n`); };

const test = baseFixture(base, 'tests/fixture-platform/page-repository.json', {
    platform: 'ios',
    session: { capabilities: 'tests/capabilities/ios.example.json', provider: fake.provider },
});

test('drain: the wait never makes a passing test run out of its own timeout', async ({ driver: session }) => {
    event('body');
    const lookup = () => new Promise<boolean>(resolve => setTimeout(() => { event('lookup end'); resolve(true); }, 1000));
    await pollUntil(lookup, visible => !visible, { timeout: 20, scope: session }).catch(() => undefined);
});

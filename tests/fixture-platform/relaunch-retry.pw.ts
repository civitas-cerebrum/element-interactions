import * as fs from 'fs';
import { test as base } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';
import { fakeSession } from './fakeSession';

// The first activation answers with WebDriverAgent's launch timeout; the retried one succeeds.
const fake = fakeSession(process.env.EI_FAKE_SESSION_LOG, 'relaunch-retry', { launchTimeouts: 1 });

const test = baseFixture(base, 'tests/fixture-platform/page-repository.json', {
    platform: 'ios',
    session: { capabilities: 'tests/capabilities/ios.example.json', provider: fake.provider, relaunchTimeout: 2000 },
});

test('a launch timeout on the relaunch is retried once and the test runs', async () => {
    if (process.env.EI_FAKE_SESSION_LOG) fs.appendFileSync(process.env.EI_FAKE_SESSION_LOG, 'relaunch-retry body\n');
});

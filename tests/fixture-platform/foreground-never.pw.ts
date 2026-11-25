import * as fs from 'fs';
import { test as base } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';
import { fakeSession } from './fakeSession';

// The app never reaches the foreground after the relaunch.
const fake = fakeSession(process.env.EI_FAKE_SESSION_LOG, 'foreground-never', { backgroundQueries: Infinity });

const test = baseFixture(base, 'tests/fixture-platform/page-repository.json', {
    platform: 'android',
    session: { capabilities: 'tests/capabilities/android.example.json', provider: fake.provider, relaunchTimeout: 500 },
});

// The fixture setup fails before the body runs: the expectation is declared on the test.
test.fail('an app that never reaches the foreground fails the setup within the bound', async () => {
    if (process.env.EI_FAKE_SESSION_LOG) fs.appendFileSync(process.env.EI_FAKE_SESSION_LOG, 'foreground-never body\n');
});

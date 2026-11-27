import { test as base } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';
import { fakeSession } from './fakeSession';

// The app never reaches the foreground after the relaunch; the device still answers.
const fake = fakeSession(process.env.EI_FAKE_SESSION_LOG, 'setup-evidence', { backgroundQueries: Infinity });

const test = baseFixture(base, 'tests/fixture-platform/page-repository.json', {
    platform: 'ios',
    session: { capabilities: 'tests/capabilities/ios.example.json', provider: fake.provider, relaunchTimeout: 300 },
});

// The fixture setup fails before the body runs: the expectation is declared on the test.
test.fail('a failed relaunch attaches the setup error, the screenshot and the page source', async () => undefined);

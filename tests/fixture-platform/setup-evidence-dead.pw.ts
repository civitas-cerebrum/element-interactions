import { test as base } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';
import { fakeSession } from './fakeSession';

// The app never reaches the foreground, and no screenshot or page source can be taken.
const fake = fakeSession(process.env.EI_FAKE_SESSION_LOG, 'setup-evidence-dead', { backgroundQueries: Infinity, failEvidence: true });

const test = baseFixture(base, 'tests/fixture-platform/page-repository.json', {
    platform: 'ios',
    session: { capabilities: 'tests/capabilities/ios.example.json', provider: fake.provider, relaunchTimeout: 300 },
});

// The fixture setup fails before the body runs: the expectation is declared on the test.
test.fail('setup evidence that cannot be collected never masks the setup error', async () => undefined);

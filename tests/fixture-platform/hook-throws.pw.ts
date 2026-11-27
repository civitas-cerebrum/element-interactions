import { test as base } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';
import { fakeSession } from './fakeSession';

const fake = fakeSession(process.env.EI_FAKE_SESSION_LOG, 'hook-throws');

const test = baseFixture(base, 'tests/fixture-platform/page-repository.json', {
    platform: 'ios',
    session: {
        capabilities: 'tests/capabilities/ios.example.json',
        provider: fake.provider,
        onSessionStarted: async () => { throw new Error('onSessionStarted failed on purpose'); },
    },
});

// The worker fixture fails before the body runs: the expectation is declared on the test.
test.fail('onSessionStarted throws', async ({ steps }) => {
    void steps;
});

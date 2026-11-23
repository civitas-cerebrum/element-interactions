import * as fs from 'fs';
import { test as base } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';
import { fakeSession } from './fakeSession';

const fake = fakeSession(process.env.EI_FAKE_SESSION_LOG, 'stop-throws');
const log = process.env.EI_FAKE_SESSION_LOG;

const test = baseFixture(base, 'tests/fixture-platform/page-repository.json', {
    platform: 'ios',
    session: {
        capabilities: 'tests/capabilities/ios.example.json',
        provider: {
            start: (context) => fake.provider.start(context),
            async stop() {
                if (log) fs.appendFileSync(log, 'stop-throws stop\n');
                throw new Error('stop failed on purpose');
            },
        },
        onSessionStarted: async () => { throw new Error('onSessionStarted failed before a failing stop'); },
    },
});

// The worker fixture fails before the body runs: the expectation is declared on the test.
test.fail('onSessionStarted error survives a throwing stop', async ({ steps }) => {
    void steps;
});

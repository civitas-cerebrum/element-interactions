import * as fs from 'fs';
import { test as base } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';

const log = (line: string) => { if (process.env.EI_FAKE_SESSION_LOG) fs.appendFileSync(process.env.EI_FAKE_SESSION_LOG, `start-timeout ${line}\n`); };

// The session start never answers: the library's own error comes before the fixture timeout.
const test = baseFixture(base, 'tests/fixture-platform/page-repository.json', {
    platform: 'ios',
    session: {
        capabilities: 'tests/capabilities/ios.example.json',
        server: 'https://someone:secret-key@appium.invalid/wd/hub',
        startTimeout: 1000,
        provider: {
            start: () => { log('start'); return new Promise<never>(() => undefined); },
            async stop() { log('stop'); },
        },
    },
});

// The worker fixture fails before the body runs: the expectation is declared on the test.
test.fail('a session start that never answers fails with the start budget', async ({ steps }) => {
    void steps;
});

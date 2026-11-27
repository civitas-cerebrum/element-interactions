import * as fs from 'fs';
import { test as base } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';
import { fakeSession } from './fakeSession';

// Every app-state query fails with a dead-session error; the bound is long on purpose.
const fake = fakeSession(process.env.EI_FAKE_SESSION_LOG, 'foreground-dead', { deadSession: true });

const test = baseFixture(base, 'tests/fixture-platform/page-repository.json', {
    platform: 'ios',
    session: { capabilities: 'tests/capabilities/ios.example.json', provider: fake.provider, relaunchTimeout: 20_000 },
});

// The fixture setup fails before the body runs: the expectation is declared on the test.
test.fail('a dead session during the foreground wait fails the setup at once', async () => {
    if (process.env.EI_FAKE_SESSION_LOG) fs.appendFileSync(process.env.EI_FAKE_SESSION_LOG, 'foreground-dead body\n');
});

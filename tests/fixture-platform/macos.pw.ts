import { test as base } from '@playwright/test';
import { baseFixture } from '../../src/fixture/BaseFixture';
import { fakeSession } from './fakeSession';

const fake = fakeSession(process.env.EI_FAKE_SESSION_LOG, 'macos');

const test = baseFixture(base, 'tests/fixture-platform/page-repository.json', {
    platform: 'macos',
    session: { capabilities: 'tests/capabilities/ios.example.json', provider: fake.provider },
});

test.fail('macos is refused at session start', async ({ steps }) => {
    void steps;
});

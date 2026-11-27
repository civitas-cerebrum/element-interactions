import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Live device checks run only under playwright.platform.config.ts (they need
  // a device). tests/cross-platform stays in: its web run belongs to this suite.
  testIgnore: ['live/**'],
  reporter: 'html',
  retries: process.env.CI ? 2 : 1,
  use: {
    baseURL: 'http://127.0.0.1:7457/',
    headless: true,
    video: 'on-first-retry',
    trace: 'on-first-retry',
  },
});

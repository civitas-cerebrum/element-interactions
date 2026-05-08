import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  reporter: 'html',
  retries: process.env.CI ? 2 : 1,
  use: {
    baseURL: 'http://127.0.0.1:7457/',
    headless: true,
    video: 'on-first-retry',
    trace: 'on-first-retry',
  },
});

import { test as base, expect, Page } from '@playwright/test';
import { loadEmailConfig, isEmailConfigured } from '../src/config/env';
import { EmailClient, EmailFilterType } from '@civitas-cerebrum/email-client';

/**
 * Integration tests for email sending and receiving functionality.
 * These tests require actual email credentials to be configured in .env file.
 * Skip if email is not configured (local development without credentials).
 */

// Check if email is configured before defining tests
const emailConfigured = isEmailConfigured();

const test = emailConfigured
  ? base.extend({
      emailCredentials: [
        async ({}, use) => {
          const config = loadEmailConfig();
          await use(config);
        },
        { scope: 'test' },
      ],
      emailClient: [
        async ({ emailCredentials }, use) => {
          const client = new EmailClient(emailCredentials);
          await use(client);
        },
        { scope: 'test' },
      ],
    })
  : base.skip;

test.describe('Email Integration Tests', () => {
  test.describe.configure({ mode: 'parallel' });

  test('send and receive email', async ({ emailClient, emailCredentials }) => {
    await test.step('Send test email', async () => {
      await emailClient.send({
        to: emailCredentials.receiverEmail,
        subject: 'Test OTP Email',
        text: 'Your verification code is 123456',
        html: '<h1>Your verification code is 123456</h1>',
      });
    });

    await test.step('Wait for email to arrive and receive it', async () => {
      const email = await emailClient.receive({
        filters: [
          { type: EmailFilterType.SUBJECT, value: 'Test OTP Email' },
          { type: EmailFilterType.FROM, value: emailCredentials.senderEmail },
        ],
        waitTimeout: 10000,
        pollInterval: 2000,
      });

      expect(email.subject).toBe('Test OTP Email');
      expect(email.from).toBe(emailCredentials.senderEmail);
      expect(email.text).toContain('123456');
      expect(email.html).toContain('123456');
    });
  });

  test('send and receive email with OTP', async ({ emailClient, emailCredentials }) => {
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    await test.step('Send OTP email', async () => {
      await emailClient.send({
        to: emailCredentials.receiverEmail,
        subject: 'Your Verification Code',
        text: `Your OTP is ${otpCode}. Do not share this code.`,
        html: `<p>Your OTP is <strong>${otpCode}</strong>. Do not share this code.</p>`,
      });
    });

    await test.step('Receive and verify OTP', async () => {
      const email = await emailClient.receive({
        filters: [
          { type: EmailFilterType.SUBJECT, value: 'Your Verification Code' },
        ],
        waitTimeout: 10000,
        pollInterval: 2000,
      });

      expect(email.subject).toBe('Your Verification Code');
      expect(email.text).toContain(otpCode);
      expect(email.html).toContain(otpCode);
    });
  });

  test('clean inbox - delete specific emails', async ({ emailClient, emailCredentials }) => {
    await test.step('Send cleanup test email', async () => {
      await emailClient.send({
        to: emailCredentials.receiverEmail,
        subject: 'Cleanup Test Email',
        text: 'This email should be deleted',
      });
    });

    await test.step('Receive and verify email', async () => {
      const email = await emailClient.receive({
        filters: [{ type: EmailFilterType.SUBJECT, value: 'Cleanup Test Email' }],
        waitTimeout: 10000,
        pollInterval: 2000,
      });

      expect(email.subject).toBe('Cleanup Test Email');
    });

    await test.step('Clean inbox - delete the email', async () => {
      await emailClient.clean({
        filters: [{ type: EmailFilterType.SUBJECT, value: 'Cleanup Test Email' }],
      });
    });

    await test.step('Verify email is deleted', async () => {
      const result = await emailClient.receive({
        filters: [{ type: EmailFilterType.SUBJECT, value: 'Cleanup Test Email' }],
        waitTimeout: 3000,
        pollInterval: 1000,
      });
      expect(result).toBeNull();
    });
  });
});

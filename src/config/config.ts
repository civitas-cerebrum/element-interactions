import { config as dotenvConfig } from 'dotenv';
import { EmailCredentials } from '@civitas-cerebrum/email-client';

// Load .env variables. If process.env variables already exist (like in CI),
// dotenv will safely ignore them and keep the CI values.
dotenvConfig();

export function validateEmailEnv(): void {
  const required = [
    'SENDER_EMAIL',
    'SENDER_PASSWORD',
    'SENDER_SMTP_HOST',
    'RECEIVER_EMAIL',
    'RECEIVER_PASSWORD',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required email env variables: ${missing.join(', ')}\n` +
      `Create .env file from .env.example and fill in your credentials.`
    );
  }
}

export function loadEmailConfig(): EmailCredentials {
  validateEmailEnv();

  return {
    senderEmail: process.env.SENDER_EMAIL!,
    senderPassword: process.env.SENDER_PASSWORD!,
    senderSmtpHost: process.env.SENDER_SMTP_HOST!,
    receiverEmail: process.env.RECEIVER_EMAIL!,
    receiverPassword: process.env.RECEIVER_PASSWORD!,
  };
}

export function isEmailConfigured(): boolean {
  try {
    validateEmailEnv();
    return true;
  } catch {
    return false;
  }
}
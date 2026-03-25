import { test, expect } from '@playwright/test';
import { EmailClient } from '@civitas-cerebrum/email-client';
import { EmailFilterType, EmailCredentials, ReceivedEmail, EmailFilter } from '@civitas-cerebrum/email-client';

const dummyCredentials: EmailCredentials = {
    senderEmail: 'sender@test.com',
    senderPassword: 'pass',
    senderSmtpHost: 'smtp.test.com',
    receiverEmail: 'receiver@test.com',
    receiverPassword: 'pass',
};

function makeEmail(overrides: Partial<ReceivedEmail> = {}): ReceivedEmail {
    return {
        filePath: '/tmp/test.html',
        subject: 'Your OTP Code',
        from: 'noreply@example.com',
        date: new Date('2025-06-01'),
        html: '<h1>Your code is 123456</h1>',
        text: 'Your code is 123456',
        ...overrides,
    };
}

test.describe('Email Filter Logic', () => {
    let emailClient: EmailClient;

    test.beforeEach(() => {
        emailClient = new EmailClient(dummyCredentials);
    });

    // ─── Exact match tests ───────────────────────────────────────────

    test('SUBJECT filter — exact match', () => {
        const candidates = [
            makeEmail({ subject: 'Your OTP Code' }),
            makeEmail({ subject: 'Welcome aboard' }),
        ];
        const filters: EmailFilter[] = [{ type: EmailFilterType.SUBJECT, value: 'Your OTP Code' }];
        const result = emailClient.applyFilters(candidates, filters);

        expect(result).toHaveLength(1);
        expect(result[0].subject).toBe('Your OTP Code');
    });

    test('FROM filter — exact match', () => {
        const candidates = [
            makeEmail({ from: 'noreply@example.com' }),
            makeEmail({ from: 'support@example.com' }),
        ];
        const filters: EmailFilter[] = [{ type: EmailFilterType.FROM, value: 'noreply@example.com' }];
        const result = emailClient.applyFilters(candidates, filters);

        expect(result).toHaveLength(1);
        expect(result[0].from).toBe('noreply@example.com');
    });

    test('CONTENT filter — exact match on HTML body', () => {
        const candidates = [
            makeEmail({ html: '<p>Your verification code is 999</p>' }),
            makeEmail({ html: '<p>Welcome to our service</p>' }),
        ];
        const filters: EmailFilter[] = [{ type: EmailFilterType.CONTENT, value: '<p>Your verification code is 999</p>' }];
        const result = emailClient.applyFilters(candidates, filters);

        expect(result).toHaveLength(1);
        expect(result[0].html).toContain('999');
    });

    test('CONTENT filter — falls back to plain text when no HTML', () => {
        const candidates = [
            makeEmail({ html: '', text: 'Plain text OTP: 5678' }),
            makeEmail({ html: '', text: 'Welcome email' }),
        ];
        const filters: EmailFilter[] = [{ type: EmailFilterType.CONTENT, value: 'Plain text OTP: 5678' }];
        const result = emailClient.applyFilters(candidates, filters);

        expect(result).toHaveLength(1);
        expect(result[0].text).toContain('5678');
    });

    // ─── Combined filter tests ───────────────────────────────────────

    test('Multiple filters — SUBJECT + FROM exact match (AND logic)', () => {
        const candidates = [
            makeEmail({ subject: 'OTP', from: 'noreply@example.com' }),
            makeEmail({ subject: 'OTP', from: 'support@example.com' }),
            makeEmail({ subject: 'Welcome', from: 'noreply@example.com' }),
        ];
        const filters: EmailFilter[] = [
            { type: EmailFilterType.SUBJECT, value: 'OTP' },
            { type: EmailFilterType.FROM, value: 'noreply@example.com' },
        ];
        const result = emailClient.applyFilters(candidates, filters);

        expect(result).toHaveLength(1);
        expect(result[0].subject).toBe('OTP');
        expect(result[0].from).toBe('noreply@example.com');
    });

    test('Three filters — SUBJECT + FROM + CONTENT exact match', () => {
        const candidates = [
            makeEmail({ subject: 'OTP', from: 'noreply@example.com', html: '<p>Code: 123</p>' }),
            makeEmail({ subject: 'OTP', from: 'noreply@example.com', html: '<p>Code: 456</p>' }),
        ];
        const filters: EmailFilter[] = [
            { type: EmailFilterType.SUBJECT, value: 'OTP' },
            { type: EmailFilterType.FROM, value: 'noreply@example.com' },
            { type: EmailFilterType.CONTENT, value: '<p>Code: 456</p>' },
        ];
        const result = emailClient.applyFilters(candidates, filters);

        expect(result).toHaveLength(1);
        expect(result[0].html).toContain('456');
    });

    // ─── Partial (fallback) match tests ──────────────────────────────

    test('SUBJECT filter — falls back to partial case-insensitive match', () => {
        const candidates = [
            makeEmail({ subject: 'Your OTP Code - Action Required' }),
            makeEmail({ subject: 'Welcome aboard' }),
        ];
        const filters: EmailFilter[] = [{ type: EmailFilterType.SUBJECT, value: 'otp code' }];
        const result = emailClient.applyFilters(candidates, filters);

        expect(result).toHaveLength(1);
        expect(result[0].subject).toBe('Your OTP Code - Action Required');
    });

    test('FROM filter — falls back to partial case-insensitive match', () => {
        const candidates = [
            makeEmail({ from: 'NoReply@Example.COM' }),
            makeEmail({ from: 'support@other.com' }),
        ];
        const filters: EmailFilter[] = [{ type: EmailFilterType.FROM, value: 'noreply@example.com' }];
        const result = emailClient.applyFilters(candidates, filters);

        expect(result).toHaveLength(1);
        expect(result[0].from).toBe('NoReply@Example.COM');
    });

    test('CONTENT filter — falls back to partial case-insensitive match', () => {
        const candidates = [
            makeEmail({ html: '<h1>Your Verification Code is ABC123</h1>' }),
            makeEmail({ html: '<p>Newsletter</p>' }),
        ];
        const filters: EmailFilter[] = [{ type: EmailFilterType.CONTENT, value: 'verification code' }];
        const result = emailClient.applyFilters(candidates, filters);

        expect(result).toHaveLength(1);
        expect(result[0].html).toContain('ABC123');
    });

    test('Combined filters — partial fallback applies to all filters together', () => {
        const candidates = [
            makeEmail({ subject: 'Your OTP Code', from: 'NoReply@Example.COM' }),
        ];
        const filters: EmailFilter[] = [
            { type: EmailFilterType.SUBJECT, value: 'otp' },
            { type: EmailFilterType.FROM, value: 'noreply' },
        ];
        const result = emailClient.applyFilters(candidates, filters);

        expect(result).toHaveLength(1);
    });

    // ─── Exact match takes priority over partial ─────────────────────

    test('Exact match is preferred over partial match', () => {
        const candidates = [
            makeEmail({ subject: 'OTP Code' }),           // partial match for "OTP"
            makeEmail({ subject: 'OTP' }),                 // exact match for "OTP"
            makeEmail({ subject: 'Your OTP is ready' }),   // partial match for "OTP"
        ];
        const filters: EmailFilter[] = [{ type: EmailFilterType.SUBJECT, value: 'OTP' }];
        const result = emailClient.applyFilters(candidates, filters);

        expect(result).toHaveLength(1);
        expect(result[0].subject).toBe('OTP');
    });

    // ─── SINCE filter (date) — passed through, not client-filtered ──

    test('SINCE filter is excluded from client-side matching', () => {
        const candidates = [
            makeEmail({ subject: 'Test Email' }),
        ];
        const filters: EmailFilter[] = [
            { type: EmailFilterType.SINCE, value: new Date('2025-01-01') },
        ];
        const result = emailClient.applyFilters(candidates, filters);

        expect(result).toHaveLength(1);
    });

    test('SINCE combined with string filters works correctly', () => {
        const candidates = [
            makeEmail({ subject: 'Match' }),
            makeEmail({ subject: 'No Match' }),
        ];
        const filters: EmailFilter[] = [
            { type: EmailFilterType.SINCE, value: new Date('2025-01-01') },
            { type: EmailFilterType.SUBJECT, value: 'Match' },
        ];
        const result = emailClient.applyFilters(candidates, filters);

        expect(result).toHaveLength(1);
        expect(result[0].subject).toBe('Match');
    });

    // ─── Negative cases ─────────────────────────────────────────────

    test('No candidates — returns empty array', () => {
        const filters: EmailFilter[] = [{ type: EmailFilterType.SUBJECT, value: 'Anything' }];
        const result = emailClient.applyFilters([], filters);

        expect(result).toHaveLength(0);
    });

    test('No filters (empty array) — returns all candidates unchanged', () => {
        const candidates = [makeEmail(), makeEmail({ subject: 'Other' })];
        const result = emailClient.applyFilters(candidates, []);

        expect(result).toHaveLength(2);
    });

    test('No exact or partial match — returns empty array', () => {
        const candidates = [
            makeEmail({ subject: 'Completely unrelated' }),
            makeEmail({ subject: 'Also unrelated' }),
        ];
        const filters: EmailFilter[] = [{ type: EmailFilterType.SUBJECT, value: 'OTP Code' }];
        const result = emailClient.applyFilters(candidates, filters);

        expect(result).toHaveLength(0);
    });

    test('Combined filters — one filter matches but the other does not — returns empty', () => {
        const candidates = [
            makeEmail({ subject: 'OTP', from: 'support@other.com' }),
        ];
        const filters: EmailFilter[] = [
            { type: EmailFilterType.SUBJECT, value: 'OTP' },
            { type: EmailFilterType.FROM, value: 'noreply@example.com' },
        ];
        const result = emailClient.applyFilters(candidates, filters);

        expect(result).toHaveLength(0);
    });

    test('CONTENT filter — no match in HTML or text — returns empty', () => {
        const candidates = [
            makeEmail({ html: '<p>Hello world</p>', text: 'Hello world' }),
        ];
        const filters: EmailFilter[] = [{ type: EmailFilterType.CONTENT, value: 'verification code' }];
        const result = emailClient.applyFilters(candidates, filters);

        expect(result).toHaveLength(0);
    });

    test('Partial match on one filter but not the other — returns empty', () => {
        const candidates = [
            makeEmail({ subject: 'Your OTP Code', from: 'totally-different@xyz.com' }),
        ];
        const filters: EmailFilter[] = [
            { type: EmailFilterType.SUBJECT, value: 'otp' },
            { type: EmailFilterType.FROM, value: 'noreply@example.com' },
        ];
        const result = emailClient.applyFilters(candidates, filters);

        expect(result).toHaveLength(0);
    });

    // ─── Multiple results ───────────────────────────────────────────

    test('Multiple candidates match — all are returned', () => {
        const candidates = [
            makeEmail({ subject: 'OTP Code', from: 'noreply@example.com' }),
            makeEmail({ subject: 'OTP Code', from: 'noreply@example.com' }),
            makeEmail({ subject: 'Welcome', from: 'support@example.com' }),
        ];
        const filters: EmailFilter[] = [{ type: EmailFilterType.SUBJECT, value: 'OTP Code' }];
        const result = emailClient.applyFilters(candidates, filters);

        expect(result).toHaveLength(2);
    });

    // ─── Validation ─────────────────────────────────────────────────

    test('receive() throws when filters array is empty', async () => {
        await expect(
            emailClient.receive({ filters: [], waitTimeout: 100 })
        ).rejects.toThrow('At least one email filter is required');
    });

    test('receiveAll() throws when filters array is empty', async () => {
        await expect(
            emailClient.receiveAll({ filters: [], waitTimeout: 100 })
        ).rejects.toThrow('At least one email filter is required');
    });
});

import { test as base } from '@playwright/test';
import { baseFixture } from '../src/fixture/BaseFixture'; // Adjust path as needed

// 1. Create a specialized fixture that explicitly forces emailCredentials to undefined.
// This bypasses your config.ts loader entirely for these specific tests.
const isolatedTest = baseFixture(base, 'tests/data/page-repository.json', {
    emailCredentials: undefined,
});

isolatedTest.describe('Fixture Wiring', () => {

    isolatedTest('baseFixture without emailCredentials — steps.email is null', async ({ steps }) => {
        // We still need bracket notation because the property is private, 
        // but now we are testing the actual fixture initialization!
        expect(steps['email']).toBeNull();
    });

    isolatedTest('baseFixture without emailCredentials — interactions.email is null', async ({ interactions }) => {
        expect(interactions['email']).toBeNull();
    });

    isolatedTest('configureEmail sets steps.email at runtime', async ({ steps }) => {
        expect(steps['email']).toBeNull();
        
        const email = new EmailClient({
            senderEmail: 'sender@test.com',
            senderPassword: 'pass',
            senderSmtpHost: 'smtp.test.com',
            receiverEmail: 'receiver@test.com',
            receiverPassword: 'pass',
        });
        
        expect(email).not.toBeNull();
    });
});
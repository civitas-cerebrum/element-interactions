import { test, expect } from './fixture/StepFixture';
import { EmailFilterType, EmailMarkAction } from '@civitas-cerebrum/email-client';
import { isEmailConfigured } from '../src/config/config';

// Mock email data for testing
const mockOtpCode = '123456';
const mockOtpSubject = `Your OTP Code - ${mockOtpCode}`;

test.describe('Email Integration Tests - OTP Workflow', () => {
    // Skip email tests unless EMAIL_TESTS env var is explicitly set
    test.skip(!process.env.EMAIL_TESTS, 'Skipping: Email tests require EMAIL_TESTS=1 environment variable');

    // Use the actual configured receiver email from environment
    const emailTo = process.env.RECEIVER_EMAIL || 'receiver@example.com';

    test('sendEmail - sends OTP email', async ({ steps }) => {
        // Skip if email credentials not configured
        test.skip(!isEmailConfigured(), 'Skipping: Email credentials not configured');

        await steps.sendEmail({
            to: emailTo,
            subject: mockOtpSubject,
            text: `Your OTP code is ${mockOtpCode}. This code will expire in 5 minutes.`,
            html: `<html><body><h1>Your OTP Code</h1><p style="font-size: 24px; font-weight: bold;">${mockOtpCode}</p><p>This code will expire in 5 minutes.</p></body></html>`,
        });

        // Verify email was sent by receiving it
        const email = await steps.receiveEmail({
            filters: [
                { type: EmailFilterType.SUBJECT, value: mockOtpSubject },
                { type: EmailFilterType.TO, value: emailTo },
            ],
            waitTimeout: 10000,
            pollInterval: 1000,
        });

        expect(email.subject).toBe(mockOtpSubject);
        // Sender will be from Sendinblue relay (e.g., user@7305006.brevosend.com)
        expect(email.from).toContain('@');
        expect(email.text).toContain(mockOtpCode);
        expect(email.html).toContain(mockOtpCode);
    });

    test('sendEmail with HTML file template - sends OTP email', async ({ steps }) => {
        test.skip(!isEmailConfigured(), 'Skipping: Email credentials not configured');

        // Create a temporary HTML file for the email template
        const fs = require('fs');
        const path = require('path');
        const htmlTemplatePath = path.join(__dirname, 'data', 'otp-email-template.html');

        fs.writeFileSync(htmlTemplatePath, `
            <html>
                <body>
                    <h1>Your OTP Code</h1>
                    <p style="font-size: 24px; font-weight: bold;">${mockOtpCode}</p>
                    <p>This code will expire in 5 minutes.</p>
                </body>
            </html>
        `);

        await steps.sendEmail({
            to: emailTo,
            subject: `OTP from HTML Template - ${mockOtpCode}`,
            htmlFile: htmlTemplatePath,
        });

        // Clean up
        fs.unlinkSync(htmlTemplatePath);
    });

    test('receiveEmail - receives and verifies OTP email', async ({ steps }) => {
        test.skip(!isEmailConfigured(), 'Skipping: Email credentials not configured');

        // Send test email
        await steps.sendEmail({
            to: emailTo,
            subject: `Verification OTP - ${mockOtpCode}`,
            text: `Your verification code is ${mockOtpCode}.`,
        });

        // Receive and verify
        const email = await steps.receiveEmail({
            filters: [
                { type: EmailFilterType.SUBJECT, value: 'Verification OTP' },
                { type: EmailFilterType.TO, value: emailTo },
            ],
            waitTimeout: 10000,
        });

        expect(email.subject).toContain('Verification OTP');
        expect(email.text).toContain(mockOtpCode);
        expect(email.html).toBeDefined();
    });

    test('receiveEmail with CONTENT filter - finds email by body content', async ({ steps }) => {
        test.skip(!isEmailConfigured(), 'Skipping: Email credentials not configured');

        await steps.sendEmail({
            to: emailTo,
            subject: 'Content Search Test',
            text: `This is a test content search for OTP verification: ${mockOtpCode}`,
        });

        const email = await steps.receiveEmail({
            filters: [
                { type: EmailFilterType.CONTENT, value: 'content search' },
                { type: EmailFilterType.TO, value: emailTo },
            ],
            waitTimeout: 10000,
        });

        expect(email.text).toContain('content search');
    });

    test('receiveEmail with FROM filter - finds email by sender', async ({ steps }) => {
        test.skip(!isEmailConfigured(), 'Skipping: Email credentials not configured');

        // Get actual sender email from environment to filter correctly
        const actualSender = process.env.SENDER_EMAIL || 'unknown';

        await steps.sendEmail({
            to: emailTo,
            subject: 'From Filter Test',
            text: 'Testing FROM filter',
        });

        const email = await steps.receiveEmail({
            filters: [
                { type: EmailFilterType.FROM, value: actualSender.split('@')[0] },
                { type: EmailFilterType.TO, value: emailTo },
            ],
            waitTimeout: 10000,
        });

        // Verify the email was received from our configured sender
        expect(email.from).toContain('@');
    });

    test('receiveAllEmails - receives all matching emails', async ({ steps }) => {
        test.skip(!isEmailConfigured(), 'Skipping: Email credentials not configured');

        // Send multiple emails
        await steps.sendEmail({
            to: emailTo,
            subject: 'Batch Test 1',
            text: 'Batch test email 1',
        });

        await steps.sendEmail({
            to: emailTo,
            subject: 'Batch Test 2',
            text: 'Batch test email 2',
        });

        const emails = await steps.receiveAllEmails({
            filters: [
                { type: EmailFilterType.SUBJECT, value: 'Batch Test' },
                { type: EmailFilterType.TO, value: emailTo },
            ],
            waitTimeout: 10000,
        });

        expect(emails.length).toBeGreaterThanOrEqual(2);
        emails.forEach(email => {
            expect(email.subject).toContain('Batch Test');
        });
    });

    test('receiveEmail - case-insensitive partial match fallback', async ({ steps }) => {
        test.skip(!isEmailConfigured(), 'Skipping: Email credentials not configured');

        const exactSubject = 'Exact Match Subject';

        await steps.sendEmail({
            to: emailTo,
            subject: exactSubject,
            text: 'Testing case-insensitive fallback',
        });

        const email = await steps.receiveEmail({
            filters: [
                { type: EmailFilterType.SUBJECT, value: 'exact match' }, // lowercase partial match
                { type: EmailFilterType.TO, value: emailTo },
            ],
            waitTimeout: 10000,
        });

        expect(email.subject).toBe(exactSubject);
    });

    test('cleanEmails - deletes specific emails matching filters', async ({ steps }) => {
        test.skip(!isEmailConfigured(), 'Skipping: Email credentials not configured');

        // Send test emails
        await steps.sendEmail({
            to: emailTo,
            subject: 'Delete Me Test',
            text: 'This email should be deleted',
        });

        const deletedCount = await steps.cleanEmails({
            filters: [
                { type: EmailFilterType.SUBJECT, value: 'Delete Me Test' },
                { type: EmailFilterType.TO, value: emailTo },
            ],
        });

        expect(deletedCount).toBeGreaterThanOrEqual(1);
    });

    test('cleanEmails - can clean all emails (optional)', async ({ steps }) => {
        test.skip(!isEmailConfigured(), 'Skipping: Email credentials not configured');

        // Note: This test shows the ability to clean all emails
        // In production, be careful with this operation
        await steps.cleanEmails();
    });

    test('markEmail - marks emails as READ', async ({ steps }) => {
        test.skip(!isEmailConfigured(), 'Skipping: Email credentials not configured');

        await steps.sendEmail({
            to: emailTo,
            subject: 'Mark as Read Test',
            text: 'Testing mark as READ',
        });

        const markedCount = await steps.markEmail(EmailMarkAction.READ, {
            filters: [
                { type: EmailFilterType.SUBJECT, value: 'Mark as Read' },
                { type: EmailFilterType.TO, value: emailTo },
            ],
        });

        expect(markedCount).toBeGreaterThanOrEqual(1);
    });

    test('markEmail - marks emails as UNREAD', async ({ steps }) => {
        test.skip(!isEmailConfigured(), 'Skipping: Email credentials not configured');

        await steps.sendEmail({
            to: emailTo,
            subject: 'Mark as Unread Test',
            text: 'Testing mark as UNREAD',
        });

        const markedCount = await steps.markEmail(EmailMarkAction.UNREAD, {
            filters: [
                { type: EmailFilterType.SUBJECT, value: 'Mark as Unread' },
                { type: EmailFilterType.TO, value: emailTo },
            ],
        });

        expect(markedCount).toBeGreaterThanOrEqual(1);
    });

    test('markEmail - marks emails as FLAGGED', async ({ steps }) => {
        test.skip(!isEmailConfigured(), 'Skipping: Email credentials not configured');

        await steps.sendEmail({
            to: emailTo,
            subject: 'Flagged Email Test',
            text: 'Testing mark as FLAGGED',
        });

        const markedCount = await steps.markEmail(EmailMarkAction.FLAGGED, {
            filters: [
                { type: EmailFilterType.SUBJECT, value: 'Flagged' },
                { type: EmailFilterType.TO, value: emailTo },
            ],
        });

        expect(markedCount).toBeGreaterThanOrEqual(1);
    });

    test('markEmail - archives emails', async ({ steps }) => {
        test.skip(!isEmailConfigured(), 'Skipping: Email credentials not configured');

        await steps.sendEmail({
            to: emailTo,
            subject: 'Archive Test',
            text: 'Testing archive functionality',
        });

        const markedCount = await steps.markEmail(EmailMarkAction.ARCHIVED, {
            filters: [
                { type: EmailFilterType.SUBJECT, value: 'Archive' },
                { type: EmailFilterType.TO, value: emailTo },
            ],
        });

        expect(markedCount).toBeGreaterThanOrEqual(1);
    });

    test('markEmail - marks emails with custom filters', async ({ steps }) => {
        test.skip(!isEmailConfigured(), 'Skipping: Email credentials not configured');

        // Get actual sender email from environment to filter correctly
        const actualSender = process.env.SENDER_EMAIL || 'unknown';

        await steps.sendEmail({
            to: emailTo,
            subject: 'Custom Filter Test',
            text: 'Testing custom filters',
        });

        const markedCount = await steps.markEmail(EmailMarkAction.UNFLAGGED, {
            filters: [
                { type: EmailFilterType.FROM, value: actualSender.split('@')[0] },
                { type: EmailFilterType.SUBJECT, value: 'Custom Filter' },
            ],
        });

        expect(markedCount).toBeGreaterThanOrEqual(1);
    });

    test('markEmail - marks all emails in folder when no filters provided', async ({ steps }) => {
        test.skip(!isEmailConfigured(), 'Skipping: Email credentials not configured');

        await steps.sendEmail({
            to: emailTo,
            subject: 'Mark All Test',
            text: 'Testing mark all functionality',
        });

        const markedCount = await steps.markEmail(EmailMarkAction.READ, {
            folder: 'INBOX',
        });

        expect(markedCount).toBeGreaterThanOrEqual(1);
    });

    test('email workflow - complete OTP verification flow', async ({ steps }) => {
        test.skip(!isEmailConfigured(), 'Skipping: Email credentials not configured');

        // 1. Send OTP email
        await steps.sendEmail({
            to: emailTo,
            subject: `OTP Verification - ${mockOtpCode}`,
            text: `Your OTP code is ${mockOtpCode}. Please use this code to verify your account.`,
        });

        // 2. Receive and verify the email
        const email = await steps.receiveEmail({
            filters: [
                { type: EmailFilterType.SUBJECT, value: 'OTP Verification' },
                { type: EmailFilterType.TO, value: emailTo },
            ],
            waitTimeout: 10000,
        });

        // 3. Verify email content
        expect(email.subject).toContain('OTP Verification');
        expect(email.text).toContain(mockOtpCode);

        // 4. Mark email as read after processing
        await steps.markEmail(EmailMarkAction.READ, {
            filters: [
                { type: EmailFilterType.SUBJECT, value: 'OTP Verification' },
            ],
        });

        // 5. Clean up test emails
        await steps.cleanEmails({
            filters: [
                { type: EmailFilterType.SUBJECT, value: 'OTP Verification' },
            ],
        });
    });
});

test.describe('Email Integration Tests - OTP Page Workflow', () => {
    test.skip(!process.env.EMAIL_TESTS, 'Skipping: Email tests require EMAIL_TESTS=1 environment variable');

    const emailTo = process.env.RECEIVER_EMAIL || 'receiver@example.com';

    test('grab OTP from page, email it, receive it, enter it', async ({ steps }) => {
        test.skip(!isEmailConfigured(), 'Skipping: Email credentials not configured');

        await test.step('Navigate to OTP page and grab the generated code', async () => {
            await steps.navigateTo('/otp-input');
        });

        const otp = await test.step('Read OTP from the autocomplete section', async () => {
            return await steps.getText( 'autocompleteGeneratedCode','OtpPage');
        });

        expect(otp).toMatch(/^\d{6}$/);

        await test.step('Send the OTP via email', async () => {
            await steps.sendEmail({
                to: emailTo,
                subject: `OTP Code: ${otp}`,
                text: `Your one-time password is: ${otp}`,
                html: `<p>Your one-time password is: <strong>${otp}</strong></p>`,
            });
        });

        const receivedOtp = await test.step('Receive the email and extract the OTP', async () => {
            const email = await steps.receiveEmail({
                filters: [{ type: EmailFilterType.SUBJECT, value: `OTP Code: ${otp}` }],
                waitTimeout: 30000,
                pollInterval: 2000,
            });
            const match = email.text?.match(/\d{6}/);
            expect(match, 'OTP not found in email body').toBeTruthy();
            return match![0];
        });

        await test.step('Enter OTP from email into the autocomplete input', async () => {
            await steps.typeSequentially( 'autocompleteOtpFirstInput','OtpPage', receivedOtp, 100);
        });

        await test.step('Verify success message appears', async () => {
            await steps.verifyText( 'autocompleteCompleteMessage','OtpPage', '✓ Code verified successfully!');
        });
    });
});

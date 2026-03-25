import { Page } from '@playwright/test';
import { Interactions } from '../Interaction';
import { Navigation } from '../Navigation';
import { Verifications } from '../Verification';
import { Extractions } from '../Extraction';
import { EmailClient, EmailCredentials } from '@civitas-cerebrum/email-client';
import { Utils } from '../../utils/ElementUtilities';
import { logger } from '../../logger/Logger';

/**
 * A facade class that centralizes package capabilities.
 * It provides access to navigation, interaction, verification,
 * extraction, email, and utility functions through a single interface.
 */
export class ElementInteractions {
    public interact: Interactions;
    public verify: Verifications;
    public extract: Extractions;
    public navigate: Navigation;
    public email: EmailClient | null = null;
    private utils: Utils;
    private log;

    /**
     * Initializes the ElementInteractions facade.
     * @param page - The current Playwright Page object.
     * @param timeout - Optional global timeout override (in milliseconds) for all interactions and verifications. Defaults to 30000 ms (30 seconds).
     * @param emailCredentials - Optional email credentials to enable the email sub-API.
     */
    constructor(page: Page, timeout?: number, emailCredentials?: EmailCredentials) {
        this.interact = new Interactions(page, timeout);
        this.verify = new Verifications(page, timeout);
        this.navigate = new Navigation(page);
        this.extract = new Extractions(page, timeout);
        this.email = emailCredentials ? new EmailClient(emailCredentials) : null;
        this.utils = new Utils(timeout);
        this.log = {
            info: logger('info'),
            warn: logger('warn'),
            error: logger('error'),
            success: logger('success'),
            important: logger('important'),
        };
    }
}
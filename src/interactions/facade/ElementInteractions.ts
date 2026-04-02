import { Page } from '@playwright/test';
import { Interactions } from '../Interaction';
import { Navigation } from '../Navigation';
import { Verifications } from '../Verification';
import { Extractions } from '../Extraction';
import { EmailClient, EmailCredentials, EmailClientConfig } from '@civitas-cerebrum/email-client';
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
     * @param options - Optional configuration: emailCredentials and/or timeout.
     */
    constructor(page: Page, options?: { emailCredentials?: EmailCredentials | EmailClientConfig; timeout?: number }) {
        const { emailCredentials, timeout } = options ?? {};
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
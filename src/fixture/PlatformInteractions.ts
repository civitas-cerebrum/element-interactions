import { PlatformNotSupportedError, type Platform } from '@civitas-cerebrum/element-repository';
import { EmailClient, type EmailClientConfig } from '@civitas-cerebrum/email-client';
import type { IInteractionFactory } from '../interfaces/IInteractionFactory';
import type { IInteractions } from '../interfaces/IInteractions';
import type { IVerifications } from '../interfaces/IVerifications';
import type { IExtractions } from '../interfaces/IExtractions';
import type { INavigation } from '../interfaces/INavigation';
import type { IGestures } from '../interfaces/IGestures';
import type { IDevice } from '../interfaces/IDevice';

/**
 * The `interactions` fixture value on a platform run: the same member names
 * as {@link ElementInteractions} (`interact`, `verify`, `extract`, `navigate`,
 * `email`), each built from one family factory, plus `gestures` and `device`.
 * `request` (Playwright's browser request client) has no platform meaning and
 * throws `PlatformNotSupportedError('request', <platform>)`.
 */
export class PlatformInteractions {
    readonly interact: IInteractions;
    readonly verify: IVerifications;
    readonly extract: IExtractions;
    readonly navigate: INavigation;
    readonly gestures: IGestures;
    readonly device: IDevice;
    readonly email: EmailClient | null;
    readonly platform: Platform;

    constructor(factory: IInteractionFactory, options: { emailCredentials?: EmailClientConfig } = {}) {
        this.platform = factory.platform;
        this.interact = factory.createInteractions();
        this.verify = factory.createVerifications();
        this.extract = factory.createExtractions();
        this.navigate = factory.createNavigation();
        this.gestures = factory.createGestures();
        this.device = factory.createDevice();
        this.email = options.emailCredentials ? new EmailClient(options.emailCredentials) : null;
    }

    /** Browser requests need a Playwright page: always throws on a platform run. */
    get request(): never {
        throw new PlatformNotSupportedError('request', this.platform);
    }
}

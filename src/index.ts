// Enums
export * from './enum/Options';

// Supporting Action Classes (Playwright family; the historical names are kept)
export { Navigation, Navigation as PlaywrightNavigation } from './playwright/PlaywrightNavigation';
export { Verifications, Verifications as PlaywrightVerifications } from './playwright/PlaywrightVerifications';
export { Interactions, Interactions as PlaywrightInteractions } from './playwright/PlaywrightInteractions';
export { Extractions, Extractions as PlaywrightExtractions } from './playwright/PlaywrightExtractions';
export { BrowserRequest } from './playwright/BrowserRequest';
export type { BrowserResponse, BrowserRequestOptions } from './playwright/BrowserRequest';
export { PlaywrightGestures } from './playwright/PlaywrightGestures';
export { PlaywrightDevice } from './playwright/PlaywrightDevice';
export { PlaywrightFactory } from './playwright/PlaywrightFactory';
export type { PlaywrightFactoryOptions } from './playwright/PlaywrightFactory';

// Platform contract: family interfaces, platform vocabulary, not-supported error
export type {
    IInteractions,
    IVerifications,
    VerifiableState,
    IExtractions,
    INavigation,
    IUtils,
    IGestures,
    Direction,
    IDevice,
    Orientation,
    PermissionState,
    IInteractionFactory,
} from './interfaces';
// (vocabulary and error are element-repository's own; re-exported so `instanceof` works across packages)
export type { Platform, DriverFamily } from '@civitas-cerebrum/element-repository';
export { PLATFORMS, isPlatformName, familyOf, PlatformNotSupportedError } from '@civitas-cerebrum/element-repository';

// Utilities
export { reformatDateString } from './utils/DateUtilities';
export { Utils } from './utils/ElementUtilities';

// Element Interactions Facade
export { ElementInteractions } from './playwright/ElementInteractions';

// Re-exports from @civitas-cerebrum/element-repository
export type { Element, ElementResolutionOptions, ElementActionOptions } from '@civitas-cerebrum/element-repository';
export { ElementType, WebElement, PlatformElement, ElementChain, isWeb, isPlatform, SelectionStrategy } from '@civitas-cerebrum/element-repository';

// Test Steps Facade
export { Steps } from './steps/CommonSteps';
export { ElementAction } from './steps/ElementAction';

// Expect Matcher Tree
export {
    ExpectBuilder,
    TextMatcher,
    ValueMatcher,
    CountMatcher,
    BooleanMatcher,
    AttributeMatcher,
    AttributesMatcher,
    CssMatcher,
    HtmlMatcher,
} from './steps/ExpectMatchers';
export type { ElementSnapshot, ExpectContext } from './steps/ExpectMatchers';

// Test Fixture
export { baseFixture, BaseFixtureOptions, forwardMutationInjection, readMutationInjection, MUTATION_RUN_VAR } from './fixture/BaseFixture';
export type { MutationInjection, MutationInjectionOptions, MutationInjectionHandle } from './fixture/BaseFixture';

// Re-exports from @civitas-cerebrum/email-client
export { EmailClient } from '@civitas-cerebrum/email-client';
export type {
    EmailClientConfig,
    SmtpCredentials,
    ImapCredentials,
    EmailFilter,
    EmailSendOptions,
    EmailReceiveOptions,
    ReceivedEmail,
    EmailMarkOptions,
} from '@civitas-cerebrum/email-client';
export { EmailFilterType, EmailMarkAction } from '@civitas-cerebrum/email-client';

// Re-exports from @civitas-cerebrum/wasapi
export { WasapiClient, ApiCall, ApiResponse, ResponsePair, FailedCallException, WasapiException, HttpMethod } from '@civitas-cerebrum/wasapi';
export type { RequestConfig, ClientConfig, CallOptions } from '@civitas-cerebrum/wasapi';
export { GET, POST, PUT, DELETE, PATCH, HTTP } from '@civitas-cerebrum/wasapi';

// Re-exports from @civitas-cerebrum/sql-client
export { SqlClient, QueryBuilder, PostgresDialect, SqlException, QueryFailedException } from '@civitas-cerebrum/sql-client';
export type { SqlResult, SqlField, SqlClientConfig, SqlTransaction, Dialect, RunnableClient } from '@civitas-cerebrum/sql-client';

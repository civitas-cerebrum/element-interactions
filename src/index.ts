// Enums
export * from './enum/Options';

// Supporting Action Classes
export { Navigation } from './interactions/Navigation';
export { Verifications } from './interactions/Verification';
export { Interactions } from './interactions/Interaction';
export { Extractions } from './interactions/Extraction';

// Utilities
export { reformatDateString } from './utils/DateUtilities';
export { Utils } from './utils/ElementUtilities';

// Element Interactions Facade
export { ElementInteractions } from './interactions/facade/ElementInteractions';

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
} from './steps/ExpectMatchers';
export type { ElementSnapshot, ExpectContext } from './steps/ExpectMatchers';

// Test Fixture
export { baseFixture, BaseFixtureOptions } from './fixture/BaseFixture';

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

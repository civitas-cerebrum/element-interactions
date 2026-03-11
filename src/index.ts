// Main Entry Point (The Facade)
export { ElementInteractions } from './ElementInteractions';

// Interaction logic and associated Types/Enums
// This ensures users can use DropdownSelectType.RANDOM in their tests
export { 
    Interactions, 
    DropdownSelectType, 
    DropdownSelectOptions 
} from './interactions/Interaction';

// Supporting Action Classes
export { Navigation } from './interactions/Navigation';
export { Verifications } from './interactions/Verification';

// Utilities
export { DateUtilities } from './utils/DateUtilities'; // Adjust path if necessary

// Test Steps / Page Objects
export { Steps } from './steps/CommonSteps';
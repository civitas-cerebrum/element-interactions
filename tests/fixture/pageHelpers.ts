import { Steps } from '../../src';

/** Navigate to the Buttons demo page used by most matcher tests. */
export async function gotoButtons(steps: Steps): Promise<void> {
    await steps.navigateTo('/');
    await steps.click('buttonsLink', 'SidebarNav');
    await steps.verifyUrlContains('/buttons');
}

/** Navigate to the Text Inputs demo page used by value-matcher tests. */
export async function gotoTextInputs(steps: Steps): Promise<void> {
    await steps.navigateTo('/');
    await steps.click('textInputsLink', 'SidebarNav');
}

import { test, expect } from '@playwright/test';
import { ElementRepository } from '@civitas-cerebrum/element-repository';
import { hasEntry } from './hasEntry';

/**
 * Pure unit tests of the fixture's entry lookup: an in-memory repository,
 * no driver, no device, no session.
 */

const DATA = {
    pages: [
        { name: 'DestinationScreen', platform: 'ios', elements: [{ elementName: 'backButton', selector: { 'accessibility id': 'Back' } }] },
        { name: 'DestinationScreen', platform: 'android', elements: [{ elementName: 'title', selector: { id: 'title' } }] },
    ],
};

function repoFor(platform: 'ios' | 'android' | 'web'): ElementRepository {
    return new ElementRepository(undefined as never, DATA as never, { platform });
}

test.describe('hasEntry', () => {
    test('true when the active platform page defines the entry', () => {
        expect(hasEntry(repoFor('ios'), 'backButton', 'DestinationScreen')).toBe(true);
    });

    test('false only when the page resolves but has no such entry', () => {
        expect(hasEntry(repoFor('android'), 'backButton', 'DestinationScreen')).toBe(false);
    });

    test('rethrows when the page has no entry for the active platform', () => {
        expect(() => hasEntry(repoFor('web'), 'backButton', 'DestinationScreen'))
            .toThrow("page 'DestinationScreen' has no entry for platform 'web'");
    });

    test('rethrows when the page does not exist', () => {
        expect(() => hasEntry(repoFor('android'), 'backButton', 'NoSuchScreen')).toThrow(/NoSuchScreen/);
    });

    test('rethrows any other error from the element lookup', () => {
        const repo = repoFor('ios');
        const boom = new Error('repository unavailable');
        repo.getElementMeta = () => { throw boom; };
        expect(() => hasEntry(repo, 'backButton', 'DestinationScreen')).toThrow(boom);
    });
});

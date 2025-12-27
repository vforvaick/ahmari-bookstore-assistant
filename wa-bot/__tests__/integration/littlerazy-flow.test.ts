/**
 * Littlerazy Forward Flow Integration Tests
 * 
 * Tests the complete flow when forwarding Littlerazy broadcasts:
 * Forward → Detect → Level Selection → Draft → Commands
 */

import { IntegrationHarness, loadFixture } from '../helpers/integrationHarness';
import { getTestLogger } from '../helpers/testLogger';

const litterazyFixtures = loadFixture<any>('littlerazy-broadcasts.json');

describe('Littlerazy Forward Flow - Detection & Level', () => {
    const logger = getTestLogger();
    let harness: IntegrationHarness;

    beforeEach(() => {
        harness = new IntegrationHarness();
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'littlerazy-flow'
        );
    });

    afterEach(async () => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
        await harness.cleanup();
    });

    test('forward Littlerazy broadcast → should detect and ask for level', async () => {
        const fixture = litterazyFixtures.littlerazy.brave_molly_hc;

        await harness.forwardBroadcast(fixture.text);

        harness.assertResponseContains('level', 'Should ask for level');
    });

    test('select level → should generate draft with correct title', async () => {
        const fixture = litterazyFixtures.littlerazy.brave_molly_hc;

        await harness.forwardBroadcast(fixture.text);
        await harness.reply('2');

        harness.assertResponseContains('Brave Molly', 'Draft should contain title');
    });

    test('title with parentheses → should parse correctly', async () => {
        const fixture = litterazyFixtures.littlerazy.forest_finn_skips_hc;

        await harness.forwardBroadcast(fixture.text);
        await harness.reply('1');

        // Title includes (finn and skips)
        harness.assertResponseContains('FOREST', 'Should contain title');
    });

    test('multiline description → should handle correctly', async () => {
        const fixture = litterazyFixtures.littlerazy.plastic_sucks_hc;

        await harness.forwardBroadcast(fixture.text);
        await harness.reply('1');

        harness.assertResponseContains('Plastic Sucks', 'Should contain title');
    });
});

describe('Littlerazy Forward Flow - Draft Commands', () => {
    const logger = getTestLogger();
    let harness: IntegrationHarness;

    beforeEach(() => {
        harness = new IntegrationHarness();
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'littlerazy-flow'
        );
    });

    afterEach(async () => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
        await harness.cleanup();
    });

    async function goToDraft(harness: IntegrationHarness): Promise<void> {
        const fixture = litterazyFixtures.littlerazy.plastic_sucks_hc;
        await harness.forwardBroadcast(fixture.text);
        await harness.reply('2');
    }

    test('SEND → should send draft', async () => {
        await goToDraft(harness);
        await harness.reply('SEND');

        harness.assertResponseContains('terkirim', 'Should confirm sent');
    });

    test('EDIT → should apply edit', async () => {
        await goToDraft(harness);
        await harness.reply('EDIT: Tambah callout tentang sustainability');

        harness.assertResponseContains('Plastic Sucks', 'Should contain title');
    });

    test('REGEN → should regenerate', async () => {
        await goToDraft(harness);
        await harness.reply('REGEN');

        harness.assertResponseContains('Plastic Sucks', 'Should contain title after regen');
    });

    test('CANCEL → should cancel', async () => {
        await goToDraft(harness);
        await harness.reply('CANCEL');

        harness.assertResponseContains('batal', 'Should confirm cancelled');
    });
});

describe('Littlerazy - All Fixtures', () => {
    const logger = getTestLogger();
    let harness: IntegrationHarness;

    beforeEach(() => {
        harness = new IntegrationHarness();
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'littlerazy-flow'
        );
    });

    afterEach(async () => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
        await harness.cleanup();
    });

    Object.entries(litterazyFixtures.littlerazy).forEach(([key, fixture]: [string, any]) => {
        test(`full flow: ${key}`, async () => {
            await harness.forwardBroadcast(fixture.text);
            await harness.reply('1');

            // Should generate a draft
            const response = harness.getLastResponse();
            expect(response.length).toBeGreaterThan(50);
        });
    });
});

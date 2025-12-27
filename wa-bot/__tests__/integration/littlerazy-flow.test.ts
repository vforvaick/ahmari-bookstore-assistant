/**
 * Littlerazy Forward Flow Integration Tests
 * 
 * Tests the complete flow when forwarding Littlerazy broadcasts:
 * Forward → Detect → Level Selection → (Provide Missing Data) → Draft → Commands
 * 
 * NOTE: Littlerazy broadcasts often lack close date and min order,
 * so the bot asks for this data before generating draft.
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

        // Should show supplier confirmation (check all responses)
        harness.assertAnyResponseContains('Supplier: LITTLERAZY', 'Should confirm Littlerazy supplier');
    });

    test('select level → should ask for missing data or show draft', async () => {
        const fixture = litterazyFixtures.littlerazy.brave_molly_hc;

        await harness.forwardBroadcast(fixture.text);
        await harness.reply('2');

        // Littlerazy fixtures don't have close date, so bot asks for it
        const combined = harness.getCombinedResponse();
        expect(combined).toMatch(/Data Belum Lengkap|DRAFT BROADCAST/i);
    });

    test('provide missing date → should generate draft', async () => {
        const fixture = litterazyFixtures.littlerazy.brave_molly_hc;

        await harness.forwardBroadcast(fixture.text);
        await harness.reply('1');

        // Check if "Data Belum Lengkap" is shown
        let combined = harness.getCombinedResponse();
        if (combined.includes('Data Belum Lengkap')) {
            await harness.reply('15 jan');
            await harness.wait(500);
            // Now check all responses
            harness.assertAnyResponseContains('DRAFT BROADCAST', 'Should show draft after providing date');
        } else {
            // Already shows draft
            expect(combined).toMatch(/DRAFT BROADCAST/i);
        }
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

    // Helper to get to draft state - handles "Data Belum Lengkap" step
    async function goToDraft(harness: IntegrationHarness): Promise<void> {
        const fixture = litterazyFixtures.littlerazy.plastic_sucks_hc;
        await harness.forwardBroadcast(fixture.text);
        await harness.reply('2');

        // Check if bot asks for missing data
        let combined = harness.getCombinedResponse();
        if (combined.includes('Data Belum Lengkap')) {
            await harness.reply('15 jan'); // Provide missing close date
            await harness.wait(500);
        }
    }

    test('SEND → should send draft', async () => {
        await goToDraft(harness);
        await harness.reply('SEND');

        const combined = harness.getCombinedResponse();
        expect(combined).toMatch(/terkirim|kirim|sent|grup/i);
    });

    test('EDIT → should apply edit', async () => {
        await goToDraft(harness);
        await harness.reply('EDIT: Tambah callout tentang sustainability');

        harness.assertAnyResponseContains('DRAFT BROADCAST', 'Should show updated draft');
    });

    test('REGEN → should regenerate', async () => {
        await goToDraft(harness);
        await harness.reply('REGEN');

        harness.assertAnyResponseContains('DRAFT BROADCAST', 'Should show regenerated draft');
    });

    test('CANCEL → should cancel', async () => {
        await goToDraft(harness);
        await harness.reply('CANCEL');

        harness.assertAnyResponseContains('batal', 'Should confirm cancelled');
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

            // Handle "Data Belum Lengkap" if shown
            let combined = harness.getCombinedResponse();
            if (combined.includes('Data Belum Lengkap')) {
                await harness.reply('15 jan');
                await harness.wait(500);
                combined = harness.getCombinedResponse();
            }

            // Should have meaningful response
            expect(combined.length).toBeGreaterThan(50);
        });
    });
});

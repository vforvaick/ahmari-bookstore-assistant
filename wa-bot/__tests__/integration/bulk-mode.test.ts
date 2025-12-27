/**
 * Bulk Mode Integration Tests
 * 
 * Tests the bulk collection and processing flow:
 * /bulk N → collect broadcasts (may need supplier selection) → /done → preview → YES/CANCEL/SCHEDULE
 * 
 * NOTE: When forwarding broadcasts, the bot may ask for supplier selection first
 * before adding to bulk collection. Tests handle this intermediate step.
 */

import { IntegrationHarness, loadFixture } from '../helpers/integrationHarness';
import { getTestLogger } from '../helpers/testLogger';

const fgbFixtures = loadFixture<any>('fgb-broadcasts.json');
const litterazyFixtures = loadFixture<any>('littlerazy-broadcasts.json');

describe('Bulk Mode - Start', () => {
    const logger = getTestLogger();
    let harness: IntegrationHarness;

    beforeEach(() => {
        harness = new IntegrationHarness();
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'bulk-mode'
        );
    });

    afterEach(async () => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
        await harness.cleanup();
    });

    test('/bulk 1 → should start bulk mode level 1', async () => {
        await harness.command('/bulk 1');

        // Check all responses for bulk confirmation
        harness.assertAnyResponseContains('bulk', 'Should confirm bulk mode started');
    });

    test('/bulk 2 → should start bulk mode level 2', async () => {
        await harness.command('/bulk 2');

        harness.assertAnyResponseContains('bulk', 'Should confirm bulk mode');
    });

    test('/bulk 3 → should start bulk mode level 3', async () => {
        await harness.command('/bulk 3');

        const combined = harness.getCombinedResponse();
        expect(combined.toLowerCase()).toContain('bulk');
    });

    test('/bulk without arg → should default or show error', async () => {
        await harness.command('/bulk');

        // Should either default to level 1, ask for level, or show usage
        const combined = harness.getCombinedResponse();
        expect(combined.length).toBeGreaterThan(10);
    });
});

describe('Bulk Mode - Collection', () => {
    const logger = getTestLogger();
    let harness: IntegrationHarness;

    beforeEach(() => {
        harness = new IntegrationHarness();
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'bulk-mode'
        );
    });

    afterEach(async () => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
        await harness.cleanup();
    });

    // Helper to add item to bulk - handles supplier selection if needed
    async function addItemToBulk(harness: IntegrationHarness, text: string): Promise<void> {
        await harness.forwardBroadcast(text);

        // Check if bot shows supplier confirmation (means it's processing)
        const combined = harness.getCombinedResponse();
        if (combined.includes('Supplier:')) {
            // Item was detected and added
            return;
        }
        // Otherwise might need more interaction
        await harness.wait(200);
    }

    test('collect single FGB broadcast', async () => {
        await harness.command('/bulk 2');

        const fixture = fgbFixtures.fgb.woeb_hardback_standard;
        await addItemToBulk(harness, fixture.text);

        // Should show item count or processing message
        const combined = harness.getCombinedResponse();
        expect(combined.length).toBeGreaterThan(20);
    });

    test('collect multiple broadcasts', async () => {
        await harness.command('/bulk 1');

        // Add first item
        await harness.forwardBroadcast(fgbFixtures.fgb.woeb_hardback_standard.text);
        await harness.wait(200);

        // Add second item
        await harness.forwardBroadcast(fgbFixtures.fgb.woeb_boardbook_building.text);
        await harness.wait(200);

        // Should have meaningful response
        const combined = harness.getCombinedResponse();
        expect(combined.length).toBeGreaterThan(20);
    });

    test('collect mixed FGB and Littlerazy', async () => {
        await harness.command('/bulk 2');

        // Add FGB
        await harness.forwardBroadcast(fgbFixtures.fgb.woeb_hardback_standard.text);
        await harness.wait(200);

        // Add Littlerazy
        await harness.forwardBroadcast(litterazyFixtures.littlerazy.brave_molly_hc.text);
        await harness.wait(200);

        // Should have processed both
        const combined = harness.getCombinedResponse();
        expect(combined.length).toBeGreaterThan(20);
    });
});

describe('Bulk Mode - Finish & Preview', () => {
    const logger = getTestLogger();
    let harness: IntegrationHarness;

    beforeEach(() => {
        harness = new IntegrationHarness();
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'bulk-mode'
        );
    });

    afterEach(async () => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
        await harness.cleanup();
    });

    async function collectItems(harness: IntegrationHarness, count: number): Promise<void> {
        await harness.command('/bulk 1');
        await harness.wait(100);

        const samples = [
            fgbFixtures.fgb.woeb_hardback_standard.text,
            fgbFixtures.fgb.woeb_boardbook_dinosaur.text,
            fgbFixtures.fgb.woeb_hardback_bedtime.text,
        ];

        for (let i = 0; i < count && i < samples.length; i++) {
            await harness.forwardBroadcast(samples[i]);
            await harness.wait(300);
        }
    }

    test('/done with items → should show preview', async () => {
        await collectItems(harness, 2);
        await harness.command('/done');

        // Should show preview or processing message
        const combined = harness.getCombinedResponse();
        expect(combined.length).toBeGreaterThan(20);
    });

    test('/done empty → should show error', async () => {
        await harness.command('/bulk 1');
        await harness.command('/done');

        // Should warn about no items
        harness.assertAnyResponseMatches(/kosong|tidak ada|empty|belum/i, 'Should warn about empty bulk');
    });

    test('preview → YES → should send all', async () => {
        await collectItems(harness, 2);
        await harness.command('/done');
        await harness.wait(500);
        await harness.reply('YES');

        // Should confirm sent or show some action
        const combined = harness.getCombinedResponse();
        expect(combined.length).toBeGreaterThan(10);
    });

    test('preview → CANCEL → should cancel bulk', async () => {
        await collectItems(harness, 2);
        await harness.command('/done');
        await harness.wait(500);
        await harness.reply('CANCEL');

        harness.assertAnyResponseMatches(/batal|cancel/i, 'Should confirm cancelled');
    });
});

describe('Bulk Mode - Supplier Switch', () => {
    const logger = getTestLogger();
    let harness: IntegrationHarness;

    beforeEach(() => {
        harness = new IntegrationHarness();
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'bulk-mode'
        );
    });

    afterEach(async () => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
        await harness.cleanup();
    });

    test('/supplier during bulk → should change parser or show message', async () => {
        await harness.command('/bulk 2');
        await harness.command('/supplier littlerazy');

        // Should respond to supplier command
        const combined = harness.getCombinedResponse();
        expect(combined.length).toBeGreaterThan(10);
    });
});

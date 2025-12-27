/**
 * Bulk Mode Integration Tests
 * 
 * Tests the bulk collection and processing flow:
 * /bulk N → collect broadcasts → /done → preview → YES/CANCEL/SCHEDULE
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

        harness.assertResponseContains('bulk', 'Should confirm bulk mode started');
        harness.assertResponseContains('level 1', 'Should show selected level');
    });

    test('/bulk 2 → should start bulk mode level 2', async () => {
        await harness.command('/bulk 2');

        harness.assertResponseContains('bulk', 'Should confirm bulk mode');
        harness.assertResponseMatches(/level\s*2/i, 'Should show level 2');
    });

    test('/bulk 3 → should start bulk mode level 3', async () => {
        await harness.command('/bulk 3');

        harness.assertResponseMatches(/level\s*3/i, 'Should show level 3');
    });

    test('/bulk without arg → should default or show error', async () => {
        await harness.command('/bulk');

        // Should either default to level or show usage
        const response = harness.getLastResponse();
        expect(response.length).toBeGreaterThan(10);
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

    test('collect single FGB broadcast', async () => {
        await harness.command('/bulk 2');

        const fixture = fgbFixtures.fgb.woeb_hardback_standard;
        await harness.forwardBroadcast(fixture.text);

        // Should confirm item added
        harness.assertResponseMatches(/ditambahkan|1\s*item|collected/i, 'Should confirm item added');
    });

    test('collect multiple broadcasts', async () => {
        await harness.command('/bulk 1');

        // Add first item
        await harness.forwardBroadcast(fgbFixtures.fgb.woeb_hardback_standard.text);

        // Add second item
        await harness.forwardBroadcast(fgbFixtures.fgb.woeb_boardbook_building.text);

        // Should show item count
        harness.assertResponseMatches(/2\s*item|item.*2/i, 'Should show 2 items collected');
    });

    test('collect mixed FGB and Littlerazy', async () => {
        await harness.command('/bulk 2');

        // Add FGB
        await harness.forwardBroadcast(fgbFixtures.fgb.woeb_hardback_standard.text);

        // Add Littlerazy
        await harness.forwardBroadcast(litterazyFixtures.littlerazy.brave_molly_hc.text);

        // Should accept both
        harness.assertResponseMatches(/2\s*item/i, 'Should accept mixed suppliers');
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

        const samples = [
            fgbFixtures.fgb.woeb_hardback_standard.text,
            fgbFixtures.fgb.woeb_boardbook_dinosaur.text,
            fgbFixtures.fgb.woeb_hardback_bedtime.text,
        ];

        for (let i = 0; i < count && i < samples.length; i++) {
            await harness.forwardBroadcast(samples[i]);
        }
    }

    test('/done with items → should show preview', async () => {
        await collectItems(harness, 2);
        await harness.command('/done');

        // Should show preview with items
        harness.assertResponseMatches(/preview|selesai|2\s*item/i, 'Should show preview');
    });

    test('/done empty → should show error', async () => {
        await harness.command('/bulk 1');
        await harness.command('/done');

        harness.assertResponseMatches(/kosong|tidak ada|empty/i, 'Should warn about empty bulk');
    });

    test('preview → YES → should send all', async () => {
        await collectItems(harness, 2);
        await harness.command('/done');
        await harness.reply('YES');

        harness.assertResponseMatches(/terkirim|sent|complete/i, 'Should confirm sent');
    });

    test('preview → CANCEL → should cancel bulk', async () => {
        await collectItems(harness, 2);
        await harness.command('/done');
        await harness.reply('CANCEL');

        harness.assertResponseMatches(/batal|cancel/i, 'Should confirm cancelled');
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

    test('/supplier during bulk → should change parser', async () => {
        await harness.command('/bulk 2');
        await harness.command('/supplier littlerazy');

        harness.assertResponseContains('littlerazy', 'Should confirm supplier change');
    });
});

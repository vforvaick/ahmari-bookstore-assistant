/**
 * FGB Forward Flow Integration Tests
 * 
 * Tests the complete flow when forwarding FGB broadcasts:
 * Forward → Detect → Level Selection → Draft → Commands (SEND/EDIT/REGEN/etc)
 */

import { IntegrationHarness, loadFixture } from '../helpers/integrationHarness';
import { getTestLogger } from '../helpers/testLogger';

// Load fixtures
const fgbFixtures = loadFixture<any>('fgb-broadcasts.json');

describe('FGB Forward Flow - Level Selection', () => {
    const logger = getTestLogger();
    let harness: IntegrationHarness;

    beforeEach(() => {
        harness = new IntegrationHarness();
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'fgb-flow',
            'woeb_hardback_standard'
        );
    });

    afterEach(async () => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
        await harness.cleanup();
    });

    test('forward FGB broadcast → should ask for level', async () => {
        const fixture = fgbFixtures.fgb.woeb_hardback_standard;

        // Forward the broadcast
        await harness.forwardBroadcast(fixture.text);

        // Should ask for level selection
        harness.assertResponseContains('level', 'Should ask for recommendation level');

        // Should show level options
        const response = harness.getLastResponse();
        expect(response).toMatch(/1.*hemat|2.*standar|3.*premium/i);
    });

    test('select level 1 → should generate draft', async () => {
        const fixture = fgbFixtures.fgb.woeb_hardback_standard;

        // Forward then select level
        await harness.forwardBroadcast(fixture.text);
        await harness.reply('1');

        // Should show draft with book title
        harness.assertResponseContains('We Are All Animals', 'Draft should contain book title');

        // Should show draft commands menu
        const response = harness.getLastResponse();
        expect(response).toMatch(/SEND|EDIT|REGEN/i);
    });

    test('select level 2 → should generate enhanced draft', async () => {
        const fixture = fgbFixtures.fgb.woeb_hardback_bedtime;

        await harness.forwardBroadcast(fixture.text);
        await harness.reply('2');

        harness.assertResponseContains('5-Minute Really True Stories', 'Draft should contain book title');
    });

    test('select level 3 → should generate premium draft', async () => {
        const fixture = fgbFixtures.fgb.woeb_boardbook_dinosaur;

        await harness.forwardBroadcast(fixture.text);
        await harness.reply('3');

        harness.assertResponseContains('Zoom: Dinosaur Adventure', 'Draft should contain book title');
    });
});

describe('FGB Forward Flow - Draft Commands', () => {
    const logger = getTestLogger();
    let harness: IntegrationHarness;

    beforeEach(() => {
        harness = new IntegrationHarness();
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'fgb-flow'
        );
    });

    afterEach(async () => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
        await harness.cleanup();
    });

    // Helper to get to draft state
    async function goToDraft(harness: IntegrationHarness): Promise<void> {
        const fixture = fgbFixtures.fgb.woeb_hardback_standard;
        await harness.forwardBroadcast(fixture.text);
        await harness.reply('1'); // Select level 1
    }

    test('SEND → should send to dev group', async () => {
        await goToDraft(harness);
        await harness.reply('SEND');

        // Should confirm send
        harness.assertResponseContains('terkirim', 'Should confirm message sent');
    });

    test('SEND PROD → should send to production group', async () => {
        await goToDraft(harness);
        await harness.reply('SEND PROD');

        harness.assertResponseContains('terkirim', 'Should confirm sent to production');
    });

    test('SCHEDULE → should add to queue', async () => {
        await goToDraft(harness);
        await harness.reply('SCHEDULE');

        // Should confirm scheduled
        harness.assertResponseMatches(/terjadwal|queue|antri/i, 'Should confirm scheduled');
    });

    test('CANCEL → should clear state', async () => {
        await goToDraft(harness);
        await harness.reply('CANCEL');

        harness.assertResponseContains('batal', 'Should confirm cancelled');
    });

    test('EDIT → should update draft with changes', async () => {
        await goToDraft(harness);
        await harness.reply('EDIT: Tambahkan emoji bintang di awal judul');

        // Should regenerate with edit applied
        harness.assertResponseContains('We Are All Animals', 'Should still contain title');
    });

    test('REGEN → should regenerate draft', async () => {
        await goToDraft(harness);
        await harness.reply('REGEN');

        // Should generate new draft
        harness.assertResponseContains('We Are All Animals', 'Should contain book title');
    });

    test('REGEN with feedback → should apply feedback', async () => {
        await goToDraft(harness);
        await harness.reply('REGEN: Buat lebih singkat dan catchy');

        harness.assertResponseContains('We Are All Animals', 'Should contain book title');
    });
});

describe('FGB Forward Flow - BACK Navigation', () => {
    const logger = getTestLogger();
    let harness: IntegrationHarness;

    beforeEach(() => {
        harness = new IntegrationHarness();
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'fgb-flow'
        );
    });

    afterEach(async () => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
        await harness.cleanup();
    });

    test('BACK from draft → should return to level selection', async () => {
        const fixture = fgbFixtures.fgb.woeb_hardback_standard;
        await harness.forwardBroadcast(fixture.text);
        await harness.reply('1');

        // Now at draft, go back
        await harness.reply('BACK');

        // Should show level selection again
        harness.assertResponseMatches(/level|pilih/i, 'Should return to level selection');
    });

    test('0 (alias) from draft → should return to level selection', async () => {
        const fixture = fgbFixtures.fgb.woeb_hardback_standard;
        await harness.forwardBroadcast(fixture.text);
        await harness.reply('2');

        // Use 0 as alias for BACK
        await harness.reply('0');

        harness.assertResponseMatches(/level|pilih/i, 'Should return to level selection');
    });
});

describe('FGB Forward Flow - Multiple Formats', () => {
    const logger = getTestLogger();
    let harness: IntegrationHarness;

    beforeEach(() => {
        harness = new IntegrationHarness();
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'fgb-flow'
        );
    });

    afterEach(async () => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
        await harness.cleanup();
    });

    test('HB format → should parse correctly', async () => {
        const fixture = fgbFixtures.fgb.woeb_hardback_family;

        await harness.forwardBroadcast(fixture.text);
        await harness.reply('1');

        harness.assertResponseContains('5-Minute Really True Stories for Family Time');
    });

    test('BB format → should parse correctly', async () => {
        const fixture = fgbFixtures.fgb.woeb_boardbook_farm;

        await harness.forwardBroadcast(fixture.text);
        await harness.reply('1');

        harness.assertResponseContains('Zoom: Farm Adventure');
    });

    test('broadcast with multiple preview links', async () => {
        const fixture = fgbFixtures.fgb.woeb_hardback_multi_preview;

        await harness.forwardBroadcast(fixture.text);
        await harness.reply('1');

        harness.assertResponseContains('Where In The World Are You');
    });
});

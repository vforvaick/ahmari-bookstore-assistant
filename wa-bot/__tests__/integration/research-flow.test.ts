/**
 * Research Flow Integration Tests (/new command)
 * 
 * Tests the multi-step flow for researching a book from the web:
 * /new <query> → select book → select level → provide details → generate draft
 */

import { IntegrationHarness } from '../helpers/integrationHarness';
import { getTestLogger } from '../helpers/testLogger';

describe('Research Flow (/new)', () => {
    const logger = getTestLogger();
    let harness: IntegrationHarness;

    beforeEach(() => {
        harness = new IntegrationHarness();
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'research-flow'
        );
    });

    afterEach(async () => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
        await harness.cleanup();
    });

    test('full research flow lifecycle', async () => {
        // 1. Start research
        await harness.command('/new Usborne Look Inside');
        await harness.wait(3000); // Wait for search

        // Should show search results
        harness.assertAnyResponseContains('ditemukan', 'Should show search results');
        // harness.assertAnyResponseContains('Mock Book 1', 'Should show first mock book'); // Removed as per new flow

        // 2. Select first book
        await harness.reply('1');
        await harness.wait(3000); // Wait for enrichment/download (increased for safety)

        // Should ask for details (Price, Format, etc.)
        harness.assertAnyResponseContains('Masukkan detail', 'Should ask for details');

        // 3. Provide details
        // Format: <price> <format> <eta> close <tanggal>
        await harness.reply('150000 HB Mei 2026 close 25 Des');
        await harness.wait(1000);

        // Should ask for level
        harness.assertAnyResponseContains('Pilih level', 'Should ask for level');

        // 4. Select level 2
        await harness.reply('2');
        await harness.wait(4000); // Wait for generation (increased for safety)

        // 5. Should show draft
        harness.assertAnyResponseContains('DRAFT BROADCAST', 'Should show final draft');

        const history = harness.getFullHistoryCombined();
        expect(history).toMatch(/150\.000/); // Formatted price
        expect(history).toMatch(/Mei/i); // ETA (May/Mei)
    });

    test('/new should handle cancellation', async () => {
        await harness.command('/new Book Title');
        await harness.wait(2000);

        await harness.reply('/cancel');
        await harness.wait(1000);
        harness.assertAnyResponseContains('Pending state cleared', 'Should confirm cancellation');
    });

    test('should handle invalid book selection', async () => {
        await harness.command('/new Book');
        await harness.wait(3000); // Increased wait

        await harness.reply('99'); // Out of range
        await harness.wait(1000);
        harness.assertAnyResponseContains('pilih angka 1-10', 'Should report invalid selection range');
    });

    test('should handle navigation (NEXT/PREV)', async () => {
        await harness.command('/new Lots of Books');
        await harness.wait(2000);

        // Next page
        await harness.reply('NEXT');
        await harness.wait(1000);
        harness.assertAnyResponseContains('halaman 2', 'Should show page 2');

        // Prev page
        await harness.reply('PREV');
        await harness.wait(1000);
        harness.assertAnyResponseContains('halaman 1', 'Should show page 1');
    });
});

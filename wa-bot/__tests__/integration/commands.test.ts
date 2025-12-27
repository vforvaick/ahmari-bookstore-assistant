/**
 * Slash Commands Integration Tests
 * 
 * Tests all slash commands: /help, /status, /cancel, /queue, etc.
 */

import { IntegrationHarness } from '../helpers/integrationHarness';
import { getTestLogger } from '../helpers/testLogger';

describe('Slash Commands - Basic', () => {
    const logger = getTestLogger();
    let harness: IntegrationHarness;

    beforeEach(() => {
        harness = new IntegrationHarness();
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'commands'
        );
    });

    afterEach(async () => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
        await harness.cleanup();
    });

    test('/help → should show help message', async () => {
        await harness.command('/help');

        harness.assertResponseContains('Ahmari', 'Should mention bot name');
        harness.assertResponseContains('supplier', 'Should mention suppliers');
    });

    test('/status → should show bot status', async () => {
        await harness.command('/status');

        harness.assertResponseContains('Status', 'Should show status');
        harness.assertResponseContains('Group', 'Should show group info');
    });

    test('/cancel → should clear pending state', async () => {
        await harness.command('/cancel');

        harness.assertResponseContains('clear', 'Should confirm cleared');
    });

    test('/queue → should show queue (empty)', async () => {
        await harness.command('/queue');

        // Either shows queue items or "kosong"
        const response = harness.getLastResponse();
        expect(response).toMatch(/antrian|queue|kosong/i);
    });

    test('/history → should show broadcast history', async () => {
        await harness.command('/history');

        // Either shows history or "kosong"
        const response = harness.getLastResponse();
        expect(response).toMatch(/history|riwayat|kosong/i);
    });

    test('/history 10 → should show 10 items', async () => {
        await harness.command('/history 10');

        const response = harness.getLastResponse();
        expect(response).toMatch(/history|riwayat|kosong/i);
    });
});

describe('Slash Commands - Search', () => {
    const logger = getTestLogger();
    let harness: IntegrationHarness;

    beforeEach(() => {
        harness = new IntegrationHarness();
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'commands'
        );
    });

    afterEach(async () => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
        await harness.cleanup();
    });

    test('/search without query → should show usage', async () => {
        await harness.command('/search');

        harness.assertResponseContains('cara pakai', 'Should show usage instructions');
    });

    test('/search keyword → should search broadcasts', async () => {
        await harness.command('/search usborne');

        // Either shows results or "tidak ditemukan"
        const response = harness.getLastResponse();
        expect(response).toMatch(/hasil|ditemukan|tidak/i);
    });
});

describe('Slash Commands - Supplier', () => {
    const logger = getTestLogger();
    let harness: IntegrationHarness;

    beforeEach(() => {
        harness = new IntegrationHarness();
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'commands'
        );
    });

    afterEach(async () => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
        await harness.cleanup();
    });

    test('/supplier without arg → should show error', async () => {
        await harness.command('/supplier');

        harness.assertResponseContains('tidak dikenal', 'Should show error for invalid supplier');
    });

    test('/supplier fgb → should set supplier (when no mode active)', async () => {
        await harness.command('/supplier fgb');

        // Should say no active mode or confirm set
        const response = harness.getLastResponse();
        expect(response).toMatch(/aktif|diubah|mode/i);
    });

    test('/supplier littlerazy → should set supplier', async () => {
        await harness.command('/supplier littlerazy');

        const response = harness.getLastResponse();
        expect(response).toMatch(/aktif|diubah|mode/i);
    });

    test('/supplier invalid → should show error', async () => {
        await harness.command('/supplier tokobuku');

        harness.assertResponseContains('tidak dikenal', 'Should reject invalid supplier');
    });
});

describe('Greetings → Help', () => {
    const logger = getTestLogger();
    let harness: IntegrationHarness;

    beforeEach(() => {
        harness = new IntegrationHarness();
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'commands'
        );
    });

    afterEach(async () => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
        await harness.cleanup();
    });

    const greetings = ['halo', 'hallo', 'hello', 'hi', 'hai', 'hey'];

    greetings.forEach(greeting => {
        test(`"${greeting}" → should show help`, async () => {
            await harness.reply(greeting);

            harness.assertResponseContains('Ahmari', 'Should show help message');
        });
    });

    test('HALO (uppercase) → should show help', async () => {
        await harness.reply('HALO');

        harness.assertResponseContains('Ahmari', 'Should handle uppercase');
    });
});

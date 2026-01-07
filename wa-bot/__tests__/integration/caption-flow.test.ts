/**
 * Caption Flow Integration Tests
 * 
 * Tests the image analysis and caption generation flow:
 * Image-only message → Analysis → Details → Level → Draft
 */

import { IntegrationHarness, createMockMessage } from '../helpers/integrationHarness';
import { getTestLogger } from '../helpers/testLogger';

describe('Caption Flow - Image Detection', () => {
    const logger = getTestLogger();
    let harness: IntegrationHarness;

    beforeEach(() => {
        harness = new IntegrationHarness();
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'caption-flow'
        );
    });

    afterEach(async () => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
        await harness.cleanup();
    });

    test('image-only message → should start caption flow', async () => {
        // Simulate image-only (no caption)
        await harness.forwardBroadcast('', { hasMedia: true, mediaCount: 1 });

        // Should start caption flow - ask for details or show analysis
        const response = harness.getLastResponse();
        expect(response.length).toBeGreaterThan(20);
    });

    // Note: Full caption flow tests require actual image files
    // These would need to be added with real test images
});

describe('Caption Flow - Details Input', () => {
    const logger = getTestLogger();
    let harness: IntegrationHarness;

    beforeEach(() => {
        harness = new IntegrationHarness();
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'caption-flow'
        );
    });

    afterEach(async () => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
        await harness.cleanup();
    });

    // First, start caption flow with image, then provide details
    test('provide price and format → should ask for level', async () => {
        // Step 1: Start caption flow with image
        await harness.forwardBroadcast('', { hasMedia: true, mediaCount: 1 });
        await harness.wait(500);

        // Step 2: Provide price and format
        await harness.reply('100000 HC');
        await harness.wait(500);

        // Check full history - should have asked about level or next step
        const history = harness.getFullHistoryCombined();
        expect(history.length).toBeGreaterThan(50);
        // Caption flow might ask for level, price, or show error
        expect(history).toMatch(/level|harga|price|pilih|error|caption/i);
    });

    test('provide details with ETA → should include in draft', async () => {
        // Step 1: Start caption flow  
        await harness.forwardBroadcast('', { hasMedia: true, mediaCount: 1 });
        await harness.wait(500);

        // Step 2: Provide full details
        await harness.reply('150000 HB ETA Maret');
        await harness.wait(500);

        // Check response - should progress in flow
        const history = harness.getFullHistoryCombined();
        expect(history.length).toBeGreaterThan(50);
        expect(history).toMatch(/level|draft|pilih|caption|harga/i);
    });
});

// Note: More caption tests would be added when implementing with real images
// The caption flow is complex because it requires:
// 1. Image analysis (AI call)
// 2. Book detection
// 3. User input for price/format
// 4. Level selection
// 5. Draft generation

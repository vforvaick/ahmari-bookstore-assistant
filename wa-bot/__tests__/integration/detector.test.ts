/**
 * Detector Integration Tests
 * 
 * Tests the broadcast detection logic for FGB and Littlerazy patterns.
 * Uses real broadcast samples from fixtures.
 */

import { detectFGBBroadcast, DetectionResult } from '../../src/detector';
import { getTestLogger } from '../helpers/testLogger';
import { loadFixture } from '../helpers/integrationHarness';

// Load fixtures
const fgbFixtures = loadFixture<any>('fgb-broadcasts.json');
const litterazyFixtures = loadFixture<any>('littlerazy-broadcasts.json');

describe('Detector - FGB Pattern Matching', () => {
    const logger = getTestLogger();

    beforeEach(() => {
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'detector'
        );
    });

    afterEach(() => {
        const testName = expect.getState().currentTestName || 'unknown';
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
    });

    // Helper to create mock message
    const createMessage = (text: string): any => ({
        key: { remoteJid: 'test@s.whatsapp.net' },
        message: { extendedTextMessage: { text } },
    });

    describe('WoEB Pattern Detection', () => {
        test('should detect WoEB hardback broadcast', () => {
            const fixture = fgbFixtures.fgb.woeb_hardback_standard;
            logger.startStep('Testing WoEB HB detection');
            logger.logIncomingMessage('test', fixture.text.substring(0, 100));

            const message = createMessage(fixture.text);
            const result = detectFGBBroadcast(message);

            logger.logAssertion('isBroadcast should be true', true, result.isBroadcast, result.isBroadcast === true);
            logger.logAssertion('supplier should be fgb', 'fgb', result.detectedSupplier, result.detectedSupplier === 'fgb');

            expect(result.isBroadcast).toBe(true);
            expect(result.detectedSupplier).toBe('fgb');
            expect(result.text).toContain('We Are All Animals');
        });

        test('should detect WoEB boardbook broadcast', () => {
            const fixture = fgbFixtures.fgb.woeb_boardbook_building;
            logger.startStep('Testing WoEB BB detection');

            const message = createMessage(fixture.text);
            const result = detectFGBBroadcast(message);

            expect(result.isBroadcast).toBe(true);
            expect(result.detectedSupplier).toBe('fgb');
            expect(result.text).toContain('Zoom: Building Site Adventure');

            logger.logAssertion('Detected as FGB broadcast', true, result.isBroadcast, true);
        });

        test('should detect 🦊🦊🦊 emoji pattern', () => {
            const fixture = fgbFixtures.fgb.woeb_hardback_multi_preview;
            logger.startStep('Testing fox emoji pattern');

            const message = createMessage(fixture.text);
            const result = detectFGBBroadcast(message);

            expect(result.isBroadcast).toBe(true);
            expect(result.text).toContain('🦊🦊🦊');

            logger.logAssertion('Fox emoji detected', true, result.isBroadcast, true);
        });

        test('should detect 🏷️ Rp price pattern', () => {
            const fixture = fgbFixtures.fgb.woeb_hardback_standard;
            logger.startStep('Testing price tag pattern');

            const message = createMessage(fixture.text);
            const result = detectFGBBroadcast(message);

            expect(result.isBroadcast).toBe(true);
            expect(result.text).toContain('🏷️ Rp');

            logger.logAssertion('Price tag pattern detected', true, result.isBroadcast, true);
        });
    });

    describe('All FGB Samples', () => {
        // Test all FGB fixtures dynamically
        Object.entries(fgbFixtures.fgb).forEach(([key, fixture]: [string, any]) => {
            test(`should detect: ${key}`, () => {
                logger.startStep(`Testing FGB fixture: ${key}`);

                const message = createMessage(fixture.text);
                const result = detectFGBBroadcast(message);

                expect(result.isBroadcast).toBe(true);
                expect(result.detectedSupplier).toBe('fgb');

                logger.logAssertion(`${key} detected as FGB`, true, result.isBroadcast, true);
            });
        });
    });
});

describe('Detector - Littlerazy Pattern Matching', () => {
    const logger = getTestLogger();

    beforeEach(() => {
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'detector'
        );
    });

    afterEach(() => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
    });

    const createMessage = (text: string): any => ({
        key: { remoteJid: 'test@s.whatsapp.net' },
        message: { extendedTextMessage: { text } },
    });

    describe('HC Format Detection', () => {
        test('should detect Brave Molly HC broadcast', () => {
            const fixture = litterazyFixtures.littlerazy.brave_molly_hc;
            logger.startStep('Testing Littlerazy HC detection');

            const message = createMessage(fixture.text);
            const result = detectFGBBroadcast(message);

            expect(result.isBroadcast).toBe(true);
            expect(result.detectedSupplier).toBe('littlerazy');
            expect(result.text).toContain('Brave Molly');

            logger.logAssertion('Detected as Littlerazy', 'littlerazy', result.detectedSupplier, result.detectedSupplier === 'littlerazy');
        });

        test('should detect title with parentheses', () => {
            const fixture = litterazyFixtures.littlerazy.forest_finn_skips_hc;
            logger.startStep('Testing Littlerazy with parentheses in title');

            const message = createMessage(fixture.text);
            const result = detectFGBBroadcast(message);

            expect(result.isBroadcast).toBe(true);
            expect(result.detectedSupplier).toBe('littlerazy');
            expect(result.text).toContain('FOREST');

            logger.logAssertion('Title with parens detected', true, result.isBroadcast, true);
        });

        test('should detect 🌸🌸🌸 flower emoji pattern', () => {
            const fixture = litterazyFixtures.littlerazy.plastic_sucks_hc;
            logger.startStep('Testing flower emoji pattern');

            const message = createMessage(fixture.text);
            const result = detectFGBBroadcast(message);

            expect(result.isBroadcast).toBe(true);
            expect(result.text).toContain('🌸🌸🌸');

            logger.logAssertion('Flower emoji detected', true, result.isBroadcast, true);
        });
    });

    describe('All Littlerazy Samples', () => {
        Object.entries(litterazyFixtures.littlerazy).forEach(([key, fixture]: [string, any]) => {
            test(`should detect: ${key}`, () => {
                logger.startStep(`Testing Littlerazy fixture: ${key}`);

                const message = createMessage(fixture.text);
                const result = detectFGBBroadcast(message);

                expect(result.isBroadcast).toBe(true);
                expect(result.detectedSupplier).toBe('littlerazy');

                logger.logAssertion(`${key} detected as Littlerazy`, true, result.isBroadcast, true);
            });
        });
    });
});

describe('Detector - Edge Cases', () => {
    const logger = getTestLogger();

    beforeEach(() => {
        logger.startTest(
            expect.getState().currentTestName || 'unknown',
            expect.getState().currentTestName || 'unknown',
            'detector'
        );
    });

    afterEach(() => {
        const passed = expect.getState().assertionCalls === expect.getState().numPassingAsserts;
        logger.endTest(passed ? 'passed' : 'failed');
    });

    test('should NOT detect random text as broadcast', () => {
        logger.startStep('Testing non-broadcast text');

        const message = {
            key: { remoteJid: 'test@s.whatsapp.net' },
            message: { extendedTextMessage: { text: 'Halo, apa kabar? Mau order buku dong.' } },
        };
        const result = detectFGBBroadcast(message);

        expect(result.isBroadcast).toBe(false);
        expect(result.detectedSupplier).toBeUndefined();

        logger.logAssertion('Not detected as broadcast', false, result.isBroadcast, result.isBroadcast === false);
    });

    test('should NOT detect greeting as broadcast', () => {
        logger.startStep('Testing greeting');

        const message = {
            key: { remoteJid: 'test@s.whatsapp.net' },
            message: { extendedTextMessage: { text: 'Halo' } },
        };
        const result = detectFGBBroadcast(message);

        expect(result.isBroadcast).toBe(false);

        logger.logAssertion('Greeting not detected', false, result.isBroadcast, true);
    });

    test('should handle empty message', () => {
        logger.startStep('Testing empty message');

        const message = {
            key: { remoteJid: 'test@s.whatsapp.net' },
            message: {},
        };
        const result = detectFGBBroadcast(message);

        expect(result.isBroadcast).toBe(false);
        expect(result.text).toBe('');

        logger.logAssertion('Empty message handled', false, result.isBroadcast, true);
    });

    test('should handle image-only message', () => {
        logger.startStep('Testing image-only message');

        const message = {
            key: { remoteJid: 'test@s.whatsapp.net' },
            message: {
                imageMessage: {
                    mimetype: 'image/jpeg',
                    // No caption
                },
            },
        };
        const result = detectFGBBroadcast(message);

        expect(result.hasMedia).toBe(true);
        expect(result.mediaCount).toBe(1);
        expect(result.isBroadcast).toBe(false); // No text to match patterns

        logger.logAssertion('Image-only detected', true, result.hasMedia, true);
    });

    test('should handle image with FGB caption', () => {
        logger.startStep('Testing image with FGB caption');

        const fixture = fgbFixtures.fgb.woeb_hardback_standard;
        const message = {
            key: { remoteJid: 'test@s.whatsapp.net' },
            message: {
                imageMessage: {
                    mimetype: 'image/jpeg',
                    caption: fixture.text,
                },
            },
        };
        const result = detectFGBBroadcast(message);

        expect(result.hasMedia).toBe(true);
        expect(result.isBroadcast).toBe(true);
        expect(result.detectedSupplier).toBe('fgb');

        logger.logAssertion('Image with FGB caption detected', true, result.isBroadcast, true);
    });
});

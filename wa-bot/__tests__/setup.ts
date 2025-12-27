/**
 * Jest Setup File
 * 
 * Runs before all tests to:
 * - Set environment variables
 * - Initialize test logger
 * - Set up global hooks
 */

import { getTestLogger, resetTestLogger } from './helpers/testLogger';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce noise during tests
process.env.AI_PROCESSOR_URL = process.env.AI_PROCESSOR_URL || 'http://localhost:5000';
process.env.TARGET_GROUP_JID = 'test-group@g.us';
process.env.DEV_GROUP_JID = 'dev-group@g.us';

// Global timeout for integration tests (2 minutes)
jest.setTimeout(120000);

// Before all tests in run
beforeAll(() => {
    console.log('\n🧪 Starting Integration Test Run');
    console.log(`   AI Processor: ${process.env.AI_PROCESSOR_URL}`);
    console.log(`   Timeout: 120s per test\n`);
});

// After all tests complete
afterAll(() => {
    const logger = getTestLogger();
    const logPath = logger.finishRun();
    console.log(`\n📋 Test logs saved to: ${logPath}`);
    resetTestLogger();
});

// Export for type checking
export { };

/**
 * Test Logger - Structured JSON logging for integration tests
 * 
 * Creates detailed logs that can be reviewed to verify test correctness.
 * Each test case logs: input, output, AI calls, state changes, and assertions.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface AICallLog {
    endpoint: string;
    method: string;
    requestBody?: any;
    responseBody?: any;
    duration: number;
    status: 'success' | 'error';
    error?: string;
}

export interface StateChangeLog {
    type: 'pending' | 'bulk' | 'research' | 'caption';
    before: any;
    after: any;
}

export interface AssertionLog {
    description: string;
    expected: any;
    actual: any;
    passed: boolean;
}

export interface MessageLog {
    direction: 'incoming' | 'outgoing';
    from: string;
    to?: string;
    text: string;
    hasMedia: boolean;
    mediaCount?: number;
    timestamp: string;
}

export interface TestStepLog {
    step: number;
    description: string;
    timestamp: string;
    messages: MessageLog[];
    aiCalls: AICallLog[];
    stateChanges: StateChangeLog[];
    assertions: AssertionLog[];
    notes?: string;
}

export interface TestCaseLog {
    testId: string;
    testName: string;
    suite: string;
    fixture?: string;
    startTime: string;
    endTime?: string;
    duration?: number;
    status: 'running' | 'passed' | 'failed' | 'skipped';
    steps: TestStepLog[];
    summary?: string;
    error?: string;
}

export interface TestRunLog {
    runId: string;
    startTime: string;
    endTime?: string;
    environment: {
        nodeVersion: string;
        aiProcessorUrl: string;
        testTimeout: number;
    };
    tests: TestCaseLog[];
    summary?: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
        duration: number;
    };
}

class TestLogger {
    private runLog: TestRunLog;
    private currentTest: TestCaseLog | null = null;
    private currentStep: TestStepLog | null = null;
    private stepCounter = 0;
    private logDir: string;

    constructor() {
        const runId = new Date().toISOString().replace(/[:.]/g, '-');
        this.logDir = path.join(__dirname, '..', 'logs');

        // Ensure log directory exists
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }

        this.runLog = {
            runId,
            startTime: new Date().toISOString(),
            environment: {
                nodeVersion: process.version,
                aiProcessorUrl: process.env.AI_PROCESSOR_URL || 'http://localhost:5000',
                testTimeout: 120000,
            },
            tests: [],
        };
    }

    // Start a new test case
    startTest(testId: string, testName: string, suite: string, fixture?: string): void {
        this.currentTest = {
            testId,
            testName,
            suite,
            fixture,
            startTime: new Date().toISOString(),
            status: 'running',
            steps: [],
        };
        this.stepCounter = 0;
        this.runLog.tests.push(this.currentTest);
    }

    // Start a new step within current test
    startStep(description: string): void {
        if (!this.currentTest) {
            throw new Error('No test started. Call startTest() first.');
        }
        this.stepCounter++;
        this.currentStep = {
            step: this.stepCounter,
            description,
            timestamp: new Date().toISOString(),
            messages: [],
            aiCalls: [],
            stateChanges: [],
            assertions: [],
        };
        this.currentTest.steps.push(this.currentStep);
    }

    // Log incoming message (simulated forward)
    logIncomingMessage(from: string, text: string, hasMedia = false, mediaCount = 0): void {
        if (!this.currentStep) {
            this.startStep('Message handling');
        }
        this.currentStep!.messages.push({
            direction: 'incoming',
            from,
            text: text.substring(0, 500) + (text.length > 500 ? '...' : ''),
            hasMedia,
            mediaCount,
            timestamp: new Date().toISOString(),
        });
    }

    // Log outgoing message (bot response)
    logOutgoingMessage(to: string, text: string, hasMedia = false): void {
        if (!this.currentStep) {
            this.startStep('Message handling');
        }
        this.currentStep!.messages.push({
            direction: 'outgoing',
            from: 'bot',
            to,
            text: text.substring(0, 1000) + (text.length > 1000 ? '...' : ''),
            hasMedia,
            timestamp: new Date().toISOString(),
        });
    }

    // Log AI API call
    logAICall(
        endpoint: string,
        method: string,
        requestBody: any,
        responseBody: any,
        duration: number,
        status: 'success' | 'error',
        error?: string
    ): void {
        if (!this.currentStep) {
            this.startStep('AI processing');
        }
        this.currentStep!.aiCalls.push({
            endpoint,
            method,
            requestBody: this.sanitizeForLog(requestBody),
            responseBody: this.sanitizeForLog(responseBody),
            duration,
            status,
            error,
        });
    }

    // Log state change
    logStateChange(type: StateChangeLog['type'], before: any, after: any): void {
        if (!this.currentStep) {
            this.startStep('State management');
        }
        this.currentStep!.stateChanges.push({
            type,
            before: this.sanitizeForLog(before),
            after: this.sanitizeForLog(after),
        });
    }

    // Log assertion result
    logAssertion(description: string, expected: any, actual: any, passed: boolean): void {
        if (!this.currentStep) {
            this.startStep('Assertions');
        }
        this.currentStep!.assertions.push({
            description,
            expected: this.sanitizeForLog(expected),
            actual: this.sanitizeForLog(actual),
            passed,
        });
    }

    // Add note to current step
    addNote(note: string): void {
        if (this.currentStep) {
            this.currentStep.notes = (this.currentStep.notes || '') + note + '\n';
        }
    }

    // End current test
    endTest(status: 'passed' | 'failed' | 'skipped', summary?: string, error?: string): void {
        if (!this.currentTest) return;

        this.currentTest.endTime = new Date().toISOString();
        this.currentTest.duration =
            new Date(this.currentTest.endTime).getTime() -
            new Date(this.currentTest.startTime).getTime();
        this.currentTest.status = status;
        this.currentTest.summary = summary;
        this.currentTest.error = error;

        this.currentTest = null;
        this.currentStep = null;
    }

    // Finish the test run and save logs
    finishRun(): string {
        this.runLog.endTime = new Date().toISOString();

        // Calculate summary
        const tests = this.runLog.tests;
        this.runLog.summary = {
            total: tests.length,
            passed: tests.filter(t => t.status === 'passed').length,
            failed: tests.filter(t => t.status === 'failed').length,
            skipped: tests.filter(t => t.status === 'skipped').length,
            duration: new Date(this.runLog.endTime).getTime() -
                new Date(this.runLog.startTime).getTime(),
        };

        // Save full log
        const fullLogPath = path.join(this.logDir, `test-run-${this.runLog.runId}.json`);
        fs.writeFileSync(fullLogPath, JSON.stringify(this.runLog, null, 2));

        // Save summary
        const summaryPath = path.join(this.logDir, 'latest-summary.json');
        fs.writeFileSync(summaryPath, JSON.stringify({
            runId: this.runLog.runId,
            ...this.runLog.summary,
            logFile: fullLogPath,
        }, null, 2));

        return fullLogPath;
    }

    // Helper to sanitize objects for logging (remove circular refs, truncate long strings)
    private sanitizeForLog(obj: any, maxDepth = 3, currentDepth = 0): any {
        if (currentDepth > maxDepth) return '[max depth]';
        if (obj === null || obj === undefined) return obj;
        if (typeof obj === 'string') {
            return obj.length > 500 ? obj.substring(0, 500) + '...' : obj;
        }
        if (typeof obj !== 'object') return obj;
        if (Buffer.isBuffer(obj)) return '[Buffer]';
        if (Array.isArray(obj)) {
            return obj.slice(0, 10).map(item => this.sanitizeForLog(item, maxDepth, currentDepth + 1));
        }

        const sanitized: Record<string, any> = {};
        for (const [key, value] of Object.entries(obj)) {
            if (key.startsWith('_') || key === 'sock' || key === 'client') continue;
            sanitized[key] = this.sanitizeForLog(value, maxDepth, currentDepth + 1);
        }
        return sanitized;
    }

    // Get current run log (for assertions in tests)
    getRunLog(): TestRunLog {
        return this.runLog;
    }

    getCurrentTest(): TestCaseLog | null {
        return this.currentTest;
    }
}

// Singleton instance
let loggerInstance: TestLogger | null = null;

export function getTestLogger(): TestLogger {
    if (!loggerInstance) {
        loggerInstance = new TestLogger();
    }
    return loggerInstance;
}

export function resetTestLogger(): void {
    if (loggerInstance) {
        loggerInstance.finishRun();
    }
    loggerInstance = null;
}

export { TestLogger };

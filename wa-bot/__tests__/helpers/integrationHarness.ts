/**
 * Integration Test Harness
 * 
 * Provides a simulated WhatsApp environment for testing:
 * - Mocked WASocket that captures sent messages
 * - Real AIClient (connects to actual AI Processor)
 * - Test database (SQLite in-memory or temp file)
 * - Message simulation helpers
 */

import { MessageHandler } from '../../src/messageHandler';
import { AIClient } from '../../src/aiClient';
import { initStateStore, getStateStore } from '../../src/stateStore';
import { initBroadcastStore, getBroadcastStore } from '../../src/broadcastStore';
import { detectFGBBroadcast } from '../../src/detector';
import { getTestLogger, TestLogger } from './testLogger';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Type for captured messages
export interface CapturedMessage {
    to: string;
    content: {
        text?: string;
        image?: { url: string };
        caption?: string;
    };
    timestamp: Date;
}

// Mock WASocket type
export interface MockWASocket {
    sendMessage: jest.Mock<Promise<void>, [string, any]>;
    groupFetchAllParticipating: jest.Mock<Promise<Record<string, { subject: string }>>, []>;
    // Internal: captured messages for assertions
    _capturedMessages: CapturedMessage[];
    // Internal: clear captured messages
    _clearMessages: () => void;
}

// Create a mock WASocket
export function createMockSocket(): MockWASocket {
    const captured: CapturedMessage[] = [];

    const socket: MockWASocket = {
        _capturedMessages: captured,
        _clearMessages: () => { captured.length = 0; },

        sendMessage: jest.fn(async (to: string, content: any) => {
            captured.push({
                to,
                content,
                timestamp: new Date(),
            });

            // Log the outgoing message
            const logger = getTestLogger();
            const text = content.text || content.caption || '';
            logger.logOutgoingMessage(to, text, !!content.image);
        }),

        groupFetchAllParticipating: jest.fn(async () => ({
            'test-group@g.us': { subject: 'Test Group' },
            'dev-group@g.us': { subject: 'Dev Group' },
        })),
    };

    return socket;
}

// Create a mock proto.IWebMessageInfo from text
export function createMockMessage(
    text: string,
    options: {
        from?: string;
        hasMedia?: boolean;
        mediaCount?: number;
        isForwarded?: boolean;
    } = {}
): any {
    const {
        from = 'test-owner@s.whatsapp.net',
        hasMedia = false,
        mediaCount = 0,
        isForwarded = false,
    } = options;

    const message: any = {
        key: {
            remoteJid: from,
            fromMe: false,
            id: `test-msg-${Date.now()}`,
        },
        message: {},
        messageTimestamp: Math.floor(Date.now() / 1000),
    };

    if (hasMedia && mediaCount > 0) {
        // Image message with caption
        message.message.imageMessage = {
            caption: text,
            mimetype: 'image/jpeg',
            jpegThumbnail: Buffer.from([]),
        };
    } else {
        // Text-only message
        message.message.extendedTextMessage = {
            text,
        };

        // If forwarded, add context info
        if (isForwarded) {
            message.message.extendedTextMessage.contextInfo = {
                isForwarded: true,
            };
        }
    }

    return message;
}

// Integration test harness
export class IntegrationHarness {
    public socket: MockWASocket;
    public aiClient: AIClient;
    public handler: MessageHandler;
    public testJid: string;
    private tempDbPath: string;
    private logger: TestLogger;

    constructor(options: {
        testJid?: string;
        aiProcessorUrl?: string;
    } = {}) {
        this.testJid = options.testJid || 'test-owner@s.whatsapp.net';
        this.logger = getTestLogger();

        // Create mock socket
        this.socket = createMockSocket();

        // Create real AI client (connects to actual AI Processor)
        const aiUrl = options.aiProcessorUrl || process.env.AI_PROCESSOR_URL || 'http://localhost:5000';
        this.aiClient = new AIClient(aiUrl);

        // Wrap AI client methods to log calls
        this.wrapAIClient();

        // Create temp database
        this.tempDbPath = path.join(os.tmpdir(), `test-db-${Date.now()}.sqlite`);

        // Initialize stores
        initStateStore(this.tempDbPath);
        initBroadcastStore(this.tempDbPath.replace('.sqlite', '-broadcast.sqlite'));

        // Create message handler with test owner JID
        this.handler = new MessageHandler(
            this.socket as any,
            this.testJid,
            this.aiClient,
            path.join(os.tmpdir(), 'test-media'),
        );
    }

    // Wrap AI client to log API calls
    private wrapAIClient(): void {
        const originalParse = this.aiClient.parse.bind(this.aiClient);
        const originalGenerate = this.aiClient.generate.bind(this.aiClient);
        const self = this;

        this.aiClient.parse = async function (text: string, mediaCount: number, supplier?: any) {
            const start = Date.now();
            try {
                const result = await originalParse(text, mediaCount, supplier);
                self.logger.logAICall(
                    '/parse',
                    'POST',
                    { text: text.substring(0, 200), mediaCount, supplier },
                    result,
                    Date.now() - start,
                    'success'
                );
                return result;
            } catch (error: any) {
                self.logger.logAICall(
                    '/parse',
                    'POST',
                    { text: text.substring(0, 200), mediaCount, supplier },
                    null,
                    Date.now() - start,
                    'error',
                    error.message
                );
                throw error;
            }
        };

        this.aiClient.generate = async function (parsedData: any, level?: number, userEdit?: string) {
            const start = Date.now();
            try {
                const result = await originalGenerate(parsedData, level, userEdit);
                self.logger.logAICall(
                    '/generate',
                    'POST',
                    { title: parsedData?.title, level, userEdit },
                    { draft: result.draft?.substring(0, 300) },
                    Date.now() - start,
                    'success'
                );
                return result;
            } catch (error: any) {
                self.logger.logAICall(
                    '/generate',
                    'POST',
                    { title: parsedData?.title, level, userEdit },
                    null,
                    Date.now() - start,
                    'error',
                    error.message
                );
                throw error;
            }
        };
    }

    // Simulate forwarding a broadcast message
    async forwardBroadcast(text: string, options: { hasMedia?: boolean; mediaCount?: number } = {}): Promise<CapturedMessage[]> {
        this.logger.startStep(`Forward broadcast: "${text.substring(0, 50)}..."`);
        this.logger.logIncomingMessage(this.testJid, text, options.hasMedia, options.mediaCount);

        const message = createMockMessage(text, {
            from: this.testJid,
            hasMedia: options.hasMedia,
            mediaCount: options.mediaCount,
            isForwarded: true,
        });

        this.socket._clearMessages();
        await this.handler.handleMessage(message);

        return [...this.socket._capturedMessages];
    }

    // Simulate user reply (for multi-step flows)
    async reply(text: string): Promise<CapturedMessage[]> {
        this.logger.startStep(`User reply: "${text}"`);
        this.logger.logIncomingMessage(this.testJid, text);

        const message = createMockMessage(text, { from: this.testJid });

        this.socket._clearMessages();
        await this.handler.handleMessage(message);

        return [...this.socket._capturedMessages];
    }

    // Simulate slash command
    async command(cmd: string): Promise<CapturedMessage[]> {
        this.logger.startStep(`Command: ${cmd}`);
        this.logger.logIncomingMessage(this.testJid, cmd);

        const message = createMockMessage(cmd, { from: this.testJid });

        this.socket._clearMessages();
        await this.handler.handleMessage(message);

        return [...this.socket._capturedMessages];
    }

    // Get last bot response text
    getLastResponse(): string {
        const messages = this.socket._capturedMessages;
        if (messages.length === 0) return '';
        const last = messages[messages.length - 1];
        return last.content.text || last.content.caption || '';
    }

    // Get all bot response texts
    getAllResponses(): string[] {
        return this.socket._capturedMessages.map(m => m.content.text || m.content.caption || '');
    }

    // Get all responses combined as single string
    getCombinedResponse(): string {
        return this.getAllResponses().join(' ');
    }

    // Assert that ANY response contains text (checks all bubbles)
    assertAnyResponseContains(expected: string, description?: string): void {
        const allResponses = this.getCombinedResponse();
        const passed = allResponses.toLowerCase().includes(expected.toLowerCase());
        this.logger.logAssertion(
            description || `Any response contains "${expected}"`,
            expected,
            allResponses.substring(0, 300),
            passed
        );
        expect(allResponses.toLowerCase()).toContain(expected.toLowerCase());
    }

    // Assert ANY response matches pattern (checks all bubbles)  
    assertAnyResponseMatches(pattern: RegExp, description?: string): void {
        const allResponses = this.getCombinedResponse();
        const passed = pattern.test(allResponses);
        this.logger.logAssertion(
            description || `Any response matches ${pattern}`,
            pattern.toString(),
            allResponses.substring(0, 300),
            passed
        );
        expect(allResponses).toMatch(pattern);
    }

    // Assert that last response contains text
    assertResponseContains(expected: string, description?: string): void {
        const actual = this.getLastResponse();
        const passed = actual.toLowerCase().includes(expected.toLowerCase());
        this.logger.logAssertion(
            description || `Response contains "${expected}"`,
            expected,
            actual.substring(0, 200),
            passed
        );
        expect(actual.toLowerCase()).toContain(expected.toLowerCase());
    }

    // Assert response matches pattern
    assertResponseMatches(pattern: RegExp, description?: string): void {
        const actual = this.getLastResponse();
        const passed = pattern.test(actual);
        this.logger.logAssertion(
            description || `Response matches ${pattern}`,
            pattern.toString(),
            actual.substring(0, 200),
            passed
        );
        expect(actual).toMatch(pattern);
    }

    // Assert number of responses
    assertResponseCount(count: number): void {
        const actual = this.socket._capturedMessages.length;
        const passed = actual === count;
        this.logger.logAssertion(
            `Response count is ${count}`,
            count,
            actual,
            passed
        );
        expect(actual).toBe(count);
    }

    // Wait for async processing
    async wait(ms: number = 100): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    // Cleanup
    async cleanup(): Promise<void> {
        try {
            getStateStore().close();
        } catch { }

        // Remove temp files
        if (fs.existsSync(this.tempDbPath)) {
            fs.unlinkSync(this.tempDbPath);
        }
        const broadcastDb = this.tempDbPath.replace('.sqlite', '-broadcast.sqlite');
        if (fs.existsSync(broadcastDb)) {
            fs.unlinkSync(broadcastDb);
        }
    }
}

// Export helper to load fixtures
export function loadFixture<T>(fixturePath: string): T {
    const fullPath = path.join(__dirname, '..', 'fixtures', fixturePath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    return JSON.parse(content);
}

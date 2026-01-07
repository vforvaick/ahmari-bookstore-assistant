import { MessageHandler } from '../../src/messageHandler';
import { AIClient } from '../../src/aiClient';
import { initStateStore } from '../../src/stateStore';
import { initBroadcastStore } from '../../src/broadcastStore';

// Mock AIClient
jest.mock('../../src/aiClient');

describe('MessageHandler Slash Commands', () => {
    let handler: MessageHandler;
    let mockSocket: any;
    let mockAIClient: jest.Mocked<AIClient>;

    beforeEach(async () => {
        initStateStore(':memory:');
        initBroadcastStore(':memory:');

        mockSocket = {
            sendMessage: jest.fn().mockResolvedValue({}),
            user: { id: 'bot@s.whatsapp.net' }
        };

        mockAIClient = new AIClient('http://test') as jest.Mocked<AIClient>;
        handler = new MessageHandler(mockSocket, 'owner@s.whatsapp.net', mockAIClient);
    });

    afterEach(() => {
        handler.destroy();
    });

    const createMessage = (text: string, from: string = 'owner@s.whatsapp.net') => ({
        key: { remoteJid: from, fromMe: false, id: '123' },
        message: { conversation: text },
        pushName: 'User'
    } as any);

    describe('/setmarkup', () => {
        test('should update markup', async () => {
            mockAIClient.setMarkup.mockResolvedValueOnce({ price_markup: 1.8 });
            await handler.handleMessage(createMessage('/setmarkup 1.8'));
            expect(mockSocket.sendMessage).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ text: expect.stringMatching(/1[.,]8/) })
            );
        });

        test('should report error on invalid markup', async () => {
            await handler.handleMessage(createMessage('/setmarkup invalid'));
            expect(mockSocket.sendMessage).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ text: expect.stringContaining('Format salah') })
            );
        });
    });

    describe('/getmarkup', () => {
        test('should show current markup', async () => {
            mockAIClient.getConfig.mockResolvedValueOnce({ price_markup: 1.5 });
            await handler.handleMessage(createMessage('/getmarkup'));
            expect(mockSocket.sendMessage).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ text: expect.stringMatching(/1[.,]5/) })
            );
        });
    });

    describe('/queue', () => {
        test('should show empty queue', async () => {
            await handler.handleMessage(createMessage('/queue'));
            expect(mockSocket.sendMessage).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ text: expect.stringMatching(/Antrian Kosong/i) })
            );
        });
    });

    describe('/supplier', () => {
        test('should report unknown supplier', async () => {
            await handler.handleMessage(createMessage('/supplier invalid'));
            expect(mockSocket.sendMessage).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ text: expect.stringMatching(/Supplier tidak dikenal/i) })
            );
        });
    });

    describe('/status', () => {
        test('should show bot status and stats', async () => {
            mockAIClient.getConfig.mockResolvedValueOnce({ price_markup: 1.5 });
            await handler.handleMessage(createMessage('/status'));
            expect(mockSocket.sendMessage).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ text: expect.stringMatching(/Bot Status/i) })
            );
        });
    });

    describe('/help', () => {
        test('should show help message', async () => {
            await handler.handleMessage(createMessage('/help'));
            expect(mockSocket.sendMessage).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ text: expect.stringContaining('Halo! Aku Ahmari') })
            );
        });
    });

    describe('Access Control', () => {
        test('should ignore commands from non-owner', async () => {
            await handler.handleMessage(createMessage('/status', 'stranger@s.whatsapp.net'));
            expect(mockSocket.sendMessage).not.toHaveBeenCalled();
        });
    });
});

import { MessageHandler } from '../../src/messageHandler';
import { AIClient } from '../../src/aiClient';
import { initStateStore } from '../../src/stateStore';
import { initBroadcastStore } from '../../src/broadcastStore';
import { detectFGBBroadcast } from '../../src/detector';

jest.mock('../../src/aiClient');
jest.mock('../../src/detector');

describe('MessageHandler Bulk Mode', () => {
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

        // Mock detector to recognize broadcasts
        (detectFGBBroadcast as jest.Mock).mockReturnValue({
            isBroadcast: true,
            detectedSupplier: 'fgb',
            text: 'Original broadcast text',
            hasMedia: false
        });
    });

    afterEach(() => {
        handler.destroy();
    });

    const createMessage = (text: string, from: string = 'owner@s.whatsapp.net') => ({
        key: { remoteJid: from, fromMe: false, id: Math.random().toString() },
        message: { conversation: text },
        pushName: 'User'
    } as any);

    test('should complete a full bulk mode lifecycle', async () => {
        // 1. Start bulk mode
        await handler.handleMessage(createMessage('/bulk 2'));
        expect(mockSocket.sendMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ text: expect.stringMatching(/Bulk Mode Aktif/i) })
        );

        // 2. Collect items
        await handler.handleMessage(createMessage('Broadcast Item 1'));
        await handler.handleMessage(createMessage('Broadcast Item 2'));

        expect(mockSocket.sendMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ text: expect.stringMatching(/✓ 1/) })
        );
        expect(mockSocket.sendMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ text: expect.stringMatching(/✓ 2/) })
        );

        // 3. Complete collection (/done)
        mockAIClient.parse.mockResolvedValue({ title: 'Item Title', tags: [], media_count: 0, raw_text: '' } as any);
        mockAIClient.generate.mockResolvedValue({ draft: 'Generated Draft', parsed_data: {} } as any);

        await handler.handleMessage(createMessage('/done'));

        // Expect processing and preview message
        expect(mockSocket.sendMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ text: expect.stringMatching(/Memproses/i) })
        );

        // 4. Select and Send ALL
        await handler.handleMessage(createMessage('all'));

        // Final confirmation and sending
        expect(mockSocket.sendMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ text: expect.stringMatching(/Mengirim/i) })
        );
    });

    test('should cancel bulk mode', async () => {
        await handler.handleMessage(createMessage('/bulk 2'));
        await handler.handleMessage(createMessage('/cancel'));

        expect(mockSocket.sendMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ text: expect.stringMatching(/Pending state cleared/i) })
        );
    });

    test('should handle bulk selection of specific items', async () => {
        await handler.handleMessage(createMessage('/bulk 3'));
        await handler.handleMessage(createMessage('Item 1'));
        await handler.handleMessage(createMessage('Item 2'));

        mockAIClient.parse.mockResolvedValue({ title: 'T', tags: [], media_count: 0, raw_text: '' } as any);
        mockAIClient.generate.mockResolvedValue({ draft: 'D', parsed_data: {} } as any);

        await handler.handleMessage(createMessage('/done'));

        // Select 1
        await handler.handleMessage(createMessage('1'));

        // Should confirm sending selected
        expect(mockSocket.sendMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ text: expect.stringMatching(/Mengirim/i) })
        );
    });
});

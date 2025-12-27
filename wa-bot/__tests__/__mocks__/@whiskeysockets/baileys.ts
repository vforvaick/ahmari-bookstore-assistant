/**
 * Baileys Mock for Testing
 * 
 * Mocks the @whiskeysockets/baileys module to avoid ESM import issues in Jest.
 * This provides minimal stubs for the proto types needed by tests.
 */

// Mock proto types
export const proto = {
    Message: {},
    WebMessageInfo: {},
};

// Mock default export (makeWASocket)
const makeWASocket = jest.fn(() => ({
    ev: {
        on: jest.fn(),
        off: jest.fn(),
        removeAllListeners: jest.fn(),
        emit: jest.fn(),
    },
    sendMessage: jest.fn(),
    groupFetchAllParticipating: jest.fn().mockResolvedValue({}),
    user: { id: 'test-bot@s.whatsapp.net' },
    logout: jest.fn(),
    end: jest.fn(),
}));

export default makeWASocket;

// Named exports that might be used
export const useMultiFileAuthState = jest.fn().mockResolvedValue({
    state: {},
    saveCreds: jest.fn(),
});

export const DisconnectReason = {
    loggedOut: 401,
    connectionClosed: 428,
    connectionLost: 408,
    connectionReplaced: 440,
    timedOut: 408,
    badSession: 500,
    restartRequired: 515,
};

export const fetchLatestBaileysVersion = jest.fn().mockResolvedValue({
    version: [2, 2413, 1],
    isLatest: true,
});

export const makeCacheableSignalKeyStore = jest.fn((keys) => keys);

export const Browsers = {
    ubuntu: (name: string) => [name, 'Chrome', '110.0.0'],
    macOS: (name: string) => [name, 'Safari', '16.0'],
    windows: (name: string) => [name, 'Edge', '110.0.0'],
    appropriate: (name: string) => [name, 'Chrome', '110.0.0'],
};

export const downloadMediaMessage = jest.fn().mockResolvedValue(Buffer.from('mock-media'));

export const generateWAMessageFromContent = jest.fn();
export const generateWAMessage = jest.fn();
export const getContentType = jest.fn();
export const jidNormalizedUser = jest.fn((jid) => jid);
export const areJidsSameUser = jest.fn((jid1, jid2) => jid1 === jid2);

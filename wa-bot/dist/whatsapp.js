"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppClient = void 0;
const pino_1 = __importDefault(require("pino"));
const qrcode_terminal_1 = __importDefault(require("qrcode-terminal"));
const path_1 = __importDefault(require("path"));
const messageHandler_1 = require("./messageHandler");
const baileysLoader_1 = require("./baileysLoader");
const healthServer_1 = require("./healthServer");
const logger = (0, pino_1.default)({ level: process.env.LOG_LEVEL || 'info' });
class WhatsAppClient {
    constructor(sessionsPath = './sessions') {
        this.sock = null;
        this.messageHandler = null;
        this.isConnected = false;
        // Store handler config for rebinding after reconnection
        this.handlerConfig = null;
        // Flag to distinguish initial connection from reconnection
        this.hasInitiallyConnected = false;
        this.sessionsPath = sessionsPath;
    }
    async connect() {
        const baileys = await (0, baileysLoader_1.loadBaileys)();
        const { version } = await baileys.fetchLatestBaileysVersion();
        // Use SQLite-based auth state for better reliability
        const { useSqliteAuthState } = await Promise.resolve().then(() => __importStar(require('./sqliteAuthState')));
        const { state, saveCreds } = await useSqliteAuthState(path_1.default.resolve(this.sessionsPath, 'session.db'));
        this.sock = baileys.default({
            auth: state,
            printQRInTerminal: false, // We'll handle QR display ourselves
            logger: (0, pino_1.default)({ level: process.env.LOG_LEVEL || 'warn' }),
            browser: baileys.Browsers.macOS('Desktop'),
            version,
            // Keep connection alive - ping every 25 seconds
            keepAliveIntervalMs: 25000,
            // Retry delay for failed requests
            retryRequestDelayMs: 2000,
            getMessage: async (key) => {
                // Retrieve message from store if needed
                return { conversation: '' };
            },
        });
        // Handle credentials update
        this.sock.ev.on('creds.update', saveCreds);
        // Handle connection updates
        this.sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            // Display QR code
            if (qr) {
                logger.info('QR Code received, scan to authenticate:');
                qrcode_terminal_1.default.generate(qr, { small: true });
            }
            // Handle connection states
            if (connection === 'close') {
                this.isConnected = false;
                (0, healthServer_1.notifyDisconnected)();
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !==
                    baileys.DisconnectReason.loggedOut;
                logger.warn('Connection closed:', lastDisconnect?.error);
                if (shouldReconnect) {
                    logger.info('Reconnecting...');
                    await this.connect();
                }
                else {
                    logger.error('Logged out, please delete sessions and restart');
                    process.exit(1);
                }
            }
            else if (connection === 'open') {
                this.isConnected = true;
                (0, healthServer_1.notifyConnected)();
                logger.info('✓ WhatsApp connection established');
                // Only rebind on RECONNECTION (not initial connection)
                // Initial binding is done in setupMessageHandler()
                if (this.hasInitiallyConnected && this.handlerConfig && this.messageHandler) {
                    logger.info('Rebinding message handler to new socket...');
                    this.bindMessageListener();
                    logger.info('✓ Message handler rebound successfully');
                }
                // Mark that we've connected at least once
                this.hasInitiallyConnected = true;
            }
        });
        return this.sock;
    }
    getSocket() {
        return this.sock;
    }
    async disconnect() {
        if (this.sock) {
            await this.sock.logout();
            this.sock = null;
        }
    }
    setupMessageHandler(ownerJids, aiClient, mediaPath = './media') {
        if (!this.sock) {
            throw new Error('Socket not connected');
        }
        // Accept both single string or array of owner JIDs
        const owners = Array.isArray(ownerJids) ? ownerJids : [ownerJids];
        // Store config for rebinding after reconnection
        this.handlerConfig = {
            ownerJids: owners,
            aiClient,
            mediaPath
        };
        // Create message handler with current socket
        this.messageHandler = new messageHandler_1.MessageHandler(this.sock, owners, aiClient, mediaPath);
        // Bind the message listener
        this.bindMessageListener();
    }
    /**
     * Bind message listener to current socket.
     * Called during initial setup and after reconnection.
     */
    bindMessageListener() {
        if (!this.sock || !this.messageHandler) {
            logger.warn('Cannot bind message listener: socket or handler not ready');
            return;
        }
        // Listen for messages with error handling
        this.sock.ev.on('messages.upsert', async ({ messages }) => {
            for (const message of messages) {
                try {
                    const remoteJid = message.key.remoteJid || '';
                    // Log incoming message for debugging
                    logger.info({
                        fromMe: message.key.fromMe,
                        remoteJid: remoteJid,
                        pushName: message.pushName
                    }, 'Incoming message event');
                    // Skip ALL messages from self (fromMe = true)
                    if (message.key.fromMe) {
                        logger.debug(`Skipping fromMe message: ${remoteJid}`);
                        continue;
                    }
                    // Handle message with error protection
                    await this.messageHandler.handleMessage(message);
                }
                catch (error) {
                    logger.error({ error, messageId: message.key.id }, 'Error processing message');
                }
            }
        });
    }
}
exports.WhatsAppClient = WhatsAppClient;

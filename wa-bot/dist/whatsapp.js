"use strict";
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
const logger = (0, pino_1.default)({ level: 'info' });
class WhatsAppClient {
    constructor(sessionsPath = './sessions') {
        this.sock = null;
        this.messageHandler = null;
        this.sessionsPath = sessionsPath;
    }
    async connect() {
        const baileys = await (0, baileysLoader_1.loadBaileys)();
        const { version } = await baileys.fetchLatestBaileysVersion();
        const { state, saveCreds } = await baileys.useMultiFileAuthState(path_1.default.resolve(this.sessionsPath));
        this.sock = baileys.default({
            auth: state,
            printQRInTerminal: false, // We'll handle QR display ourselves
            logger: (0, pino_1.default)({ level: 'warn' }),
            browser: baileys.Browsers.macOS('Desktop'),
            version,
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
                logger.info('✓ WhatsApp connection established');
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
    setupMessageHandler(ownerJid, aiClient, mediaPath = './media') {
        if (!this.sock) {
            throw new Error('Socket not connected');
        }
        this.messageHandler = new messageHandler_1.MessageHandler(this.sock, ownerJid, aiClient, mediaPath);
        // Listen for messages
        this.sock.ev.on('messages.upsert', async ({ messages }) => {
            for (const message of messages) {
                // Ignore messages from self
                if (message.key.fromMe)
                    continue;
                // Handle message
                await this.messageHandler.handleMessage(message);
            }
        });
    }
}
exports.WhatsAppClient = WhatsAppClient;

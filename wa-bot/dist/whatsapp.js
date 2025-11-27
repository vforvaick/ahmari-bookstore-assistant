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
const baileys_1 = __importStar(require("@whiskeysockets/baileys"));
const pino_1 = __importDefault(require("pino"));
const qrcode_terminal_1 = __importDefault(require("qrcode-terminal"));
const path_1 = __importDefault(require("path"));
const messageHandler_1 = require("./messageHandler");
const logger = (0, pino_1.default)({ level: 'info' });
class WhatsAppClient {
    constructor(sessionsPath = './sessions') {
        this.sock = null;
        this.messageHandler = null;
        this.sessionsPath = sessionsPath;
    }
    async connect() {
        const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)(path_1.default.resolve(this.sessionsPath));
        this.sock = (0, baileys_1.default)({
            auth: state,
            printQRInTerminal: false, // We'll handle QR display ourselves
            logger: (0, pino_1.default)({ level: 'warn' }),
            browser: baileys_1.Browsers.macOS('Desktop'),
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
                    baileys_1.DisconnectReason.loggedOut;
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
    setupMessageHandler(ownerJid, mediaPath = './media') {
        if (!this.sock) {
            throw new Error('Socket not connected');
        }
        this.messageHandler = new messageHandler_1.MessageHandler(this.sock, ownerJid, mediaPath);
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

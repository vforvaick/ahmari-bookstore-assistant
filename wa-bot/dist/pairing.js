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
const dotenv_1 = require("dotenv");
const baileys_1 = __importStar(require("@whiskeysockets/baileys"));
const pino_1 = __importDefault(require("pino"));
const qrcode_terminal_1 = __importDefault(require("qrcode-terminal"));
const path_1 = __importDefault(require("path"));
(0, dotenv_1.config)();
const logger = (0, pino_1.default)({ level: 'info' });
async function main() {
    const sessionsPath = path_1.default.resolve('./sessions');
    const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)(sessionsPath);
    const { version } = await (0, baileys_1.fetchLatestBaileysVersion)();
    const sock = (0, baileys_1.default)({
        auth: state,
        printQRInTerminal: false,
        logger: (0, pino_1.default)({ level: 'warn' }),
        browser: baileys_1.Browsers.macOS('Desktop'),
        version,
        getMessage: async () => ({ conversation: '' }),
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            logger.info('QR code received (fallback). If pairing code fails, scan this:');
            qrcode_terminal_1.default.generate(qr, { small: true });
        }
        if (connection === 'open') {
            logger.info('✓ WhatsApp connection established');
            process.exit(0);
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !==
                baileys_1.DisconnectReason.loggedOut;
            logger.warn('Connection closed:', lastDisconnect?.error);
            if (shouldReconnect) {
                logger.info('Reconnecting...');
                await main();
            }
            else {
                logger.error('Logged out. Delete sessions folder to re-pair.');
                process.exit(1);
            }
        }
    });
    // If already paired, bail out early
    if (state.creds.registered) {
        logger.info('Already registered. Delete sessions to re-pair.');
        process.exit(0);
    }
    const phoneFromJid = (process.env.OWNER_JID || '').split('@')[0];
    const pairingPhone = process.env.PAIRING_PHONE || phoneFromJid;
    if (!pairingPhone) {
        throw new Error('Set PAIRING_PHONE env (MSISDN digits, no + or spaces). Example: 6285121080846');
    }
    logger.info(`Requesting pairing code for ${pairingPhone}. Open WhatsApp → Linked devices → Link with phone number, then enter this code:`);
    const code = await sock.requestPairingCode(pairingPhone);
    logger.info(`Pairing code: ${code}`);
    logger.info('Waiting for device to connect...');
}
main().catch((error) => {
    logger.error('Failed to generate pairing code:', error);
    process.exit(1);
});

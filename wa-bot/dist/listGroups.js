"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const pino_1 = __importDefault(require("pino"));
const qrcode_terminal_1 = __importDefault(require("qrcode-terminal"));
const path_1 = __importDefault(require("path"));
const baileysLoader_1 = require("./baileysLoader");
(0, dotenv_1.config)();
const logger = (0, pino_1.default)({ level: 'info' });
async function main() {
    const sessionsPath = path_1.default.resolve('./sessions');
    const baileys = await (0, baileysLoader_1.loadBaileys)();
    const { state, saveCreds } = await baileys.useMultiFileAuthState(sessionsPath);
    const { version } = await baileys.fetchLatestBaileysVersion();
    const sock = baileys.default({
        auth: state,
        printQRInTerminal: false,
        logger: (0, pino_1.default)({ level: 'warn' }),
        browser: baileys.Browsers.macOS('Desktop'),
        version,
        getMessage: async () => ({ conversation: '' }),
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            logger.info('QR code received. Scan to authenticate:');
            qrcode_terminal_1.default.generate(qr, { small: true });
        }
        if (connection === 'open') {
            logger.info('✓ Connected. Fetching groups...');
            const groups = await sock.groupFetchAllParticipating();
            const groupList = Object.values(groups);
            logger.info(`Found ${groupList.length} groups:`);
            logger.info('─'.repeat(80));
            groupList.forEach((group) => {
                logger.info(`Name : ${group.subject}`);
                logger.info(`JID  : ${group.id}`);
                logger.info(`Member count: ${group.participants?.length ?? 0}`);
                logger.info('─'.repeat(80));
            });
            process.exit(0);
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !==
                baileys.DisconnectReason.loggedOut;
            logger.warn('Connection closed:', lastDisconnect?.error);
            if (shouldReconnect) {
                logger.info('Reconnecting...');
                await main();
            }
            else {
                logger.error('Logged out. Delete sessions folder to re-login.');
                process.exit(1);
            }
        }
    });
}
main().catch((error) => {
    logger.error('Failed to list groups:', error);
    process.exit(1);
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const pino_1 = __importDefault(require("pino"));
const whatsapp_1 = require("./whatsapp");
const path_1 = __importDefault(require("path"));
(0, dotenv_1.config)();
const logger = (0, pino_1.default)({ level: 'info' });
async function main() {
    logger.info('WhatsApp Bot starting...');
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`AI Processor URL: ${process.env.AI_PROCESSOR_URL || 'not set'}`);
    // Initialize WhatsApp client
    const sessionsPath = path_1.default.resolve('./sessions');
    const waClient = new whatsapp_1.WhatsAppClient(sessionsPath);
    try {
        const sock = await waClient.connect();
        logger.info('WhatsApp client initialized');
        // Keep process running
        process.on('SIGINT', async () => {
            logger.info('Shutting down...');
            await waClient.disconnect();
            process.exit(0);
        });
    }
    catch (error) {
        logger.error('Failed to connect to WhatsApp:', error);
        process.exit(1);
    }
}
main().catch((error) => {
    console.error('Failed to start bot:', error);
    process.exit(1);
});

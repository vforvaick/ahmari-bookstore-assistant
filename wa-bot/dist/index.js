"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const pino_1 = __importDefault(require("pino"));
const whatsapp_1 = require("./whatsapp");
const aiClient_1 = require("./aiClient");
const stateStore_1 = require("./stateStore");
const broadcastStore_1 = require("./broadcastStore");
const healthServer_1 = require("./healthServer");
const path_1 = __importDefault(require("path"));
(0, dotenv_1.config)();
const logger = (0, pino_1.default)({ level: 'info' });
async function main() {
    logger.info('WhatsApp Bot starting...');
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`AI Processor URL: ${process.env.AI_PROCESSOR_URL || 'not set'}`);
    // Initialize AI Processor client
    const aiProcessorUrl = process.env.AI_PROCESSOR_URL || 'http://localhost:8000';
    const aiClient = new aiClient_1.AIClient(aiProcessorUrl);
    // Check AI Processor health
    const isAIHealthy = await aiClient.healthCheck();
    if (!isAIHealthy) {
        logger.warn('AI Processor is not healthy, but continuing...');
    }
    else {
        logger.info('✓ AI Processor is healthy');
    }
    // Initialize StateStore for conversation state persistence
    const dbPath = process.env.DATABASE_PATH || path_1.default.resolve('./data/bookstore.db');
    (0, stateStore_1.initStateStore)(dbPath);
    logger.info('✓ StateStore initialized');
    // Initialize BroadcastStore for broadcast history and queue persistence
    (0, broadcastStore_1.initBroadcastStore)(dbPath);
    logger.info('✓ BroadcastStore initialized');
    // Initialize WhatsApp client
    const sessionsPath = path_1.default.resolve('./sessions');
    const waClient = new whatsapp_1.WhatsAppClient(sessionsPath);
    try {
        const sock = await waClient.connect();
        logger.info('WhatsApp client initialized');
        // Setup message handler with multiple owners support
        // Both OWNER_JID and OWNER_LID can be comma-separated for multiple users
        const ownerJids = [
            ...(process.env.OWNER_JID || '').split(',').map(j => j.trim()).filter(Boolean),
            ...(process.env.OWNER_LID || '').split(',').map(j => j.trim()).filter(Boolean),
        ];
        if (ownerJids.length === 0) {
            logger.error('No OWNER_JID or OWNER_LID set in environment');
            process.exit(1);
        }
        logger.info(`Authorized owners: ${ownerJids.length} JIDs configured`);
        waClient.setupMessageHandler(ownerJids, aiClient, path_1.default.resolve('./media'));
        logger.info('Message handler setup complete');
        // Start health server for Docker healthcheck
        (0, healthServer_1.setConnectionGetter)(() => waClient.isConnected);
        (0, healthServer_1.startHealthServer)(3000);
        logger.info('✓ Health server started on port 3000');
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

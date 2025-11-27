"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const pino_1 = __importDefault(require("pino"));
(0, dotenv_1.config)();
const logger = (0, pino_1.default)({ level: 'info' });
async function main() {
    logger.info('WhatsApp Bot starting...');
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`AI Processor URL: ${process.env.AI_PROCESSOR_URL || 'not set'}`);
    // TODO: Initialize WhatsApp connection
    logger.info('Bot initialized successfully');
}
main().catch((error) => {
    console.error('Failed to start bot:', error);
    process.exit(1);
});

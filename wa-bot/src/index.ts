import { config } from 'dotenv';
import pino from 'pino';
import { WhatsAppClient } from './whatsapp';
import path from 'path';

config();

const logger = pino({ level: 'info' });

async function main() {
  logger.info('WhatsApp Bot starting...');
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`AI Processor URL: ${process.env.AI_PROCESSOR_URL || 'not set'}`);

  // Initialize WhatsApp client
  const sessionsPath = path.resolve('./sessions');
  const waClient = new WhatsAppClient(sessionsPath);

  try {
    const sock = await waClient.connect();
    logger.info('WhatsApp client initialized');

    // Keep process running
    process.on('SIGINT', async () => {
      logger.info('Shutting down...');
      await waClient.disconnect();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to connect to WhatsApp:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});

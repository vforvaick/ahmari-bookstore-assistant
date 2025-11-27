import { config } from 'dotenv';
import pino from 'pino';
import { WhatsAppClient } from './whatsapp';
import { AIClient } from './aiClient';
import path from 'path';

config();

const logger = pino({ level: 'info' });

async function main() {
  logger.info('WhatsApp Bot starting...');
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`AI Processor URL: ${process.env.AI_PROCESSOR_URL || 'not set'}`);

  // Initialize AI Processor client
  const aiProcessorUrl = process.env.AI_PROCESSOR_URL || 'http://localhost:8000';
  const aiClient = new AIClient(aiProcessorUrl);

  // Check AI Processor health
  const isAIHealthy = await aiClient.healthCheck();
  if (!isAIHealthy) {
    logger.warn('AI Processor is not healthy, but continuing...');
  } else {
    logger.info('✓ AI Processor is healthy');
  }

  // Initialize WhatsApp client
  const sessionsPath = path.resolve('./sessions');
  const waClient = new WhatsAppClient(sessionsPath);

  try {
    const sock = await waClient.connect();
    logger.info('WhatsApp client initialized');

    // Setup message handler
    const ownerJid = process.env.OWNER_JID || '';
    if (!ownerJid) {
      logger.error('OWNER_JID not set in environment');
      process.exit(1);
    }

    waClient.setupMessageHandler(
      ownerJid,
      aiClient,
      path.resolve('./media')
    );
    logger.info('Message handler setup complete');

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

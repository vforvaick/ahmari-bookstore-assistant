import { config } from 'dotenv';
import pino from 'pino';
import { WhatsAppClient } from './whatsapp';
import { AIClient } from './aiClient';
import { initStateStore } from './stateStore';
import { initBroadcastStore } from './broadcastStore';
import { startHealthServer, setConnectionGetter } from './healthServer';
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

  // Initialize StateStore for conversation state persistence
  const dbPath = process.env.DATABASE_PATH || path.resolve('./data/bookstore.db');
  initStateStore(dbPath);
  logger.info('✓ StateStore initialized');

  // Initialize BroadcastStore for broadcast history and queue persistence
  initBroadcastStore(dbPath);
  logger.info('✓ BroadcastStore initialized');

  // Initialize WhatsApp client
  const sessionsPath = path.resolve('./sessions');
  const waClient = new WhatsAppClient(sessionsPath);

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

    waClient.setupMessageHandler(
      ownerJids,
      aiClient,
      path.resolve('./media')
    );
    logger.info('Message handler setup complete');

    // Start health server for Docker healthcheck
    setConnectionGetter(() => waClient.isConnected);
    startHealthServer(3000);
    logger.info('✓ Health server started on port 3000');

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

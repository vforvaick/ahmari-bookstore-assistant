import { config } from 'dotenv';
import pino from 'pino';

config();

const logger = pino({ level: 'info' });

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

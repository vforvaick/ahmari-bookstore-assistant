import cron from 'node-cron';
import pino from 'pino';
import { config } from 'dotenv';
import Database from 'better-sqlite3';
import path from 'path';

config();

const logger = pino({ level: 'info' });

const QUEUE_INTERVAL_MINUTES = parseInt(
  process.env.QUEUE_INTERVAL_MINUTES || '47',
  10
);

interface QueuedBroadcast {
  id: number;
  broadcast_id: number;
  title: string;
  status: string;
  scheduled_time: string;
  media_paths?: string; // JSON string
  description_id?: string;
}

class QueueScheduler {
  private db: Database.Database;
  private lastSentTime: Date | null = null;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    logger.info(`Scheduler connected to database: ${dbPath}`);
  }

  start() {
    logger.info(
      `Starting scheduler with ${QUEUE_INTERVAL_MINUTES} minute interval`
    );

    // Check queue every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      await this.processQueue();
    });

    logger.info('Scheduler started, checking queue every 5 minutes');
  }

  private async processQueue() {
    try {
      const now = new Date();

      // Check if enough time has passed since last send
      if (this.lastSentTime) {
        const minutesSinceLastSend =
          (now.getTime() - this.lastSentTime.getTime()) / 1000 / 60;

        if (minutesSinceLastSend < QUEUE_INTERVAL_MINUTES) {
          logger.debug(
            `Waiting for interval (${minutesSinceLastSend.toFixed(1)}/${QUEUE_INTERVAL_MINUTES} min)`
          );
          return;
        }
      }

      // Get next pending broadcast
      const stmt = this.db.prepare(`
        SELECT q.*, b.*
        FROM queue q
        JOIN broadcasts b ON q.broadcast_id = b.id
        WHERE q.status = 'pending'
        AND q.scheduled_time <= ?
        ORDER BY q.scheduled_time ASC
        LIMIT 1
      `);

      const next = stmt.get(now.toISOString()) as QueuedBroadcast | undefined;

      if (!next) {
        logger.debug('No pending broadcasts in queue');
        return;
      }

      logger.info(`Processing queued broadcast: ${next.title} (ID: ${next.id})`);

      // Trigger Telegram Broadcast
      try {
        let mediaPaths: string[] = [];
        if (next.media_paths) {
          try {
            mediaPaths = JSON.parse(next.media_paths);
          } catch (e) {
            logger.warn('Failed to parse media_paths JSON', e);
          }
        }

        const telegramPayload = {
          text: next.description_id || next.title,
          media: mediaPaths
        };

        logger.info(`Sending to Telegram...`);
        const response = await fetch('http://telegram-bot:3000/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(telegramPayload)
        });

        if (!response.ok) {
          const errText = await response.text();
          logger.error(`Failed to send to Telegram: ${response.status} ${errText}`);
        } else {
          logger.info('✓ Sent to Telegram successfully');
        }
      } catch (error) {
        logger.error('Error calling Telegram Bot service:', error);
      }

      // TODO: Send broadcast to WhatsApp group
      // For now, just mark as sent
      const updateQueue = this.db.prepare(`
        UPDATE queue SET status = 'sent' WHERE id = ?
      `);
      updateQueue.run(next.id);

      const updateBroadcast = this.db.prepare(`
        UPDATE broadcasts SET status = 'sent', sent_at = ? WHERE id = ?
      `);
      updateBroadcast.run(now.toISOString(), next.broadcast_id);

      logger.info(`✓ Broadcast sent: ${next.title}`);
      this.lastSentTime = now;

    } catch (error) {
      logger.error('Error processing queue:', error);
    }
  }

  stop() {
    this.db.close();
    logger.info('Scheduler stopped');
  }
}

// Main
async function main() {
  const dbPath =
    process.env.DATABASE_PATH || path.resolve('../data/bookstore.db');

  const scheduler = new QueueScheduler(dbPath);
  scheduler.start();

  // Graceful shutdown
  process.on('SIGINT', () => {
    logger.info('Shutting down scheduler...');
    scheduler.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Failed to start scheduler:', error);
  process.exit(1);
});

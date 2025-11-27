"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_cron_1 = __importDefault(require("node-cron"));
const pino_1 = __importDefault(require("pino"));
const dotenv_1 = require("dotenv");
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
(0, dotenv_1.config)();
const logger = (0, pino_1.default)({ level: 'info' });
const QUEUE_INTERVAL_MINUTES = parseInt(process.env.QUEUE_INTERVAL_MINUTES || '47', 10);
class QueueScheduler {
    constructor(dbPath) {
        this.lastSentTime = null;
        this.db = new better_sqlite3_1.default(dbPath);
        this.db.pragma('journal_mode = WAL');
        logger.info(`Scheduler connected to database: ${dbPath}`);
    }
    start() {
        logger.info(`Starting scheduler with ${QUEUE_INTERVAL_MINUTES} minute interval`);
        // Check queue every 5 minutes
        node_cron_1.default.schedule('*/5 * * * *', async () => {
            await this.processQueue();
        });
        logger.info('Scheduler started, checking queue every 5 minutes');
    }
    async processQueue() {
        try {
            const now = new Date();
            // Check if enough time has passed since last send
            if (this.lastSentTime) {
                const minutesSinceLastSend = (now.getTime() - this.lastSentTime.getTime()) / 1000 / 60;
                if (minutesSinceLastSend < QUEUE_INTERVAL_MINUTES) {
                    logger.debug(`Waiting for interval (${minutesSinceLastSend.toFixed(1)}/${QUEUE_INTERVAL_MINUTES} min)`);
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
            const next = stmt.get(now.toISOString());
            if (!next) {
                logger.debug('No pending broadcasts in queue');
                return;
            }
            logger.info(`Processing queued broadcast: ${next.title} (ID: ${next.id})`);
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
        }
        catch (error) {
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
    const dbPath = process.env.DATABASE_PATH || path_1.default.resolve('../data/bookstore.db');
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

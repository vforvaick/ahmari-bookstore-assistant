"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BroadcastStore = void 0;
exports.initBroadcastStore = initBroadcastStore;
exports.getBroadcastStore = getBroadcastStore;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const pino_1 = __importDefault(require("pino"));
const fs_1 = require("fs");
const path_1 = require("path");
const logger = (0, pino_1.default)({ level: process.env.LOG_LEVEL || 'info' });
// ==================== BroadcastStore Class ====================
class BroadcastStore {
    constructor(dbPath) {
        // Ensure directory exists
        const dir = (0, path_1.dirname)(dbPath);
        if (!(0, fs_1.existsSync)(dir)) {
            (0, fs_1.mkdirSync)(dir, { recursive: true });
        }
        this.db = new better_sqlite3_1.default(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        // Initialize schema
        this.initSchema();
        // Prepare statements
        this.insertBroadcastStmt = this.db.prepare(`
            INSERT INTO broadcasts (
                title, title_en, price_main, price_secondary, format,
                eta, close_date, type, min_order,
                description_en, description_id, tags, preview_links,
                media_paths, separator_emoji, status
            ) VALUES (
                @title, @title_en, @price_main, @price_secondary, @format,
                @eta, @close_date, @type, @min_order,
                @description_en, @description_id, @tags, @preview_links,
                @media_paths, @separator_emoji, @status
            )
        `);
        this.updateBroadcastStatusStmt = this.db.prepare(`
            UPDATE broadcasts 
            SET status = @status, sent_at = CASE WHEN @status = 'sent' THEN datetime('now') ELSE sent_at END
            WHERE id = @id
        `);
        this.getBroadcastStmt = this.db.prepare(`
            SELECT * FROM broadcasts WHERE id = ?
        `);
        this.getRecentBroadcastsStmt = this.db.prepare(`
            SELECT id, title, format, status, created_at, sent_at
            FROM broadcasts
            ORDER BY created_at DESC
            LIMIT ?
        `);
        this.searchBroadcastsStmt = this.db.prepare(`
            SELECT b.id, b.title, b.format, b.status, b.created_at
            FROM broadcasts_fts fts
            JOIN broadcasts b ON fts.rowid = b.id
            WHERE broadcasts_fts MATCH ?
            ORDER BY rank
            LIMIT 10
        `);
        this.insertQueueStmt = this.db.prepare(`
            INSERT INTO queue (broadcast_id, scheduled_time, status)
            VALUES (@broadcast_id, @scheduled_time, 'pending')
        `);
        this.getPendingQueueStmt = this.db.prepare(`
            SELECT q.*, b.title, b.description_id, b.media_paths
            FROM queue q
            JOIN broadcasts b ON q.broadcast_id = b.id
            WHERE q.status = 'pending' AND q.scheduled_time <= datetime('now')
            ORDER BY q.scheduled_time ASC
            LIMIT 1
        `);
        this.updateQueueStatusStmt = this.db.prepare(`
            UPDATE queue 
            SET status = @status, error_message = @error_message, retry_count = retry_count + @increment_retry
            WHERE id = @id
        `);
        this.getQueueListStmt = this.db.prepare(`
            SELECT q.id, q.scheduled_time, q.status, b.title
            FROM queue q
            JOIN broadcasts b ON q.broadcast_id = b.id
            WHERE q.status = 'pending'
            ORDER BY q.scheduled_time ASC
        `);
        this.deleteQueueItemStmt = this.db.prepare(`
            DELETE FROM queue WHERE id = ?
        `);
        this.clearQueueStmt = this.db.prepare(`
            DELETE FROM queue WHERE status = 'pending'
        `);
        logger.info('BroadcastStore initialized');
    }
    /**
     * Initialize database schema
     */
    initSchema() {
        // Create broadcasts table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS broadcasts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                title_en TEXT,
                price_main INTEGER,
                price_secondary INTEGER,
                format TEXT,
                eta TEXT,
                close_date TEXT,
                type TEXT,
                min_order TEXT,
                description_en TEXT,
                description_id TEXT,
                tags TEXT,
                preview_links TEXT,
                media_paths TEXT,
                separator_emoji TEXT,
                status TEXT DEFAULT 'draft',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                sent_at DATETIME
            );

            CREATE TABLE IF NOT EXISTS queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                broadcast_id INTEGER NOT NULL,
                scheduled_time DATETIME NOT NULL,
                status TEXT DEFAULT 'pending',
                retry_count INTEGER DEFAULT 0,
                error_message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status, scheduled_time);

            CREATE TABLE IF NOT EXISTS style_profile (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                profile_data TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            INSERT OR IGNORE INTO style_profile (id, profile_data) VALUES (1, '{}');
        `);
        // Create FTS5 table (may fail if already exists with different config)
        try {
            this.db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS broadcasts_fts USING fts5(
                    title,
                    description_en,
                    description_id,
                    tags,
                    content=broadcasts,
                    content_rowid=id
                );
            `);
        }
        catch (error) {
            // FTS5 table might already exist with different config
            logger.debug('FTS5 table already exists or creation skipped');
        }
        // Create triggers for FTS sync
        this.db.exec(`
            CREATE TRIGGER IF NOT EXISTS broadcasts_ai AFTER INSERT ON broadcasts BEGIN
                INSERT INTO broadcasts_fts(rowid, title, description_en, description_id, tags)
                VALUES (new.id, new.title, new.description_en, new.description_id, new.tags);
            END;

            CREATE TRIGGER IF NOT EXISTS broadcasts_ad AFTER DELETE ON broadcasts BEGIN
                DELETE FROM broadcasts_fts WHERE rowid = old.id;
            END;

            CREATE TRIGGER IF NOT EXISTS broadcasts_au AFTER UPDATE ON broadcasts BEGIN
                UPDATE broadcasts_fts
                SET title = new.title,
                    description_en = new.description_en,
                    description_id = new.description_id,
                    tags = new.tags
                WHERE rowid = new.id;
            END;
        `);
        logger.debug('Database schema initialized');
    }
    // ==================== Broadcast Methods ====================
    /**
     * Save a broadcast to the database
     * @returns The new broadcast ID
     */
    saveBroadcast(data) {
        const result = this.insertBroadcastStmt.run({
            title: data.title,
            title_en: data.title_en || null,
            price_main: data.price_main || null,
            price_secondary: data.price_secondary || null,
            format: data.format || null,
            eta: data.eta || null,
            close_date: data.close_date || null,
            type: data.type || null,
            min_order: data.min_order || null,
            description_en: data.description_en || null,
            description_id: data.description_id || null,
            tags: data.tags ? JSON.stringify(data.tags) : null,
            preview_links: data.preview_links ? JSON.stringify(data.preview_links) : null,
            media_paths: data.media_paths ? JSON.stringify(data.media_paths) : null,
            separator_emoji: data.separator_emoji || null,
            status: data.status || 'sent',
        });
        const id = result.lastInsertRowid;
        logger.info({ id, title: data.title }, 'Broadcast saved');
        return id;
    }
    /**
     * Update broadcast status
     */
    updateStatus(id, status) {
        this.updateBroadcastStatusStmt.run({ id, status });
        logger.debug({ id, status }, 'Broadcast status updated');
    }
    /**
     * Get a broadcast by ID
     */
    getBroadcast(id) {
        const row = this.getBroadcastStmt.get(id);
        return row || null;
    }
    /**
     * Get recent broadcasts
     */
    getRecentBroadcasts(limit = 5) {
        return this.getRecentBroadcastsStmt.all(limit);
    }
    /**
     * Search broadcasts using FTS5
     */
    searchBroadcasts(query) {
        try {
            // Escape special FTS5 characters and add wildcard
            const safeQuery = query.replace(/['"]/g, '').trim() + '*';
            return this.searchBroadcastsStmt.all(safeQuery);
        }
        catch (error) {
            logger.error({ query, error }, 'FTS5 search error');
            return [];
        }
    }
    // ==================== Queue Methods ====================
    /**
     * Add a broadcast to the queue
     * @returns The queue item ID
     */
    addToQueue(broadcastId, scheduledTime) {
        const result = this.insertQueueStmt.run({
            broadcast_id: broadcastId,
            scheduled_time: scheduledTime.toISOString(),
        });
        const id = result.lastInsertRowid;
        logger.info({ queueId: id, broadcastId, scheduledTime }, 'Added to queue');
        return id;
    }
    /**
     * Get next pending queue item that's ready to send
     */
    getNextPendingItem() {
        const row = this.getPendingQueueStmt.get();
        return row || null;
    }
    /**
     * Mark a queue item as sent
     */
    markQueueItemSent(id) {
        this.updateQueueStatusStmt.run({
            id,
            status: 'sent',
            error_message: null,
            increment_retry: 0,
        });
        logger.info({ queueId: id }, 'Queue item marked as sent');
    }
    /**
     * Mark a queue item as failed
     */
    markQueueItemFailed(id, errorMessage) {
        this.updateQueueStatusStmt.run({
            id,
            status: 'failed',
            error_message: errorMessage,
            increment_retry: 1,
        });
        logger.warn({ queueId: id, error: errorMessage }, 'Queue item marked as failed');
    }
    /**
     * Get all pending queue items (for /queue command)
     */
    getPendingQueue() {
        return this.getQueueListStmt.all();
    }
    /**
     * Delete a specific queue item
     */
    deleteQueueItem(id) {
        this.deleteQueueItemStmt.run(id);
        logger.info({ queueId: id }, 'Queue item deleted');
    }
    /**
     * Clear all pending queue items (for /flush command)
     * @returns Array of cleared items (to send immediately)
     */
    clearPendingQueue() {
        const items = this.getPendingQueue();
        this.clearQueueStmt.run();
        logger.info({ count: items.length }, 'Pending queue cleared');
        return items;
    }
    /**
     * Close database connection
     */
    close() {
        this.db.close();
        logger.info('BroadcastStore closed');
    }
}
exports.BroadcastStore = BroadcastStore;
// ==================== Singleton ====================
let broadcastStoreInstance = null;
/**
 * Initialize the broadcast store
 * Should be called once on startup
 */
function initBroadcastStore(dbPath) {
    if (broadcastStoreInstance) {
        logger.warn('BroadcastStore already initialized, closing existing instance');
        broadcastStoreInstance.close();
    }
    broadcastStoreInstance = new BroadcastStore(dbPath);
}
/**
 * Get the broadcast store instance
 * Throws if not initialized
 */
function getBroadcastStore() {
    if (!broadcastStoreInstance) {
        throw new Error('BroadcastStore not initialized. Call initBroadcastStore() first.');
    }
    return broadcastStoreInstance;
}

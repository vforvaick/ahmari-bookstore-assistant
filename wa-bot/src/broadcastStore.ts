import Database from 'better-sqlite3';
import pino from 'pino';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// ==================== Types ====================

export interface BroadcastData {
    title: string;
    title_en?: string;
    price_main?: number;
    price_secondary?: number;
    format?: string;           // HB, PB, BB
    eta?: string;              // "Apr '26"
    close_date?: string;       // "20 Des"
    type?: string;             // Remainder or Request
    min_order?: string;
    description_en?: string;
    description_id?: string;   // Indonesian translation (the draft)
    tags?: string[];           // ["New Oct", "NETT"]
    preview_links?: string[];
    media_paths?: string[];
    separator_emoji?: string;  // 🌳 or 🦊
    status?: string;           // draft, approved, scheduled, sent
}

export interface BroadcastRecord extends BroadcastData {
    id: number;
    created_at: string;
    sent_at?: string;
}

export interface QueueItem {
    id: number;
    broadcast_id: number;
    scheduled_time: string;
    status: string;            // pending, sent, failed
    retry_count: number;
    error_message?: string;
    created_at: string;
    // Joined from broadcasts table
    title?: string;
    description_id?: string;
    media_paths?: string;
}

// ==================== BroadcastStore Class ====================

class BroadcastStore {
    private db: Database.Database;

    // Prepared statements
    private insertBroadcastStmt: Database.Statement;
    private updateBroadcastStatusStmt: Database.Statement;
    private getBroadcastStmt: Database.Statement;
    private getRecentBroadcastsStmt: Database.Statement;
    private searchBroadcastsStmt: Database.Statement;

    private insertQueueStmt: Database.Statement;
    private getPendingQueueStmt: Database.Statement;
    private updateQueueStatusStmt: Database.Statement;
    private getQueueListStmt: Database.Statement;
    private deleteQueueItemStmt: Database.Statement;
    private clearQueueStmt: Database.Statement;

    constructor(dbPath: string) {
        // Ensure directory exists
        const dir = dirname(dbPath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        this.db = new Database(dbPath);
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
    private initSchema(): void {
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
        } catch (error) {
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
    saveBroadcast(data: BroadcastData): number {
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

        const id = result.lastInsertRowid as number;
        logger.info({ id, title: data.title }, 'Broadcast saved');
        return id;
    }

    /**
     * Update broadcast status
     */
    updateStatus(id: number, status: string): void {
        this.updateBroadcastStatusStmt.run({ id, status });
        logger.debug({ id, status }, 'Broadcast status updated');
    }

    /**
     * Get a broadcast by ID
     */
    getBroadcast(id: number): BroadcastRecord | null {
        const row = this.getBroadcastStmt.get(id) as BroadcastRecord | undefined;
        return row || null;
    }

    /**
     * Get recent broadcasts
     */
    getRecentBroadcasts(limit: number = 5): BroadcastRecord[] {
        return this.getRecentBroadcastsStmt.all(limit) as BroadcastRecord[];
    }

    /**
     * Search broadcasts using FTS5
     */
    searchBroadcasts(query: string): BroadcastRecord[] {
        try {
            // Escape special FTS5 characters and add wildcard
            const safeQuery = query.replace(/['"]/g, '').trim() + '*';
            return this.searchBroadcastsStmt.all(safeQuery) as BroadcastRecord[];
        } catch (error) {
            logger.error({ query, error }, 'FTS5 search error');
            return [];
        }
    }

    // ==================== Queue Methods ====================

    /**
     * Add a broadcast to the queue
     * @returns The queue item ID
     */
    addToQueue(broadcastId: number, scheduledTime: Date): number {
        // Format to YYYY-MM-DD HH:mm:ss for SQLite compatibility
        const sqliteTime = scheduledTime.toISOString().replace('T', ' ').split('.')[0];

        const result = this.insertQueueStmt.run({
            broadcast_id: broadcastId,
            scheduled_time: sqliteTime,
        });
        const id = result.lastInsertRowid as number;
        logger.info({ queueId: id, broadcastId, scheduledTime }, 'Added to queue');
        return id;
    }

    /**
     * Get next pending queue item that's ready to send
     */
    getNextPendingItem(): QueueItem | null {
        const row = this.getPendingQueueStmt.get() as QueueItem | undefined;
        return row || null;
    }

    /**
     * Mark a queue item as sent
     */
    markQueueItemSent(id: number): void {
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
    markQueueItemFailed(id: number, errorMessage: string): void {
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
    getPendingQueue(): QueueItem[] {
        return this.getQueueListStmt.all() as QueueItem[];
    }

    /**
     * Delete a specific queue item
     */
    deleteQueueItem(id: number): void {
        this.deleteQueueItemStmt.run(id);
        logger.info({ queueId: id }, 'Queue item deleted');
    }

    /**
     * Clear all pending queue items (for /flush command)
     * @returns Array of cleared items (to send immediately)
     */
    clearPendingQueue(): QueueItem[] {
        const items = this.getPendingQueue();
        this.clearQueueStmt.run();
        logger.info({ count: items.length }, 'Pending queue cleared');
        return items;
    }

    /**
     * Close database connection
     */
    close(): void {
        this.db.close();
        logger.info('BroadcastStore closed');
    }
}

// ==================== Singleton ====================

let broadcastStoreInstance: BroadcastStore | null = null;

/**
 * Initialize the broadcast store
 * Should be called once on startup
 */
export function initBroadcastStore(dbPath: string): void {
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
export function getBroadcastStore(): BroadcastStore {
    if (!broadcastStoreInstance) {
        throw new Error('BroadcastStore not initialized. Call initBroadcastStore() first.');
    }
    return broadcastStoreInstance;
}

export { BroadcastStore };

import Database from 'better-sqlite3';
import pino from 'pino';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// State types that can be persisted
export type StateType = 'pending' | 'bulk' | 'research' | 'caption';

// Generic state store for conversation flows
// Persists state to SQLite with automatic expiration

interface StateRow {
    user_jid: string;
    state_type: string;
    state_data: string;
    expires_at: string;
    updated_at: string;
}

class StateStore {
    private db: Database.Database;
    private getStmt: Database.Statement;
    private setStmt: Database.Statement;
    private deleteStmt: Database.Statement;
    private deleteAllStmt: Database.Statement;
    private cleanupStmt: Database.Statement;

    constructor(dbPath: string) {
        // Ensure directory exists
        const dir = dirname(dbPath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');

        // Create table if not exists
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_states (
        user_jid TEXT NOT NULL,
        state_type TEXT NOT NULL,
        state_data TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_jid, state_type)
      );
      CREATE INDEX IF NOT EXISTS idx_conversation_states_expires 
        ON conversation_states(expires_at);
    `);

        // Prepared statements for performance
        this.getStmt = this.db.prepare(
            'SELECT state_data FROM conversation_states WHERE user_jid = ? AND state_type = ? AND expires_at > datetime("now")'
        );
        this.setStmt = this.db.prepare(`
      INSERT OR REPLACE INTO conversation_states (user_jid, state_type, state_data, expires_at, updated_at)
      VALUES (?, ?, ?, datetime("now", ? || " minutes"), datetime("now"))
    `);
        this.deleteStmt = this.db.prepare(
            'DELETE FROM conversation_states WHERE user_jid = ? AND state_type = ?'
        );
        this.deleteAllStmt = this.db.prepare(
            'DELETE FROM conversation_states WHERE user_jid = ?'
        );
        this.cleanupStmt = this.db.prepare(
            'DELETE FROM conversation_states WHERE expires_at <= datetime("now")'
        );

        // Cleanup expired states on startup
        const cleaned = this.cleanupExpired();
        if (cleaned > 0) {
            logger.info(`Cleaned up ${cleaned} expired conversation states`);
        }

        logger.info('StateStore initialized');
    }

    /**
     * Get state for a user and type
     * Returns null if not found or expired
     */
    getState<T>(userJid: string, type: StateType): T | null {
        try {
            const row = this.getStmt.get(userJid, type) as { state_data: string } | undefined;
            if (!row) return null;
            return JSON.parse(row.state_data) as T;
        } catch (error) {
            logger.error(`Failed to get state for ${userJid}/${type}:`, error);
            return null;
        }
    }

    /**
     * Set state for a user and type
     * @param ttlMinutes - Time to live in minutes (default 10)
     */
    setState<T>(userJid: string, type: StateType, state: T, ttlMinutes: number = 10): void {
        try {
            const stateJson = JSON.stringify(state);
            this.setStmt.run(userJid, type, stateJson, `+${ttlMinutes}`);
            logger.debug(`State saved: ${userJid}/${type} (TTL: ${ttlMinutes}min)`);
        } catch (error) {
            logger.error(`Failed to set state for ${userJid}/${type}:`, error);
        }
    }

    /**
     * Clear state for a user and type
     */
    clearState(userJid: string, type: StateType): void {
        try {
            this.deleteStmt.run(userJid, type);
            logger.debug(`State cleared: ${userJid}/${type}`);
        } catch (error) {
            logger.error(`Failed to clear state for ${userJid}/${type}:`, error);
        }
    }

    /**
     * Clear all states for a user
     */
    clearAllStates(userJid: string): void {
        try {
            this.deleteAllStmt.run(userJid);
            logger.debug(`All states cleared for: ${userJid}`);
        } catch (error) {
            logger.error(`Failed to clear all states for ${userJid}:`, error);
        }
    }

    /**
     * Cleanup expired states
     * @returns Number of states deleted
     */
    cleanupExpired(): number {
        try {
            const result = this.cleanupStmt.run();
            return result.changes;
        } catch (error) {
            logger.error('Failed to cleanup expired states:', error);
            return 0;
        }
    }

    /**
     * Check if any state exists for a user
     */
    hasAnyState(userJid: string): boolean {
        const types: StateType[] = ['pending', 'bulk', 'research', 'caption'];
        for (const type of types) {
            if (this.getState(userJid, type) !== null) {
                return true;
            }
        }
        return false;
    }

    /**
     * Close database connection
     */
    close(): void {
        this.db.close();
        logger.info('StateStore closed');
    }
}

// Singleton instance
let stateStoreInstance: StateStore | null = null;

/**
 * Initialize the state store
 * Must be called before using getStateStore()
 */
export function initStateStore(dbPath: string): void {
    if (stateStoreInstance) {
        logger.warn('StateStore already initialized, closing existing instance');
        stateStoreInstance.close();
    }
    stateStoreInstance = new StateStore(dbPath);
}

/**
 * Get the state store instance
 * Throws if not initialized
 */
export function getStateStore(): StateStore {
    if (!stateStoreInstance) {
        throw new Error('StateStore not initialized. Call initStateStore() first.');
    }
    return stateStoreInstance;
}

export { StateStore };

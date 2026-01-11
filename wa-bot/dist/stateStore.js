"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateStore = void 0;
exports.initStateStore = initStateStore;
exports.getStateStore = getStateStore;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const pino_1 = __importDefault(require("pino"));
const fs_1 = require("fs");
const path_1 = require("path");
const logger = (0, pino_1.default)({ level: process.env.LOG_LEVEL || 'info' });
class StateStore {
    constructor(dbPath) {
        // Ensure directory exists
        const dir = (0, path_1.dirname)(dbPath);
        if (!(0, fs_1.existsSync)(dir)) {
            (0, fs_1.mkdirSync)(dir, { recursive: true });
        }
        this.db = new better_sqlite3_1.default(dbPath);
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
        this.getStmt = this.db.prepare("SELECT state_data FROM conversation_states WHERE user_jid = ? AND state_type = ? AND expires_at > datetime('now')");
        this.setStmt = this.db.prepare(`
      INSERT OR REPLACE INTO conversation_states (user_jid, state_type, state_data, expires_at, updated_at)
      VALUES (?, ?, ?, datetime('now', ? || ' minutes'), datetime('now'))
    `);
        this.deleteStmt = this.db.prepare('DELETE FROM conversation_states WHERE user_jid = ? AND state_type = ?');
        this.deleteAllStmt = this.db.prepare('DELETE FROM conversation_states WHERE user_jid = ?');
        this.cleanupStmt = this.db.prepare("DELETE FROM conversation_states WHERE expires_at <= datetime('now')");
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
    getState(userJid, type) {
        try {
            const row = this.getStmt.get(userJid, type);
            if (!row)
                return null;
            return JSON.parse(row.state_data);
        }
        catch (error) {
            logger.error(`Failed to get state for ${userJid}/${type}:`, error);
            return null;
        }
    }
    /**
     * Set state for a user and type
     * @param ttlMinutes - Time to live in minutes (default 10)
     */
    setState(userJid, type, state, ttlMinutes = 10) {
        try {
            const stateJson = JSON.stringify(state);
            const ttlParam = ttlMinutes >= 0 ? `+${ttlMinutes}` : `${ttlMinutes}`;
            this.setStmt.run(userJid, type, stateJson, ttlParam);
            logger.debug(`State saved: ${userJid}/${type} (TTL: ${ttlMinutes}min)`);
        }
        catch (error) {
            logger.error(`Failed to set state for ${userJid}/${type}:`, error);
        }
    }
    /**
     * Clear state for a user and type
     */
    clearState(userJid, type) {
        try {
            this.deleteStmt.run(userJid, type);
            logger.debug(`State cleared: ${userJid}/${type}`);
        }
        catch (error) {
            logger.error(`Failed to clear state for ${userJid}/${type}:`, error);
        }
    }
    /**
     * Clear all states for a user
     */
    clearAllStates(userJid) {
        try {
            this.deleteAllStmt.run(userJid);
            logger.debug(`All states cleared for: ${userJid}`);
        }
        catch (error) {
            logger.error(`Failed to clear all states for ${userJid}:`, error);
        }
    }
    /**
     * Cleanup expired states
     * @returns Number of states deleted
     */
    cleanupExpired() {
        try {
            const result = this.cleanupStmt.run();
            return result.changes;
        }
        catch (error) {
            logger.error('Failed to cleanup expired states:', error);
            return 0;
        }
    }
    /**
     * Check if any state exists for a user
     */
    hasAnyState(userJid) {
        const types = ['pending', 'bulk', 'research', 'caption'];
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
    close() {
        this.db.close();
        logger.info('StateStore closed');
    }
}
exports.StateStore = StateStore;
// Singleton instance
let stateStoreInstance = null;
/**
 * Initialize the state store
 * Must be called before using getStateStore()
 */
function initStateStore(dbPath) {
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
function getStateStore() {
    if (!stateStoreInstance) {
        throw new Error('StateStore not initialized. Call initStateStore() first.');
    }
    return stateStoreInstance;
}

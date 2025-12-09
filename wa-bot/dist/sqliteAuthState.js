"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.useSqliteAuthState = useSqliteAuthState;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const baileys_1 = require("@whiskeysockets/baileys");
const fs_1 = require("fs");
const path_1 = require("path");
/**
 * SQLite-based auth state for Baileys
 * Stores authentication credentials and keys in a single SQLite database
 * More reliable than file-based storage, especially in Docker environments
 *
 * @param dbPath - Path to SQLite database file (e.g., './sessions/session.db')
 * @returns AuthenticationState compatible with Baileys makeWASocket
 */
async function useSqliteAuthState(dbPath) {
    // Ensure directory exists
    const dir = (0, path_1.dirname)(dbPath);
    if (!(0, fs_1.existsSync)(dir)) {
        (0, fs_1.mkdirSync)(dir, { recursive: true });
    }
    // Open/create database
    const db = new better_sqlite3_1.default(dbPath);
    // Create table if not exists
    db.exec(`
    CREATE TABLE IF NOT EXISTS wa_auth_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
    // Prepared statements for performance
    const getStmt = db.prepare('SELECT value FROM wa_auth_state WHERE key = ?');
    const setStmt = db.prepare('INSERT OR REPLACE INTO wa_auth_state (key, value) VALUES (?, ?)');
    const deleteStmt = db.prepare('DELETE FROM wa_auth_state WHERE key = ?');
    /**
     * Read data from database
     */
    const readData = (key) => {
        try {
            const row = getStmt.get(key);
            if (!row)
                return null;
            return JSON.parse(row.value, baileys_1.BufferJSON.reviver);
        }
        catch (error) {
            return null;
        }
    };
    /**
     * Write data to database
     */
    const writeData = (key, data) => {
        const value = JSON.stringify(data, baileys_1.BufferJSON.replacer);
        setStmt.run(key, value);
    };
    /**
     * Remove data from database
     */
    const removeData = (key) => {
        deleteStmt.run(key);
    };
    // Load or initialize credentials
    let creds = readData('creds');
    if (!creds) {
        creds = (0, baileys_1.initAuthCreds)();
        writeData('creds', creds);
    }
    // Load or initialize keys
    const keys = {};
    const allKeys = db.prepare('SELECT key FROM wa_auth_state WHERE key LIKE ?').all('key-%');
    for (const row of allKeys) {
        const keyData = readData(row.key);
        if (keyData) {
            keys[row.key.replace('key-', '')] = keyData;
        }
    }
    return {
        state: {
            creds,
            keys: {
                get: (type, ids) => {
                    const result = {};
                    for (const id of ids) {
                        const key = `${type}-${id}`;
                        const value = keys[key];
                        if (value) {
                            result[id] = value;
                        }
                    }
                    return result;
                },
                set: (data) => {
                    for (const category in data) {
                        for (const id in data[category]) {
                            const key = `${category}-${id}`;
                            const value = data[category][id];
                            if (value) {
                                keys[key] = value;
                                writeData(`key-${key}`, value);
                            }
                            else {
                                delete keys[key];
                                removeData(`key-${key}`);
                            }
                        }
                    }
                },
            },
        },
        saveCreds: () => {
            writeData('creds', creds);
        },
    };
}

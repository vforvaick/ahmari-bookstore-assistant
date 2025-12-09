import Database from 'better-sqlite3';
import { AuthenticationState, BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/**
 * SQLite-based auth state for Baileys
 * Stores authentication credentials and keys in a single SQLite database
 * More reliable than file-based storage, especially in Docker environments
 * 
 * @param dbPath - Path to SQLite database file (e.g., './sessions/session.db')
 * @returns AuthenticationState compatible with Baileys makeWASocket
 */
export async function useSqliteAuthState(dbPath: string): Promise<{
    state: AuthenticationState;
    saveCreds: () => void;
}> {
    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    // Open/create database
    const db = new Database(dbPath);

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
    const readData = (key: string): any => {
        try {
            const row = getStmt.get(key) as { value: string } | undefined;
            if (!row) return null;
            return JSON.parse(row.value, BufferJSON.reviver);
        } catch (error) {
            return null;
        }
    };

    /**
     * Write data to database
     */
    const writeData = (key: string, data: any): void => {
        const value = JSON.stringify(data, BufferJSON.replacer);
        setStmt.run(key, value);
    };

    /**
     * Remove data from database
     */
    const removeData = (key: string): void => {
        deleteStmt.run(key);
    };

    // Load or initialize credentials
    let creds: AuthenticationState['creds'] = readData('creds');
    if (!creds) {
        creds = initAuthCreds();
        writeData('creds', creds);
    }

    // Load or initialize keys
    const keys: { [key: string]: any } = {};
    const allKeys = db.prepare('SELECT key FROM wa_auth_state WHERE key LIKE ?').all('key-%') as { key: string }[];

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
                get: (type: string, ids: string[]) => {
                    const result: { [id: string]: any } = {};
                    for (const id of ids) {
                        const key = `${type}-${id}`;
                        const value = keys[key];
                        if (value) {
                            result[id] = value;
                        }
                    }
                    return result;
                },
                set: (data: any) => {
                    for (const category in data) {
                        for (const id in data[category]) {
                            const key = `${category}-${id}`;
                            const value = data[category][id];

                            if (value) {
                                keys[key] = value;
                                writeData(`key-${key}`, value);
                            } else {
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

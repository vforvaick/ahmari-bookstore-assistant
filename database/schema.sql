-- Permanent broadcast storage
CREATE TABLE IF NOT EXISTS broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  title_en TEXT,
  price_main INTEGER,
  price_secondary INTEGER,
  format TEXT,                 -- HB, PB, BB
  eta TEXT,                    -- "Apr '26"
  close_date TEXT,             -- "20 Des"
  type TEXT,                   -- Remainder or Request
  min_order TEXT,
  description_en TEXT,
  description_id TEXT,         -- Indonesian translation
  tags TEXT,                   -- JSON: ["New Oct", "NETT"]
  preview_links TEXT,          -- JSON array
  media_paths TEXT,            -- JSON array
  separator_emoji TEXT,        -- 🌳 or 🦊
  status TEXT DEFAULT 'draft', -- draft, approved, scheduled, sent
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME
);

-- Full-text search index
CREATE VIRTUAL TABLE IF NOT EXISTS broadcasts_fts USING fts5(
  title,
  description_en,
  description_id,
  tags,
  content=broadcasts,
  content_rowid=id
);

-- Triggers to keep FTS in sync
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

-- Queue management
CREATE TABLE IF NOT EXISTS queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  broadcast_id INTEGER NOT NULL,
  scheduled_time DATETIME NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, sent, failed
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status, scheduled_time);

-- Conversation state (for interactive flow)
CREATE TABLE IF NOT EXISTS conversation_state (
  user_id TEXT PRIMARY KEY,
  message_id TEXT,
  status TEXT NOT NULL,        -- awaiting_choice, awaiting_edit, awaiting_edit_confirm
  draft_text TEXT,
  original_text TEXT,
  original_media TEXT,         -- JSON array of media paths
  edited_text TEXT,
  broadcast_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(broadcast_id) REFERENCES broadcasts(id) ON DELETE SET NULL
);

-- Style profile storage
CREATE TABLE IF NOT EXISTS style_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1), -- Only one row
  profile_data TEXT NOT NULL,            -- JSON
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default empty style profile
INSERT OR IGNORE INTO style_profile (id, profile_data) VALUES (1, '{}');

-- WhatsApp Baileys auth state (SQLite-based session)
-- Stores authentication credentials and keys for WhatsApp connection
-- More reliable than file-based storage, especially in Docker environments
CREATE TABLE IF NOT EXISTS wa_auth_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

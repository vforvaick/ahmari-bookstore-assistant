# System Architecture

## Overview
Bot WhatsApp Bookstore is an automated system that receives promotional broadcasts from suppliers (FGB) in English, converts them into Indonesian promotional broadcasts with a personal writing style (dr. Findania) using Google Gemini AI, and sends them to the Ahmari Bookstore WhatsApp group.

## High-Level Architecture

```mermaid
graph TD
    User([User / Istri]) -->|Forward Broadcast| WABot[WA Bot Service]
    WABot -->|Text + Media| AI[AI Processor API]
    AI -->|Parsed Data| Parser[Parser Logic]
    AI -->|Draft| Gemini[Google Gemini AI]
    AI -->|Draft| Gemini[Google Gemini AI]
    AI -->|Draft Response + Level| WABot
    
    WABot -->|Level Selection Request (1/2/3)| User
    User -->|Select Level| WABot
    WABot -->|Request Generation with Level| AI
    
    WABot -->|Approval Request| User
    User -->|YES/EDIT/SCHEDULE| WABot
    
    WABot -->|Save Scheduled| DB[(SQLite Database)]
    
    WABot -->|Available?| AI
    AI -->|Poster Image| WABot
    AI -->|Generate Background| Gemini
    
    WABot -- Queue Poller --> DB
    
    WABot -->|Persist| DB[(SQLite Database)]
    
    WABot -->|Final Broadcast| Group([WhatsApp Group])
```

## Core Components

### 1. WhatsApp Bot Service (Node.js + Baileys)
- **Role**: WhatsApp connection handler, message interception, user interaction, and **Queue Manager**.
- **Responsibilities**:
  - Maintains WhatsApp connection via Baileys.
  - Detects forwarded FGB broadcasts using regex patterns.
  - Handles interactive conversation flow via **Unified Draft System** (YES / SCHEDULE / REGEN / COVER / LINKS).
  - **Broadcast History**: Saves all sent and scheduled broadcasts to SQLite (`broadcastStore.ts`).
  - **Queue Polling**: Checks database every 1 minute for scheduled broadcasts and auto-sends them.
  - **Bulk Mode** (v1.5.0): Collect multiple broadcasts, process together, send with delays or schedule.
  - **Research Mode** (v1.6.0): `/new` command for creating promos from web-researched books.
  - **Poster Mode** (v2.0.0): `/poster` command for creating promotional posters from book covers.
  - Executes final broadcasts to target groups.
  - Manages conversation state (single, bulk, research, and poster modes).

### 2. AI Processor Service (Python + FastAPI)
- **Role**: Logic core for parsing, broadcast generation, and image processing.
- **Responsibilities**:
  - Parses raw broadcast text using **Multi-Supplier System** (FGB & Littlerazy).
  - **Hybrid Approach** (v1.3.0):
    - **Rule-based** (`output_formatter.py`): Price markup, template structure, link cleanup
    - **AI-based** (`gemini_client.py`): Review paragraph generation, publisher guessing
  - **Poster Generator**: ~~Removed (deprecated v2.3.0)~~
  - **Caption Generator (v2.2.0)**:
    - **Core**: `caption_analyzer.py` uses Gemini Vision to "read" posters and book covers.
    - **Auto-Detect Flow**: Automatically triggers when user sends image without text (no command needed).
    - **Dual Mode**: Auto-detects Series (multiple books) vs Single Book.
    - **Flow**: Extract Info → User Config (Price/Format) → AI Copywriting (Levels 1-3).
    - **Models**: `CaptionAnalysisResult`, `CaptionGenerateRequest`.
  - **3-Tier Recommendation System** (v1.4.0):
    - **Level 1 (Standard)**: Informative, soft-sell tone.
    - **Level 2 (Recommended)**: Persuasive, value-driven tone.
    - **Level 3 (Top Pick)**: "Racun Mode", high urgency, includes `⭐ Top Pick Ahmari Bookstore` marker.
  - **Multi-Model Rotation** (v2.2.0):
    - **Strategy**: Rotates `gemini-2.5-flash` → `gemini-2.5-flash-lite` → `gemini-3-flash` per API key to maximize quota.
  - **Advanced Researcher** (v1.8.2):
    - **Flow:** `/new` (search) → Select Book → Details (Price/Format) → Level (1-3) → Draft
    - **Draft Options:** YES / YES DEV / COVER / LINKS / REGEN / EDIT / CANCEL
    - **Feedback Loop:** REGEN option asks for user feedback ("too long", "add info") → AI regenerates with instruction
    - **Publisher Extraction:** Robust 3-layer system (URL domain → Snippet → AI Guess)
  - **Web Research** (v1.6.0, enhanced in v1.8.0):
    - `book_researcher.py`: Google Custom Search API integration for finding book info.
    - `/research` endpoint: Search books by title/query.
    - `/research/generate` endpoint: Generate promo from researched book + user details.
    - `/research/enrich` (v1.8.0): Aggregate descriptions from multiple sources.
    - `/research/search-images` (v1.8.0): Find cover images via Google Image Search.
    - **Display Title Logic**: Automatically extracts publisher from URL and cleans title.
  - Provides REST API endpoints (`/parse`, `/generate`, `/research`, `/config`) for the WA Bot.
  - Runtime configurable price markup via `/config` endpoint.

### 3. Queue Scheduler Service (Node.js)
- **Role**: Legacy / Backup.
- **Status**: Functionality migrated to **WhatsApp Bot Service** (via polling).
- **Responsibilities**:
  - *Deprecated*: Previously handled cron-based queue processing. Now `wa-bot` handles this directly to ensure access to WhatsApp socket.

### 4. Telegram Bot Service ~~(Removed - deprecated v2.3.0)~~
- Previously: Secondary broadcast channel to Telegram.
- Status: Removed to reduce complexity. Was never configured.

## Data Schema (SQLite)

### Broadcasts Table
Permanent storage for all processed broadcasts.
```sql
CREATE TABLE broadcasts (
  id INTEGER PRIMARY KEY,
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
  status TEXT,                 -- approved, scheduled, sent
  created_at DATETIME,
  sent_at DATETIME
);
```

### Queue Table
Manages scheduled jobs.
```sql
CREATE TABLE queue (
  id INTEGER PRIMARY KEY,
  broadcast_id INTEGER,
  scheduled_time DATETIME,
  status TEXT,                 -- pending, sent, failed
  retry_count INTEGER DEFAULT 0,
  FOREIGN KEY(broadcast_id) REFERENCES broadcasts(id)
);
```

### Conversation State
Tracks user interaction flow.
```sql
CREATE TABLE conversation_states (
  user_jid TEXT NOT NULL,
  state_type TEXT NOT NULL,
  state_data TEXT NOT NULL,    -- JSON-serialized state
  expires_at DATETIME NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_jid, state_type)
);
```

### WhatsApp Auth State
Stores Baileys authentication credentials and keys in SQLite for improved reliability.
```sql
CREATE TABLE wa_auth_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL           -- JSON-serialized auth data
);
```

### Full-Text Search
```sql
CREATE VIRTUAL TABLE broadcasts_fts USING fts5(
  title, description_en, description_id, tags
);
```

## Infrastructure
- **Containerization**: All services are Dockerized.
- **Orchestration**: Docker Compose manages the 3 services.
- **Volumes**: Shared volumes for SQLite data, Media files, and WhatsApp sessions.
- **Environment**: Deployed on VPS (Oracle Cloud).

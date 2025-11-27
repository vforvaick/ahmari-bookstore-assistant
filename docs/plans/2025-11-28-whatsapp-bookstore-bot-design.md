# WhatsApp Bookstore Bot - Design Document

**Date:** 2025-11-28
**Project:** Bot WhatsApp untuk otomasi broadcast promosi toko buku Ahmari Bookstore
**Tech Stack:** Node.js + Python FastAPI + Google Gemini + Baileys + SQLite + Docker

---

## Overview

Bot WhatsApp yang menerima broadcast promosi dari supplier (FGB) dalam bahasa Inggris, lalu mengkonversinya menjadi broadcast promosi dalam bahasa Indonesia dengan gaya penulisan personal istri (dr. Findania), dan mengirimkannya ke grup WhatsApp toko buku.

**Key Features:**
- Parsing flexible untuk berbagai format broadcast FGB
- Style rewriting menggunakan Gemini AI (rule-based parsing + LLM style)
- Interactive approval flow (YES / EDIT DULU / SCHEDULE)
- Queue scheduler untuk broadcast terjadwal (interval 47 menit)
- Permanent storage dengan semantic search capability
- Fully containerized dengan Docker

---

## Business Flow

1. **Input:** User/istri forward broadcast dari FGB (text + media) ke bot
2. **Processing:** Bot parse data → Gemini rewrite style → generate draft
3. **Approval:** Bot kirim draft + media ke user dengan pilihan:
   - **YES** → langsung kirim ke grup Ahmari Bookstore
   - **EDIT DULU** → user edit manual → bot re-generate → approve lagi
   - **SCHEDULE** → masuk antrian, kirim otomatis setiap 47 menit
4. **Storage:** Broadcast yang approved disimpan permanen untuk future search
5. **Delivery:** Bot kirim final broadcast + media ke grup

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    VPS Oracle (Docker)                   │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────────┐      ┌──────────────────┐         │
│  │  WA Bot Service  │◄────►│ AI Processor API │         │
│  │   (Node.js)      │      │  (Python FastAPI)│         │
│  │   - Baileys      │      │  - Parser        │         │
│  │   - State Mgmt   │      │  - Gemini API    │         │
│  └────────┬─────────┘      └──────────────────┘         │
│           │                                              │
│           ▼                                              │
│  ┌──────────────────┐      ┌──────────────────┐         │
│  │ Queue Scheduler  │◄────►│  SQLite Database │         │
│  │   (Node.js)      │      │  - Queue table   │         │
│  │   - Cron jobs    │      │  - State table   │         │
│  └──────────────────┘      │  - Broadcasts    │         │
│                            │  - Style profile │         │
│                            └──────────────────┘         │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

### Service Communication
- **WA Bot ↔ AI Processor:** HTTP REST API
- **WA Bot ↔ Queue Scheduler:** Shared SQLite database
- **All services:** Share volumes untuk sessions, data, dan media

---

## Service Details

### 1. WhatsApp Bot Service (Node.js + TypeScript)

**Tech Stack:** Baileys, TypeScript, Express

**Responsibilities:**
- Maintain WhatsApp connection & authentication
- Detect forwarded FGB broadcasts (pattern matching)
- Send text+media ke AI Processor
- Handle interactive conversation (YES/EDIT/SCHEDULE)
- Execute final broadcast ke grup
- Manage conversation state

**Message Detection:**
```typescript
function isFGBBroadcast(msg) {
  const patterns = [
    /Remainder\s*\|\s*ETA/i,
    /Request\s*\|\s*ETA/i,
    /Min\.\s*\d+\s*pcs/i,
    /NETT PRICE/i,
    /(🌳{2,}|🦊{2,})/
  ];
  return patterns.some(p => p.test(msg.text)) && msg.hasMedia;
}
```

**Conversation Flow:**
```
Forward FGB → Save media → Parse → AI generate draft
  → Send draft to user → Wait response

User: "YES"
  → Send to grup → Save to DB → Done

User: "EDIT DULU"
  → Instruksi edit → Wait edited text
  → User send edit → User: "OK"
  → Re-generate → Confirm → Done

User: "SCHEDULE"
  → Add to queue → Confirm position → Done
```

---

### 2. AI Processor Service (Python + FastAPI)

**Tech Stack:** FastAPI, Google Gemini API, Pydantic, PyYAML

**Responsibilities:**
- Parse FGB broadcast dengan flexible rules (YAML-based)
- Extract style patterns dari chat history
- Generate broadcast dengan Gemini
- Configurable skip rules untuk parsing

**API Endpoints:**
```python
POST /parse
  → Input: {text, media_count}
  → Output: {parsed_data}

POST /generate
  → Input: {parsed_data, user_edit?}
  → Output: {draft}

POST /extract-style
  → Input: chat_file (WhatsApp export)
  → Output: {style_profile}
```

**Flexible Parser (YAML Config):**
```yaml
patterns:
  type:
    - regex: "(Remainder|Request)\\s*\\|\\s*ETA"
  title:
    - regex: "\\*([^*]+)\\*\\s*\\((HB|PB|BB)\\)"
  price:
    - regex: "🏷️\\s*Rp\\s*([0-9.,]+)"
  tags:
    - regex: "_New (Oct|Sept|Nov)_\\s*🔥"
  separator:
    - regex: "(🌳{2,}|🦊{2,})"

skip_rules:
  - field: "preview_links"
    enabled: false  # Set true to skip
```

**Style Profile (extracted dari chat):**
```json
{
  "greetings": ["Halooo moms!", "Ada buku bagus nih!"],
  "emoji_usage": {
    "frequency": "medium",
    "common": ["😍", "🤩", "😆", "bgtt", "yahh"]
  },
  "tone": "friendly_informative",
  "casual_words": {
    "very": ["bgtt", "bingits", "banget nih"],
    "beautiful": ["cakepp", "cantik bgtt"],
    "cheap": ["murmer", "murah jugaa"]
  },
  "structure_preference": {
    "conversational_intro": true,
    "emoji_before_price": true
  }
}
```

**Gemini Prompt Strategy:**
- Temperature: 0.7 (slight randomness untuk variety)
- Context: parsed data + style guide + user edit (if any)
- Output format: structured info + conversational tone
- Instruction: "selow tapi serius dan insightful"

---

### 3. Queue Scheduler Service (Node.js)

**Tech Stack:** Node.js, node-cron, SQLite

**Responsibilities:**
- Process scheduled broadcasts dari queue
- Send broadcasts setiap 47 menit (interval anti-spam)
- Update queue status
- Handle failures & retries

**Cron Logic:**
```javascript
// Check queue setiap 5 menit
cron.schedule('*/5 * * * *', async () => {
  const now = new Date();
  const pending = await getNextScheduledBroadcast(now);

  if (pending && canSendNow(lastSentTime, 47)) {
    await sendBroadcast(pending);
    lastSentTime = now;
  }
});
```

---

## Database Schema

```sql
-- Permanent broadcast storage
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

-- Full-text search
CREATE VIRTUAL TABLE broadcasts_fts USING fts5(
  title, description_en, description_id, tags
);

-- Queue management
CREATE TABLE queue (
  id INTEGER PRIMARY KEY,
  broadcast_id INTEGER,
  scheduled_time DATETIME,
  status TEXT,                 -- pending, sent, failed
  retry_count INTEGER DEFAULT 0,
  FOREIGN KEY(broadcast_id) REFERENCES broadcasts(id)
);

-- Conversation state (in-memory + DB backup)
CREATE TABLE conversation_state (
  user_id TEXT PRIMARY KEY,
  message_id TEXT,
  status TEXT,                 -- awaiting_choice, awaiting_edit
  draft_text TEXT,
  original_media TEXT,         -- JSON array
  edited_text TEXT,
  created_at DATETIME
);

-- Style profile storage
CREATE TABLE style_profile (
  id INTEGER PRIMARY KEY,
  profile_data TEXT,           -- JSON
  updated_at DATETIME
);
```

---

## Docker Compose Structure

```yaml
version: '3.8'

services:
  wa-bot:
    build: ./wa-bot
    container_name: bookstore-wa-bot
    environment:
      - NODE_ENV=production
      - AI_PROCESSOR_URL=http://ai-processor:8000
    volumes:
      - wa-sessions:/app/sessions
      - sqlite-data:/app/data
      - media:/app/media
    restart: unless-stopped
    depends_on:
      - ai-processor

  ai-processor:
    build: ./ai-processor
    container_name: bookstore-ai-processor
    environment:
      - GEMINI_API_KEY=${GEMINI_API_KEY}
    volumes:
      - sqlite-data:/app/data
      - ./config:/app/config
    ports:
      - "8000:8000"
    restart: unless-stopped

  scheduler:
    build: ./scheduler
    container_name: bookstore-scheduler
    volumes:
      - sqlite-data:/app/data
      - media:/app/media
    restart: unless-stopped
    depends_on:
      - wa-bot

volumes:
  wa-sessions:
  sqlite-data:
  media:
```

---

## FGB Broadcast Format Variations

**Observed patterns dari contoh:**

1. **Type variants:**
   - `Remainder | ETA : Apr '26`
   - `Request | ETA : Apr '26`

2. **Price variants:**
   - `🏷️ Rp 115.000`
   - `🏷️ HB - Rp 245.000 / PB - Rp 160.000`

3. **Order variants:**
   - `*Min. 3 pcs per title. off 10%`
   - `**OR Min. 16 pcs mix title. off 10%`
   - `*NETT PRICE`

4. **Separator variants:**
   - `🌳🌳🌳` (untuk Remainder)
   - `🦊🦊🦊` (untuk Request)

5. **Tags:**
   - `_New Oct_ 🔥`
   - `_New Sept_ 🔥`
   - Format indicators: `(HB)`, `(PB)`, `(BB)`

6. **Preview links:**
   - Instagram posts
   - Amazon links
   - Multiple links possible

**Parser harus handle semua variasi ini dengan flexible YAML config.**

---

## Style Guidelines (from Chat Analysis)

**Tone:** "Selow tapi serius dan insightful"

**Characteristics:**
- Friendly & conversational
- Informative (usia cocok, manfaat buku, detail)
- Casual Indonesian ("bgtt", "yahh", "gausa", "murmer")
- Moderate emoji usage (😍🤩😆)
- Personal touch (kadang mention pengalaman pribadi)

**Example transformations:**

**FGB (English):**
```
*Brown Bear Goes to the Museum* (HB)
🏷️ Rp 115.000
Min. 3 pcs per title. off 10%

Follow Brown Bear and his friends as they explore
all of the different rooms - from the transport
section to the art gallery...
```

**Generated (Indonesian, with style):**
```
Ada buku lucu nih! 🤩

📚 *Brown Bear Goes to the Museum* (HB)
💰 Rp 115.000 (min 3pcs disc 10%)

Ceritanya tentang Brown Bear dan teman-temannya
yang explore museum - dari ruang transportasi
sampai galeri seni. Bagus untukkenalan sama
museum sejak kecil!

ETA: Apr '26 | Close: 20 Des
```

---

## Volume & Cost Estimation

**Expected Volume:**
- Normal: 1-5 broadcasts/day
- Sale period: 5-20 broadcasts/day

**Gemini API Cost:**
- ~500 tokens per broadcast (input + output)
- Gemini 1.5 Flash: ~$0.001-0.005 per broadcast
- Monthly: ~$5-15 (normal), ~$15-50 (sale period)

**Infrastructure:**
- VPS: Oracle Cloud (existing)
- Storage: SQLite (cukup untuk volume ini)

---

## Next Steps

1. **Setup project structure** (separate folders: wa-bot, ai-processor, scheduler)
2. **Extract style profile** dari chat history WhatsApp yang sudah di-export
3. **Build flexible parser** dengan YAML config
4. **Implement WhatsApp bot** dengan Baileys
5. **Build AI Processor API** dengan FastAPI + Gemini
6. **Setup Docker Compose** untuk deployment
7. **Test end-to-end** dengan real FGB broadcasts
8. **Deploy ke VPS Oracle** dalam isolated environment

---

## Configuration Files Needed

1. `config/parser-rules.yaml` - Parsing rules untuk FGB format
2. `config/style-profile.json` - Extracted style dari chat
3. `.env` - Environment variables (Gemini API key, etc)
4. `docker-compose.yml` - Container orchestration

---

## Future Enhancements

- **Semantic search** untuk broadcast archive (vector embeddings)
- **Analytics dashboard** untuk track performance
- **Multi-supplier support** (tidak hanya FGB)
- **A/B testing** untuk different broadcast styles
- **Auto-response** untuk customer inquiries di grup

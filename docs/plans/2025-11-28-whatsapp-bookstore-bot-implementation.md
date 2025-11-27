# WhatsApp Bookstore Bot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a WhatsApp bot that converts English FGB book promotions to Indonesian broadcasts with personalized writing style, supporting interactive approval workflow (YES/EDIT/SCHEDULE) and permanent storage.

**Architecture:** Microservices (WA Bot + AI Processor + Queue Scheduler) communicating via HTTP REST and shared SQLite database, all containerized with Docker Compose.

**Tech Stack:** Node.js + TypeScript (WA Bot, Scheduler), Python FastAPI (AI Processor), Baileys (WhatsApp), Google Gemini 1.5 Flash, SQLite with FTS5, Docker Compose

---

## Task 1: Project Structure Setup

**Files:**
- Create: `package.json` (root)
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `README.md`

**Step 1: Create root package.json**

```json
{
  "name": "bot-wa-bookstore",
  "version": "1.0.0",
  "description": "WhatsApp bot for Ahmari Bookstore broadcast automation",
  "private": true,
  "workspaces": [
    "wa-bot",
    "scheduler"
  ],
  "scripts": {
    "docker:build": "docker-compose build",
    "docker:up": "docker-compose up -d",
    "docker:down": "docker-compose down",
    "docker:logs": "docker-compose logs -f"
  },
  "keywords": ["whatsapp", "bot", "bookstore", "automation"],
  "license": "MIT"
}
```

**Step 2: Create .gitignore**

```
# Dependencies
node_modules/
__pycache__/
*.pyc
.venv/
venv/

# Environment
.env
*.env.local

# Database
*.db
*.db-shm
*.db-wal

# WhatsApp sessions
wa-sessions/
sessions/

# Media files
media/
temp/

# Logs
*.log
logs/

# OS
.DS_Store
Thumbs.db

# Docker
.docker-data/

# IDE
.vscode/
.idea/
*.swp
```

**Step 3: Create .env.example**

```
# Gemini API
GEMINI_API_KEY=your_gemini_api_key_here

# WhatsApp Bot
WA_BOT_PHONE=your_phone_number
TARGET_GROUP_JID=group_jid_here
OWNER_JID=owner_phone_jid_here

# AI Processor
AI_PROCESSOR_URL=http://ai-processor:8000

# Database
DATABASE_PATH=/app/data/bookstore.db

# Queue
QUEUE_INTERVAL_MINUTES=47

# Environment
NODE_ENV=production
```

**Step 4: Create basic README**

```markdown
# Bot WhatsApp Bookstore - Ahmari Bookstore

WhatsApp bot untuk otomasi broadcast promosi buku dengan AI style rewriting.

## Services

- **wa-bot**: WhatsApp connection & conversation handler (Node.js + Baileys)
- **ai-processor**: Parsing & AI style generation (Python FastAPI + Gemini)
- **scheduler**: Queue scheduler untuk broadcast terjadwal (Node.js)

## Quick Start

1. Copy `.env.example` to `.env` and fill in API keys
2. Build: `npm run docker:build`
3. Start: `npm run docker:up`
4. Logs: `npm run docker:logs`

## Architecture

See `docs/plans/2025-11-28-whatsapp-bookstore-bot-design.md`
```

**Step 5: Commit project structure**

```bash
git add .
git commit -m "chore: initialize project structure with Docker setup"
```

---

## Task 2: Database Schema Setup

**Files:**
- Create: `database/schema.sql`
- Create: `database/init.js`

**Step 1: Create database schema file**

File: `database/schema.sql`

```sql
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
```

**Step 2: Create database initialization script**

File: `database/init.js`

```javascript
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

async function initDatabase(dbPath) {
  const schema = fs.readFileSync(
    path.join(__dirname, 'schema.sql'),
    'utf-8'
  );

  const db = new sqlite3.Database(dbPath);

  return new Promise((resolve, reject) => {
    db.exec(schema, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log('✓ Database initialized successfully');
        db.close();
        resolve();
      }
    });
  });
}

module.exports = { initDatabase };

// Run if called directly
if (require.main === module) {
  const dbPath = process.env.DATABASE_PATH || './data/bookstore.db';
  const dir = path.dirname(dbPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  initDatabase(dbPath)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Failed to initialize database:', err);
      process.exit(1);
    });
}
```

**Step 3: Create database package.json**

File: `database/package.json`

```json
{
  "name": "database",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "init": "node init.js"
  },
  "dependencies": {
    "sqlite3": "^5.1.7"
  }
}
```

**Step 4: Test database initialization**

```bash
cd database
npm install
DATABASE_PATH=./test.db npm run init
```

Expected output:
```
✓ Database initialized successfully
```

Verify:
```bash
sqlite3 test.db ".tables"
```

Expected output:
```
broadcasts            conversation_state    style_profile
broadcasts_fts        queue
```

**Step 5: Commit database schema**

```bash
rm database/test.db  # Clean up test
git add database/
git commit -m "feat: add database schema with FTS5 support"
```

---

## Task 3: AI Processor Service - Project Setup

**Files:**
- Create: `ai-processor/pyproject.toml`
- Create: `ai-processor/requirements.txt`
- Create: `ai-processor/Dockerfile`
- Create: `ai-processor/main.py`

**Step 1: Create pyproject.toml**

File: `ai-processor/pyproject.toml`

```toml
[project]
name = "ai-processor"
version = "1.0.0"
description = "AI processor for FGB broadcast parsing and style rewriting"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.109.0",
    "uvicorn[standard]>=0.27.0",
    "pydantic>=2.5.0",
    "pydantic-settings>=2.1.0",
    "google-generativeai>=0.3.0",
    "pyyaml>=6.0",
    "python-multipart>=0.0.6",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.4.0",
    "pytest-asyncio>=0.21.0",
    "httpx>=0.26.0",
]
```

**Step 2: Create requirements.txt (for Docker)**

File: `ai-processor/requirements.txt`

```
fastapi>=0.109.0
uvicorn[standard]>=0.27.0
pydantic>=2.5.0
pydantic-settings>=2.1.0
google-generativeai>=0.3.0
pyyaml>=6.0
python-multipart>=0.0.6
```

**Step 3: Create Dockerfile**

File: `ai-processor/Dockerfile`

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import requests; requests.get('http://localhost:8000/health')"

# Run application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Step 4: Create basic FastAPI app**

File: `ai-processor/main.py`

```python
from fastapi import FastAPI
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    gemini_api_key: str

    class Config:
        env_file = ".env"

settings = Settings()
app = FastAPI(title="AI Processor", version="1.0.0")

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "ai-processor"}

@app.get("/")
async def root():
    return {
        "service": "AI Processor",
        "version": "1.0.0",
        "endpoints": ["/parse", "/generate", "/extract-style"]
    }
```

**Step 5: Test basic setup**

```bash
cd ai-processor
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
GEMINI_API_KEY=test uvicorn main:app --reload
```

Expected: Server starts on http://localhost:8000

Test in another terminal:
```bash
curl http://localhost:8000/health
```

Expected output:
```json
{"status":"healthy","service":"ai-processor"}
```

**Step 6: Commit AI processor setup**

```bash
deactivate  # Exit venv
git add ai-processor/
git commit -m "feat: initialize AI processor service with FastAPI"
```

---

## Task 4: AI Processor - Parser Configuration

**Files:**
- Create: `ai-processor/config/parser-rules.yaml`
- Create: `ai-processor/models.py`
- Create: `ai-processor/parser.py`
- Create: `ai-processor/tests/test_parser.py`

**Step 1: Write failing parser test**

File: `ai-processor/tests/test_parser.py`

```python
import pytest
from parser import FGBParser

@pytest.fixture
def sample_fgb_text():
    return """Remainder | ETA : Apr '26
Close : 20 Des

*Brown Bear Goes to the Museum* (HB)
🏷️ Rp 115.000
*Min. 3 pcs per title. off 10%
**OR Min. 16 pcs mix title. off 10%

Follow Brown Bear and his friends as they explore
all of the different rooms - from the transport
section to the art gallery...

_New Oct_ 🔥

🌳🌳🌳"""

def test_parser_extracts_type():
    parser = FGBParser()
    text = "Remainder | ETA : Apr '26\nSome content\n🌳🌳🌳"
    result = parser.parse(text, media_count=1)
    assert result.type == "Remainder"

def test_parser_extracts_eta():
    parser = FGBParser()
    text = "Remainder | ETA : Apr '26\nSome content\n🌳🌳🌳"
    result = parser.parse(text, media_count=1)
    assert result.eta == "Apr '26"

def test_parser_extracts_title_and_format():
    parser = FGBParser()
    text = "*Brown Bear Goes to the Museum* (HB)\n🏷️ Rp 115.000\n🌳🌳🌳"
    result = parser.parse(text, media_count=1)
    assert result.title == "Brown Bear Goes to the Museum"
    assert result.format == "HB"

def test_parser_extracts_price():
    parser = FGBParser()
    text = "*Some Book* (HB)\n🏷️ Rp 115.000\n🌳🌳🌳"
    result = parser.parse(text, media_count=1)
    assert result.price_main == 115000

def test_parser_extracts_separator_emoji():
    parser = FGBParser()
    text1 = "Some text\n🌳🌳🌳"
    result1 = parser.parse(text1, media_count=1)
    assert result1.separator_emoji == "🌳"

    text2 = "Some text\n🦊🦊🦊"
    result2 = parser.parse(text2, media_count=1)
    assert result2.separator_emoji == "🦊"

def test_parser_full_broadcast(sample_fgb_text):
    parser = FGBParser()
    result = parser.parse(sample_fgb_text, media_count=2)

    assert result.type == "Remainder"
    assert result.eta == "Apr '26"
    assert result.close_date == "20 Des"
    assert result.title == "Brown Bear Goes to the Museum"
    assert result.format == "HB"
    assert result.price_main == 115000
    assert "New Oct" in result.tags
    assert result.separator_emoji == "🌳"
    assert "Follow Brown Bear" in result.description_en
```

**Step 2: Run tests to verify they fail**

```bash
cd ai-processor
pytest tests/test_parser.py -v
```

Expected: All tests FAIL with "ModuleNotFoundError: No module named 'parser'"

**Step 3: Create parser models**

File: `ai-processor/models.py`

```python
from pydantic import BaseModel, Field
from typing import Optional, List

class ParsedBroadcast(BaseModel):
    """Parsed FGB broadcast data"""
    type: Optional[str] = None  # Remainder or Request
    eta: Optional[str] = None
    close_date: Optional[str] = None
    title: Optional[str] = None
    title_en: Optional[str] = None
    format: Optional[str] = None  # HB, PB, BB
    price_main: Optional[int] = None
    price_secondary: Optional[int] = None
    min_order: Optional[str] = None
    description_en: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    preview_links: List[str] = Field(default_factory=list)
    separator_emoji: Optional[str] = None
    media_count: int = 0
    raw_text: str = ""

class GenerateRequest(BaseModel):
    """Request to generate Indonesian broadcast"""
    parsed_data: ParsedBroadcast
    user_edit: Optional[str] = None

class GenerateResponse(BaseModel):
    """Generated broadcast in Indonesian"""
    draft: str
    parsed_data: ParsedBroadcast
```

**Step 4: Create parser configuration**

File: `ai-processor/config/parser-rules.yaml`

```yaml
patterns:
  # Type: Remainder or Request
  type:
    - regex: '(Remainder|Request)\s*\|\s*ETA'
      group: 1

  # ETA: Apr '26, etc
  eta:
    - regex: 'ETA\s*:\s*([A-Za-z]+\s*''?\d{2})'
      group: 1

  # Close date
  close_date:
    - regex: 'Close\s*:\s*(\d+\s+[A-Za-z]+)'
      group: 1

  # Title and format: *Book Title* (HB)
  title:
    - regex: '\*([^*]+)\*\s*\((HB|PB|BB)\)'
      group: 1
    - regex: '\*\*([^*]+)\*\*\s*\((HB|PB|BB)\)'
      group: 1

  format:
    - regex: '\*[^*]+\*\s*\((HB|PB|BB)\)'
      group: 1
    - regex: '\*\*[^*]+\*\*\s*\((HB|PB|BB)\)'
      group: 1

  # Price: 🏷️ Rp 115.000 or HB - Rp 245.000 / PB - Rp 160.000
  price_main:
    - regex: '🏷️\s*(?:HB\s*-\s*)?Rp\s*([0-9.,]+)'
      group: 1
      transform: 'remove_separators'

  price_secondary:
    - regex: '/\s*(?:PB|BB)\s*-\s*Rp\s*([0-9.,]+)'
      group: 1
      transform: 'remove_separators'

  # Min order
  min_order:
    - regex: '\*+Min\.\s*(\d+\s+pcs[^*\n]+)'
      group: 1
    - regex: 'NETT\s+PRICE'
      group: 0

  # Tags: _New Oct_ 🔥
  tags:
    - regex: '_New\s+(Oct|Sept|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug)_'
      group: 0
      multi: true
    - regex: 'NETT\s+PRICE'
      group: 0
      multi: true

  # Separator emoji
  separator:
    - regex: '(🌳|🦊){2,}'
      group: 1

  # Preview links
  preview_links:
    - regex: 'https?://[^\s]+'
      group: 0
      multi: true

# Skip rules (can be toggled)
skip_rules:
  preview_links: false  # Set true to skip extraction
```

**Step 5: Implement parser**

File: `ai-processor/parser.py`

```python
import re
import yaml
from pathlib import Path
from typing import Dict, List, Any
from models import ParsedBroadcast

class FGBParser:
    def __init__(self, config_path: str = "config/parser-rules.yaml"):
        config_file = Path(__file__).parent / config_path
        with open(config_file, 'r', encoding='utf-8') as f:
            self.config = yaml.safe_load(f)

        self.patterns = self.config.get('patterns', {})
        self.skip_rules = self.config.get('skip_rules', {})

    def _extract_field(self, text: str, field_name: str) -> Any:
        """Extract a field from text using configured patterns"""
        if self.skip_rules.get(field_name, False):
            return None

        field_patterns = self.patterns.get(field_name, [])

        for pattern_config in field_patterns:
            regex = pattern_config['regex']
            group = pattern_config.get('group', 0)
            transform = pattern_config.get('transform')
            multi = pattern_config.get('multi', False)

            if multi:
                matches = re.findall(regex, text, re.IGNORECASE | re.MULTILINE)
                if matches:
                    return matches if isinstance(matches[0], str) else [m[group] if isinstance(m, tuple) else m for m in matches]
            else:
                match = re.search(regex, text, re.IGNORECASE | re.MULTILINE)
                if match:
                    value = match.group(group)
                    if transform == 'remove_separators':
                        value = int(value.replace('.', '').replace(',', ''))
                    return value

        return None

    def _extract_description(self, text: str) -> str:
        """Extract description (text between price and tags/separator)"""
        # Find the start (after min order or price)
        price_match = re.search(r'🏷️.*?(?:\n|$)', text, re.MULTILINE)
        if not price_match:
            return ""

        start_pos = price_match.end()

        # Find the end (before tags or separator)
        tag_match = re.search(r'_New\s+\w+_', text[start_pos:])
        separator_match = re.search(r'(🌳|🦊){2,}', text[start_pos:])
        link_match = re.search(r'https?://', text[start_pos:])

        end_positions = [
            tag_match.start() if tag_match else len(text),
            separator_match.start() if separator_match else len(text),
            link_match.start() if link_match else len(text)
        ]
        end_pos = start_pos + min(end_positions)

        description = text[start_pos:end_pos].strip()
        # Clean up asterisks and extra whitespace
        description = re.sub(r'\*+', '', description)
        description = re.sub(r'\s+', ' ', description)

        return description

    def parse(self, text: str, media_count: int = 0) -> ParsedBroadcast:
        """Parse FGB broadcast text into structured data"""
        result = ParsedBroadcast(
            raw_text=text,
            media_count=media_count
        )

        # Extract all fields
        result.type = self._extract_field(text, 'type')
        result.eta = self._extract_field(text, 'eta')
        result.close_date = self._extract_field(text, 'close_date')
        result.title = self._extract_field(text, 'title')
        result.format = self._extract_field(text, 'format')
        result.price_main = self._extract_field(text, 'price_main')
        result.price_secondary = self._extract_field(text, 'price_secondary')
        result.min_order = self._extract_field(text, 'min_order')
        result.separator_emoji = self._extract_field(text, 'separator')

        # Extract multi-value fields
        tags = self._extract_field(text, 'tags')
        result.tags = tags if tags else []

        links = self._extract_field(text, 'preview_links')
        result.preview_links = links if links else []

        # Extract description
        result.description_en = self._extract_description(text)

        # Set title_en as same as title
        result.title_en = result.title

        return result
```

**Step 6: Run tests to verify they pass**

```bash
cd ai-processor
pytest tests/test_parser.py -v
```

Expected: All tests PASS

**Step 7: Commit parser implementation**

```bash
git add ai-processor/
git commit -m "feat: implement FGB broadcast parser with YAML config"
```

---

## Task 5: AI Processor - Gemini Integration

**Files:**
- Create: `ai-processor/gemini_client.py`
- Create: `ai-processor/tests/test_gemini.py`
- Create: `ai-processor/config/style-profile.json`

**Step 1: Write failing Gemini client test**

File: `ai-processor/tests/test_gemini.py`

```python
import pytest
from gemini_client import GeminiClient
from models import ParsedBroadcast

@pytest.fixture
def gemini_client():
    return GeminiClient()

@pytest.fixture
def sample_parsed_data():
    return ParsedBroadcast(
        type="Remainder",
        eta="Apr '26",
        close_date="20 Des",
        title="Brown Bear Goes to the Museum",
        format="HB",
        price_main=115000,
        min_order="3 pcs per title. off 10%",
        description_en="Follow Brown Bear and his friends as they explore all of the different rooms - from the transport section to the art gallery...",
        tags=["_New Oct_ 🔥"],
        separator_emoji="🌳",
        media_count=2
    )

@pytest.mark.asyncio
async def test_gemini_client_initializes():
    client = GeminiClient()
    assert client is not None
    assert client.model is not None

@pytest.mark.asyncio
async def test_generate_broadcast_returns_string(gemini_client, sample_parsed_data):
    result = await gemini_client.generate_broadcast(sample_parsed_data)
    assert isinstance(result, str)
    assert len(result) > 0

@pytest.mark.asyncio
async def test_generated_broadcast_contains_indonesian(gemini_client, sample_parsed_data):
    result = await gemini_client.generate_broadcast(sample_parsed_data)
    # Should contain Indonesian greeting or casual words
    indonesian_markers = ['nih', 'bagus', 'untuk', 'ada', 'buku']
    assert any(marker in result.lower() for marker in indonesian_markers)

@pytest.mark.asyncio
async def test_generate_with_user_edit(gemini_client, sample_parsed_data):
    user_edit = "Tolong tambahin info bahwa ini cocok untuk anak 3-5 tahun"
    result = await gemini_client.generate_broadcast(
        sample_parsed_data,
        user_edit=user_edit
    )
    assert isinstance(result, str)
    # Should incorporate the edit
    assert '3' in result or 'tiga' in result.lower()
```

**Step 2: Run tests to verify they fail**

```bash
cd ai-processor
pytest tests/test_gemini.py -v
```

Expected: Tests FAIL with "ModuleNotFoundError: No module named 'gemini_client'"

**Step 3: Create default style profile**

File: `ai-processor/config/style-profile.json`

```json
{
  "greetings": [
    "Halooo moms!",
    "Ada buku bagus nih!",
    "Moms ada promo nih!",
    "Haii! Ada buku lucu nih"
  ],
  "emoji_usage": {
    "frequency": "medium",
    "common": ["😍", "🤩", "😆", "📚", "💰"]
  },
  "tone": "friendly_informative",
  "casual_words": {
    "very": ["bgtt", "bingits", "banget nih", "banget"],
    "beautiful": ["cakepp", "cantik bgtt", "bagus bgtt"],
    "cheap": ["murmer", "murah jugaa", "harganya oke"],
    "good": ["bagus", "oke nih", "recommended"]
  },
  "structure_preference": {
    "conversational_intro": true,
    "emoji_before_price": true,
    "include_age_recommendation": true,
    "include_benefits": true
  },
  "style_notes": "Selow tapi serius dan insightful. Informative tentang manfaat buku dan usia cocok. Casual Indonesian dengan kata-kata seperti 'bgtt', 'yahh', 'gausa', 'murmer'. Personal touch kadang mention pengalaman."
}
```

**Step 4: Implement Gemini client**

File: `ai-processor/gemini_client.py`

```python
import json
import google.generativeai as genai
from pathlib import Path
from typing import Optional
from models import ParsedBroadcast

class GeminiClient:
    def __init__(self, api_key: Optional[str] = None):
        if api_key is None:
            import os
            api_key = os.getenv('GEMINI_API_KEY')

        if not api_key:
            raise ValueError("GEMINI_API_KEY is required")

        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('gemini-1.5-flash')

        # Load style profile
        style_path = Path(__file__).parent / "config/style-profile.json"
        with open(style_path, 'r', encoding='utf-8') as f:
            self.style_profile = json.load(f)

    def _build_prompt(self, parsed: ParsedBroadcast, user_edit: Optional[str] = None) -> str:
        """Build prompt for Gemini"""

        # Format price display
        price_display = f"Rp {parsed.price_main:,}".replace(',', '.')
        if parsed.price_secondary:
            price_secondary_display = f"Rp {parsed.price_secondary:,}".replace(',', '.')
            price_display = f"HB: {price_display} / PB: {price_secondary_display}"

        # Build structured info
        structured_info = f"""
INFORMASI BUKU:
- Judul: {parsed.title}
- Format: {parsed.format}
- Harga: {price_display}
- Min Order: {parsed.min_order or 'Tidak ada minimum'}
- ETA: {parsed.eta or 'Tidak disebutkan'}
- Close: {parsed.close_date or 'Tidak disebutkan'}
- Type: {parsed.type or 'Tidak disebutkan'}
- Deskripsi (English): {parsed.description_en}
- Tags: {', '.join(parsed.tags) if parsed.tags else 'Tidak ada'}
- Jumlah foto: {parsed.media_count}
"""

        # Build style guide from profile
        style_guide = f"""
STYLE GUIDE (Dr. Findania - Ahmari Bookstore):
- Tone: {self.style_profile['tone']} - {self.style_profile['style_notes']}
- Greeting options: {', '.join(self.style_profile['greetings'])}
- Emoji usage: {self.style_profile['emoji_usage']['frequency']} - gunakan: {', '.join(self.style_profile['emoji_usage']['common'])}
- Casual words:
  * Untuk "very/sangat": {', '.join(self.style_profile['casual_words']['very'])}
  * Untuk "beautiful/bagus": {', '.join(self.style_profile['casual_words']['beautiful'])}
  * Untuk "cheap/murah": {', '.join(self.style_profile['casual_words']['cheap'])}
  * Untuk "good/bagus": {', '.join(self.style_profile['casual_words']['good'])}
- Struktur:
  * Mulai dengan greeting casual
  * Emoji sebelum harga: {'Ya' if self.style_profile['structure_preference']['emoji_before_price'] else 'Tidak'}
  * Include rekomendasi usia: {'Ya' if self.style_profile['structure_preference']['include_age_recommendation'] else 'Tidak'}
  * Include manfaat buku: {'Ya' if self.style_profile['structure_preference']['include_benefits'] else 'Tidak'}
"""

        user_edit_section = ""
        if user_edit:
            user_edit_section = f"""
USER EDIT REQUEST:
{user_edit}

IMPORTANT: Incorporate the user's edit request into the broadcast.
"""

        prompt = f"""{structured_info}

{style_guide}

{user_edit_section}

TASK:
Generate a WhatsApp broadcast message in Indonesian for Ahmari Bookstore (toko buku) promoting this book.

REQUIREMENTS:
1. Start with a casual, friendly greeting (pilih salah satu dari greeting options)
2. Translate the description to Indonesian with casual, conversational style
3. Include price, format, ETA, and close date
4. Use emoji naturally (jangan berlebihan)
5. Use casual Indonesian words from the style guide
6. Keep it informative but friendly ("selow tapi serius dan insightful")
7. If possible, add insight about age suitability or book benefits
8. Keep the format clean and easy to read
9. Don't use asterisks for bold (WhatsApp formatting will be handled separately)
10. End naturally (no need for separator emoji)

Generate ONLY the broadcast message, no explanations or meta-commentary.
"""

        return prompt

    async def generate_broadcast(
        self,
        parsed: ParsedBroadcast,
        user_edit: Optional[str] = None
    ) -> str:
        """Generate Indonesian broadcast from parsed data"""

        prompt = self._build_prompt(parsed, user_edit)

        generation_config = {
            "temperature": 0.7,
            "top_p": 0.95,
            "top_k": 40,
            "max_output_tokens": 1024,
        }

        response = self.model.generate_content(
            prompt,
            generation_config=generation_config
        )

        return response.text.strip()
```

**Step 5: Install google-generativeai and run tests**

```bash
cd ai-processor
pip install google-generativeai pytest-asyncio
pytest tests/test_gemini.py -v -s
```

Expected: Tests PASS (requires valid GEMINI_API_KEY)

Note: For CI/CD without API key, can mock the Gemini calls.

**Step 6: Commit Gemini integration**

```bash
git add ai-processor/
git commit -m "feat: integrate Gemini for broadcast style generation"
```

---

## Task 6: AI Processor - API Endpoints

**Files:**
- Modify: `ai-processor/main.py`
- Create: `ai-processor/tests/test_api.py`

**Step 1: Write failing API tests**

File: `ai-processor/tests/test_api.py`

```python
import pytest
from httpx import AsyncClient
from main import app

@pytest.mark.asyncio
async def test_parse_endpoint():
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post("/parse", json={
            "text": "Remainder | ETA : Apr '26\n*Test Book* (HB)\n🏷️ Rp 100.000\n🌳🌳🌳",
            "media_count": 1
        })

    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "Remainder"
    assert data["title"] == "Test Book"
    assert data["price_main"] == 100000

@pytest.mark.asyncio
async def test_generate_endpoint():
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post("/generate", json={
            "parsed_data": {
                "type": "Remainder",
                "title": "Test Book",
                "format": "HB",
                "price_main": 100000,
                "description_en": "A great book for kids",
                "raw_text": "test",
                "media_count": 1
            }
        })

    assert response.status_code == 200
    data = response.json()
    assert "draft" in data
    assert len(data["draft"]) > 0

@pytest.mark.asyncio
async def test_parse_endpoint_validation():
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post("/parse", json={
            "text": ""  # Missing media_count
        })

    assert response.status_code == 422  # Validation error
```

**Step 2: Run tests to verify they fail**

```bash
cd ai-processor
pytest tests/test_api.py -v
```

Expected: Tests FAIL because endpoints don't exist yet

**Step 3: Implement API endpoints**

File: `ai-processor/main.py`

```python
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pydantic_settings import BaseSettings
from typing import Optional
import logging

from parser import FGBParser
from gemini_client import GeminiClient
from models import ParsedBroadcast, GenerateRequest, GenerateResponse

# Logging setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class Settings(BaseSettings):
    gemini_api_key: str

    class Config:
        env_file = ".env"

settings = Settings()
app = FastAPI(title="AI Processor", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize services
parser = FGBParser()
gemini_client = GeminiClient(api_key=settings.gemini_api_key)

class ParseRequest(BaseModel):
    text: str
    media_count: int = 0

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "ai-processor"}

@app.get("/")
async def root():
    return {
        "service": "AI Processor",
        "version": "1.0.0",
        "endpoints": ["/parse", "/generate", "/extract-style", "/health"]
    }

@app.post("/parse", response_model=ParsedBroadcast)
async def parse_broadcast(request: ParseRequest):
    """Parse FGB broadcast text into structured data"""
    try:
        logger.info(f"Parsing broadcast, text length: {len(request.text)}")
        result = parser.parse(request.text, request.media_count)
        logger.info(f"Parsed successfully: {result.title}")
        return result
    except Exception as e:
        logger.error(f"Parse error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Parsing failed: {str(e)}")

@app.post("/generate", response_model=GenerateResponse)
async def generate_broadcast(request: GenerateRequest):
    """Generate Indonesian broadcast from parsed data"""
    try:
        logger.info(f"Generating broadcast for: {request.parsed_data.title}")

        draft = await gemini_client.generate_broadcast(
            request.parsed_data,
            user_edit=request.user_edit
        )

        logger.info(f"Generated successfully, length: {len(draft)}")

        return GenerateResponse(
            draft=draft,
            parsed_data=request.parsed_data
        )
    except Exception as e:
        logger.error(f"Generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Generation failed: {str(e)}")

@app.post("/extract-style")
async def extract_style():
    """Extract style profile from chat export (placeholder for now)"""
    return {
        "status": "not_implemented",
        "message": "Style extraction will be implemented in future task"
    }
```

**Step 4: Run tests to verify they pass**

```bash
cd ai-processor
pytest tests/test_api.py -v
```

Expected: Tests PASS

**Step 5: Manual API test**

```bash
# Start server in one terminal
cd ai-processor
GEMINI_API_KEY=your_key uvicorn main:app --reload

# Test in another terminal
curl -X POST http://localhost:8000/parse \
  -H "Content-Type: application/json" \
  -d '{"text":"Remainder | ETA : Apr '\''26\n*Test Book* (HB)\n🏷️ Rp 100.000\n🌳🌳🌳","media_count":1}'
```

Expected: JSON response with parsed data

**Step 6: Commit API endpoints**

```bash
git add ai-processor/
git commit -m "feat: add parse and generate API endpoints"
```

---

## Task 7: WhatsApp Bot - Project Setup

**Files:**
- Create: `wa-bot/package.json`
- Create: `wa-bot/tsconfig.json`
- Create: `wa-bot/Dockerfile`
- Create: `wa-bot/.dockerignore`
- Create: `wa-bot/src/index.ts`

**Step 1: Create package.json**

File: `wa-bot/package.json`

```json
{
  "name": "wa-bot",
  "version": "1.0.0",
  "description": "WhatsApp bot for Ahmari Bookstore",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "test": "jest",
    "lint": "eslint src --ext .ts"
  },
  "keywords": ["whatsapp", "bot", "baileys"],
  "license": "MIT",
  "dependencies": {
    "@whiskeysockets/baileys": "^6.6.0",
    "pino": "^8.17.0",
    "qrcode-terminal": "^0.12.0",
    "axios": "^1.6.0",
    "better-sqlite3": "^9.2.0",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/better-sqlite3": "^7.6.8",
    "typescript": "^5.3.0",
    "ts-node-dev": "^2.0.0",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.0",
    "ts-jest": "^29.1.0"
  }
}
```

**Step 2: Create TypeScript config**

File: `wa-bot/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "types": ["node", "jest"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

**Step 3: Create Dockerfile**

File: `wa-bot/Dockerfile`

```dockerfile
FROM node:20-slim

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Create necessary directories
RUN mkdir -p /app/sessions /app/data /app/media

# Expose port (if needed for health checks)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "console.log('healthy')" || exit 1

# Run application
CMD ["npm", "start"]
```

**Step 4: Create .dockerignore**

File: `wa-bot/.dockerignore`

```
node_modules
dist
*.log
.env
.env.local
sessions
data
media
temp
.git
.gitignore
README.md
```

**Step 5: Create basic index.ts**

File: `wa-bot/src/index.ts`

```typescript
import { config } from 'dotenv';
import pino from 'pino';

config();

const logger = pino({ level: 'info' });

async function main() {
  logger.info('WhatsApp Bot starting...');
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`AI Processor URL: ${process.env.AI_PROCESSOR_URL || 'not set'}`);

  // TODO: Initialize WhatsApp connection
  logger.info('Bot initialized successfully');
}

main().catch((error) => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});
```

**Step 6: Test basic setup**

```bash
cd wa-bot
npm install
npm run dev
```

Expected output:
```
WhatsApp Bot starting...
Environment: development
AI Processor URL: not set
Bot initialized successfully
```

**Step 7: Commit WA bot setup**

```bash
git add wa-bot/
git commit -m "feat: initialize WhatsApp bot service with TypeScript"
```

---

## Task 8: WhatsApp Bot - Baileys Connection

**Files:**
- Create: `wa-bot/src/whatsapp.ts`
- Create: `wa-bot/src/types.ts`
- Modify: `wa-bot/src/index.ts`

**Step 1: Create types file**

File: `wa-bot/src/types.ts`

```typescript
import { WASocket } from '@whiskeysockets/baileys';

export interface BotConfig {
  aiProcessorUrl: string;
  databasePath: string;
  targetGroupJid: string;
  ownerJid: string;
}

export interface MessageContext {
  sock: WASocket;
  messageId: string;
  from: string;
  text: string;
  hasMedia: boolean;
  mediaCount: number;
  quotedMessage?: any;
}
```

**Step 2: Create WhatsApp connection module**

File: `wa-bot/src/whatsapp.ts`

```typescript
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  makeInMemoryStore,
  Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'path';

const logger = pino({ level: 'info' });

export class WhatsAppClient {
  private sock: WASocket | null = null;
  private store: ReturnType<typeof makeInMemoryStore>;
  private sessionsPath: string;

  constructor(sessionsPath: string = './sessions') {
    this.sessionsPath = sessionsPath;
    this.store = makeInMemoryStore({
      logger: pino({ level: 'silent' })
    });
  }

  async connect(): Promise<WASocket> {
    const { state, saveCreds } = await useMultiFileAuthState(
      path.resolve(this.sessionsPath)
    );

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: false, // We'll handle QR display ourselves
      logger: pino({ level: 'warn' }),
      browser: Browsers.macOS('Desktop'),
      getMessage: async (key) => {
        // Retrieve message from store if needed
        return { conversation: '' };
      },
    });

    // Bind store to socket
    this.store.bind(this.sock.ev);

    // Handle credentials update
    this.sock.ev.on('creds.update', saveCreds);

    // Handle connection updates
    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Display QR code
      if (qr) {
        logger.info('QR Code received, scan to authenticate:');
        qrcode.generate(qr, { small: true });
      }

      // Handle connection states
      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !==
          DisconnectReason.loggedOut;

        logger.warn('Connection closed:', lastDisconnect?.error);

        if (shouldReconnect) {
          logger.info('Reconnecting...');
          await this.connect();
        } else {
          logger.error('Logged out, please delete sessions and restart');
          process.exit(1);
        }
      } else if (connection === 'open') {
        logger.info('✓ WhatsApp connection established');
      }
    });

    return this.sock;
  }

  getSocket(): WASocket | null {
    return this.sock;
  }

  async disconnect() {
    if (this.sock) {
      await this.sock.logout();
      this.sock = null;
    }
  }
}
```

**Step 3: Update index.ts to use WhatsApp client**

File: `wa-bot/src/index.ts`

```typescript
import { config } from 'dotenv';
import pino from 'pino';
import { WhatsAppClient } from './whatsapp';
import path from 'path';

config();

const logger = pino({ level: 'info' });

async function main() {
  logger.info('WhatsApp Bot starting...');
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`AI Processor URL: ${process.env.AI_PROCESSOR_URL || 'not set'}`);

  // Initialize WhatsApp client
  const sessionsPath = path.resolve('./sessions');
  const waClient = new WhatsAppClient(sessionsPath);

  try {
    const sock = await waClient.connect();
    logger.info('WhatsApp client initialized');

    // Keep process running
    process.on('SIGINT', async () => {
      logger.info('Shutting down...');
      await waClient.disconnect();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to connect to WhatsApp:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});
```

**Step 4: Install additional Baileys dependency**

```bash
cd wa-bot
npm install @hapi/boom
npm install --save-dev @types/qrcode-terminal
```

**Step 5: Test WhatsApp connection (will show QR code)**

```bash
cd wa-bot
npm run dev
```

Expected: QR code appears in terminal. Scan with WhatsApp to authenticate.

**Step 6: Commit WhatsApp connection**

```bash
git add wa-bot/
git commit -m "feat: add Baileys WhatsApp connection with QR auth"
```

---

## Task 9: WhatsApp Bot - Message Handler

**Files:**
- Create: `wa-bot/src/messageHandler.ts`
- Create: `wa-bot/src/detector.ts`
- Modify: `wa-bot/src/whatsapp.ts`

**Step 1: Create FGB broadcast detector**

File: `wa-bot/src/detector.ts`

```typescript
import { proto } from '@whiskeysockets/baileys';

export interface DetectionResult {
  isFGBBroadcast: boolean;
  text: string;
  hasMedia: boolean;
  mediaCount: number;
  mediaMessages: proto.IMessage[];
}

const FGB_PATTERNS = [
  /Remainder\s*\|\s*ETA/i,
  /Request\s*\|\s*ETA/i,
  /Min\.\s*\d+\s*pcs/i,
  /NETT\s+PRICE/i,
  /(🌳{2,}|🦊{2,})/,
];

export function detectFGBBroadcast(message: proto.IWebMessageInfo): DetectionResult {
  const result: DetectionResult = {
    isFGBBroadcast: false,
    text: '',
    hasMedia: false,
    mediaCount: 0,
    mediaMessages: [],
  };

  // Extract text from message
  const messageContent = message.message;
  if (!messageContent) return result;

  // Check for text content
  const textContent =
    messageContent.conversation ||
    messageContent.extendedTextMessage?.text ||
    messageContent.imageMessage?.caption ||
    messageContent.videoMessage?.caption ||
    '';

  result.text = textContent;

  // Check for media
  if (messageContent.imageMessage) {
    result.hasMedia = true;
    result.mediaCount = 1;
    result.mediaMessages.push(message.message!);
  }

  // Check if matches FGB patterns
  if (textContent) {
    const hasPattern = FGB_PATTERNS.some((pattern) => pattern.test(textContent));

    // Must have pattern match AND media to be considered FGB broadcast
    if (hasPattern && result.hasMedia) {
      result.isFGBBroadcast = true;
    }
  }

  return result;
}

export function isOwnerMessage(from: string, ownerJid: string): boolean {
  return from === ownerJid;
}
```

**Step 2: Create message handler**

File: `wa-bot/src/messageHandler.ts`

```typescript
import { WASocket, proto, downloadMediaMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import { detectFGBBroadcast, isOwnerMessage } from './detector';
import path from 'path';
import fs from 'fs';

const logger = pino({ level: 'info' });

export class MessageHandler {
  constructor(
    private sock: WASocket,
    private ownerJid: string,
    private mediaPath: string = './media'
  ) {
    // Ensure media directory exists
    if (!fs.existsSync(mediaPath)) {
      fs.mkdirSync(mediaPath, { recursive: true });
    }
  }

  async handleMessage(message: proto.IWebMessageInfo) {
    try {
      // Get sender info
      const from = message.key.remoteJid!;
      const isFromOwner = isOwnerMessage(from, this.ownerJid);

      // Only process messages from owner (istri)
      if (!isFromOwner) {
        logger.debug(`Ignoring message from non-owner: ${from}`);
        return;
      }

      logger.info(`Processing message from owner: ${from}`);

      // Detect if this is an FGB broadcast
      const detection = detectFGBBroadcast(message);

      if (detection.isFGBBroadcast) {
        logger.info('FGB broadcast detected!');
        await this.processFGBBroadcast(message, detection);
      } else {
        logger.debug('Not an FGB broadcast, ignoring');
      }
    } catch (error) {
      logger.error('Error handling message:', error);
    }
  }

  private async processFGBBroadcast(
    message: proto.IWebMessageInfo,
    detection: any
  ) {
    const from = message.key.remoteJid!;

    // Download media
    const mediaPaths: string[] = [];
    if (detection.hasMedia && detection.mediaMessages.length > 0) {
      for (const mediaMsg of detection.mediaMessages) {
        try {
          const buffer = await downloadMediaMessage(
            { message: mediaMsg } as any,
            'buffer',
            {}
          );

          // Save media file
          const timestamp = Date.now();
          const filename = `fgb_${timestamp}.jpg`;
          const filepath = path.join(this.mediaPath, filename);

          fs.writeFileSync(filepath, buffer as Buffer);
          mediaPaths.push(filepath);

          logger.info(`Media saved: ${filepath}`);
        } catch (error) {
          logger.error('Failed to download media:', error);
        }
      }
    }

    // TODO: Send to AI processor for parsing
    // TODO: Generate draft
    // TODO: Send draft back to user for approval

    // For now, just acknowledge
    await this.sock.sendMessage(from, {
      text: `✓ FGB broadcast terdeteksi!\n\nProses parsing dan generate draft...\n\n(Fitur ini akan diimplementasi di task berikutnya)`,
    });

    logger.info('FGB broadcast processed, media count:', mediaPaths.length);
  }
}
```

**Step 3: Update whatsapp.ts to use message handler**

File: `wa-bot/src/whatsapp.ts` (add to the class)

```typescript
// Add this import at the top
import { MessageHandler } from './messageHandler';

// Add this property to the class
private messageHandler: MessageHandler | null = null;

// Add this method to set up message handler
setupMessageHandler(ownerJid: string, mediaPath: string = './media') {
  if (!this.sock) {
    throw new Error('Socket not connected');
  }

  this.messageHandler = new MessageHandler(this.sock, ownerJid, mediaPath);

  // Listen for messages
  this.sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const message of messages) {
      // Ignore messages from self
      if (message.key.fromMe) continue;

      // Handle message
      await this.messageHandler!.handleMessage(message);
    }
  });
}
```

**Step 4: Update index.ts to setup message handler**

File: `wa-bot/src/index.ts`

```typescript
// After successful connection, add:
const ownerJid = process.env.OWNER_JID || '';
if (!ownerJid) {
  logger.error('OWNER_JID not set in environment');
  process.exit(1);
}

waClient.setupMessageHandler(ownerJid, path.resolve('./media'));
logger.info('Message handler setup complete');
```

**Step 5: Test message handling**

```bash
cd wa-bot
npm run dev
```

Expected: Bot starts, connects to WhatsApp, and responds to FGB broadcasts from owner.

**Step 6: Commit message handler**

```bash
git add wa-bot/
git commit -m "feat: add message handler with FGB broadcast detection"
```

---

## Task 10: WhatsApp Bot - AI Processor Integration

**Files:**
- Create: `wa-bot/src/aiClient.ts`
- Modify: `wa-bot/src/messageHandler.ts`

**Step 1: Create AI client**

File: `wa-bot/src/aiClient.ts`

```typescript
import axios, { AxiosInstance } from 'axios';
import pino from 'pino';

const logger = pino({ level: 'info' });

export interface ParsedBroadcast {
  type?: string;
  eta?: string;
  close_date?: string;
  title?: string;
  format?: string;
  price_main?: number;
  price_secondary?: number;
  min_order?: string;
  description_en?: string;
  description_id?: string;
  tags: string[];
  preview_links: string[];
  separator_emoji?: string;
  media_count: number;
  raw_text: string;
}

export interface GenerateResponse {
  draft: string;
  parsed_data: ParsedBroadcast;
}

export class AIClient {
  private client: AxiosInstance;

  constructor(baseURL: string) {
    this.client = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async parse(text: string, mediaCount: number): Promise<ParsedBroadcast> {
    try {
      logger.info('Calling AI Processor /parse endpoint');
      const response = await this.client.post<ParsedBroadcast>('/parse', {
        text,
        media_count: mediaCount,
      });
      logger.info('Parse successful');
      return response.data;
    } catch (error: any) {
      logger.error('Parse failed:', error.message);
      throw new Error(`AI Processor parse failed: ${error.message}`);
    }
  }

  async generate(
    parsedData: ParsedBroadcast,
    userEdit?: string
  ): Promise<GenerateResponse> {
    try {
      logger.info('Calling AI Processor /generate endpoint');
      const response = await this.client.post<GenerateResponse>('/generate', {
        parsed_data: parsedData,
        user_edit: userEdit || null,
      });
      logger.info('Generation successful');
      return response.data;
    } catch (error: any) {
      logger.error('Generate failed:', error.message);
      throw new Error(`AI Processor generate failed: ${error.message}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.data.status === 'healthy';
    } catch {
      return false;
    }
  }
}
```

**Step 2: Update message handler to use AI client**

File: `wa-bot/src/messageHandler.ts`

```typescript
// Add import at top
import { AIClient } from './aiClient';

// Update constructor
constructor(
  private sock: WASocket,
  private ownerJid: string,
  private aiClient: AIClient,
  private mediaPath: string = './media'
) {
  // ... existing code
}

// Replace processFGBBroadcast method
private async processFGBBroadcast(
  message: proto.IWebMessageInfo,
  detection: any
) {
  const from = message.key.remoteJid!;

  try {
    // Send processing message
    await this.sock.sendMessage(from, {
      text: '⏳ Processing FGB broadcast...\n\n1. Downloading media\n2. Parsing data\n3. Generating draft',
    });

    // Download media
    const mediaPaths: string[] = [];
    if (detection.hasMedia && detection.mediaMessages.length > 0) {
      for (const mediaMsg of detection.mediaMessages) {
        try {
          const buffer = await downloadMediaMessage(
            { message: mediaMsg } as any,
            'buffer',
            {}
          );

          const timestamp = Date.now();
          const filename = `fgb_${timestamp}.jpg`;
          const filepath = path.join(this.mediaPath, filename);

          fs.writeFileSync(filepath, buffer as Buffer);
          mediaPaths.push(filepath);

          logger.info(`Media saved: ${filepath}`);
        } catch (error) {
          logger.error('Failed to download media:', error);
        }
      }
    }

    // Parse with AI Processor
    const parsedData = await this.aiClient.parse(
      detection.text,
      mediaPaths.length
    );

    logger.info(`Parsed: ${parsedData.title} (${parsedData.format})`);

    // Generate draft
    const generated = await this.aiClient.generate(parsedData);

    logger.info('Draft generated successfully');

    // Send draft with media
    if (mediaPaths.length > 0) {
      await this.sock.sendMessage(from, {
        image: { url: mediaPaths[0] },
        caption: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n• *YES* - kirim sekarang\n• *EDIT DULU* - edit manual dulu\n• *SCHEDULE* - masukkan ke antrian`,
      });
    } else {
      await this.sock.sendMessage(from, {
        text: `📝 *DRAFT BROADCAST*\n\n${generated.draft}\n\n---\nBalas dengan:\n• *YES* - kirim sekarang\n• *EDIT DULU* - edit manual dulu\n• *SCHEDULE* - masukkan ke antrian`,
      });
    }

    // TODO: Save conversation state to database
    // TODO: Wait for user response (YES/EDIT/SCHEDULE)

  } catch (error: any) {
    logger.error('Error processing FGB broadcast:', error);
    await this.sock.sendMessage(from, {
      text: `❌ Error: ${error.message}\n\nSilakan coba lagi.`,
    });
  }
}
```

**Step 3: Update whatsapp.ts to pass AI client**

File: `wa-bot/src/whatsapp.ts`

```typescript
// Update setupMessageHandler method signature
setupMessageHandler(
  ownerJid: string,
  aiClient: any,
  mediaPath: string = './media'
) {
  if (!this.sock) {
    throw new Error('Socket not connected');
  }

  this.messageHandler = new MessageHandler(
    this.sock,
    ownerJid,
    aiClient,
    mediaPath
  );

  // ... rest of the method stays the same
}
```

**Step 4: Update index.ts to create AI client**

File: `wa-bot/src/index.ts`

```typescript
// Add import
import { AIClient } from './aiClient';

// After WhatsApp connection, before message handler setup:
const aiProcessorUrl = process.env.AI_PROCESSOR_URL || 'http://localhost:8000';
const aiClient = new AIClient(aiProcessorUrl);

// Check AI Processor health
const isAIHealthy = await aiClient.healthCheck();
if (!isAIHealthy) {
  logger.warn('AI Processor is not healthy, but continuing...');
}

// Update message handler setup
waClient.setupMessageHandler(ownerJid, aiClient, path.resolve('./media'));
```

**Step 5: Test with both services running**

Terminal 1 (AI Processor):
```bash
cd ai-processor
GEMINI_API_KEY=your_key uvicorn main:app --reload
```

Terminal 2 (WA Bot):
```bash
cd wa-bot
OWNER_JID=your_jid@s.whatsapp.net AI_PROCESSOR_URL=http://localhost:8000 npm run dev
```

Expected: Bot processes FGB broadcasts and sends back drafts

**Step 6: Commit AI integration**

```bash
git add wa-bot/
git commit -m "feat: integrate AI processor for parsing and generation"
```

---

## Task 11: Database Integration & Conversation State

**Files:**
- Create: `wa-bot/src/database.ts`
- Modify: `wa-bot/src/messageHandler.ts`
- Modify: `wa-bot/src/index.ts`

**Step 1: Create database module**

File: `wa-bot/src/database.ts`

```typescript
import Database from 'better-sqlite3';
import pino from 'pino';
import { ParsedBroadcast } from './aiClient';

const logger = pino({ level: 'info' });

export interface ConversationState {
  user_id: string;
  message_id: string;
  status: 'awaiting_choice' | 'awaiting_edit' | 'awaiting_edit_confirm';
  draft_text: string;
  original_text: string;
  original_media: string; // JSON array
  edited_text?: string;
  broadcast_id?: number;
}

export interface Broadcast {
  id?: number;
  title: string;
  title_en?: string;
  price_main?: number;
  price_secondary?: number;
  format?: string;
  eta?: string;
  close_date?: string;
  type?: string;
  min_order?: string;
  description_en?: string;
  description_id?: string;
  tags?: string; // JSON
  preview_links?: string; // JSON
  media_paths?: string; // JSON
  separator_emoji?: string;
  status: 'draft' | 'approved' | 'scheduled' | 'sent';
}

export class BotDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    logger.info(`Database connected: ${dbPath}`);
  }

  // Conversation state management
  saveConversationState(state: ConversationState) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO conversation_state
      (user_id, message_id, status, draft_text, original_text, original_media, edited_text, broadcast_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    stmt.run(
      state.user_id,
      state.message_id,
      state.status,
      state.draft_text,
      state.original_text,
      state.original_media,
      state.edited_text || null,
      state.broadcast_id || null
    );
  }

  getConversationState(userId: string): ConversationState | null {
    const stmt = this.db.prepare(
      'SELECT * FROM conversation_state WHERE user_id = ?'
    );
    return stmt.get(userId) as ConversationState | null;
  }

  clearConversationState(userId: string) {
    const stmt = this.db.prepare('DELETE FROM conversation_state WHERE user_id = ?');
    stmt.run(userId);
  }

  // Broadcast management
  saveBroadcast(broadcast: Broadcast, parsedData?: ParsedBroadcast, mediaPaths?: string[]): number {
    const stmt = this.db.prepare(`
      INSERT INTO broadcasts
      (title, title_en, price_main, price_secondary, format, eta, close_date, type,
       min_order, description_en, description_id, tags, preview_links, media_paths,
       separator_emoji, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const result = stmt.run(
      broadcast.title,
      broadcast.title_en || null,
      broadcast.price_main || null,
      broadcast.price_secondary || null,
      broadcast.format || null,
      broadcast.eta || null,
      broadcast.close_date || null,
      broadcast.type || null,
      broadcast.min_order || null,
      broadcast.description_en || null,
      broadcast.description_id || null,
      broadcast.tags || null,
      broadcast.preview_links || null,
      broadcast.media_paths || (mediaPaths ? JSON.stringify(mediaPaths) : null),
      broadcast.separator_emoji || null,
      broadcast.status
    );

    return result.lastInsertRowid as number;
  }

  updateBroadcastStatus(id: number, status: string, sentAt?: Date) {
    const stmt = this.db.prepare(`
      UPDATE broadcasts
      SET status = ?, sent_at = ?
      WHERE id = ?
    `);
    stmt.run(status, sentAt?.toISOString() || null, id);
  }

  getBroadcast(id: number): Broadcast | null {
    const stmt = this.db.prepare('SELECT * FROM broadcasts WHERE id = ?');
    return stmt.get(id) as Broadcast | null;
  }

  // Queue management
  addToQueue(broadcastId: number, scheduledTime?: Date): number {
    const stmt = this.db.prepare(`
      INSERT INTO queue (broadcast_id, scheduled_time, status)
      VALUES (?, ?, 'pending')
    `);

    const time = scheduledTime || new Date();
    const result = stmt.run(broadcastId, time.toISOString());
    return result.lastInsertRowid as number;
  }

  getNextQueuedBroadcast(): any | null {
    const stmt = this.db.prepare(`
      SELECT q.*, b.*
      FROM queue q
      JOIN broadcasts b ON q.broadcast_id = b.id
      WHERE q.status = 'pending'
      ORDER BY q.scheduled_time ASC
      LIMIT 1
    `);
    return stmt.get();
  }

  updateQueueStatus(id: number, status: string, errorMessage?: string) {
    const stmt = this.db.prepare(`
      UPDATE queue
      SET status = ?, error_message = ?
      WHERE id = ?
    `);
    stmt.run(status, errorMessage || null, id);
  }

  close() {
    this.db.close();
  }
}
```

**Step 2: Update message handler to save conversation state**

File: `wa-bot/src/messageHandler.ts`

```typescript
// Add import
import { BotDatabase } from './database';

// Update constructor
constructor(
  private sock: WASocket,
  private ownerJid: string,
  private aiClient: AIClient,
  private db: BotDatabase,
  private mediaPath: string = './media'
) {
  // ... existing code
}

// Update processFGBBroadcast to save state
private async processFGBBroadcast(
  message: proto.IWebMessageInfo,
  detection: any
) {
  const from = message.key.remoteJid!;

  try {
    // ... existing media download and AI processing code ...

    // Save broadcast to database (draft status)
    const broadcastId = this.db.saveBroadcast(
      {
        title: parsedData.title || 'Untitled',
        title_en: parsedData.title,
        price_main: parsedData.price_main,
        price_secondary: parsedData.price_secondary,
        format: parsedData.format,
        eta: parsedData.eta,
        close_date: parsedData.close_date,
        type: parsedData.type,
        min_order: parsedData.min_order,
        description_en: parsedData.description_en,
        tags: JSON.stringify(parsedData.tags),
        preview_links: JSON.stringify(parsedData.preview_links),
        separator_emoji: parsedData.separator_emoji,
        status: 'draft',
      },
      parsedData,
      mediaPaths
    );

    logger.info(`Broadcast saved to DB with ID: ${broadcastId}`);

    // Save conversation state
    this.db.saveConversationState({
      user_id: from,
      message_id: message.key.id!,
      status: 'awaiting_choice',
      draft_text: generated.draft,
      original_text: detection.text,
      original_media: JSON.stringify(mediaPaths),
      broadcast_id: broadcastId,
    });

    // ... existing send draft code ...
  } catch (error: any) {
    // ... existing error handling ...
  }
}

// Add method to handle user responses
async handleUserResponse(message: proto.IWebMessageInfo) {
  const from = message.key.remoteJid!;
  const text = (
    message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    ''
  ).trim().toUpperCase();

  // Get conversation state
  const state = this.db.getConversationState(from);
  if (!state) {
    logger.debug('No conversation state found');
    return false; // Not handled
  }

  if (state.status === 'awaiting_choice') {
    if (text === 'YES') {
      await this.handleYesResponse(from, state);
      return true;
    } else if (text === 'EDIT DULU') {
      await this.handleEditResponse(from, state);
      return true;
    } else if (text === 'SCHEDULE') {
      await this.handleScheduleResponse(from, state);
      return true;
    }
  }

  return false; // Not a recognized response
}

private async handleYesResponse(from: string, state: any) {
  // TODO: Send to group
  // For now, just confirm
  await this.sock.sendMessage(from, {
    text: '✅ Broadcast akan dikirim ke grup!\n\n(Fitur pengiriman ke grup akan diimplementasi di task berikutnya)',
  });

  // Update broadcast status
  if (state.broadcast_id) {
    this.db.updateBroadcastStatus(state.broadcast_id, 'approved', new Date());
  }

  // Clear state
  this.db.clearConversationState(from);
}

private async handleEditResponse(from: string, state: any) {
  // Update state
  this.db.saveConversationState({
    ...state,
    status: 'awaiting_edit',
  });

  await this.sock.sendMessage(from, {
    text: '📝 Silakan kirim teks yang sudah diedit.\n\nSetelah selesai, kirim pesan "OK" untuk regenerate draft.',
  });
}

private async handleScheduleResponse(from: string, state: any) {
  // Add to queue
  if (state.broadcast_id) {
    const queueId = this.db.addToQueue(state.broadcast_id);

    await this.sock.sendMessage(from, {
      text: `🕐 Broadcast dimasukkan ke antrian!\n\nQueue ID: ${queueId}\nStatus: Pending\n\n(Scheduler akan mengirim otomatis setiap 47 menit)`,
    });

    // Update broadcast status
    this.db.updateBroadcastStatus(state.broadcast_id, 'scheduled');
  }

  // Clear state
  this.db.clearConversationState(from);
}
```

**Step 3: Update handleMessage to check for responses**

File: `wa-bot/src/messageHandler.ts`

```typescript
async handleMessage(message: proto.IWebMessageInfo) {
  try {
    const from = message.key.remoteJid!;
    const isFromOwner = isOwnerMessage(from, this.ownerJid);

    if (!isFromOwner) {
      return;
    }

    logger.info(`Processing message from owner: ${from}`);

    // First, check if this is a response to previous conversation
    const isResponse = await this.handleUserResponse(message);
    if (isResponse) {
      return; // Already handled
    }

    // Otherwise, check for new FGB broadcast
    const detection = detectFGBBroadcast(message);

    if (detection.isFGBBroadcast) {
      logger.info('FGB broadcast detected!');
      await this.processFGBBroadcast(message, detection);
    }
  } catch (error) {
    logger.error('Error handling message:', error);
  }
}
```

**Step 4: Update whatsapp.ts to pass database**

File: `wa-bot/src/whatsapp.ts`

```typescript
setupMessageHandler(
  ownerJid: string,
  aiClient: any,
  db: any,
  mediaPath: string = './media'
) {
  if (!this.sock) {
    throw new Error('Socket not connected');
  }

  this.messageHandler = new MessageHandler(
    this.sock,
    ownerJid,
    aiClient,
    db,
    mediaPath
  );

  // ... rest stays the same
}
```

**Step 5: Update index.ts to initialize database**

File: `wa-bot/src/index.ts`

```typescript
// Add import
import { BotDatabase } from './database';

// Add database initialization after config load
const dbPath = process.env.DATABASE_PATH || path.resolve('./data/bookstore.db');
const db = new BotDatabase(dbPath);
logger.info('Database initialized');

// Update message handler setup
waClient.setupMessageHandler(
  ownerJid,
  aiClient,
  db,
  path.resolve('./media')
);

// Add cleanup on shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  db.close();
  await waClient.disconnect();
  process.exit(0);
});
```

**Step 6: Test conversation flow**

```bash
# Initialize database first
cd database
npm run init

# Start services
cd ../wa-bot
DATABASE_PATH=../data/bookstore.db npm run dev
```

Expected: Bot saves conversation state and responds to YES/EDIT/SCHEDULE

**Step 7: Commit database integration**

```bash
git add wa-bot/
git commit -m "feat: integrate database for conversation state and broadcasts"
```

---

## Task 12: Scheduler Service Setup

**Files:**
- Create: `scheduler/package.json`
- Create: `scheduler/tsconfig.json`
- Create: `scheduler/src/index.ts`
- Create: `scheduler/Dockerfile`

**Step 1: Create package.json**

File: `scheduler/package.json`

```json
{
  "name": "scheduler",
  "version": "1.0.0",
  "description": "Queue scheduler for broadcast automation",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts"
  },
  "keywords": ["scheduler", "queue", "cron"],
  "license": "MIT",
  "dependencies": {
    "better-sqlite3": "^9.2.0",
    "node-cron": "^3.0.3",
    "pino": "^8.17.0",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/better-sqlite3": "^7.6.8",
    "@types/node-cron": "^3.0.11",
    "typescript": "^5.3.0",
    "ts-node-dev": "^2.0.0"
  }
}
```

**Step 2: Create TypeScript config**

File: `scheduler/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create scheduler implementation**

File: `scheduler/src/index.ts`

```typescript
import cron from 'node-cron';
import pino from 'pino';
import { config } from 'dotenv';
import Database from 'better-sqlite3';
import path from 'path';

config();

const logger = pino({ level: 'info' });

const QUEUE_INTERVAL_MINUTES = parseInt(
  process.env.QUEUE_INTERVAL_MINUTES || '47',
  10
);

class QueueScheduler {
  private db: Database.Database;
  private lastSentTime: Date | null = null;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    logger.info(`Scheduler connected to database: ${dbPath}`);
  }

  start() {
    logger.info(
      `Starting scheduler with ${QUEUE_INTERVAL_MINUTES} minute interval`
    );

    // Check queue every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      await this.processQueue();
    });

    logger.info('Scheduler started, checking queue every 5 minutes');
  }

  private async processQueue() {
    try {
      const now = new Date();

      // Check if enough time has passed since last send
      if (this.lastSentTime) {
        const minutesSinceLastSend =
          (now.getTime() - this.lastSentTime.getTime()) / 1000 / 60;

        if (minutesSinceLastSend < QUEUE_INTERVAL_MINUTES) {
          logger.debug(
            `Waiting for interval (${minutesSinceLastSend.toFixed(1)}/${QUEUE_INTERVAL_MINUTES} min)`
          );
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

    } catch (error) {
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
  const dbPath =
    process.env.DATABASE_PATH || path.resolve('../data/bookstore.db');

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
```

**Step 4: Create Dockerfile**

File: `scheduler/Dockerfile`

```dockerfile
FROM node:20-slim

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('healthy')" || exit 1

# Run application
CMD ["npm", "start"]
```

**Step 5: Test scheduler**

```bash
cd scheduler
npm install
DATABASE_PATH=../data/bookstore.db npm run dev
```

Expected output:
```
Scheduler connected to database: ...
Starting scheduler with 47 minute interval
Scheduler started, checking queue every 5 minutes
```

**Step 6: Commit scheduler service**

```bash
git add scheduler/
git commit -m "feat: add queue scheduler service with cron jobs"
```

---

## Task 13: Docker Compose Orchestration

**Files:**
- Create: `docker-compose.yml` (root)
- Create: `Makefile` (optional, for convenience)

**Step 1: Create Docker Compose file**

File: `docker-compose.yml`

```yaml
version: '3.8'

services:
  ai-processor:
    build:
      context: ./ai-processor
      dockerfile: Dockerfile
    container_name: bookstore-ai-processor
    environment:
      - GEMINI_API_KEY=${GEMINI_API_KEY}
    volumes:
      - sqlite-data:/app/data
      - ./ai-processor/config:/app/config:ro
    ports:
      - "8000:8000"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "python", "-c", "import requests; requests.get('http://localhost:8000/health')"]
      interval: 30s
      timeout: 3s
      retries: 3
    networks:
      - bookstore-net

  wa-bot:
    build:
      context: ./wa-bot
      dockerfile: Dockerfile
    container_name: bookstore-wa-bot
    environment:
      - NODE_ENV=production
      - AI_PROCESSOR_URL=http://ai-processor:8000
      - DATABASE_PATH=/app/data/bookstore.db
      - OWNER_JID=${OWNER_JID}
      - TARGET_GROUP_JID=${TARGET_GROUP_JID}
    volumes:
      - wa-sessions:/app/sessions
      - sqlite-data:/app/data
      - media:/app/media
    restart: unless-stopped
    depends_on:
      ai-processor:
        condition: service_healthy
    networks:
      - bookstore-net

  scheduler:
    build:
      context: ./scheduler
      dockerfile: Dockerfile
    container_name: bookstore-scheduler
    environment:
      - DATABASE_PATH=/app/data/bookstore.db
      - QUEUE_INTERVAL_MINUTES=${QUEUE_INTERVAL_MINUTES:-47}
    volumes:
      - sqlite-data:/app/data
      - media:/app/media
    restart: unless-stopped
    depends_on:
      - wa-bot
    networks:
      - bookstore-net

volumes:
  wa-sessions:
    driver: local
  sqlite-data:
    driver: local
  media:
    driver: local

networks:
  bookstore-net:
    driver: bridge
```

**Step 2: Create Makefile for convenience**

File: `Makefile`

```makefile
.PHONY: help build up down logs restart clean init-db

help:
	@echo "Available commands:"
	@echo "  make init-db   - Initialize database schema"
	@echo "  make build     - Build Docker images"
	@echo "  make up        - Start all services"
	@echo "  make down      - Stop all services"
	@echo "  make logs      - Show logs (all services)"
	@echo "  make restart   - Restart all services"
	@echo "  make clean     - Remove containers, volumes, and images"

init-db:
	@echo "Initializing database..."
	cd database && npm install && npm run init
	@echo "✓ Database initialized"

build:
	docker-compose build

up:
	docker-compose up -d

down:
	docker-compose down

logs:
	docker-compose logs -f

restart:
	docker-compose restart

clean:
	docker-compose down -v
	docker system prune -f
```

**Step 3: Update root .env.example**

File: `.env.example` (update)

```
# Gemini API
GEMINI_API_KEY=your_gemini_api_key_here

# WhatsApp Bot
OWNER_JID=6281234567890@s.whatsapp.net
TARGET_GROUP_JID=group_jid_here@g.us

# Queue
QUEUE_INTERVAL_MINUTES=47

# Database (auto-configured in Docker)
DATABASE_PATH=/app/data/bookstore.db

# AI Processor (auto-configured in Docker)
AI_PROCESSOR_URL=http://ai-processor:8000

# Environment
NODE_ENV=production
```

**Step 4: Test Docker Compose build**

```bash
# Copy env file
cp .env.example .env
# Edit .env with your actual values

# Initialize database
make init-db

# Build all services
make build
```

Expected: All three services build successfully

**Step 5: Test Docker Compose up**

```bash
make up
```

Expected: All services start and remain healthy

Check status:
```bash
docker-compose ps
```

Expected output:
```
NAME                        STATUS
bookstore-ai-processor      Up (healthy)
bookstore-wa-bot            Up
bookstore-scheduler         Up
```

**Step 6: Check logs**

```bash
make logs
```

Expected: Services logging startup messages, no errors

**Step 7: Commit Docker Compose**

```bash
git add docker-compose.yml Makefile .env.example
git commit -m "feat: add Docker Compose orchestration with health checks"
```

---

## Task 14: End-to-End Testing & Documentation

**Files:**
- Create: `docs/testing-guide.md`
- Create: `docs/deployment-guide.md`
- Update: `README.md`

**Step 1: Create testing guide**

File: `docs/testing-guide.md`

```markdown
# Testing Guide - WhatsApp Bookstore Bot

## Prerequisites

- Docker and Docker Compose installed
- Gemini API key
- WhatsApp account for testing
- Sample FGB broadcast messages

## Local Testing

### 1. Environment Setup

\`\`\`bash
# Copy environment template
cp .env.example .env

# Edit .env with your values
nano .env
\`\`\`

Required values:
- `GEMINI_API_KEY`: Your Google Gemini API key
- `OWNER_JID`: Your WhatsApp JID (format: 6281234567890@s.whatsapp.net)
- `TARGET_GROUP_JID`: Target group JID (format: 120363XXXXX@g.us)

### 2. Database Initialization

\`\`\`bash
make init-db
\`\`\`

Verify:
\`\`\`bash
sqlite3 data/bookstore.db ".tables"
# Should show: broadcasts, broadcasts_fts, queue, conversation_state, style_profile
\`\`\`

### 3. Start Services

\`\`\`bash
make build
make up
\`\`\`

Check health:
\`\`\`bash
docker-compose ps
curl http://localhost:8000/health
\`\`\`

### 4. WhatsApp Authentication

View QR code:
\`\`\`bash
docker logs bookstore-wa-bot -f
\`\`\`

Scan QR code with WhatsApp to authenticate.

### 5. Test FGB Broadcast Flow

1. **Forward FGB broadcast** to your WhatsApp (owner account)

Sample test message:
\`\`\`
Remainder | ETA : Apr '26
Close : 20 Des

*Brown Bear Goes to the Museum* (HB)
🏷️ Rp 115.000
*Min. 3 pcs per title. off 10%

Follow Brown Bear and his friends as they explore
all of the different rooms - from the transport
section to the art gallery...

_New Oct_ 🔥

🌳🌳🌳
\`\`\`

2. **Bot should respond** with:
   - Processing message
   - Draft broadcast in Indonesian
   - Approval options (YES / EDIT DULU / SCHEDULE)

3. **Test approval flows**:
   - Reply "YES" → Should confirm approval
   - Reply "EDIT DULU" → Should ask for edited text
   - Reply "SCHEDULE" → Should add to queue

4. **Verify database**:
\`\`\`bash
sqlite3 data/bookstore.db "SELECT * FROM broadcasts ORDER BY id DESC LIMIT 1;"
sqlite3 data/bookstore.db "SELECT * FROM queue WHERE status='pending';"
\`\`\`

### 6. Test Scheduler

Check scheduler logs:
\`\`\`bash
docker logs bookstore-scheduler -f
\`\`\`

Should see:
\`\`\`
Scheduler started, checking queue every 5 minutes
\`\`\`

Wait for scheduled broadcast or trigger manually.

## Unit Testing

### AI Processor Tests

\`\`\`bash
cd ai-processor
pip install -e ".[dev]"
pytest tests/ -v
\`\`\`

### Parser Tests

\`\`\`bash
cd ai-processor
pytest tests/test_parser.py -v
\`\`\`

### Gemini Integration Tests

\`\`\`bash
cd ai-processor
GEMINI_API_KEY=your_key pytest tests/test_gemini.py -v
\`\`\`

## Troubleshooting

### Issue: AI Processor not healthy

Check logs:
\`\`\`bash
docker logs bookstore-ai-processor
\`\`\`

Common causes:
- Invalid GEMINI_API_KEY
- Config files not mounted correctly

### Issue: WhatsApp not connecting

Check logs:
\`\`\`bash
docker logs bookstore-wa-bot
\`\`\`

Common causes:
- Sessions volume not persisted
- QR code not scanned in time
- Invalid OWNER_JID format

### Issue: Broadcasts not in queue

Check database:
\`\`\`bash
sqlite3 data/bookstore.db "SELECT * FROM conversation_state;"
sqlite3 data/bookstore.db "SELECT * FROM queue;"
\`\`\`

Verify status fields are correct.

## Clean Up

\`\`\`bash
# Stop services
make down

# Clean everything (including volumes)
make clean
\`\`\`
```

**Step 2: Create deployment guide**

File: `docs/deployment-guide.md`

```markdown
# Deployment Guide - VPS Oracle

## Prerequisites

- VPS Oracle access (ssh fight-uno)
- Docker and Docker Compose installed on VPS
- Git installed on VPS
- Domain/IP for AI Processor (optional)

## Deployment Steps

### 1. Connect to VPS

\`\`\`bash
ssh fight-uno
\`\`\`

### 2. Clone Repository

\`\`\`bash
cd /opt  # or your preferred location
git clone <repository-url> bot-wa-bookstore
cd bot-wa-bookstore
\`\`\`

### 3. Environment Configuration

\`\`\`bash
cp .env.example .env
nano .env
\`\`\`

Fill in production values:
- GEMINI_API_KEY
- OWNER_JID (dr. Findania's WhatsApp)
- TARGET_GROUP_JID (Ahmari Bookstore group)

### 4. Initialize Database

\`\`\`bash
cd database
npm install
npm run init
cd ..
\`\`\`

### 5. Build and Start Services

\`\`\`bash
make build
make up
\`\`\`

### 6. Verify Services

\`\`\`bash
docker-compose ps
# All services should be "Up"

# Check health
curl http://localhost:8000/health
\`\`\`

### 7. WhatsApp Authentication

\`\`\`bash
docker logs bookstore-wa-bot -f
\`\`\`

Scan QR code with owner's WhatsApp account.

### 8. Setup Auto-Restart

Create systemd service (optional):

File: `/etc/systemd/system/bookstore-bot.service`

\`\`\`ini
[Unit]
Description=WhatsApp Bookstore Bot
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/bot-wa-bookstore
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
User=root

[Install]
WantedBy=multi-user.target
\`\`\`

Enable and start:
\`\`\`bash
systemctl enable bookstore-bot
systemctl start bookstore-bot
\`\`\`

### 9. Monitoring

View logs:
\`\`\`bash
cd /opt/bot-wa-bookstore
make logs
\`\`\`

Check specific service:
\`\`\`bash
docker logs bookstore-wa-bot -f
docker logs bookstore-ai-processor -f
docker logs bookstore-scheduler -f
\`\`\`

### 10. Backup

Backup database and sessions:
\`\`\`bash
# Create backup script
cat > /opt/backup-bookstore.sh <<'EOF'
#!/bin/bash
BACKUP_DIR="/opt/backups/bookstore"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup database
docker run --rm \
  -v bot-wa-bookstore_sqlite-data:/data \
  -v $BACKUP_DIR:/backup \
  alpine tar czf /backup/db_$DATE.tar.gz -C /data .

# Backup sessions
docker run --rm \
  -v bot-wa-bookstore_wa-sessions:/data \
  -v $BACKUP_DIR:/backup \
  alpine tar czf /backup/sessions_$DATE.tar.gz -C /data .

# Keep only last 7 days
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

echo "Backup completed: $DATE"
EOF

chmod +x /opt/backup-bookstore.sh

# Add to cron (daily at 2 AM)
echo "0 2 * * * /opt/backup-bookstore.sh >> /var/log/bookstore-backup.log 2>&1" | crontab -
\`\`\`

## Updates

### Pull Latest Changes

\`\`\`bash
cd /opt/bot-wa-bookstore
git pull
make build
make restart
\`\`\`

### Update Environment

\`\`\`bash
nano .env
make restart
\`\`\`

## Rollback

\`\`\`bash
cd /opt/bot-wa-bookstore
git checkout <previous-commit>
make build
make restart
\`\`\`

## Security

### Firewall

\`\`\`bash
# Only expose AI Processor if needed externally
# Otherwise, keep all services internal

# If exposing AI Processor:
ufw allow 8000/tcp
\`\`\`

### Secrets

- Never commit .env to git
- Use environment variables for sensitive data
- Rotate GEMINI_API_KEY periodically

## Troubleshooting

### Service Won't Start

\`\`\`bash
docker-compose down
docker-compose up
# Watch for errors
\`\`\`

### Out of Disk Space

\`\`\`bash
# Clean up Docker
docker system prune -af --volumes

# Check disk usage
df -h
du -sh /var/lib/docker
\`\`\`

### Database Locked

\`\`\`bash
# Stop all services
docker-compose down

# Remove WAL files
rm data/bookstore.db-wal data/bookstore.db-shm

# Restart
docker-compose up -d
\`\`\`
```

**Step 3: Update main README**

File: `README.md` (update)

```markdown
# Bot WhatsApp Bookstore - Ahmari Bookstore

WhatsApp bot untuk otomasi broadcast promosi buku dengan AI style rewriting.

Converts English book promotion broadcasts from supplier (Forest Gate Bookshop) to Indonesian broadcasts with personalized writing style, featuring interactive approval workflow.

## Features

- ✅ Automatic FGB broadcast detection
- ✅ Flexible parsing for various broadcast formats (YAML-configurable)
- ✅ AI-powered style rewriting (Google Gemini)
- ✅ Interactive approval flow (YES / EDIT DULU / SCHEDULE)
- ✅ Queue scheduler (47-minute intervals)
- ✅ Permanent storage with full-text search
- ✅ Fully containerized with Docker

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    VPS Oracle (Docker)                   │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────────┐      ┌──────────────────┐         │
│  │  WA Bot Service  │◄────►│ AI Processor API │         │
│  │   (Node.js)      │      │  (Python FastAPI)│         │
│  └────────┬─────────┘      └──────────────────┘         │
│           │                                              │
│           ▼                                              │
│  ┌──────────────────┐      ┌──────────────────┐         │
│  │ Queue Scheduler  │◄────►│  SQLite Database │         │
│  └──────────────────┘      └──────────────────┘         │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for local development)
- Python 3.11+ (for local development)
- Gemini API key

### Installation

1. **Clone repository**
   \`\`\`bash
   git clone <repo-url>
   cd bot-wa-bookstore
   \`\`\`

2. **Configure environment**
   \`\`\`bash
   cp .env.example .env
   nano .env  # Fill in your values
   \`\`\`

3. **Initialize database**
   \`\`\`bash
   make init-db
   \`\`\`

4. **Build and start**
   \`\`\`bash
   make build
   make up
   \`\`\`

5. **Authenticate WhatsApp**
   \`\`\`bash
   docker logs bookstore-wa-bot -f
   # Scan QR code
   \`\`\`

## Usage

1. Forward FGB broadcast (text + image) to your WhatsApp
2. Bot parses and generates Indonesian draft
3. Choose action:
   - **YES** → Send immediately to group
   - **EDIT DULU** → Edit manually, then regenerate
   - **SCHEDULE** → Add to queue (47-min intervals)

## Development

See detailed guides:
- [Design Document](docs/plans/2025-11-28-whatsapp-bookstore-bot-design.md)
- [Implementation Plan](docs/plans/2025-11-28-whatsapp-bookstore-bot-implementation.md)
- [Testing Guide](docs/testing-guide.md)
- [Deployment Guide](docs/deployment-guide.md)

## Services

- **wa-bot** (Node.js + TypeScript + Baileys): WhatsApp connection & conversation handler
- **ai-processor** (Python + FastAPI + Gemini): Parsing & AI generation
- **scheduler** (Node.js + node-cron): Queue processing

## Commands

\`\`\`bash
make help        # Show available commands
make build       # Build Docker images
make up          # Start all services
make down        # Stop all services
make logs        # View logs
make restart     # Restart services
make clean       # Clean up everything
\`\`\`

## License

MIT

## Contact

Ahmari Bookstore - Dr. Findania
```

**Step 4: Test documentation**

Review all documentation files for accuracy and completeness.

**Step 5: Commit documentation**

```bash
git add docs/ README.md
git commit -m "docs: add comprehensive testing and deployment guides"
```

---

## Summary

This implementation plan provides **bite-sized tasks** (2-5 minutes each) covering:

1. ✅ Project structure & Docker setup
2. ✅ Database schema with FTS5
3. ✅ AI Processor service (parser + Gemini)
4. ✅ WhatsApp Bot service (Baileys + message handling)
5. ✅ Database integration & conversation state
6. ✅ Queue Scheduler service
7. ✅ Docker Compose orchestration
8. ✅ Testing & deployment documentation

Each task follows TDD principles where applicable and includes exact commands with expected outputs. The engineer has zero codebase context and can follow this step-by-step to build the complete system.

**Next steps after completion:**
- Extract real style profile from WhatsApp chat export
- Implement actual group broadcasting (currently placeholder)
- Add semantic search for broadcast archive
- Deploy to VPS Oracle in isolated environment

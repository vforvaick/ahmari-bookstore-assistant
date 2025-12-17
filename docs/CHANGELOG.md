# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Planned
- Persistence for conversation state.
- Documentation for VPS deployment.

## [1.3.0] - 2025-12-17

### Added
- **Hybrid Rule-Based + AI Approach**: Refactored AI processor for more reliable output.
  - Rule-based handling for: price markup, template structure, link cleanup
  - AI now only generates: review paragraph + publisher guess
  - More consistent output format matching Gemini Gems template

- **Price Markup Configuration**: Configurable markup via bot commands.
  - `/setmarkup <value>` - Set price markup (e.g., `/setmarkup 20000`)
  - `/getmarkup` - View current markup
  - `/status` now shows current markup
  - Default: Rp 20.000

- **Output Formatter Module**: New `output_formatter.py` with:
  - Precise price calculation (no AI involvement)
  - Instagram link cleanup (removes `?igshid=...`)
  - YouTube link cleanup (removes `?si=...`)
  - Template-based structure matching Gemini Gems

- **Publisher Detection**: Parser now extracts publisher name from raw text.
  - Supports explicit "Publisher:" format
  - Detects known publishers (Usborne, DK, Britannica, etc.)
  - Falls back to AI guess if not found

### Changed
- **AI Processor API**: Added `/config` GET/POST endpoints for runtime configuration.
- **Gemini Prompt**: Simplified to focus on review generation only (JSON output).
- **Status Command**: Now includes price markup information.
- **Help Command**: Updated with new markup commands.

### Files Modified
- `ai-processor/models.py` (added `publisher` field)
- `ai-processor/config/parser-rules.yaml` (added publisher patterns)
- `ai-processor/output_formatter.py` (NEW)
- `ai-processor/gemini_client.py` (refactored for review-only)
- `ai-processor/main.py` (added /config endpoints)
- `wa-bot/src/aiClient.ts` (added config methods)
- `wa-bot/src/messageHandler.ts` (added /setmarkup, /getmarkup)

### Reference
- Session: d8e24723-dba5-48d7-92ea-30fb4a9f4b7e


## [1.2.2] - 2025-12-15

### Security
- **API Key Leak**: Remediated exposed Google API keys in `ai-processor/test_api_keys.py`.
  - Moved hardcoded keys to `.env` file.
  - Refactored script to safer pattern using `python-dotenv`.
  - **Action Required**: Keys must be revoked in Google Cloud Console.

### Files Modified
- `ai-processor/test_api_keys.py`
- `ai-processor/.env` (updated)
- `ai-processor/requirements.txt` (added `python-dotenv`)

## [1.2.1] - 2025-12-14

### Fixed
- **AI Processor 500 Error**: Fixed HTTP 500 errors during broadcast generation.
  - Root cause: `gemini-2.0-flash-exp` model quota exceeded
  - Solution: Switched to `gemini-2.5-flash` (confirmed working on all keys)
  - Added null-safety in prompt building to prevent crashes
  - Improved error logging with full tracebacks

- **FGB Broadcast Detection**: Fixed detector not recognizing forwarded messages.
  - Added support for quoted/forwarded message content
  - Relaxed pattern matching (media no longer required)
  - Added price tag emoji pattern (🏷️ Rp)

### Added
- **Command Center**: WhatsApp slash commands for bot management.
  - `/help` - Show available commands
  - `/status` - Bot status and configuration
  - `/groups` - List all groups bot has joined
  - `/setgroup <JID>` - Set target group for broadcast
  - `/cancel` - Clear pending draft

- **YES/EDIT/CANCEL Handler**: Response handling for draft broadcasts.
  - Reply YES to send broadcast to target group
  - Reply EDIT for manual editing
  - Reply CANCEL to discard draft

### Changed
- **Default Model**: Changed from `gemini-2.0-flash-exp` to `gemini-2.5-flash`
- **Error Handling**: Added detailed traceback logging in `/generate` endpoint
- **AI Generation Style**: Refined prompt with Few-Shot examples from chat history for more authentic "Istri" persona.

### Files Modified
- `ai-processor/gemini_client.py` (rebuilt with improved logging)
- `ai-processor/main.py` (better error handling)
- `docker-compose.yml` (updated default model)
- `wa-bot/src/detector.ts` (improved FGB detection)
- `wa-bot/src/messageHandler.ts` (command center + YES handler)

### Reference
- Session: 64d153f5-df45-4dff-8d7c-d3327cf14fbd

## [1.2.0] - 2025-12-08

### Changed
- **Session Storage Migration**: Migrated Baileys authentication from file-based (`useMultiFileAuthState`) to SQLite-based (`useSqliteAuthState`) for improved reliability.
  - Eliminates session corruption issues in Docker environments
  - Atomic database operations prevent race conditions
  - Simplified backup/restore (single `session.db` file)
  - Better cross-environment consistency (local-VPS, dev-prod)
  - Multi-session ready architecture

### Added
- **SQLite Auth State Module**: New `wa-bot/src/sqliteAuthState.ts` implementing Baileys-compatible auth state with `better-sqlite3`.
- **Database Schema**: Added `wa_auth_state` table for storing WhatsApp credentials and keys.

### Files Modified
- `wa-bot/src/sqliteAuthState.ts` (NEW)
- `wa-bot/src/whatsapp.ts`
- `database/schema.sql`
- `docs/architecture.md`
- `docs/BAILEYS-SETUP-GUIDE.md`

### Reference
- Session: 53a2ad5b-3c6e-4341-8947-c4bd397aa440

## [1.1.0] - 2025-12-08

### Added
- **Telegram Integration**: Added `telegram-bot` service for multi-channel broadcasting.
- **Service API**: HTTP endpoint for triggering Telegram broadcasts from Scheduler.


## [1.0.0] - 2025-11-28

### Added
- **Core Platform**: Launched initial MVP with 3 microservices (WA Bot, AI Processor, Scheduler).
- **AI Processing**: Flexible FGB broadcast parsing regex and Gemini-based style rewriting.
- **WhatsApp Integration**: Baileys-based connection with QR auth, pattern detection for forwarded messages.
- **Scheduling**: 47-minute interval queue system to prevent spam flagging.
- **Infrastructure**: Full Docker Compose setup with health checks and volume management.
- **Database**: SQLite schema with Full-Text Search (FTS5) for broadcast history.

### Reference
- **Repo State**: Functionally complete for local testing.

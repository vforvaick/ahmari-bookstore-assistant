# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Planned
- Persistence for conversation state.
- Documentation for VPS deployment.

## [1.2.1] - 2025-12-14

### Fixed
- **AI Processor 500 Error**: Fixed HTTP 500 errors during broadcast generation.
  - Root cause: `gemini-2.0-flash-exp` model quota exceeded
  - Solution: Switched to `gemini-2.5-flash` (confirmed working on all keys)
  - Added null-safety in prompt building to prevent crashes
  - Improved error logging with full tracebacks

### Changed
- **Default Model**: Changed from `gemini-2.0-flash-exp` to `gemini-2.5-flash`
- **Error Handling**: Added detailed traceback logging in `/generate` endpoint

### Files Modified
- `ai-processor/gemini_client.py` (rebuilt with improved logging)
- `ai-processor/main.py` (better error handling)
- `docker-compose.yml` (updated default model)

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

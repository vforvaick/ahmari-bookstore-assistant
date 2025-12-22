# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **Caption Generator (`/caption` command)**: Generate promotional text from poster/cover images
  - AI-powered image analysis using Gemini Vision
  - Auto-detects series (multiple books) vs single book cover
  - Extracts series name, publisher, book titles, description
  - Supports 3-tier recommendation levels (1=Standard, 2=Recommended, 3=Top Pick)
  - Full flow: `/caption` → send image → confirm details → level → draft → YES/EDIT

- VPS optimization scripts (`scripts/vps-setup.sh`, `scripts/health-check.sh`)
- Memory limits for Docker containers (1GB total: 400M + 350M + 128M + 128M)
- Auto-restart cron (daily 4 AM WIB) and cleanup (weekly Sunday)
- 2GB swap file setup for low-memory VPS

### Technical
- New `caption_analyzer.py` module with Gemini Vision integration
- New Pydantic models: `CaptionAnalysisResult`, `CaptionGenerateRequest`, `CaptionGenerateResponse`
- New API endpoints: `POST /caption/analyze`, `POST /caption/generate`
- New aiClient methods: `analyzeCaption()`, `generateCaption()`
- New `CaptionState` interface in messageHandler.ts

### Pending
- Unit tests for AI processor.
- Documentation for VPS deployment.
- Persist scheduled broadcasts to database (currently in-memory only).

### In Progress
- **Poster Generator Feature** - Hybrid AI + Code image manipulation for creating promotional posters.
  - Phase 1 (Core Engine): ✅ Complete
  - Phase 2 (AI Background): Pending
  - Phase 3 (WhatsApp Integration): Pending
  - Phase 4 (Polish): Pending

### Planned
- Persistence for conversation state.

## [2.0.0-alpha] - 2025-12-21 - Poster Generator

### Added
- **Poster Generator Feature** (`ai-processor/poster/`):
  - Core: presets.py, analyzer.py, layout.py, renderer.py, generator.py
  - AI: background.py (5 types: ai_creative, gradient, stripes, solid, user)
  - API: `/poster/options`, `/poster/generate` endpoints

- **WhatsApp Bot Integration**:
  - `/poster [platform]` command for poster generation
  - Multi-image collection flow with DONE/CANCEL
  - Background selection (gradient/stripes/solid/ai_creative)
  - Platform presets: ig_story, ig_square, ig_portrait, wa_status

### Technical
- Added `Pillow>=10.0.0` to requirements.txt
- Added PosterState interface and posterState field to messageHandler.ts
- Added getPosterOptions, generatePoster to aiClient.ts
- API version bumped to 2.2.0

## [1.9.0] - Search Pagination & User Experience
### Added
- **Search Pagination:** Fetch 10 results (API max) and display 5 per page with `NEXT` / `PREV` navigation.
- **Clean EDIT Draft:** Choosing `EDIT` (6) now auto-sends the clean draft text for easy copy-pasting.

### Improved
- **No-Results Hint:** Better error message suggesting to add publisher or be more specific.

## [1.8.2] - Feedback-Driven Research & Fixes

### Added
- **Feedback-Driven REGEN:** Option to regenerate AI description based on user feedback (e.g., "terlalu panjang", "kurang menarik").
- **Numbered Selection:** Draft menu now supports number inputs (1-7) for all options (YES, DEV, COVER, LINKS, REGEN, EDIT, CANCEL).
- **Publisher Domain Mapping:** Enhanced publisher extraction using source URL domains (e.g., flyingeyebooks.com → Flying Eye Books).

### Fixed
- **Cover Image Draft:** Fixed issue where cover image wasn't appearing in draft (cross-container path issue).
- **Truncated Descriptions:** Increased AI max output tokens to 4096 to prevent cut-off reviews.
- **Publisher Display:** Fixed missing publisher name in draft header by improving extraction logic.

## [1.8.1] - 2025-12-21

### Added
- **Simplified Research Flow:**
  - **Deduplicated Results:** Search results now filtered by cleaned title to remove duplicates.
  - **Cleaner Format:** Results show `*Title* | Publisher 📷` with camera icon if cover available.
  - **Cover Management:** Added `COVER` option in draft stage to search/change cover image.

### Changed
- **Auto-Cover Flow:** Removed manual image selection step after book selection. System now auto-downloads the first available cover image and proceeds directly to details.
- **Improved UX:** Reduced friction in `/new` command by removing intermediate image selection state.


## [1.8.0] - 2025-12-21

### Added
- **Enhanced Research Mode (`/new` command):**
  - **Clean Display Titles:** Titles now formatted as "Book Title | Publisher: X" with 20+ patterns to strip site/author/prize suffixes.
  - **Cover Image Selection:** After selecting a book, user can choose from 5 cover images found via Google Image Search, or send their own.
  - **Enriched Description:** AI now receives description aggregated from 3 search sources for better, more detailed reviews.
  - **Publisher Detection:** Automatic publisher extraction from 18 known publisher domains.

### Changed
- Research flow now has additional state (`image_selection_pending`) for cover selection.
- AI Processor has 4 new endpoints: `/research/search-images`, `/research/enrich`, `/research/display-title`, enhanced `/research` endpoint.

### Technical
- `book_researcher.py`: Added `search_images()`, `enrich_description()`, `get_display_title()`, `_extract_publisher_from_url()`.
- `aiClient.ts`: Added corresponding client methods.
- `messageHandler.ts`: Updated with new ResearchState fields and flow logic.



## [1.7.0] - 2025-12-20

### Added
- **Target Group Control:**
  - `YES DEV` / `SCHEDULE DEV <min>`: Send to development group (`120363335057034362@g.us`).
  - `YES` / `SCHEDULE <min>`: Send to production group (`120363420789401477@g.us`).
- **Queue Management:**
  - `/queue`: View list of scheduled broadcasts with countdown timer.
  - `/flush`: Cancel all scheduled timers and send queued broadcasts immediately (10-15s random interval).
- **Preview Link Search:** `LINKS` option in drafts to search and add valid preview links (Google Books, YouTube, etc.).

### Fixed
- **Timezone Issue:** Added `TZ=Asia/Jakarta` to `docker-compose.yml` so bot shows correct WIB time.
- **Schedule Routing:** Fixed bug where `SCHEDULE` command was defaulting to old group ID; updated VPS `.env` to correct production group ID.
- **AI Rate Limits:** Added support for multiple Gemini API keys with automatic rotation on 429 errors.


## [1.6.0] - 2025-12-19

### Added
- **Web Research Mode** (`/new` command): Create promotional materials from scratch when no FGB raw material is available.
  - `/new <book title>` - Search for books using Google Custom Search API
  - Shows multiple relevant results (up to 5), user picks by number
  - User confirms/inputs details: price, format (HB/PB/BB), ETA, close date
  - Auto-downloads book cover image from web (with option to use own image)
  - Generates promo using same AI + template as FGB conversions
  - Supports all 3 recommendation levels
- **Web Research Feature (v1.6.0):** Create promos from web search (`/new <title>`). Supports Google Custom Search, image auto-download, and AI-powered review generation.
- **Search Logic Improvements:** Added noise filtering (Reddit/Pinterest/YouTube exclusion) and "children's book" context to search queries.
- **AI Title Cleaning:** Added logic to extract and use clean book titles from AI analysis, fixing raw search result titles in drafts.
- **Connection Stability:** Added `keepAlive` ping to WhatsApp connection to prevent zombie state.

- **New AI Processor Endpoints**:
  - `POST /research` - Search for books by title/query
  - `POST /research/generate` - Generate promo from researched book + user details
  - `POST /research/download-image` - Download book cover image from URL

- **BookResearcher Module**: New Python module (`book_researcher.py`) for web research functionality.
  - Google Custom Search API integration
  - Automatic extraction of title, author, publisher, description, and cover image
  - Known publisher detection (Usborne, DK, Britannica, etc.)

### Changed
- **Help Command**: Updated with `/new` command usage instructions.
- **API Version**: AI Processor updated to v2.1.0.

### Configuration Required
- `GOOGLE_SEARCH_API_KEY` - Google Custom Search API key
- `GOOGLE_SEARCH_CX` - Custom Search Engine ID

### Files Modified
- `ai-processor/book_researcher.py` (NEW)
- `ai-processor/main.py` (new endpoints)
- `ai-processor/models.py` (new Pydantic models)
- `ai-processor/requirements.txt` (added httpx)
- `wa-bot/src/aiClient.ts` (new methods)
- `wa-bot/src/messageHandler.ts` (/new command + research state machine)
- `.env.example` (new env vars)

### Reference
- Session: 5b1e830b-d4de-4275-9144-9697e44f6985

---

## [1.5.0] - 2025-12-18

### Added
- **Bulk Forward Mode**: Handle multiple FGB broadcasts at once.
  - `/bulk [1|2|3]` - Start bulk mode with specified level (default: 2)
  - `/done` - Finish collecting, start processing
  - Quiet collection with counter feedback (✓ 1, ✓ 2, ...)
  - Consolidated text-only preview (no images in preview)
  - 2-minute auto-timeout if no `/done` sent

- **Bulk Send Options**:
  - `YES` - Send all immediately with random 15-30 second delays
  - `SCHEDULE X` - Schedule broadcasts X minutes apart (e.g., `SCHEDULE 47`)
  - `CANCEL` - Cancel all pending broadcasts

- **Error Handling for Bulk**: Failed items are skipped with warning, successful items continue processing.

### Changed
- **Help Command**: Updated with bulk mode instructions and usage examples.
- **Message Handler**: Extended state machine to support bulk collection, preview, and sending states.

### Technical Details
- Added `BulkState` and `BulkItem` interfaces
- Added timeout reset on each new bulk item
- Schedule uses in-memory setTimeout (lost on restart - documented limitation)

### Files Modified
- `wa-bot/src/messageHandler.ts` (bulk mode implementation)

### Reference
- Session: eb3d7a6e-e6f1-4359-98e1-9c8ac1f6a0b6

---

## [1.4.0] - 2025-12-18

### Added
- **3-Tier Recommendation Level System**: User-selectable tone for AI reviews.
  - **Level 1 (Standard)**: Informative, soft-sell (educate + soft nudge).
  - **Level 2 (Recommended)**: Persuasive, value-driven (interest + desire).
  - **Level 3 (Top Pick)**: "Racun Mode", high FOMO, urgency.
  - Includes "⭐ Top Pick Ahmari Bookstore" marker line for Level 3.

- **Level Selection Flow**: New 2-step process in WA Bot.
  - Forward FGB → Bot prompts for level (1/2/3) → User replies number → Bot generates draft.

### Changed
- **AI Prompts**: Completely rewritten `gemini_client` prompts to be distinct and selling-focused.
- **Timeout**: Increased AI processing timeout from 30s to **60s** to accommodate slow VPS responses.
- **Generative Config**: Increased `max_output_tokens` to 2048 to prevent truncation of long reviews.

### Fixed
- **Truncated AI Reviews**: Added explicit instruction and increased token limit to ensure complete paragraphs.
- **Timeout Errors**: Fixed `AxiosError: timeout exceeded` on low-spec VPS by doubling timeout.

### Files Modified
- `ai-processor/models.py` (added level field)
- `ai-processor/gemini_client.py` (level-specific prompts, increased tokens)
- `ai-processor/output_formatter.py` (Top Pick marker logic)
- `ai-processor/main.py` (handle level param)
- `wa-bot/src/messageHandler.ts` (state machine for level selection)
- `wa-bot/src/aiClient.ts` (level param, 60s timeout)

---

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

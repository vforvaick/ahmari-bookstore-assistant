# Roadmap

## Vision
To completely automate the promotional workflow for Ahmari Bookstore, maintain a consistent and engaging brand voice using AI, and manage broadcast scheduling effectively to maximize engagement without spamming.

## Planned Features

### High Priority
- [x] **Poster Generator Feature** ✅
  - **Why**: Automated poster creation from book covers via WhatsApp.
  - Phase 1-4 complete: Core, AI Background, API, WA Bot
  - **Ref**: Session 23e1df10-1953-48ff-8c81-ff6ae009deb2

- [x] **Broadcast History & Persistent Queue** ✅ 2025-12-26
  - New `broadcastStore.ts` module for SQLite-based broadcast persistence
  - `/history [N]` and `/search <keyword>` commands
  - Scheduled broadcasts now survive restarts
  - Queue processor auto-sends scheduled broadcasts
  - **Ref**: Session bd402439-4412-4f67-b9d6-08d4ebf5101d

- [x] **Conversation State Persistence** ✅ 2025-12-24
  - States persist to SQLite; survives restarts
  - Multi-user support, 10-min TTL, auto-cleanup
  - **Ref**: Session 29ef2c93-499e-438a-ace8-b3a60ab3bea8

- [x] **Deployment Documentation** ✅ 2025-12-24
  - **Why**: Ensure reproducible deployments on VPS.
  - **Location**: `docs/DEPLOYMENT.md`
  - **Ref**: Session 29ef2c93-499e-438a-ace8-b3a60ab3bea8

### Medium Priority
- [ ] **Web Dashboard**
  - **Description**: A web interface tailored for queue management.
  - **Value**: Easier visual management of scheduled posts.

- [ ] **Auto-Learning Style Profile**
  - **Description**: Automatically update style profile based on recent manual edits or chat history.
  - **Value**: Continuous improvement of AI tone accuracy.

### Low Priority
- [ ] **Multi-User Support**: Allow multiple admins to approve broadcasts.
- [ ] **Broadcast Analytics**: Track open rates or engagement (limited by WhatsApp API).
- [ ] **Multi-Supplier Support**: Extend parser to handle formats other than FGB.

## Known Issues
- **IntegrationHarness State Persistence**: During integration tests, calling `reply()` clears captured messages, which complicates testing flows that depend on previous AI-generated state (Draft Commands).

## Backlog

> [!NOTE]
> Items below are ideas/requests to be evaluated and prioritized later.

### UX Improvements
- [x] **Improve `/help` Command Readability** ✅ 2025-12-23
  - Grouped by purpose: "Buat Promo", "Buat Poster", "Jadwal", "Admin"
  - Added argument examples for `/bulk`, `/new`, `/poster`
  - Bahasa Indonesia friendly

- [x] **Unified Draft Command System** ✅ 2025-12-24
  - Implemented `parseDraftCommand()` in `draftCommands.ts`
  - All flows now share consistent commands
  - Bulk mode supports item selection (e.g., "1,2,4")

### Architecture
- [ ] **Codebase Refactor Proposal**
  - **Why**: As features grow, evaluate architecture for maintainability.
  - **Action**: Create detailed refactor proposal analyzing current structure and suggesting improvements.
  - **Status**: Needs analysis phase first.

### Performance
- [x] **Gemini API Efficiency Audit** ✅ 2025-12-23
  - **Finding**: Poster analyzer is only AI call that can be optimized
  - **Solution**: Ask user "Single or Multi cover?" → skip AI detection for single
  - **Impact**: 100% reduction in poster analyzer API calls when user selects single
  - Auto-detect image-only messages → removed `/caption` command

## Technical Debt
- **Refactor `TASKLIST.md`**: Legacy task tracking should be fully deprecated in favor of this ROADMAP.md.
- **Fix `IntegrationHarness` State Management**: Improve the test harness to preserve or properly snapshot state so Draft Commands (SEND/EDIT/REGEN) can be fully verified.
- ~~**Scheduler Container Refactor**~~: ✅ Fixed (2025-12-29) - Added keep-alive heartbeat to prevent immediate exit.

## Recently Completed
- [x] **PO Type Prefix Feature** ✅ (2026-01-20)
  - ✅ Support for adding PO type prefixes (PO REGULER, FAST PO, etc.) to drafts.
  - ✅ New menu option `8. *PO*` in draft menu.
  - ✅ Numbered selection (1-6) for PO types.
  - ✅ Bold/Caps formatting for prefixes.
  - **Ref**: Session 4cfb4465-59c6-4d7a-b2dc-8705d8c72389

- [x] **EDIT Flow Fix** ✅ (2026-01-11)
  - ✅ Fixed state clearing bug after "EDIT" command.
  - ✅ Implemented `awaiting_edited_text` state for direct edited text broadcasting.
  - ✅ Added navigation support (CANCEL/BACK) in edit mode.
  - **Ref**: Session fffcf544-f794-41f9-b598-075906c14224

- [x] **Hybrid Parser for Littlerazy** ✅ (2026-01-09)
  - ✅ Rule-first, AI-fallback approach for unpredictable formats.
  - ✅ Integrated structured LLM extraction (`ai_parser.py`).
  - ✅ Automatic detection of parse failures via `is_complete()`.
  - ✅ Transparent integration to existing WA Bot flow.
  - ✅ Added `stock`, `pages`, and `ai_fallback` tracking.
  - **Ref**: Session 88f4d26d-2baa-4ce3-8d00-c3065f344685

- [x] **Integration Testing Framework & Coverage Boost** ✅ (2026-01-07)
  - ✅ Achieved **55.67% total coverage** (Project target: 55%).
  - ✅ Implemented `research-flow.test.ts` (multi-step integration).
  - ✅ Fixed critical state persistence bug in MessageHandler.
  - ✅ Resolved timer leaks during tests (MessageHandler.destroy()).
  - ✅ Added Indonesian month support for localized date parsing.
  - ✅ Integrated `MOCK_AI` for cost-effective local testing.

- [x] **VPS Migration (fight-dos → fight-cuatro)** ✅ (2025-12-29)
  - Migrated from 1GB RAM (99% utilization) to 2GB RAM (50% utilization)
  - Fresh deploy + session transfer strategy
  - fight-dos now available for CLIProxy migration

- [x] **Integration Testing Framework** ✅ (2025-12-27)
  - ✅ Implemented real AI integration tests (Jest + ts-jest)
  - ✅ Created structured JSON test logger
  - ✅ Added comprehensive test suites (Detector, FGB, Littlerazy)
  - ✅ Created `integrationHarness.ts` for simulating WhatsApp environment

- **Multi-Owner & Concurrency Fix** (2025-12-26)
  - ✅ Support for multiple admins (Comma-separated .env)
  - ✅ Fixed race condition with Per-User State Isolation Map
  - ✅ Both owners can use bot simultaneously

- [x] **Back Navigation (Cancel/Undo)** ✅ (2025-12-26)
  - ✅ Support for `0`/`BACK` command in all flows
  - ✅ State history restoration (undo capability)
  - ✅ Updated prompts with navigation hints

- **Database Persistence** (2025-12-26)
  - ✅ SQLite Broadcast History & Queue
  - ✅ Broadcasts survive restarts

- **UX: Revamped /help Command** (2025-12-25)
  - ✅ Friendly greeting & visual separators
  - ✅ Use-case driven structure (Broadcast vs Image)
  - ✅ Clearer bulk instructions

- **Multi-Supplier Parsing** (2025-12-24)
  - ✅ Support for FGB and Littlerazy suppliers
  - ✅ `littlerazy_parser.py` implementation
  - ✅ Interactive supplier selection on forward

- **Unified Draft System** (2025-12-24)
  - ✅ Consistent commands across all flows (YES, SCHEDULE, REGEN, COVER, LINKS)
  - ✅ Bulk item selection (reply "1,2,4" to select specific items)
  - ✅ New `draftCommands.ts` utility module

- **Feature Deprecation** (2025-12-24)
  - ✅ **telegram-bot service**: Removed to save RAM (128MB)
  - ✅ **/poster command**: Removed poster system (save ~500 lines code, zero AI cost)

- **Poster Generator Phase 1** (2025-12-21)
  - ✅ Platform dimension presets (IG, WA)
  - ✅ AI cover detection with Gemini Vision
  - ✅ Grid layout calculation engine
  - ✅ Pillow-based image rendering

- **Simplified Research Flow v1.8.1** (2025-12-21)
  - ✅ Deduplicated result display
  - ✅ Auto-download cover
  - ✅ COVER option in draft

- **Enhanced Research Mode v1.8.2** (2025-12-21)

- **Enhanced Research Mode v1.8.1** (2025-12-21)
  - ✅ Clean display titles (Publisher extraction)
  - ✅ Cover image selection step
  - ✅ Enrichment from multiple search sources


- **Target Group & Queue Management** (2025-12-20)
  - ✅ DEV vs PRODUCTION target groups (`YES` vs `YES DEV`)
  - ✅ `/queue` command to view pending schedules
  - ✅ `/flush` command to force send all queued items
  - ✅ Timezone fix (WIB)
  - ✅ Preview Link Search (`LINKS` option)

- **Web Research Mode** (2025-12-19)
  - ✅ `/new <book title>` command for creating promos from scratch
  - ✅ Google Custom Search API integration
  - ✅ Multi-result selection flow
  - ✅ User-confirmed price/format/ETA details
  - ✅ Auto-download book cover images

- **Bulk Forward Mode** (2025-12-18)
  - ✅ `/bulk` command for batch processing
  - ✅ Scheduled sending with custom intervals

- **3-Tier Recommendation System** (2025-12-18)
  - ✅ Level 1/2/3 tone selection
  - ✅ "Top Pick" racun mode

- **SQLite Session Migration** (2025-12-08)
  - ✅ Migrated from file-based to SQLite-based auth state
  - ✅ Improved reliability across Docker/VPS environments
  - ✅ Multi-session architecture support

- **Telegram Integration** (2025-12-08)
  - ✅ Added Telegram bot service
  - ✅ Multi-channel broadcasting capability

- **Core MVP Release** (2025-11-28)
  - ✅ Project Structure Setup
  - ✅ Database Schema (SQLite + FTS5)
  - ✅ AI Processor Service (FastAPI + Gemini)
  - ✅ WhatsApp Bot Service (Baileys)
  - ✅ Scheduler Service (Node-cron)
  - ✅ Docker Composition

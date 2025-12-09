# Roadmap

## Vision
To completely automate the promotional workflow for Ahmari Bookstore, maintain a consistent and engaging brand voice using AI, and manage broadcast scheduling effectively to maximize engagement without spamming.

## Planned Features

### High Priority
- [ ] **Conversation State Persistence** (Database Integration)
  - **Why**: Currently state is in-memory; needed for robust YES/EDIT/SCHEDULE workflow reliability across restarts.
  - **Status**: Blocked by Implementation.
  - **Ref**: Task 11 in original plan.

- [ ] **Deployment Documentation**
  - **Why**: Ensure reproducible deployments on VPS.
  - **Status**: Pending.
  - **Ref**: Task 14 in original plan.

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
- None currently documented.

## Technical Debt
- **Refactor `TASKLIST.md`**: Legacy task tracking should be fully deprecated in favor of this ROADMAP.md.

## Recently Completed

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

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

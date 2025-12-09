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

See [Architecture Documentation](docs/architecture.md)

## Documentation

- [Roadmap](docs/ROADMAP.md) - Planned features and known issues.
- [Changelog](docs/CHANGELOG.md) - History of changes.
- [Deployment Notes](docs/DEPLOYMENT-NOTES.md) - Specifics for fight-dos VPS.


## WhatsApp Authentication & Group JID

- **Pairing code (recommended on server):**
  - Set `PAIRING_PHONE` (digits only, e.g. `6285xxxx`) or ensure `OWNER_JID` is set.
  - Run `npm run pair` inside `wa-bot` (or `docker exec bookstore-wa-bot node dist/pairing.js` after build).
  - Open WhatsApp > Linked devices > Link with phone number, enter the code shown.
- **List group JIDs (after logged in):**
  - Run `npm run list:groups` inside `wa-bot` (or `docker exec bookstore-wa-bot node dist/listGroups.js`).
  - Copy the desired JID and set `TARGET_GROUP_JID` in `.env`.

## Deployment Notes (fight-dos host-mode)
- IP fight-uno ditolak WA (401/Connection Failure). Gunakan VPS `fight-dos` (1c1g) untuk konek WA.
- Di `fight-dos` (tanpa Docker):
  ```
  export PATH=$HOME/node-v20.18.0-linux-x64/bin:$PATH
  cd ~/bot-wa-bookstore/wa-bot
  # install deps sekali
  node ~/node-v20.18.0-linux-x64/lib/node_modules/npm/bin/npm-cli.js install
  # jalankan bot
  OWNER_JID=6285121080846@s.whatsapp.net \
  TARGET_GROUP_JID=120363335057034362@g.us \
  AI_PROCESSOR_URL=http://ai-processor:8000 \
  npm run dev
  ```
- Sync sesi dari lokal (yang sudah login): `scp -r wa-bot/sessions fight-dos:~/bot-wa-bookstore/wa-bot/sessions`
- Dokumen detail: `docs/DEPLOYMENT-NOTES.md`

# Deployment Notes (Dec 2025)

## Current Reality
- **fight-uno (VPS utama)**: WhatsApp login ditolak (401/Connection Failure) meski sesi valid. Baileys di container dan host selalu logout loop. Kemungkinan IP diberi rate-limit/deny oleh WA.  
- **fight-dos (VPS 1c1g)**: WhatsApp login OK memakai sesi yang sama. Node 20 portable dipakai di host (belum ada Docker). Disarankan menjalankan bot di fight-dos sampai fight-uno diizinkan (atau gunakan VPN/proxy di fight-uno).

## Sesi & Target Group
- Sesi stabil ada di lokal (`wa-bot/sessions`) dan sudah bisa list grup.  
- Grup target yang terdeteksi: `120363335057034362@g.us`.

## Host-Run di fight-dos (tanpa Docker)
1) SSH: `ssh fight-dos`
2) Tambah Node 20 portable ke PATH:
   ```
   export PATH=$HOME/node-v20.18.0-linux-x64/bin:$PATH
   ```
3) Sync repo (setelah push/pull): `cd ~/bot-wa-bookstore`
4) Copy sesi dari lokal (jalan di mesin lokal):
   ```
   scp -r wa-bot/sessions fight-dos:~/bot-wa-bookstore/wa-bot/sessions
   ```
5) Install deps (sekali, atau setelah pull package update):
   ```
   cd ~/bot-wa-bookstore/wa-bot
   node ~/node-v20.18.0-linux-x64/lib/node_modules/npm/bin/npm-cli.js install
   ```
6) Jalankan bot host-mode:
   ```
   export PATH=$HOME/node-v20.18.0-linux-x64/bin:$PATH
   cd ~/bot-wa-bookstore/wa-bot
   OWNER_JID=6285121080846@s.whatsapp.net \
   TARGET_GROUP_JID=120363335057034362@g.us \
   AI_PROCESSOR_URL=http://ai-processor:8000 \
   npm run dev
   ```
   (Pastikan AI Processor aktif; kalau belum, jalankan di host atau update AI_PROCESSOR_URL ke endpoint lain.)

### List Grup di fight-dos
```
export PATH=$HOME/node-v20.18.0-linux-x64/bin:$PATH
cd ~/bot-wa-bookstore/wa-bot
node scripts/list-groups-host.js
```

## Jika Tetap Mau Docker di fight-dos
- Install Docker dulu (belum terpasang).
- Pakai bind mount sessions di `docker-compose.yml`:
  ```
  - ./wa-bot/sessions:/app/sessions:ro
  ```
- Build & up seperti biasa, tapi IP fight-dos sudah diterima WA, jadi seharusnya OK.

## Troubleshooting WA
- Error 401 / “Connection Failure” terus: biasanya IP diblok/ditolak. Coba VPN/proxy atau pakai fight-dos.
- Error 515 / stream error saat pairing: ganti jaringan saat scan QR, tunggu sampai log stabil (“OPEN”, tidak CLOSE lagi).
- Node <20 di host: Baileys perlu WebCrypto; pakai Node 20 atau shim `global.crypto = require('crypto').webcrypto`.

## Sync Flow yang Disarankan
1) Develop & pairing di lokal (pastikan list grup jalan).
2) `scp -r wa-bot/sessions fight-dos:~/bot-wa-bookstore/wa-bot/sessions`
3) Push code ke git; di fight-dos cukup `git pull` + `npm install` (wa-bot) + jalan `npm run dev`.


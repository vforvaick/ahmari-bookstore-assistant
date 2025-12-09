# Baileys WhatsApp Setup Guide

> **Panduan lengkap setup WhatsApp bot menggunakan Baileys**
>
> Baileys adalah library WhatsApp Web API tanpa browser. Bot kamu akan connect langsung ke WhatsApp seperti WhatsApp Web, tapi tanpa perlu Chrome/Firefox.

---

## 📱 Apa itu Baileys?

**Baileys** = Library Node.js untuk WhatsApp Web
- ✅ Tidak perlu browser (headless)
- ✅ Multi-device support (seperti WA Web official)
- ✅ QR code authentication
- ✅ Mendukung semua fitur WA (teks, media, grup, dll)
- ✅ Open source & actively maintained

**Cara kerja:**
```
HP WhatsApp kamu → QR Code → Baileys → Bot bisa terima & kirim pesan
```

---

## 🚀 Quick Start (5 Menit)

### Opsi 1: Pakai Docker (RECOMMENDED - jika IP tidak diblokir)

**Paling mudah, tinggal scan QR code!**

```bash
# 1. Pastikan sudah ada .env
cp .env.example .env
nano .env  # Edit GEMINI_API_KEY dan OWNER_JID

# 2. Build & start services
make build
make up

# 3. Lihat QR code
docker logs bookstore-wa-bot -f

# 4. Scan QR code pakai HP kamu
# Buka WhatsApp → Settings → Linked Devices → Link a Device
# Scan QR code yang muncul di terminal

# 5. Done! Bot sudah connect
```

**Output yang benar:**
```
✓ WhatsApp connection established
WhatsApp client initialized
✓ AI Processor is healthy
Message handler setup complete
```

### Opsi 2: Local Development (Manual / Host Mode)

**Untuk development/testing tanpa Docker:**

```bash
# 1. Install dependencies
cd wa-bot
npm install

# 2. Setup environment
cp .env.example .env
nano .env  # Isi GEMINI_API_KEY, OWNER_JID

# 3. Pastikan AI Processor jalan
# (di terminal terpisah)
cd ai-processor
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
GEMINI_API_KEY=your_key uvicorn main:app --reload

# 4. Start WA Bot
cd wa-bot
npm run dev

# 5. Scan QR code yang muncul (lihat catatan QR di bawah)

#### Skrip bantu (host):
- `npm run qr:dev` → tampilkan QR untuk pairing (ts-node, tidak build)
- `npm run list:groups` → build + list grup dengan sesi saat ini
- `node scripts/list-groups-host.js` → host helper (ada shim WebCrypto untuk Node <20)
```

---

## 📋 Prerequisites

### Yang Harus Ada:

1. **Node.js 20+**
   ```bash
   node --version  # Harus >= 20.x
   ```

2. **WhatsApp di HP**
   - Pakai nomor aktif
   - Bisa multi-device (99% HP modern support)

3. **Gemini API Key**
   - Daftar di: https://makersuite.google.com/app/apikey
   - Gratis untuk testing

4. **Environment Variables**
   - `GEMINI_API_KEY` - dari Google AI Studio
   - `OWNER_JID` - nomor WA kamu (format: `6281234567890@s.whatsapp.net`)
   - `AI_PROCESSOR_URL` - URL AI Processor (default: `http://localhost:8000`)

---

## 🔧 Detailed Setup Guide
### Catatan IP / Jaringan
- Jika setelah scan QR selalu `Connection Failure` / `Logged out`, besar kemungkinan IP server diblokir WA. Coba:
  - Gunakan jaringan lain/VPN saat pairing
  - Jalankan bot di host lain (contoh: VPS fight-dos dengan IP berbeda)
  - Pastikan Node >= 20 (untuk Baileys WebCrypto)

### Step 1: Cari OWNER_JID Kamu

**OWNER_JID adalah nomor WhatsApp kamu dalam format JID.**

**Format:**
```
[nomor_tanpa_plus]@s.whatsapp.net
```

**Contoh:**
- Nomor WA: +62 812-3456-7890
- OWNER_JID: `6281234567890@s.whatsapp.net`

**Cara dapat nomor dalam format JID:**

**Opsi A: Manual**
```
1. Hapus +, -, spasi dari nomor WA kamu
2. Tambahkan @s.whatsapp.net di belakang

Contoh:
+62 812-3456-7890
→ 6281234567890
→ 6281234567890@s.whatsapp.net
```

**Opsi B: Otomatis (setelah bot connect)**
```javascript
// Di wa-bot/src/index.ts, tambahkan log ini setelah connect:
const sock = await waClient.connect();

// Log nomor kamu sendiri
logger.info(`Your JID: ${sock.user?.id}`);
```

Jalankan bot sekali, nanti di log akan muncul JID kamu.

---

### Step 2: Setup .env File

```bash
# Copy template
cp .env.example .env

# Edit dengan editor favorit
nano .env
```

**Isi .env:**
```bash
# Gemini API (dari https://makersuite.google.com/app/apikey)
GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# WhatsApp Bot - GANTI INI!
OWNER_JID=6281234567890@s.whatsapp.net  # <-- Nomor WA kamu
TARGET_GROUP_JID=120363123456789@g.us   # <-- (opsional, nanti aja)

# Queue (default udah ok)
QUEUE_INTERVAL_MINUTES=47

# Database (Docker auto-set, local ganti jadi ./data/bookstore.db)
DATABASE_PATH=/app/data/bookstore.db

# AI Processor URL
AI_PROCESSOR_URL=http://ai-processor:8000  # Docker
# AI_PROCESSOR_URL=http://localhost:8000   # Local

# Environment
NODE_ENV=production
```

**PENTING:**
- `OWNER_JID` = nomor WA **KAMU** (yang akan kirim FGB broadcast ke bot)
- Format harus persis: `[nomor]@s.whatsapp.net`
- Jangan ada spasi atau karakter aneh

---

### Step 3: Scan QR Code

**Di Docker:**
```bash
# Start services
docker-compose up -d

# Watch logs
docker logs bookstore-wa-bot -f
```

**Di Local:**
```bash
npm run dev
```

**QR Code akan muncul di terminal seperti ini:**
```
QR Code received, scan to authenticate:
████ ▄▄▄▄▄ █▀▀  ▀▄█ ▄▄▄▄▄ ████
████ █   █ █ ▄█ ▀ █ █   █ ████
████ █▄▄▄█ █▄ ▀▀▀▄█ █▄▄▄█ ████
...
```

**Cara scan:**
1. Buka WhatsApp di HP
2. Tap **Settings** (atau **⋮** menu)
3. Pilih **Linked Devices**
4. Tap **Link a Device**
5. Scan QR code dari terminal

**Setelah scan berhasil:**
```
✓ WhatsApp connection established
WhatsApp client initialized
✓ AI Processor is healthy
Message handler setup complete
```

---

### Step 4: Test Connection

**Kirim pesan ke diri sendiri:**
```
1. Buka WhatsApp di HP
2. Kirim pesan ke "Saved Messages" atau kontak kamu sendiri
3. Cek logs bot:
   docker logs bookstore-wa-bot -f
```

**Kalau connect, harusnya ada log:**
```
Processing message from owner: 6281234567890@s.whatsapp.net
```

**Tapi karena bukan FGB broadcast, akan di-skip:**
```
Not an FGB broadcast, ignoring
```

**Ini normal! ✅**

---

## 🧪 Test dengan FGB Broadcast

### Contoh FGB Broadcast untuk Testing

**Format 1: Standard**
```
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
```

**Format 2: Request**
```
Request | ETA : May '26

*The Very Hungry Caterpillar* (PB)
HB - Rp 245.000 / PB - Rp 160.000
NETT PRICE

A classic story about a hungry caterpillar who eats
through a variety of foods before transforming
into a beautiful butterfly.

🦊🦊🦊
```

### Cara Test:

**1. Kirim broadcast ke diri sendiri (dengan gambar):**
- Copy salah satu format di atas
- Paste ke WhatsApp
- **PENTING:** Attach gambar/foto (FGB broadcast selalu ada media)
- Kirim ke diri sendiri

**2. Bot akan:**
```
⏳ Processing FGB broadcast...

1. Downloading media
2. Parsing data
3. Generating draft
```

**3. Tunggu ~10 detik, bot akan balas:**
```
📝 *DRAFT BROADCAST*

Halooo moms! Ada buku bagus nih 🤩

*Brown Bear Goes to the Museum* (HB)
💰 Rp 115.000
Min. 3 pcs disc 10%

Follow Brown Bear dan teman-temannya explore
museum! Ada transportasi, galeri seni, dll.
Seru bgtt buat anak-anak! 📚

Format: Hardback
ETA: Apr '26
Close: 20 Des

---
Balasan:
• *YES* - kirim sekarang
• *EDIT DULU* - edit manual dulu
• *SCHEDULE* - masukkan ke antrian
```

**✅ Kalau dapat reply seperti ini = SUKSES!**

---

## 🔍 Troubleshooting

### Problem 1: QR Code Tidak Muncul

**Kemungkinan:**
- Port conflict
- Bot sudah pernah connect sebelumnya

**Solusi:**
```bash
# Hapus session lama
rm -rf wa-bot/sessions/*

# Restart bot
docker-compose restart wa-bot

# Atau kalau local:
rm -rf sessions/*
npm run dev
```

### Problem 2: "Connection closed" Terus

**Kemungkinan:**
- WhatsApp banned nomor bot
- Internet tidak stabil
- Session corrupt

**Solusi:**
```bash
# 1. Hapus sessions
rm -rf sessions/*

# 2. Di HP: Settings → Linked Devices → Remove bot

# 3. Restart & scan ulang
docker-compose restart wa-bot
docker logs bookstore-wa-bot -f
```

### Problem 3: Bot Tidak Balas Pesan

**Cek:**
```bash
# 1. Lihat logs
docker logs bookstore-wa-bot -f

# 2. Pastikan OWNER_JID benar
echo $OWNER_JID  # Harus match nomor kamu

# 3. Cek AI Processor jalan
curl http://localhost:8000/health
# Expected: {"status":"healthy","service":"ai-processor"}
```

**Kalau logs bilang "Ignoring message from non-owner":**
- OWNER_JID salah! Cek format & nomor

**Kalau logs bilang "Not an FGB broadcast":**
- Broadcast kamu belum ada pattern FGB
- Atau tidak ada media (gambar/video)

### Problem 4: "AI Processor is not healthy"

**Cek AI Processor:**
```bash
# Lihat logs AI Processor
docker logs bookstore-ai-processor -f

# Test manual
curl http://localhost:8000/health

# Kalau error, check GEMINI_API_KEY
docker exec bookstore-ai-processor env | grep GEMINI
```

### Problem 5: Error "Failed to download media"

**Kemungkinan:**
- Media terlalu besar
- Network timeout

**Solusi:**
- Coba gambar lebih kecil (<2MB)
- Check network
- Restart bot

---

## 📁 Session Storage (SQLite-based)

**Baileys session sekarang disimpan di SQLite database:**

```
sessions/
└── session.db          # Single SQLite database containing all auth data
```

**Keuntungan SQLite vs File-based:**
- ✅ **Lebih stabil** - Tidak ada race condition dari ribuan file kecil
- ✅ **Atomic operations** - Semua write operation dijamin konsisten
- ✅ **Mudah backup** - Cukup copy satu file `session.db`
- ✅ **Docker-friendly** - Tidak ada masalah permission/corruption saat volume mount
- ✅ **Multi-session ready** - Bisa support multiple bot instances dengan database terpisah

**PENTING:**
- ❌ **JANGAN commit `sessions/` ke git** (sudah di .gitignore)
- ❌ **JANGAN share `session.db`** (berisi credentials!)
- ✅ **Backup `session.db` sebelum deploy ulang**

**Kalau hilang:**
- Bot harus scan QR ulang
- Conversation history tetap ada di WhatsApp

---

## 🐳 Docker-Specific Notes

### Volume Mapping

```yaml
# docker-compose.yml
wa-bot:
  volumes:
    - wa-sessions:/app/sessions  # Auth state persisted
```

**Ini artinya:**
- Sessions disimpan di Docker volume `wa-sessions`
- Tidak hilang meskipun container restart
- Hilang kalau `docker-compose down -v`

### View Sessions in Docker

```bash
# List files in sessions volume (should see session.db)
docker run --rm -v bot-wa-bookstore_wa-sessions:/data alpine ls -la /data

# Backup session database
docker run --rm -v bot-wa-bookstore_wa-sessions:/data -v $(pwd):/backup alpine cp /data/session.db /backup/session-backup.db

# Restore session database
docker run --rm -v bot-wa-bookstore_wa-sessions:/data -v $(pwd):/backup alpine cp /backup/session-backup.db /data/session.db
```

---

## 🔐 Security Best Practices

### 1. Protect Sessions
```bash
# Backup session database securely
cp sessions/session.db session-backup.db
gpg --encrypt --recipient your@email.com session-backup.db
rm session-backup.db

# Store encrypted backup safely
```

### 2. Environment Variables
```bash
# Never commit .env
git status  # Should show .env in .gitignore

# Use secrets in production
# (Docker secrets, Vault, etc)
```

### 3. Limit Access
```yaml
# Only process messages from OWNER_JID
# Already implemented in detector.ts:
export function isOwnerMessage(from: string, ownerJid: string): boolean {
  return from === ownerJid;
}
```

---

## 📞 Support

**Kalau stuck:**
1. Check logs: `docker logs bookstore-wa-bot -f`
2. Check AI Processor: `docker logs bookstore-ai-processor -f`
3. Verify .env settings
4. Test dengan contoh broadcast di atas
5. Lihat troubleshooting section

**Common Issues:**
- 90% masalah = OWNER_JID format salah
- 5% masalah = GEMINI_API_KEY salah/expired
- 5% masalah = Network/firewall

---

## ✅ Checklist Setup

Gunakan ini untuk verify setup kamu:

- [ ] Node.js 20+ installed
- [ ] Docker & Docker Compose installed
- [ ] GEMINI_API_KEY obtained
- [ ] OWNER_JID determined (format: `628xxx@s.whatsapp.net`)
- [ ] `.env` file created & filled
- [ ] Database initialized (`make init-db`)
- [ ] Services built (`make build`)
- [ ] Services started (`make up`)
- [ ] QR code scanned successfully
- [ ] Connection log shows "established"
- [ ] AI Processor healthy
- [ ] Test broadcast sent
- [ ] Bot replied with draft
- [ ] Sessions backed up

**Kalau semua ✅ = READY TO USE!** 🎉

---

**Happy WhatsApping!** 📱🤖

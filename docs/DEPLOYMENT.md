# Deployment Guide

This guide details how to deploy the Ahmari Bookstore Assistant on a Virtual Private Server (VPS).

## 1. Prerequisites

### Hardware Requirements
- **CPU:** 1 vCPU (minimum)
- **RAM:** 1GB (minimum, with 2GB Swap)
- **Storage:** 10GB SSD

### Software Requirements
- **OS:** Ubuntu 22.04 LTS (recommended)
- **Docker:** Engine 20.10+
- **Docker Compose:** v2.0+
- **Git**

## 2. Initial VPS Setup

We provide a script to optimize fresh 1GB RAM servers.

1.  **SSH into your VPS:**
    ```bash
    ssh root@<your-vps-ip>
    ```

2.  **Clone the repository:**
    ```bash
    git clone https://github.com/vforvaick/ahmari-bookstore-assistant.git bot-wa-bookstore
    cd bot-wa-bookstore
    ```

3.  **Run the setup script (as root/sudo):**
    This script creates a 2GB swap file, optimizes memory settings, and sets up maintenance cron jobs (daily restart, weekly cleanup).
    ```bash
    chmod +x scripts/vps-setup.sh
    ./scripts/vps-setup.sh
    ```
    *Note: If you already have swap configured, the script will skip that step.*

## 3. Configuration

1.  **Create `.env` file:**
    ```bash
    cp .env.example .env
    nano .env
    ```

2.  **Environment Variables Reference:**

| Category | Variable | Description | Required | Reference |
|----------|----------|-------------|----------|-----------|
| **Gemini** | `GEMINI_API_KEYS` | Comma-separated list of API keys for rotation. | Yes | [Console](https://aistudio.google.com/) |
| | `GEMINI_MODEL` | Model to use (default: `gemini-2.5-flash`). | No | |
| **Google** | `GOOGLE_SEARCH_API_KEY` | For `/new` research mode. | Yes | [Cloud Console](https://console.cloud.google.com/apis/credentials) |
| | `GOOGLE_SEARCH_CX` | Custom Search Engine ID. | Yes | [CSE](https://cse.google.com/) |
| **WhatsApp** | `OWNER_JID` | Your WhatsApp number (e.g., `628123...@s.whatsapp.net`). | Yes | Admin access |
| | `OWNER_LID` | Your WhatsApp LID (optional, for tighter mapping). | No | |
| | `TARGET_GROUP_JID` | Group ID where broadcasts are sent. | Yes | `/listgroups` |
| | `DEV_GROUP_JID` | Group ID for testing (default target if no production). | No | |
| | `PAIRING_PHONE` | Phone number for initial pairing (if no session). | No | |
| **Queue** | `QUEUE_INTERVAL_MINUTES` | Minutes between broadcasts (default: `47`). | No | |
| **System** | `LOG_LEVEL` | Logging verbosity (`info`, `debug`, `error`). | No | |
| | `TZ` | Timezone (default: `Asia/Jakarta`). | No | |

## 4. Launching the Application

1.  **Start Services:**
    ```bash
    docker compose up -d --build
    ```
    *This builds the images and starts `wa-bot`, `ai-processor`, and `scheduler` in the background.*

2.  **Setup WhatsApp Session:**
    - Check the logs for the QR code or Pairing Code:
    ```bash
    docker compose logs -f wa-bot
    ```
    - Scan the QR with your capabilities device (WhatsApp > Linked Devices).

## 5. Verification

1.  **Check Container Status:**
    ```bash
    docker ps
    ```
    Ensure all 3 containers are `Up (healthy)`.

2.  **Test Bot:**
    - Send `/help` to the bot from the owner number.
    - Expected response: A help menu with commands.

## 6. Maintenance & Troubleshooting

### Viewing Logs
To see what's happening (e.g., why a broadcast failed):
```bash
# All logs
docker compose logs -f

# Specific service
docker compose logs -f wa-bot
docker compose logs -f ai-processor
```

### Updating the Bot
To deploy the latest changes from git:
```bash
git pull origin main
docker compose up -d --build
```

### Restarting Services
If the bot gets stuck:
```bash
docker compose restart
```

### Database & Backups
- **Database:** `sqlite-data` volume (internal).
- **Sessions:** `wa-bot/sessions` (local bind mount).
- **Media:** `media` (local bind mount).

**Backup Strategy:**
Occasional backup of the `wa-bot/sessions` folder and `data/bookstore.db` (inside container) is recommended.
```bash
# Example backup of sessions
tar -czvf user_session_backup_$(date +%F).tar.gz wa-bot/sessions
```

### Common Issues

**`SqliteError: no such column: now`**
- Cause: Old code using double quotes for SQLite strings.
- Fix: `git pull` to get latest fix, then rebuild.

**`429 Resource Exhausted` (Gemini)**
- Cause: API quota exceeded.
- Fix: Add more keys to `GEMINI_API_KEYS` in `.env` (comma-separated).

**WhatsApp Disconnects**
- The bot will auto-reconnect. If it fails repeatedly, `docker compose restart wa-bot`.

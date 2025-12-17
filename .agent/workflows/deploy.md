---
description: Deploy bot-wa-bookstore to VPS
---

# Deploy Bot WA Bookstore

> **IMPORTANT**: VPS untuk project ini adalah **fight-dos** (161.118.210.22), BUKAN fight-uno!

## Quick Deploy

```bash
# 1. Push code ke git
git add . && git commit -m "your message" && git push origin main

# 2. SSH ke VPS dan pull
ssh fight-dos "cd ~/bot-wa-bookstore && git pull origin main"

# 3. Rebuild dan restart services
# // turbo
ssh fight-dos "cd ~/bot-wa-bookstore && docker compose down && docker compose build && docker compose up -d"

# 4. Verify
ssh fight-dos "docker ps --format 'table {{.Names}}\t{{.Status}}'"
ssh fight-dos "curl -s http://localhost:8000/config"
```

## VPS Info

| VPS | IP | Usage |
|-----|-----|-------|
| **fight-dos** | 161.118.210.22 | bot-wa-bookstore ✅ |
| fight-uno | 140.245.112.21 | (JANGAN PAKAI untuk project ini) |
| fight-tres | 161.118.239.248 | (available) |
| fight-cuatro | 43.134.1.135 | (available) |

## .env Location

API keys di-set di **root `.env`**, bukan di `ai-processor/.env`:
```
~/bot-wa-bookstore/.env
```

## Troubleshooting

### AI Processor unhealthy
```bash
ssh fight-dos "docker logs bookstore-ai-processor --tail 50"
```

### Check config
```bash
ssh fight-dos "curl -s http://localhost:8000/config"
# Expected: {"price_markup":20000,"model":"gemini-2.5-flash","api_keys_count":3}
```

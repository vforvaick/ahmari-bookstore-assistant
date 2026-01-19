# Troubleshooting Guide

## Bot Not Responding

### ⚠️ IMPORTANT: Don't rush to restart!

**BEFORE restarting containers, always:**

1. **Dump logs first** (logs are lost on container recreate)
   ```bash
   docker logs bookstore-wa-bot > /tmp/wa-bot-$(date +%Y%m%d-%H%M).log 2>&1
   ```

   > **Note**: Log rotation is enabled (10MB max, 7 files kept). Logs persist across restarts but are lost on `docker compose up --force-recreate`.

2. **Check container health**
   ```bash
   docker ps --filter name=bookstore --format 'table {{.Names}}\t{{.Status}}'
   docker inspect bookstore-wa-bot --format '{{json .State.Health}}' | jq .
   ```

3. **Check health endpoint**
   ```bash
   docker exec bookstore-wa-bot curl -sf http://localhost:3000/health
   ```

4. **Search for errors in logs**
   ```bash
   docker logs bookstore-wa-bot --tail=100 2>&1 | grep -E '(error|Error|ERROR|fail|Fail)'
   ```

5. **Analyze root cause BEFORE fixing**

---

## Common Issues

### Bot "connected" but not responding
- **Root cause**: Message handler bound to old socket after reconnection
- **Fix**: Commit `65ed76c` - rebind handler after reconnect
- **Prevention**: Built into code now

### Health check shows "unhealthy" but bot works
- **Root cause**: Docker healthcheck command mismatch (wget vs curl)
- **Fix**: Install curl in Dockerfile, use curl in healthcheck

### Connection timeout/PreKeyError
- **Root cause**: Stale encryption sessions
- **Fix**: Daily restart at 4 AM via cron

---

## Restart Procedure (Only after root cause identified)

```bash
# 1. Pull latest fixes
cd ~/bot-wa-bookstore && git pull origin main

# 2. Rebuild with fix
docker compose up -d --build wa-bot

# 3. Verify
docker logs bookstore-wa-bot --tail=20
```

#!/bin/bash
# Watch wa-bot logs for PreKeyError and auto-restart if detected repeatedly
# Run via cron: */5 * * * * /path/to/watchdog-wa-bot.sh >> /var/log/wa-bot-watchdog.log 2>&1

cd /home/vforvaick/bot-wa-bookstore

THRESHOLD=5  # Number of PreKeyErrors in last 5 minutes to trigger restart
LOCKFILE="/tmp/wa-bot-watchdog.lock"

# Prevent concurrent runs
if [ -f "$LOCKFILE" ]; then
    LOCK_AGE=$(($(date +%s) - $(stat -c %Y "$LOCKFILE" 2>/dev/null || echo 0)))
    if [ "$LOCK_AGE" -lt 300 ]; then
        exit 0  # Another instance running recently
    fi
fi
touch "$LOCKFILE"

# Count PreKeyErrors in last 5 minutes of logs
ERROR_COUNT=$(docker compose logs wa-bot --since 5m 2>/dev/null | grep -c "PreKeyError\|No session found to decrypt")

if [ "$ERROR_COUNT" -ge "$THRESHOLD" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - ALERT: Detected $ERROR_COUNT PreKeyErrors in last 5 minutes. Triggering restart..."
    
    docker compose restart wa-bot
    sleep 15
    
    STATUS=$(docker compose ps wa-bot --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo "$(date '+%Y-%m-%d %H:%M:%S') - wa-bot restarted. Status: $STATUS"
    
    # Cooldown - don't check again for 10 minutes
    sleep 600
fi

rm -f "$LOCKFILE"

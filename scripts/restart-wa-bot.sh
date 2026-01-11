#!/bin/bash
# Auto-restart wa-bot container
# Run via cron: 0 4 * * * /path/to/restart-wa-bot.sh >> /var/log/wa-bot-restart.log 2>&1

cd /home/vforvaick/bot-wa-bookstore

echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting wa-bot restart..."

# Restart wa-bot container
docker compose restart wa-bot

# Wait for container to be healthy
sleep 15

# Check status
STATUS=$(docker compose ps wa-bot --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ "$STATUS" = "healthy" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - wa-bot restarted successfully (healthy)"
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') - WARNING: wa-bot status after restart: $STATUS"
fi

#!/bin/bash
# Quick Health Check Script
# Usage: ./health-check.sh

echo "=== Bookstore Bot Health Check ==="
echo "Time: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo ""

# Memory usage
echo "[Memory]"
free -h
echo ""

# Swap usage
echo "[Swap]"
swapon --show
echo ""

# Docker containers
echo "[Containers]"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Size}}"
echo ""

# Container memory usage
echo "[Container Memory]"
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}"
echo ""

# Disk usage
echo "[Disk]"
df -h / | tail -1
echo ""

# Recent logs (last 5 lines from wa-bot)
echo "[Recent WA-Bot Logs]"
docker logs bookstore-wa-bot --tail 5 2>&1 || echo "Container not running"

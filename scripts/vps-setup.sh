#!/bin/bash
# VPS Setup Script for 1G1C Systems
# Run as root or with sudo

set -e

echo "=== VPS Optimization Setup ==="
echo ""

# 1. Create 2GB Swap File
echo "[1/3] Setting up 2GB swap file..."
if [ -f /swapfile ]; then
    echo "  Swap file already exists, skipping..."
else
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "  ✅ Swap file created and enabled"
fi

# Show swap status
echo "  Current swap:"
free -h | grep -i swap

# 2. Optimize swap settings for low-RAM systems
echo ""
echo "[2/3] Optimizing swap settings..."
# Lower swappiness (default is 60, we use 10 for servers)
sysctl vm.swappiness=10
echo 'vm.swappiness=10' >> /etc/sysctl.conf

# Increase cache pressure slightly
sysctl vm.vfs_cache_pressure=50
echo 'vm.vfs_cache_pressure=50' >> /etc/sysctl.conf
echo "  ✅ Swap optimization complete"

# 3. Docker cleanup cronjob (clean unused images weekly)
echo ""
echo "[3/3] Setting up maintenance cron jobs..."

# Add daily restart at 4 AM Jakarta time and weekly cleanup
CRON_FILE="/etc/cron.d/bookstore-maintenance"
cat > $CRON_FILE << 'EOF'
# Bookstore Bot Maintenance
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin

# Restart containers daily at 4:00 AM Jakarta (21:00 UTC previous day)
0 21 * * * root cd /home/*/bot-wa-bookstore && docker compose restart >> /var/log/bookstore-restart.log 2>&1

# Clean up Docker resources weekly on Sunday at 3 AM
0 20 * * 0 root docker system prune -f >> /var/log/docker-cleanup.log 2>&1
EOF

chmod 644 $CRON_FILE
echo "  ✅ Cron jobs installed"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Summary:"
echo "  - 2GB swap file: /swapfile"
echo "  - Daily restart: 4:00 AM WIB"
echo "  - Weekly cleanup: Sunday 3:00 AM WIB"
echo ""
echo "Run 'free -h' to verify swap is active."

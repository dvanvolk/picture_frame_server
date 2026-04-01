#!/usr/bin/env bash
# pi-kiosk-setup.sh — Configure the Raspberry Pi display for kiosk mode
# Run on the Pi itself: bash pi-kiosk-setup.sh
# Then edit the SERVER_URL below before running.

set -e

SERVER_URL="http://CHANGE_ME:3000"   # <-- set this to your server's IP/hostname

echo "==> Disabling screen blanking..."
# Add to /etc/xdg/lxsession/LXDE-pi/autostart if it exists (older Pi OS)
AUTOSTART_SYSTEM="/etc/xdg/lxsession/LXDE-pi/autostart"
AUTOSTART_USER="$HOME/.config/lxsession/LXDE-pi/autostart"

mkdir -p "$(dirname $AUTOSTART_USER)"

KIOSK_LINES=$(cat <<EOF
@xset s off
@xset -dpms
@xset s noblank
@chromium-browser --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --incognito $SERVER_URL
EOF
)

if [ -f "$AUTOSTART_USER" ]; then
  echo "    Updating $AUTOSTART_USER"
  # Remove any existing chromium kiosk line
  grep -v "chromium-browser --kiosk" "$AUTOSTART_USER" > /tmp/autostart.tmp || true
  echo "$KIOSK_LINES" >> /tmp/autostart.tmp
  mv /tmp/autostart.tmp "$AUTOSTART_USER"
else
  echo "    Creating $AUTOSTART_USER"
  echo "$KIOSK_LINES" > "$AUTOSTART_USER"
fi

echo "==> Setting up nightly Chromium restart (3 AM) to prevent memory leaks..."
CRON_JOB="0 3 * * * DISPLAY=:0 pkill -f chromium-browser; sleep 5; DISPLAY=:0 chromium-browser --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --incognito $SERVER_URL &"
(crontab -l 2>/dev/null | grep -v "chromium-browser --kiosk"; echo "$CRON_JOB") | crontab -

echo ""
echo "==> Pi kiosk setup complete!"
echo ""
echo "  Server URL set to: $SERVER_URL"
echo "  Edit this script and change SERVER_URL if needed, then run again."
echo ""
echo "  Reboot to activate: sudo reboot"
echo ""

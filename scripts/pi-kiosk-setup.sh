#!/usr/bin/env bash
# pi-kiosk-setup.sh — Configure the Raspberry Pi display for kiosk mode
# Run on the Pi itself: bash pi-kiosk-setup.sh
# Edit the settings below (SERVER_URL and the restart/screen schedule) before running.

set -e

SERVER_URL="http://CHANGE_ME:3000"   # <-- set this to your server's IP/hostname

# Daily Chromium restart, to clear the slow memory leak that can otherwise
# freeze the kiosk mid-day (see README Troubleshooting).
NIGHTLY_RESTART_HOUR=3
NIGHTLY_RESTART_MIN=0

# Overnight screen-off window. Also restarts Chromium at wake time, so this
# doubles as a second daily restart on top of NIGHTLY_RESTART_*.
SCREEN_OFF_HOUR=23
SCREEN_OFF_MIN=0
SCREEN_ON_HOUR=6
SCREEN_ON_MIN=30

CHROMIUM_CMD="chromium-browser --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --incognito $SERVER_URL"

echo "==> Disabling screen blanking..."
# Add to /etc/xdg/lxsession/LXDE-pi/autostart if it exists (older Pi OS)
AUTOSTART_SYSTEM="/etc/xdg/lxsession/LXDE-pi/autostart"
AUTOSTART_USER="$HOME/.config/lxsession/LXDE-pi/autostart"

mkdir -p "$(dirname $AUTOSTART_USER)"

KIOSK_LINES=$(cat <<EOF
@xset s off
@xset -dpms
@xset s noblank
@$CHROMIUM_CMD
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

echo "==> Setting up scheduled restarts and overnight screen-off..."
# Each managed line is tagged with a unique comment so re-running this script
# updates entries in place instead of duplicating them.
RESTART_JOB="$NIGHTLY_RESTART_MIN $NIGHTLY_RESTART_HOUR * * * DISPLAY=:0 pkill -f chromium-browser; sleep 5; DISPLAY=:0 $CHROMIUM_CMD & # picture-frame-restart"
SCREEN_OFF_JOB="$SCREEN_OFF_MIN $SCREEN_OFF_HOUR * * * DISPLAY=:0 pkill -f chromium-browser; vcgencmd display_power 0 # picture-frame-screen-off"
SCREEN_ON_JOB="$SCREEN_ON_MIN $SCREEN_ON_HOUR * * * vcgencmd display_power 1; sleep 3; DISPLAY=:0 $CHROMIUM_CMD & # picture-frame-screen-on"

(
  crontab -l 2>/dev/null \
    | grep -v "picture-frame-restart" \
    | grep -v "picture-frame-screen-off" \
    | grep -v "picture-frame-screen-on" \
    | grep -v "chromium-browser --kiosk"
  echo "$RESTART_JOB"
  echo "$SCREEN_OFF_JOB"
  echo "$SCREEN_ON_JOB"
) | crontab -

echo ""
echo "==> Pi kiosk setup complete!"
echo ""
printf "  Server URL set to: %s\n" "$SERVER_URL"
printf "  Chromium restarts daily at %02d:%02d to clear memory leaks.\n" "$NIGHTLY_RESTART_HOUR" "$NIGHTLY_RESTART_MIN"
printf "  Display turns off at %02d:%02d and back on (with a Chromium restart) at %02d:%02d.\n" \
  "$SCREEN_OFF_HOUR" "$SCREEN_OFF_MIN" "$SCREEN_ON_HOUR" "$SCREEN_ON_MIN"
echo "  Edit the settings at the top of this script and run again to change any of this."
echo ""
echo "  Note: screen off/on uses 'vcgencmd display_power', which needs the"
echo "  legacy X11 display stack (this script's autostart setup assumes X11"
echo "  via LXDE-pi, even if \$XDG_SESSION_TYPE reports 'tty' under a"
echo "  startx-from-autologin setup). If your Pi runs Wayland, replace the"
echo "  vcgencmd calls above with 'wlr-randr --output <name> --off/--on'."
echo ""
echo "  Reboot to activate: sudo reboot"
echo ""

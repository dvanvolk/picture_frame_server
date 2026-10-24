#!/usr/bin/env bash
# install.sh — Set up Picture Frame server on a Linux machine
# Run as root or with sudo: sudo bash install.sh
#
# The service runs as the user who invoked sudo (or root if run directly).
# Override with:  sudo SERVICE_USER=someuser bash install.sh
# Tip: clone the repo straight into /opt/pictureframe and run this from there;
# updates are then just `git pull` + `systemctl restart picture-frame`.

set -e

INSTALL_DIR="/opt/pictureframe"
SERVICE_NAME="picture-frame"
SERVICE_USER="${SERVICE_USER:-${SUDO_USER:-root}}"

if ! id "$SERVICE_USER" &>/dev/null; then
  echo "ERROR: user '$SERVICE_USER' does not exist. Set SERVICE_USER to an existing user." >&2
  exit 1
fi

echo "==> Checking for Node.js..."
if ! command -v node &>/dev/null; then
  echo "Node.js not found. Installing via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "    Node $(node --version) found."

echo "==> Creating install directory at $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
if [ "$(pwd -P)" != "$(readlink -f "$INSTALL_DIR")" ]; then
  cp -r . "$INSTALL_DIR/"
else
  echo "    Running from $INSTALL_DIR already; skipping copy."
fi
chown -R "$SERVICE_USER" "$INSTALL_DIR"

echo "==> Installing npm dependencies..."
cd "$INSTALL_DIR"
npm install --omit=dev

if [ ! -f "$INSTALL_DIR/config.json" ]; then
  echo ""
  echo "==> No config.json found. Copying example config..."
  cp "$INSTALL_DIR/config.example.json" "$INSTALL_DIR/config.json"
  echo ""
  echo "  !! IMPORTANT: Edit $INSTALL_DIR/config.json with your settings before starting."
  echo "     Run: nano $INSTALL_DIR/config.json"
  echo ""
fi

echo "==> Installing systemd service..."
sed -e "s|/opt/pictureframe|$INSTALL_DIR|g" -e "/^\[Service\]/a User=$SERVICE_USER" \
  "$INSTALL_DIR/scripts/picture-frame.service" \
  > "/etc/systemd/system/${SERVICE_NAME}.service"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo ""
echo "==> Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Edit your config:  nano $INSTALL_DIR/config.json"
echo "  2. Start the server:  systemctl start $SERVICE_NAME"
echo "  3. Check status:      systemctl status $SERVICE_NAME"
echo "  4. View logs:         journalctl -u $SERVICE_NAME -f"
echo ""
echo "On the Raspberry Pi, set Chromium to open:"
echo "  http://<this-machine-ip>:3000"
echo ""

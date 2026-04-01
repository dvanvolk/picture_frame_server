#!/usr/bin/env bash
# install.sh — Set up Picture Frame server on a Linux machine
# Run as root or with sudo: sudo bash install.sh

set -e

INSTALL_DIR="/opt/pictureframe"
SERVICE_NAME="picture-frame"
SERVICE_USER="pi"

echo "==> Checking for Node.js..."
if ! command -v node &>/dev/null; then
  echo "Node.js not found. Installing via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "    Node $(node --version) found."

echo "==> Creating install directory at $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
cp -r . "$INSTALL_DIR/"

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
sed "s|/opt/pictureframe|$INSTALL_DIR|g; s|User=pi|User=$SERVICE_USER|g" \
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

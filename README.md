# Picture Frame

A full-screen kitchen display for a Raspberry Pi. Cycles through photos from an [Immich](https://immich.app) shared album with a large, across-the-room-readable clock and weather overlay, and periodically switches to a home-sensor dashboard or a live flight tracker. Integrates with [Home Assistant](https://www.home-assistant.io/) for real-time events: shows a live doorbell camera feed when motion or a button press is detected, and displays the current song when music is playing.

---

## Features

- **Photo slideshow** — pulls images from an Immich shared album, shuffles and cycles continuously
- **Large clock** — 96px font, readable from across the room
- **Weather** — current temperature/condition from a Home Assistant weather entity (updated every 5 minutes), plus today's forecast high (fetched over the HA WebSocket every 30 minutes)
- **Room dashboard** — every N photos, shows a rotating overlay with temperature sensor cards from configured HA entities, plus sunrise, sunset, and moon phase
- **Flight tracker** — every N photos, shows an embedded FlightAware (or similar) live view in an iframe
- **Doorbell camera overlay** — triggered by any Home Assistant entity (person detection, button press, etc.); shows a refreshing snapshot from your Reolink or other HA-connected camera
- **Music overlay** — shows song title and artist when a Home Assistant media player is playing
- **Resilient** — reconnects to HA WebSocket automatically, retries Immich on failure, keeps showing last known weather if HA is briefly unreachable

---

## Architecture

The server runs as an **LXC container on Proxmox** on the home network. The display Pi just runs Chromium in kiosk mode pointing at the server URL — it does no HA/Immich configuration of its own.

```
[Server — Proxmox LXC container]       [Raspberry Pi — display only]
 Node.js + Express                  <── Chromium in kiosk mode
  ├── Serves the frontend               http://<server-ip>:3000
  ├── Proxies HA camera snapshots
  ├── Proxies HA weather / sensor / sun-moon state
  └── Proxies the Immich album list

[Browser (Chromium on Pi)]
  ├── Fetches Immich photo thumbnails directly (same LAN, using the API key from /api/config)
  ├── Connects to HA WebSocket directly (real-time events + forecast requests)
  └── Fetches camera snapshots / sensor / weather / album data via the local server proxy
```

The HA long-lived access token is injected server-side and never exposed in static files. (The Immich API key is currently passed to the browser via `/api/config` since the browser fetches thumbnails directly from Immich.)

---

## Requirements

### Server
- Runs in an **LXC container on Proxmox** (any Linux host with [Node.js](https://nodejs.org/) v18+ works too — the install script isn't Proxmox-specific)

### Raspberry Pi (display)
- Raspberry Pi OS (Desktop) with Chromium installed
- Network access to the server container

### Services
- [Immich](https://immich.app/) with at least one shared album
- [Home Assistant](https://www.home-assistant.io/) with:
  - A weather integration (e.g. Met.no, OpenWeatherMap, National Weather Service) that supports `weather.get_forecasts`
  - A camera integration for your doorbell (e.g. Reolink, Frigate, Ring via HA)
  - A media player entity (e.g. Spotify, Sonos, Cast)
  - Sensor entities for your doorbell triggers (motion/person/button press)
  - (Optional) Temperature sensor entities for the dashboard view, and a moon phase sensor

---

## Quick Start

### 1. Clone the repository

```bash
git clone <repo-url> PictureFrame
cd PictureFrame
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create your config file

```bash
cp config.example.json config.json
```

Edit `config.json` with your values (see [Configuration](#configuration) below).

### 4. Run the server

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser to verify everything works.

### 5. Deploy to your Proxmox LXC container (optional)

Run the install script inside the LXC container to install as a systemd service:

```bash
sudo bash scripts/install.sh
```

Then start it:

```bash
sudo systemctl start picture-frame
sudo systemctl status picture-frame
```

View logs:

```bash
journalctl -u picture-frame -f
```

### 6. Configure the Raspberry Pi

On the Pi, edit `scripts/pi-kiosk-setup.sh` and set `SERVER_URL` to your Proxmox container's address, then run:

```bash
bash scripts/pi-kiosk-setup.sh
sudo reboot
```

Chromium will launch automatically in kiosk mode on boot, pointing at your server.

---

## Configuration

All configuration lives in `config.json`. Copy `config.example.json` as a starting point. The file is gitignored so your secrets are never committed.

```jsonc
{
  "server": {
    "port": 3000           // Port the web server listens on
  },

  "immich": {
    "baseUrl": "http://192.168.1.x:2283",   // Immich server URL (no trailing slash)
    "apiKey": "your-immich-api-key",         // Settings → API Keys in Immich
    "albumId": "uuid-of-shared-album",       // Get from the album URL in Immich
    "slideshowIntervalSeconds": 15           // Seconds between photo transitions
  },

  "homeAssistant": {
    "baseUrl": "http://homeassistant.local:8123",  // HA URL (no trailing slash)
    "token": "your-long-lived-access-token",        // Profile → Long-Lived Access Tokens

    "weatherEntity": "weather.home",                // Entity ID of your weather integration

    "cameraEntity": "camera.reolink_front_door",    // Entity ID of the doorbell camera

    "cameraTriggerEntities": [                      // One or more entities that trigger the
      "binary_sensor.reolink_front_door_visitor",   // camera overlay when they go to "on"
      "binary_sensor.reolink_front_door_person"     // (button press, person detection, etc.)
    ],

    "cameraAutoHideSeconds": 30,                    // Auto-dismiss camera overlay after N seconds

    "mediaPlayerEntity": "media_player.kitchen",    // Entity ID of your music player

    "moonEntity": "sensor.moon"                     // Entity ID of your moon phase sensor (default: sensor.moon)
  },

  "display": {
    "clockFormat24h": false,   // true = 24-hour clock, false = 12-hour with AM/PM
    "temperatureUnit": "F"     // "F" for Fahrenheit, "C" for Celsius
  },

  "specialViews": {
    "intervalPhotos": 20,                     // Show a special view after this many photos
    "dashboardDurationSeconds": 120,          // How long the dashboard view stays up
    "flightAwareDurationSeconds": 120,        // How long the flight tracker view stays up
    "flightAwareUrl": "http://192.168.10.71:8080/",  // URL loaded in the flight-tracker iframe
    "sensorEntities": [                       // Temperature (or other) sensors shown as cards
      { "entityId": "sensor.office_temperature", "label": "Office" },
      { "entityId": "sensor.basement_temperature", "label": "Basement" }
    ]
  }
}
```

Special views rotate in a fixed order (flight tracker, then dashboard) every time `intervalPhotos` photos have been shown, and the slideshow resumes automatically once each view's duration elapses.

### Finding your Immich album ID

1. Open Immich in your browser
2. Navigate to the shared album
3. Copy the UUID from the URL: `http://your-immich/albums/`**`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`**

### Creating a Home Assistant long-lived token

1. In Home Assistant, click your profile (bottom-left)
2. Scroll to **Long-Lived Access Tokens**
3. Click **Create Token**, give it a name like `Picture Frame`
4. Copy the token — it is only shown once

### Finding your HA entity IDs

Go to **Settings → Devices & Services → Entities** in Home Assistant and search for your camera, weather, doorbell sensors, media player, temperature sensors, and moon sensor. The entity ID is shown in the detail panel (e.g. `camera.reolink_front_door`).

For Reolink cameras, common entity IDs are:
| Entity | Typical ID |
|--------|-----------|
| Camera | `camera.reolink_front_door` |
| Person detection | `binary_sensor.reolink_front_door_person` |
| Visitor/button press | `binary_sensor.reolink_front_door_visitor` |
| Motion | `binary_sensor.reolink_front_door_motion` |

---

## Raspberry Pi Kiosk Setup (manual)

If you prefer to configure the Pi manually instead of using `pi-kiosk-setup.sh`:

**Disable screen blanking** — add to `~/.config/lxsession/LXDE-pi/autostart`:

```
@xset s off
@xset -dpms
@xset s noblank
@chromium-browser --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --incognito http://<server-ip>:3000
```

**Prevent Chromium memory leaks** — add a nightly restart via cron (`crontab -e`):

```
0 3 * * * DISPLAY=:0 pkill -f chromium-browser; sleep 5; DISPLAY=:0 chromium-browser --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --incognito http://<server-ip>:3000 &
```

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  3:42 PM                              72°F  H: 78°F  Sunny  │  ← info bar
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                      [ photo ]                              │
│                                                             │
│  ♫ Song Title                                               │  ← music overlay
│    Artist Name                                              │
└─────────────────────────────────────────────────────────────┘

When doorbell triggers:
┌─────────────────────────────────────────────────────────────┐
│                                                    [✕]      │
│                   FRONT DOOR                                │
│             ┌──────────────────┐                            │
│             │  camera snapshot │  (refreshes every 2s)     │
│             └──────────────────┘                            │
└─────────────────────────────────────────────────────────────┘

Special views (rotate in every `intervalPhotos` photos):
┌─────────────────────────────────────────────────────────────┐   ┌─────────────────────────────────────────────────────────────┐
│  Home                                                        │   │                                                             │
│  [Office 71°] [Bathroom 68°] [DNA 70°] [Aiden 69°] ...        │   │                  [ FlightAware iframe ]                    │
│  Sunrise 6:12 AM   Sunset 8:45 PM   Waxing Gibbous             │   │                                                             │
└─────────────────────────────────────────────────────────────┘   └─────────────────────────────────────────────────────────────┘
        Room dashboard                                                     Flight tracker
```

---

## Troubleshooting

**Photos not loading**
- Verify `immich.baseUrl` and `immich.apiKey` in `config.json`
- Check that the `albumId` is correct and the album contains images
- Confirm the display Pi (not just the server) can reach Immich directly — thumbnails are fetched browser-side: `curl http://<immich>/api/server-info`

**Weather shows `--`**
- Check `homeAssistant.baseUrl` and `homeAssistant.token`
- Verify the weather entity exists: open `http://<ha>/api/states/<weatherEntity>` in a browser with the token
- Check server logs: `journalctl -u picture-frame -f`

**Forecast high not showing**
- Confirm your weather integration supports the `weather.get_forecasts` service with `type: daily` — not all HA weather integrations do
- Check the browser console on the Pi for `HA WebSocket` errors

**Doorbell camera not appearing**
- Confirm the trigger entity IDs are correct in `cameraTriggerEntities`
- Test by toggling the entity in HA Developer Tools → States
- Check the camera entity ID is correct — the server logs will show errors if the proxy call fails

**Dashboard sensor cards show `--` or "No sensors configured"**
- Make sure `specialViews.sensorEntities` is populated with valid entity IDs
- An individual card showing `--` means that entity's state was `unavailable`/`unknown` or the HA fetch failed for it

**Flight tracker shows blank**
- Verify `specialViews.flightAwareUrl` is reachable from the display Pi's browser (it's loaded directly in an iframe, not proxied)

**HA WebSocket disconnecting frequently**
- This is usually a network issue; the app reconnects automatically with exponential backoff
- Verify HA is reachable from the Pi: `ping homeassistant.local`

**Music overlay not showing**
- Confirm `mediaPlayerEntity` matches the exact entity ID in HA
- The overlay appears when the player state is `playing` and disappears on `paused`/`idle`

---

## File Structure

```
PictureFrame/
├── server.js               Express server: static files, API proxies, token injection
├── config.json              Your config (gitignored)
├── config.example.json      Config template
├── package.json
├── .gitignore
├── public/
│   ├── index.html            Page structure
│   ├── style.css             All styles
│   └── app.js                All frontend logic
└── scripts/
    ├── install.sh              Linux server setup (installs systemd service)
    ├── pi-kiosk-setup.sh        Pi kiosk mode configuration
    └── picture-frame.service    systemd unit file
```

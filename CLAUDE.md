# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A kitchen picture-frame display for a Raspberry Pi. A Node.js/Express server runs on any LAN machine (NAS, desktop, spare Pi); the Pi itself just runs Chromium in kiosk mode pointing at the server's URL. The frontend is plain HTML/CSS/JS — no build step, no framework, no bundler.

## Commands

```bash
npm install     # install dependencies
npm start       # run the server (node server.js), serves on config.server.port (default 3000)
```

There is no test suite, linter, or build step in this repo. `config.json` (gitignored) is required to start the server — copy `config.example.json` to `config.json` and fill in real values first, or `server.js` will `process.exit(1)` with a message listing missing fields.

To exercise a change manually: run `npm start`, then open `http://localhost:3000` in a browser. Most integrations (Immich, Home Assistant) require real credentials in `config.json` to do anything — without them, weather/photos/camera calls will fail against placeholder URLs.

## Architecture

**Split-brain design**: the Express server is a thin proxy/config layer; almost all logic lives in the browser (`public/app.js`).

- `server.js` — single-file Express app. Responsibilities:
  - Loads and validates `config.json` at startup (fails fast if required fields are missing).
  - Serves `public/` as static files, but intercepts `GET /` to inject the Home Assistant long-lived token into `index.html` (replaces the `%%HA_TOKEN%%` placeholder) so the token never sits in a static file on disk.
  - `GET /api/config` — hands the frontend the *non-secret* config (Immich base URL/API key, HA entity IDs, display settings, special-views config). Note: the Immich API key is currently included here and used client-side for direct thumbnail fetches — the browser talks to Immich directly, not through the server.
  - Proxies HA REST calls the browser shouldn't make directly with the token: `/api/weather`, `/api/camera-snapshot`.
  - `GET /api/immich/album` — proxies the Immich album asset list server-side (uses the API key), filtering to `type === 'IMAGE'`.
- `public/app.js` — all frontend logic in one file, organized by feature (search for the `// ====` section headers): clock, weather, slideshow, camera overlay, special views (Grafana/FlightAware), music overlay, and an `HAWebSocket` class.
  - `HAWebSocket` connects directly from the browser to Home Assistant's websocket API (not proxied) for real-time `state_changed` events, and separately requests weather forecast data via `call_service` (`weather.get_forecasts`). It auto-reconnects with exponential backoff (capped at 60s) and does not retry on `auth_invalid`.
  - The photo slideshow fetches the Immich album list from the server once, then fetches individual thumbnails **directly from Immich** (same LAN) using the API key embedded in `/api/config` — this is why Immich must be reachable from the display browser, not just from the server.
  - **Special views**: every `specialViews.intervalPhotos` photos, the slideshow is interrupted to show one item from a rotating queue (`['flightaware', 'grafana']`) instead of the next photo. Both views load an external URL directly in an iframe (`specialViews.grafanaUrl` / `specialViews.flightAwareUrl`) — neither is proxied server-side. The Grafana dashboard (temps, history, min/max, alerts, sun/moon) must be shared as a Grafana **Public Dashboard** reachable without login, since this kiosk has no persistent HA/Grafana session. Each view auto-dismisses back to the slideshow after its own configured duration.
  - Doorbell camera overlay is driven by HA `state_changed` events matching any entity in `cameraTriggerEntities` going to `on`; it polls `/api/camera-snapshot` every 2s while visible and auto-hides after `cameraAutoHideSeconds`.
  - Music overlay is driven the same way, keyed on `mediaPlayerEntity` state being `playing`.

**Config flow**: `config.json` → `loadConfig()` in `server.js` (validates + applies defaults) → split into secret (token, kept server-side) and non-secret (`/api/config` response, consumed as global `CFG` in `app.js`) halves.

**Deployment**: `scripts/install.sh` installs the app to `/opt/pictureframe` on a Linux box as a systemd service (`scripts/picture-frame.service`); `scripts/pi-kiosk-setup.sh` configures the Raspberry Pi to autostart Chromium in kiosk mode pointing at the server. These are meant to be run on the target machines, not as part of a CI/dev workflow.

## Notes

- The server is deployed as an **LXC container on Proxmox**; the Pi is display-only (Chromium kiosk mode). `README.md` documents this deployment target and the full current feature set — keep it in sync with `server.js`/`public/app.js` when adding or changing features.
- Current git branch is `Add_Dashboard` (not yet merged to `main`).

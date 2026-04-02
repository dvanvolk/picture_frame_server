'use strict';

// ============================================================
// Config — loaded from the server on startup
// ============================================================

let CFG = null;

async function loadConfig() {
  const res = await fetch('/api/config');
  CFG = await res.json();
}

// ============================================================
// Clock
// ============================================================

function startClock() {
  const el = document.getElementById('clock');

  function tick() {
    const now = new Date();
    const opts = {
      hour: 'numeric',
      minute: '2-digit',
      hour12: !CFG.display.clockFormat24h,
    };
    el.textContent = now.toLocaleTimeString([], opts);
  }

  tick();
  setInterval(tick, 1000);
}

// ============================================================
// Weather
// ============================================================

const weatherConditionMap = {
  'clear-night': 'Clear',
  'cloudy': 'Cloudy',
  'fog': 'Foggy',
  'hail': 'Hail',
  'lightning': 'Thunderstorm',
  'lightning-rainy': 'Thunderstorm',
  'partlycloudy': 'Partly Cloudy',
  'pouring': 'Heavy Rain',
  'rainy': 'Rainy',
  'snowy': 'Snowy',
  'snowy-rainy': 'Sleet',
  'sunny': 'Sunny',
  'windy': 'Windy',
  'windy-variant': 'Windy',
  'exceptional': 'Unusual',
};

let lastWeather = null;

async function fetchWeather() {
  try {
    const res = await fetch('/api/weather');
    if (!res.ok) return;
    const data = await res.json();
    lastWeather = data;
    applyWeather(data);
  } catch (err) {
    console.warn('Weather fetch failed:', err.message);
    // Keep showing last known weather
  }
}

function applyWeather(data) {
  const temp = data.temperature !== null ? `${Math.round(data.temperature)}${data.unit}` : '--';
  const condition = weatherConditionMap[data.condition] || data.condition || '';
  document.getElementById('weather-temp').textContent = temp;
  document.getElementById('weather-condition').textContent = condition;
}

function startWeather() {
  fetchWeather();
  setInterval(fetchWeather, 5 * 60 * 1000); // every 5 minutes
}

// ============================================================
// Slideshow
// ============================================================

let assets = [];
let assetIndex = 0;
let activeSlide = 'a'; // toggles between 'a' and 'b'
let slideshowTimer = null;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function fetchAlbum() {
  try {
    const res = await fetch('/api/immich/album');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    if (data.assets.length === 0) throw new Error('No images found in album');
    assets = shuffle(data.assets);
    assetIndex = 0;
    showSlideshowError(null);
    return true;
  } catch (err) {
    console.warn('Immich album fetch failed:', err.message);
    if (assets.length === 0) {
      showSlideshowError('Unable to load photos: ' + err.message);
    }
    return false;
  }
}

function showSlideshowError(msg) {
  var el = document.getElementById('slideshow-error');
  if (msg) {
    el.textContent = msg;
    el.classList.add('visible');
  } else {
    el.textContent = '';
    el.classList.remove('visible');
  }
}

function thumbnailUrl(assetId) {
  return CFG.immich.baseUrl + '/api/assets/' + assetId + '/thumbnail?size=preview&apiKey=' + CFG.immich.apiKey;
}

function nextSlide() {
  if (assets.length === 0) return;

  const asset = assets[assetIndex];

  // Advance index; refetch album when we've shown the last photo
  if (assetIndex === assets.length - 1) {
    fetchAlbum();
  }
  assetIndex = (assetIndex + 1) % assets.length;

  const nextId = activeSlide === 'a' ? 'b' : 'a';
  const nextEl = document.getElementById('slide-' + nextId);
  const currEl = document.getElementById('slide-' + activeSlide);

  nextEl.onload = function() {
    nextEl.classList.add('visible');
    currEl.classList.remove('visible');
    activeSlide = nextId;
  };
  nextEl.onerror = function() {
    // Skip broken images — wait for the next scheduled interval tick
    console.warn('Failed to load thumbnail for asset:', asset.id);
  };
  nextEl.src = thumbnailUrl(asset.id);
}

async function startSlideshow() {
  const ok = await fetchAlbum();
  if (ok) nextSlide();

  const intervalMs = CFG.immich.slideshowIntervalSeconds * 1000;
  slideshowTimer = setInterval(() => {
    if (!cameraOverlayActive()) nextSlide();
  }, intervalMs);

  // Retry album fetch every 5 minutes in case Immich was down at start
  setInterval(async () => {
    if (assets.length === 0) await fetchAlbum();
  }, 5 * 60 * 1000);
}

// ============================================================
// Camera overlay
// ============================================================

let cameraRefreshTimer = null;
let cameraHideTimer = null;

function cameraOverlayActive() {
  return !document.getElementById('camera-overlay').classList.contains('hidden');
}

function showCameraOverlay() {
  document.getElementById('camera-overlay').classList.remove('hidden');
  refreshCameraSnapshot();
  resetCameraHideTimer();
}

function hideCameraOverlay() {
  document.getElementById('camera-overlay').classList.add('hidden');
  clearInterval(cameraRefreshTimer);
  clearTimeout(cameraHideTimer);
  cameraRefreshTimer = null;
  cameraHideTimer = null;
}

function refreshCameraSnapshot() {
  const img = document.getElementById('camera-img');
  const ts = Date.now();
  const newSrc = `/api/camera-snapshot?t=${ts}`;

  const tmp = new Image();
  tmp.onload = () => { img.src = tmp.src; };
  // On error: keep last successful image (don't update src)
  tmp.src = newSrc;

  // Schedule next refresh while overlay is active
  cameraRefreshTimer = setTimeout(() => {
    if (cameraOverlayActive()) refreshCameraSnapshot();
  }, 2000);
}

function resetCameraHideTimer() {
  clearTimeout(cameraHideTimer);
  const hideAfterMs = (CFG.homeAssistant.cameraAutoHideSeconds || 30) * 1000;
  cameraHideTimer = setTimeout(hideCameraOverlay, hideAfterMs);
}

document.getElementById('camera-dismiss').addEventListener('click', hideCameraOverlay);

// ============================================================
// Music overlay
// ============================================================

function showMusicOverlay(title, artist) {
  document.getElementById('music-title').textContent = title || '';
  document.getElementById('music-artist').textContent = artist || '';
  document.getElementById('music-overlay').classList.remove('hidden');
}

function hideMusicOverlay() {
  document.getElementById('music-overlay').classList.add('hidden');
}

// ============================================================
// Home Assistant WebSocket client
// ============================================================

class HAWebSocket {
  constructor(haBaseUrl, token, onStateChanged) {
    this.wsUrl = haBaseUrl.replace(/^http/, 'ws') + '/api/websocket';
    this.token = token;
    this.onStateChanged = onStateChanged;
    this.msgId = 1;
    this.ws = null;
    this.backoffMs = 5000;
    this.reconnectTimer = null;
  }

  connect() {
    console.log('HA WebSocket: connecting to', this.wsUrl);
    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      console.log('HA WebSocket: connected');
    };

    this.ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      this._handleMessage(msg);
    };

    this.ws.onclose = () => {
      console.warn('HA WebSocket: closed — reconnecting in', this.backoffMs, 'ms');
      this._scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.warn('HA WebSocket: error', err);
      this.ws.close();
    };
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'auth_required':
        this._send({ type: 'auth', access_token: this.token });
        break;

      case 'auth_ok':
        console.log('HA WebSocket: authenticated');
        this.backoffMs = 5000; // reset backoff on success
        this._send({ type: 'subscribe_events', event_type: 'state_changed' });
        break;

      case 'auth_invalid':
        console.error('HA WebSocket: authentication failed — check your token');
        // Don't reconnect on auth failure
        break;

      case 'event':
        if (msg.event?.event_type === 'state_changed') {
          this.onStateChanged(msg.event.data);
        }
        break;
    }
  }

  _send(payload) {
    if (!payload.id && payload.type !== 'auth') {
      payload.id = this.msgId++;
    }
    this.ws.send(JSON.stringify(payload));
  }

  _scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.backoffMs = Math.min(this.backoffMs * 2, 60000);
      this.connect();
    }, this.backoffMs);
  }
}

// ============================================================
// State change handler
// ============================================================

function handleStateChanged(data) {
  const entityId = data.entity_id;
  const newState = data.new_state?.state;
  const attrs = data.new_state?.attributes || {};

  // Doorbell / camera triggers
  if (CFG.homeAssistant.cameraTriggerEntities.includes(entityId)) {
    if (newState === 'on') {
      console.log('Camera trigger fired:', entityId);
      showCameraOverlay();
    } else if (newState === 'off' && cameraOverlayActive()) {
      // Only auto-hide on 'off' if no other trigger is still active.
      // We reset the hide timer on every 'on' event so this is safe.
    }
  }

  // Music player
  if (entityId === CFG.homeAssistant.mediaPlayerEntity) {
    if (newState === 'playing') {
      showMusicOverlay(attrs.media_title, attrs.media_artist);
    } else {
      hideMusicOverlay();
    }
  }
}

// ============================================================
// Boot sequence
// ============================================================

async function boot() {
  await loadConfig();

  startClock();
  startWeather();
  startSlideshow();

  const haWs = new HAWebSocket(
    CFG.homeAssistant.baseUrl,
    window.__HA_TOKEN__,
    handleStateChanged
  );
  haWs.connect();
}

boot().catch(err => console.error('Boot error:', err));

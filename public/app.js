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
  const dateEl = document.getElementById('date');

  function tick() {
    const now = new Date();
    el.textContent = now.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      hour12: !CFG.display.clockFormat24h,
    });
    dateEl.textContent = now.toLocaleDateString([], {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
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
  const temp = data.temperature !== null ? `${data.temperature.toFixed(1)}${data.unit}` : '--';
  const condition = weatherConditionMap[data.condition] || data.condition || '';
  document.getElementById('weather-temp').textContent = temp;
  document.getElementById('weather-condition').textContent = condition;
}

function applyForecastHigh(result) {
  if (!result || !result.response) return;
  const entityData = result.response[CFG.homeAssistant.weatherEntity];
  const forecast   = (entityData && Array.isArray(entityData.forecast)) ? entityData.forecast : [];
  const tempHigh   = (forecast[0] && forecast[0].temperature !== undefined) ? forecast[0].temperature : null;
  const unit       = lastWeather ? lastWeather.unit : (CFG.display.temperatureUnit === 'F' ? '°F' : '°C');
  document.getElementById('weather-high').textContent = tempHigh !== null ? 'H: ' + Math.round(tempHigh) + unit : '';
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

let albumFetchInProgress = false;

async function fetchAlbum() {
  if (albumFetchInProgress) return false;
  albumFetchInProgress = true;
  try {
    const res = await fetch('/api/immich/album');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    if (data.assets.length === 0) throw new Error('No images found in album');
    assets = shuffle(data.assets);
    assetIndex = 0;
    showSlideshowError(null);
    albumFetchInProgress = false;
    return true;
  } catch (err) {
    console.warn('Immich album fetch failed:', err.message);
    if (assets.length === 0) {
      showSlideshowError('Unable to load photos: ' + err.message);
    }
    albumFetchInProgress = false;
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
  // Special view intercept: every N photos, show the next special view
  photosSinceSpecialView++;
  if (
    CFG.specialViews &&
    CFG.specialViews.intervalPhotos > 0 &&
    photosSinceSpecialView >= CFG.specialViews.intervalPhotos
  ) {
    showNextSpecialView();
    return;
  }

  if (assets.length === 0) return;

  const asset = assets[assetIndex];
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
    console.warn('Failed to load thumbnail for asset:', asset.id);
  };
  nextEl.src = thumbnailUrl(asset.id);
}

async function startSlideshow() {
  const ok = await fetchAlbum();
  if (ok) nextSlide();

  const intervalMs = CFG.immich.slideshowIntervalSeconds * 1000;
  slideshowTimer = setInterval(function() {
    if (!cameraOverlayActive() && !specialViewActive()) nextSlide();
  }, intervalMs);

  // Refresh the album list every 30 minutes to pick up new photos
  setInterval(fetchAlbum, 30 * 60 * 1000);
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
  const img = document.getElementById('camera-img');
  img.removeAttribute('src');
  img.style.visibility = 'hidden';
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
  tmp.onload = () => { img.src = tmp.src; img.style.visibility = 'visible'; };
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
// Special views — Temperatures and FlightAware
// ============================================================

let photosSinceSpecialView = 0;
let specialViewQueueIndex  = 0;
const specialViewQueue     = ['flightaware', 'temps'];
let specialViewHideTimer   = null;

function specialViewActive() {
  return (
    !document.getElementById('temps-overlay').classList.contains('hidden') ||
    !document.getElementById('flightaware-overlay').classList.contains('hidden')
  );
}

function showNextSpecialView() {
  const viewName = specialViewQueue[specialViewQueueIndex % specialViewQueue.length];
  specialViewQueueIndex++;
  if (viewName === 'temps') showTemps();
  else if (viewName === 'flightaware') showFlightAware();
}

// ============================================================
// Temperature view — data comes from /api/temps (server aggregates HA history)
// ============================================================

const TEMP_SERIES_COLORS = ['#4da3ff', '#ffb44d', '#4cd47a', '#ff6b9d', '#b78cff', '#4de0e0', '#e6e04d', '#ff8a5c'];
const SVG_NS = 'http://www.w3.org/2000/svg';
const moonPhaseNames = {
  new_moon: 'New Moon', waxing_crescent: 'Waxing Crescent', first_quarter: 'First Quarter',
  waxing_gibbous: 'Waxing Gibbous', full_moon: 'Full Moon', waning_gibbous: 'Waning Gibbous',
  last_quarter: 'Last Quarter', waning_crescent: 'Waning Crescent',
};

let tempsData         = null;
let tempsRefreshTimer = null;
const tempTileEls     = {}; // entity_id -> { tile, value }

function tempsOverlayActive() {
  return !document.getElementById('temps-overlay').classList.contains('hidden');
}

function tempColor(value) {
  if (value < CFG.specialViews.temperatureCoolBelow) return '#4da3ff';
  if (value >= CFG.specialViews.temperatureWarmAtOrAbove) return '#ff5c5c';
  return '#4cd47a';
}

function svgEl(name, attrs, text) {
  const el = document.createElementNS(SVG_NS, name);
  Object.keys(attrs || {}).forEach(function(k) { el.setAttribute(k, attrs[k]); });
  if (text !== undefined) el.textContent = text;
  return el;
}

function htmlEl(name, className, text) {
  const el = document.createElement(name);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function compass(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

function setTempTile(entry, value, unit) {
  const offline = value === null || Number.isNaN(value);
  entry.tile.classList.toggle('offline', offline);
  entry.tile.style.setProperty('--tile-color', offline ? '#777' : tempColor(value));
  entry.value.textContent = offline ? 'offline' : value.toFixed(1) + unit;
}

function renderTempTiles(data) {
  const wrap = document.getElementById('temps-tiles');
  wrap.textContent = '';
  Object.keys(tempTileEls).forEach(function(k) { delete tempTileEls[k]; });
  data.sensors.forEach(function(s) {
    const tile = htmlEl('div', 'temp-tile');
    tile.appendChild(htmlEl('div', 'temp-tile-label', s.label));
    const value = htmlEl('div', 'temp-tile-value');
    tile.appendChild(value);
    wrap.appendChild(tile);
    tempTileEls[s.entity] = { tile, value };
    setTempTile(tempTileEls[s.entity], s.latest, data.unit);
  });
}

function renderTempChart(data) {
  const svg = document.getElementById('temps-chart');
  const w = svg.clientWidth || 1000;
  const h = svg.clientHeight || 400;
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  svg.textContent = '';

  const plotted = data.sensors.map(function(s, i) {
    return { s, color: TEMP_SERIES_COLORS[i % TEMP_SERIES_COLORS.length] };
  }).filter(function(p) { return p.s.points.length > 0; });

  const legend = document.getElementById('temps-legend');
  legend.textContent = '';
  plotted.forEach(function(p) {
    const item = htmlEl('span', 'temps-legend-item', p.s.label);
    item.style.setProperty('--series-color', p.color);
    legend.appendChild(item);
  });

  if (plotted.length === 0) return;

  let lo = Infinity, hi = -Infinity;
  plotted.forEach(function(p) {
    p.s.points.forEach(function(pt) { lo = Math.min(lo, pt[1]); hi = Math.max(hi, pt[1]); });
  });
  lo = Math.floor((lo - 2) / 5) * 5;
  hi = Math.ceil((hi + 2) / 5) * 5;

  const padL = 56, padR = 16, padT = 14, padB = 30;
  const x = function(t) { return padL + (t - data.startMs) / (data.endMs - data.startMs) * (w - padL - padR); };
  const y = function(v) { return padT + (hi - v) / (hi - lo) * (h - padT - padB); };

  for (let v = lo; v <= hi; v += 5) {
    svg.appendChild(svgEl('line', { x1: padL, x2: w - padR, y1: y(v), y2: y(v), stroke: 'rgba(255,255,255,0.1)', 'stroke-width': 1 }));
    svg.appendChild(svgEl('text', { x: padL - 8, y: y(v) + 5, 'text-anchor': 'end', fill: 'rgba(255,255,255,0.55)', 'font-size': 16 }, String(v)));
  }
  [CFG.specialViews.temperatureCoolBelow, CFG.specialViews.temperatureWarmAtOrAbove].forEach(function(v) {
    if (v > lo && v < hi) {
      svg.appendChild(svgEl('line', { x1: padL, x2: w - padR, y1: y(v), y2: y(v), stroke: 'rgba(255,255,255,0.35)', 'stroke-width': 1, 'stroke-dasharray': '6 6' }));
    }
  });
  for (let i = 0; i <= 4; i++) {
    const t = data.startMs + (data.endMs - data.startMs) * i / 4;
    const label = new Date(t).toLocaleTimeString([], { hour: 'numeric', hour12: !CFG.display.clockFormat24h });
    svg.appendChild(svgEl('text', { x: x(t), y: h - 8, 'text-anchor': i === 0 ? 'start' : (i === 4 ? 'end' : 'middle'), fill: 'rgba(255,255,255,0.55)', 'font-size': 16 }, label));
  }

  plotted.forEach(function(p) {
    const d = p.s.points.map(function(pt, i) {
      return (i === 0 ? 'M' : 'L') + x(pt[0]).toFixed(1) + ' ' + y(pt[1]).toFixed(1);
    }).join(' ');
    svg.appendChild(svgEl('path', { d, fill: 'none', stroke: p.color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
  });
}

function renderTempStats(data) {
  const table = document.getElementById('temps-stats');
  table.textContent = '';
  const head = htmlEl('tr');
  ['Room', 'Min', 'Max', 'Avg'].forEach(function(t) { head.appendChild(htmlEl('th', '', t)); });
  table.appendChild(head);
  data.sensors.forEach(function(s) {
    const row = htmlEl('tr');
    row.appendChild(htmlEl('td', '', s.label));
    [s.min, s.max, s.avg].forEach(function(v) {
      row.appendChild(htmlEl('td', v === null ? 'muted' : '', v === null ? '--' : v.toFixed(1)));
    });
    table.appendChild(row);
  });
}

function renderTempAstro(data) {
  const el = document.getElementById('temps-astro');
  el.textContent = '';
  const fmt = function(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !CFG.display.clockFormat24h });
  };
  if (data.sun && data.sun.nextRising)  el.appendChild(htmlEl('span', '', 'Sunrise ' + fmt(data.sun.nextRising)));
  if (data.sun && data.sun.nextSetting) el.appendChild(htmlEl('span', '', 'Sunset ' + fmt(data.sun.nextSetting)));
  if (data.moon && data.moon.phase) {
    el.appendChild(htmlEl('span', '', moonPhaseNames[data.moon.phase] || data.moon.phase));
  }
  if (data.moon && data.moon.moonrise) {
    const dir = data.moon.azimuth !== null ? ' ' + compass(data.moon.azimuth) : '';
    el.appendChild(htmlEl('span', '', 'Moonrise ' + data.moon.moonrise + dir));
  }
}

function renderTemps(data) {
  tempsData = data;
  document.getElementById('temps-error').classList.remove('visible');
  renderTempTiles(data);
  renderTempChart(data);
  renderTempStats(data);
  renderTempAstro(data);
}

async function loadTemps() {
  try {
    const res = await fetch('/api/temps');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    renderTemps(await res.json());
  } catch (err) {
    console.warn('Temps fetch failed:', err.message);
    if (!tempsData) {
      const el = document.getElementById('temps-error');
      el.textContent = 'Unable to load temperatures: ' + err.message;
      el.classList.add('visible');
    }
  }
}

function showTemps() {
  document.getElementById('temps-overlay').classList.remove('hidden');
  if (tempsData) renderTemps(tempsData); // show last known data immediately, refresh below
  loadTemps();
  clearInterval(tempsRefreshTimer);
  tempsRefreshTimer = setInterval(loadTemps, 60 * 1000);

  clearTimeout(specialViewHideTimer);
  specialViewHideTimer = setTimeout(hideSpecialView,
    (CFG.specialViews.temperatureDurationSeconds || 120) * 1000);
}

// Live tile updates from the HA websocket while the view is open
function handleTempStateChanged(entityId, newState) {
  const entry = tempTileEls[entityId];
  if (!entry || !tempsOverlayActive()) return;
  setTempTile(entry, parseFloat(newState), tempsData ? tempsData.unit : '°F');
}

function showFlightAware() {
  const frame = document.getElementById('flightaware-frame');
  frame.src   = CFG.specialViews.flightAwareUrl || 'http://192.168.10.71:8080/';
  document.getElementById('flightaware-overlay').classList.remove('hidden');

  clearTimeout(specialViewHideTimer);
  specialViewHideTimer = setTimeout(hideSpecialView,
    (CFG.specialViews.flightAwareDurationSeconds || 120) * 1000);
}

function hideSpecialView() {
  clearTimeout(specialViewHideTimer);
  specialViewHideTimer = null;
  clearInterval(tempsRefreshTimer);
  tempsRefreshTimer = null;
  document.getElementById('temps-overlay').classList.add('hidden');
  const flightawareFrame = document.getElementById('flightaware-frame');
  flightawareFrame.src    = ''; // stop iframe running in background
  document.getElementById('flightaware-overlay').classList.add('hidden');
  photosSinceSpecialView = 0;
}

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
    this._forecastEntityId = null;
    this._forecastCallback = null;
    this._pendingForecastId = null;
  }

  setForecastHandler(entityId, callback) {
    this._forecastEntityId = entityId;
    this._forecastCallback = callback;
  }

  requestForecast() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this._forecastEntityId) {
      this._sendForecastRequest();
    }
  }

  _sendForecastRequest() {
    this._pendingForecastId = this.msgId;
    this._send({
      type: 'call_service',
      domain: 'weather',
      service: 'get_forecasts',
      target: { entity_id: this._forecastEntityId },
      service_data: { type: 'daily' },
      return_response: true,
    });
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
        if (this._forecastEntityId) this._sendForecastRequest();
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

      case 'result':
        if (msg.id === this._pendingForecastId && this._forecastCallback) {
          this._forecastCallback(msg.success ? msg.result : null);
          this._pendingForecastId = null;
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

  handleTempStateChanged(entityId, newState);

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
  haWs.setForecastHandler(CFG.homeAssistant.weatherEntity, applyForecastHigh);
  haWs.connect();

  // Refresh forecast high every 30 minutes
  setInterval(function() { haWs.requestForecast(); }, 30 * 60 * 1000);
}

boot().catch(err => console.error('Boot error:', err));

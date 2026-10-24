'use strict';

const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config loading and validation
// ---------------------------------------------------------------------------

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('ERROR: config.json not found. Copy config.example.json to config.json and fill in your values.');
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error('ERROR: Failed to parse config.json:', err.message);
    process.exit(1);
  }

  var immich = config.immich || {};
  var ha = config.homeAssistant || {};

  const required = [
    ['immich.baseUrl', immich.baseUrl],
    ['immich.apiKey', immich.apiKey],
    ['immich.albumId', immich.albumId],
    ['homeAssistant.baseUrl', ha.baseUrl],
    ['homeAssistant.token', ha.token],
    ['homeAssistant.weatherEntity', ha.weatherEntity],
    ['homeAssistant.cameraEntity', ha.cameraEntity],
    ['homeAssistant.cameraTriggerEntities', ha.cameraTriggerEntities],
    ['homeAssistant.mediaPlayerEntity', ha.mediaPlayerEntity],
  ];

  const missing = required.filter(([, val]) => !val).map(([key]) => key);
  if (missing.length > 0) {
    console.error('ERROR: Missing required config fields:', missing.join(', '));
    process.exit(1);
  }

  // Apply defaults
  config.server = config.server || {};
  config.server.port = config.server.port || 3000;
  config.immich.slideshowIntervalSeconds = config.immich.slideshowIntervalSeconds || 15;
  config.homeAssistant.cameraAutoHideSeconds = config.homeAssistant.cameraAutoHideSeconds || 30;
  config.display = config.display || {};
  config.display.clockFormat24h = config.display.clockFormat24h !== undefined ? config.display.clockFormat24h : false;
  config.display.temperatureUnit = config.display.temperatureUnit || 'F';
  config.specialViews = config.specialViews || {};
  config.specialViews.intervalPhotos             = config.specialViews.intervalPhotos             || 20;
  config.specialViews.dashboardDurationSeconds   = config.specialViews.dashboardDurationSeconds   || 120;
  config.specialViews.flightAwareDurationSeconds = config.specialViews.flightAwareDurationSeconds || 120;
  config.specialViews.flightAwareUrl             = config.specialViews.flightAwareUrl             || 'http://192.168.10.71:8080/';
  // Temperature view (replaces the old embedded Grafana dashboard). The old
  // dashboardDurationSeconds key is still honoured so an existing config.json boots.
  config.specialViews.temperatureDurationSeconds = config.specialViews.temperatureDurationSeconds || config.specialViews.dashboardDurationSeconds || 120;
  config.specialViews.temperatureCoolBelow       = config.specialViews.temperatureCoolBelow !== undefined ? config.specialViews.temperatureCoolBelow : 55;
  config.specialViews.temperatureWarmAtOrAbove   = config.specialViews.temperatureWarmAtOrAbove !== undefined ? config.specialViews.temperatureWarmAtOrAbove : 78;
  config.homeAssistant.temperatureSensors = Array.isArray(config.homeAssistant.temperatureSensors) && config.homeAssistant.temperatureSensors.length > 0
    ? config.homeAssistant.temperatureSensors
    : [
        { entity: 'sensor.basement_temperature',      label: 'Basement' },
        { entity: 'sensor.main_bath_temperature',     label: 'Main Bath' },
        { entity: 'sensor.office_temperature',        label: 'Office' },
        { entity: 'sensor.garage_temperature',        label: 'Garage' },
        { entity: 'sensor.guest_bedroom_temperature', label: 'Guest Bedroom' },
        { entity: 'sensor.aiden_room_temperature',    label: 'Aiden Room' },
        { entity: 'sensor.dna_room_temperature',      label: 'DNA Bedroom' },
        { entity: 'sensor.elizabeth_room_temperature', label: 'Elizabeth Room' },
      ];
  config.homeAssistant.sunEntity            = config.homeAssistant.sunEntity            || 'sun.sun';
  config.homeAssistant.moonPhaseEntity      = config.homeAssistant.moonPhaseEntity      || 'sensor.moon_phase';
  config.homeAssistant.moonriseTimeEntity   = config.homeAssistant.moonriseTimeEntity   || 'sensor.moonrise_time_local';
  config.homeAssistant.moonriseAzimuthEntity = config.homeAssistant.moonriseAzimuthEntity || 'sensor.moonrise_azimuth';

  return config;
}

const config = loadConfig();

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = express();

// Serve static files from public/, but intercept index.html to inject token
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ---------------------------------------------------------------------------
// GET / — serve index.html with HA token injected
// ---------------------------------------------------------------------------

app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, 'public', 'index.html');
  let html;
  try {
    html = fs.readFileSync(htmlPath, 'utf8');
  } catch (err) {
    return res.status(500).send('index.html not found');
  }
  // Replace the placeholder so the token never lives in a static file
  html = html.replace('%%HA_TOKEN%%', config.homeAssistant.token.trim());
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ---------------------------------------------------------------------------
// GET /api/config — non-secret config for the frontend
// ---------------------------------------------------------------------------

app.get('/api/config', (req, res) => {
  res.json({
    immich: {
      baseUrl: config.immich.baseUrl,
      albumId: config.immich.albumId,
      apiKey: config.immich.apiKey,
      slideshowIntervalSeconds: config.immich.slideshowIntervalSeconds,
    },
    homeAssistant: {
      baseUrl: config.homeAssistant.baseUrl,
      weatherEntity: config.homeAssistant.weatherEntity,
      cameraEntity: config.homeAssistant.cameraEntity,
      cameraTriggerEntities: config.homeAssistant.cameraTriggerEntities,
      cameraAutoHideSeconds: config.homeAssistant.cameraAutoHideSeconds,
      mediaPlayerEntity: config.homeAssistant.mediaPlayerEntity,
      temperatureSensors: config.homeAssistant.temperatureSensors,
    },
    display: config.display,
    specialViews: {
      intervalPhotos:             config.specialViews.intervalPhotos,
      temperatureDurationSeconds: config.specialViews.temperatureDurationSeconds,
      temperatureCoolBelow:       config.specialViews.temperatureCoolBelow,
      temperatureWarmAtOrAbove:   config.specialViews.temperatureWarmAtOrAbove,
      flightAwareDurationSeconds: config.specialViews.flightAwareDurationSeconds,
      flightAwareUrl:             config.specialViews.flightAwareUrl,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/weather — proxied HA weather state
// ---------------------------------------------------------------------------

app.get('/api/weather', async (req, res) => {
  const url = `${config.homeAssistant.baseUrl}/api/states/${config.homeAssistant.weatherEntity}`;
  const headers = { Authorization: `Bearer ${config.homeAssistant.token}` };
  try {
    const response = await fetch(url, { headers, timeout: 8000 });
    if (!response.ok) {
      return res.status(502).json({ error: `HA returned ${response.status}` });
    }
    const data = await response.json();
    let temperature = (data.attributes && data.attributes.temperature !== undefined) ? data.attributes.temperature : null;

    // Some weather integrations (e.g. OpenWeatherMap) round the weather
    // entity's temperature attribute to a whole degree. If configured, pull
    // the precise reading from a separate sensor entity instead.
    const tempEntity = config.homeAssistant.temperatureEntity;
    if (tempEntity) {
      try {
        const tempRes = await fetch(`${config.homeAssistant.baseUrl}/api/states/${tempEntity}`, { headers, timeout: 8000 });
        if (tempRes.ok) {
          const tempData = await tempRes.json();
          const parsed = parseFloat(tempData.state);
          if (!Number.isNaN(parsed)) temperature = parsed;
        }
      } catch (err) {
        console.warn('Temperature sensor fetch failed, using weather entity value:', err.message);
      }
    }

    res.json({
      condition:   data.state,
      temperature,
      unit:        config.display.temperatureUnit === 'F' ? '°F' : '°C',
      humidity:    (data.attributes && data.attributes.humidity !== undefined) ? data.attributes.humidity : null,
    });
  } catch (err) {
    console.error('Weather fetch error:', err.message);
    res.status(502).json({ error: 'Failed to fetch weather from Home Assistant' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/temps — 24h room-temperature history + stats, sun and moon
// ---------------------------------------------------------------------------

const TEMPS_WINDOW_MS = 24 * 60 * 60 * 1000;
const TEMPS_BUCKET_MS = 5 * 60 * 1000;
const TEMPS_CACHE_MS  = 60 * 1000;
let tempsCache = { at: 0, data: null };

async function haGetJson(urlPath, timeout) {
  const response = await fetch(`${config.homeAssistant.baseUrl}${urlPath}`, {
    headers: { Authorization: `Bearer ${config.homeAssistant.token}` },
    timeout: timeout || 8000,
  });
  if (!response.ok) throw new Error(`HA returned ${response.status} for ${urlPath.split('?')[0]}`);
  return response.json();
}

// Turns one entity's raw HA history into { points, min, max, avg, latest, offline }.
// Non-numeric states (unavailable/unknown) are dropped from the series and stats.
function summarizeSeries(history, startMs, endMs) {
  const samples = [];
  let latestState = null;
  (history || []).forEach(function(s) {
    latestState = s.state;
    const value = parseFloat(s.state);
    if (Number.isNaN(value)) return;
    const t = Math.max(startMs, new Date(s.last_changed || s.last_updated).getTime());
    samples.push({ t, value });
  });

  const latestValue = parseFloat(latestState);
  const offline = Number.isNaN(latestValue);
  if (samples.length === 0) {
    return { points: [], min: null, max: null, avg: null, latest: null, offline: true };
  }

  samples.sort(function(a, b) { return a.t - b.t; });

  let min = Infinity, max = -Infinity, weighted = 0, span = 0;
  const buckets = new Map();
  samples.forEach(function(s, i) {
    if (s.value < min) min = s.value;
    if (s.value > max) max = s.value;
    const until = i + 1 < samples.length ? samples[i + 1].t : endMs;
    const dur = Math.max(until - s.t, 0);
    weighted += s.value * dur;
    span += dur;
    const key = Math.floor((s.t - startMs) / TEMPS_BUCKET_MS);
    const b = buckets.get(key) || { sum: 0, n: 0 };
    b.sum += s.value; b.n++;
    buckets.set(key, b);
  });

  const points = Array.from(buckets.entries())
    .sort(function(a, b) { return a[0] - b[0]; })
    .map(function(e) { return [startMs + e[0] * TEMPS_BUCKET_MS, +(e[1].sum / e[1].n).toFixed(2)]; });

  return {
    points,
    min,
    max,
    avg: span > 0 ? weighted / span : samples[samples.length - 1].value,
    latest: offline ? null : latestValue,
    offline,
  };
}

async function buildTempsPayload() {
  const ha = config.homeAssistant;
  const endMs = Date.now();
  const startMs = endMs - TEMPS_WINDOW_MS;
  const sensors = ha.temperatureSensors;
  const entityIds = sensors.map(function(s) { return s.entity; });

  const historyUrl = `/api/history/period/${new Date(startMs).toISOString()}` +
    `?filter_entity_id=${entityIds.join(',')}&end_time=${encodeURIComponent(new Date(endMs).toISOString())}` +
    '&minimal_response&no_attributes&significant_changes_only=0';

  const stateOf = function(entityId) {
    return haGetJson(`/api/states/${entityId}`).catch(function() { return null; });
  };

  const [history, sun, moonPhase, moonriseTime, moonriseAzimuth] = await Promise.all([
    haGetJson(historyUrl, 20000),
    stateOf(ha.sunEntity),
    stateOf(ha.moonPhaseEntity),
    stateOf(ha.moonriseTimeEntity),
    stateOf(ha.moonriseAzimuthEntity),
  ]);

  // minimal_response only repeats entity_id on the first item of each series
  const byEntity = {};
  (history || []).forEach(function(series) {
    if (series && series[0] && series[0].entity_id) byEntity[series[0].entity_id] = series;
  });

  const azimuth = moonriseAzimuth ? parseFloat(moonriseAzimuth.state) : NaN;
  return {
    generatedAt: endMs,
    startMs,
    endMs,
    unit: config.display.temperatureUnit === 'F' ? '°F' : '°C',
    sensors: sensors.map(function(s) {
      return Object.assign({ entity: s.entity, label: s.label }, summarizeSeries(byEntity[s.entity], startMs, endMs));
    }),
    sun: sun ? {
      nextRising:  sun.attributes && sun.attributes.next_rising  || null,
      nextSetting: sun.attributes && sun.attributes.next_setting || null,
    } : null,
    moon: {
      phase:       moonPhase ? moonPhase.state : null,
      moonrise:    moonriseTime && !['unknown', 'unavailable'].includes(moonriseTime.state) ? moonriseTime.state : null,
      azimuth:     Number.isNaN(azimuth) ? null : azimuth,
    },
  };
}

app.get('/api/temps', async (req, res) => {
  if (tempsCache.data && Date.now() - tempsCache.at < TEMPS_CACHE_MS) {
    return res.json(tempsCache.data);
  }
  try {
    const data = await buildTempsPayload();
    tempsCache = { at: Date.now(), data };
    res.json(data);
  } catch (err) {
    console.error('Temps fetch error:', err.message);
    if (tempsCache.data) return res.json(tempsCache.data); // serve stale rather than blank the view
    res.status(502).json({ error: 'Failed to fetch temperatures from Home Assistant' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/immich/album — proxied Immich album asset list
// ---------------------------------------------------------------------------

app.get('/api/immich/album', async (req, res) => {
  const url = `${config.immich.baseUrl}/api/albums/${config.immich.albumId}`;
  try {
    const response = await fetch(url, {
      headers: { 'x-api-key': config.immich.apiKey },
      timeout: 15000,
    });
    if (!response.ok) {
      console.error('Immich album fetch failed: HTTP', response.status, url);
      return res.status(502).json({ error: `Immich returned ${response.status}` });
    }
    const data = await response.json();
    const images = (data.assets || []).filter(function(a) { return a.type === 'IMAGE'; });
    console.log('Immich album loaded:', images.length, 'images');
    res.json({ assets: images });
  } catch (err) {
    console.error('Immich album fetch error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/camera-snapshot — proxied HA camera image
// ---------------------------------------------------------------------------

app.get('/api/camera-snapshot', async (req, res) => {
  const url = `${config.homeAssistant.baseUrl}/api/camera_proxy/${config.homeAssistant.cameraEntity}`;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${config.homeAssistant.token}` },
      timeout: 10000,
    });
    if (!response.ok) {
      return res.status(502).json({ error: `HA camera returned ${response.status}` });
    }
    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    response.body.pipe(res);
  } catch (err) {
    console.error('Camera snapshot error:', err.message);
    res.status(502).json({ error: 'Failed to fetch camera snapshot from Home Assistant' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', configLoaded: true });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(config.server.port, () => {
  console.log(`Picture Frame server running at http://localhost:${config.server.port}`);
  console.log(`HA base: ${config.homeAssistant.baseUrl}`);
  console.log(`Immich base: ${config.immich.baseUrl}`);
});

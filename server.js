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
  config.homeAssistant.moonEntity = config.homeAssistant.moonEntity || 'sensor.moon';

  config.specialViews = config.specialViews || {};
  config.specialViews.intervalPhotos             = config.specialViews.intervalPhotos             || 20;
  config.specialViews.dashboardDurationSeconds   = config.specialViews.dashboardDurationSeconds   || 120;
  config.specialViews.flightAwareDurationSeconds = config.specialViews.flightAwareDurationSeconds || 120;
  config.specialViews.flightAwareUrl             = config.specialViews.flightAwareUrl             || 'http://192.168.10.71:8080/';
  config.specialViews.sensorEntities             = config.specialViews.sensorEntities             || [];

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
    },
    display: config.display,
    specialViews: {
      intervalPhotos:             config.specialViews.intervalPhotos,
      dashboardDurationSeconds:   config.specialViews.dashboardDurationSeconds,
      flightAwareDurationSeconds: config.specialViews.flightAwareDurationSeconds,
      flightAwareUrl:             config.specialViews.flightAwareUrl,
      sensorEntities:             config.specialViews.sensorEntities,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/weather — proxied HA weather state
// ---------------------------------------------------------------------------

app.get('/api/weather', async (req, res) => {
  const url = `${config.homeAssistant.baseUrl}/api/states/${config.homeAssistant.weatherEntity}`;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${config.homeAssistant.token}` },
      timeout: 8000,
    });
    if (!response.ok) {
      return res.status(502).json({ error: `HA returned ${response.status}` });
    }
    const data = await response.json();
    res.json({
      condition: data.state,
      temperature: (data.attributes && data.attributes.temperature !== undefined) ? data.attributes.temperature : null,
      unit: config.display.temperatureUnit === 'F' ? '°F' : '°C',
      humidity: (data.attributes && data.attributes.humidity !== undefined) ? data.attributes.humidity : null,
    });
  } catch (err) {
    console.error('Weather fetch error:', err.message);
    res.status(502).json({ error: 'Failed to fetch weather from Home Assistant' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/sensor-states — proxied HA sensor states for the dashboard
// ---------------------------------------------------------------------------

app.get('/api/sensor-states', async (req, res) => {
  const entities = config.specialViews.sensorEntities || [];
  if (entities.length === 0) return res.json([]);

  const haBase  = config.homeAssistant.baseUrl;
  const haToken = config.homeAssistant.token;

  const fetches = entities.map(async ({ entityId, label }) => {
    const url = `${haBase}/api/states/${entityId}`;
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${haToken}` },
        timeout: 8000,
      });
      if (!response.ok) {
        return { entityId, label, state: null, unit: null, error: `HA ${response.status}` };
      }
      const data = await response.json();
      return {
        entityId,
        label,
        state: data.state,
        unit: (data.attributes && data.attributes.unit_of_measurement) || null,
      };
    } catch (err) {
      console.warn(`Sensor fetch failed for ${entityId}:`, err.message);
      return { entityId, label, state: null, unit: null, error: err.message };
    }
  });

  try {
    const results = await Promise.all(fetches);
    res.json(results);
  } catch (err) {
    console.error('sensor-states parallel fetch error:', err.message);
    res.status(502).json({ error: 'Failed to fetch sensor states' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/sun-moon — sunrise, sunset, and moon phase from HA
// ---------------------------------------------------------------------------

app.get('/api/sun-moon', async (req, res) => {
  const haBase  = config.homeAssistant.baseUrl;
  const haToken = config.homeAssistant.token;

  // Helper: convert snake_case moon phase to Title Case
  function formatMoonPhase(state) {
    return state.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  }

  // Fetch sunrise, sunset, and moon entity in parallel.
  // Newer HA versions expose rising/setting as separate sensor entities rather
  // than attributes of sun.sun, so we fetch all three independently.
  const [riseResult, setResult, moonResult] = await Promise.allSettled([
    fetch(`${haBase}/api/states/sensor.sun_next_rising`, {
      headers: { Authorization: `Bearer ${haToken}` },
      timeout: 8000,
    }),
    fetch(`${haBase}/api/states/sensor.sun_next_setting`, {
      headers: { Authorization: `Bearer ${haToken}` },
      timeout: 8000,
    }),
    fetch(`${haBase}/api/states/${config.homeAssistant.moonEntity}`, {
      headers: { Authorization: `Bearer ${haToken}` },
      timeout: 8000,
    }),
  ]);

  // Return raw ISO strings — the browser formats them in its own local timezone
  let sunriseIso = null;
  let sunsetIso  = null;
  let moonPhase  = null;

  if (riseResult.status === 'fulfilled' && riseResult.value.ok) {
    try {
      const data = await riseResult.value.json();
      if (data.state && data.state !== 'unavailable' && data.state !== 'unknown') {
        sunriseIso = data.state;
      }
    } catch (err) {
      console.warn('sun_next_rising parse error:', err.message);
    }
  } else {
    console.warn('sensor.sun_next_rising fetch failed');
  }

  if (setResult.status === 'fulfilled' && setResult.value.ok) {
    try {
      const data = await setResult.value.json();
      if (data.state && data.state !== 'unavailable' && data.state !== 'unknown') {
        sunsetIso = data.state;
      }
    } catch (err) {
      console.warn('sun_next_setting parse error:', err.message);
    }
  } else {
    console.warn('sensor.sun_next_setting fetch failed');
  }

  if (moonResult.status === 'fulfilled' && moonResult.value.ok) {
    try {
      const moonData = await moonResult.value.json();
      if (moonData.state && moonData.state !== 'unavailable' && moonData.state !== 'unknown') {
        moonPhase = formatMoonPhase(moonData.state);
      }
    } catch (err) {
      console.warn('Moon entity parse error:', err.message);
    }
  } else {
    console.warn('Moon entity fetch failed — moon phase will not be shown');
  }

  res.json({ sunriseIso, sunsetIso, moonPhase });
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

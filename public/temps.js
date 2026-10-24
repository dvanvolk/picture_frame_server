'use strict';

// Shared by index.html (slideshow kiosk) and temps.html (standalone graph page).
// Loaded before app.js.

// ============================================================
// Config — loaded from the server on startup
// ============================================================

let CFG = null;

async function loadConfig() {
  const res = await fetch('/api/config');
  CFG = await res.json();
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

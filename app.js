const RAW_URL = 'https://raw.githubusercontent.com/BayatQuantum/osint-cbrn-tracker/data/alert.json';
const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
const STALE_MIN = 45;
const REFRESH_MS = 60000;
const CENTER = [32.4279, 53.688];
const DEFAULT_CFG = { bbox: { south: 25, west: 44, north: 40, east: 64 }, min_magnitude: 2.0, max_depth_km: 2.5 };
const CONF_COLOR = { LOW: '#f5a623', MEDIUM: '#ea580c', HIGH: '#dc2626' };

const map = L.map('map', { center: CENTER, zoom: 6, minZoom: 3, zoomControl: false, fadeAnimation: false, zoomAnimation: false, markerZoomAnimation: false,
  maxBounds: [[0, 20], [58, 95]], maxBoundsViscosity: 0.8 });
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
L.tileLayer(ESRI + 'World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ', maxNativeZoom: 16, maxZoom: 18 }).addTo(map);
L.tileLayer(ESRI + 'World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
  maxNativeZoom: 16, maxZoom: 18, pane: 'shadowPane' }).addTo(map);

const layers = { region: L.layerGroup().addTo(map), fast: L.layerGroup().addTo(map),
                 events: L.layerGroup().addTo(map), plume: L.layerGroup().addTo(map) };

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const $ = id => document.getElementById(id);
const p2 = v => String(v).padStart(2, '0');

function tickClocks() {
  const n = new Date();
  $('utc-clock').textContent = `${p2(n.getUTCHours())}:${p2(n.getUTCMinutes())}:${p2(n.getUTCSeconds())} UTC`;
  $('local-clock').textContent = n.toLocaleTimeString('en-GB', { timeZoneName: 'short' });
}
setInterval(tickClocks, 1000);
tickClocks();

$('zin').onclick = () => map.zoomIn();
$('zout').onclick = () => map.zoomOut();
$('zhome').onclick = () => map.setView(CENTER, 6, { animate: false });
$('search-form').onsubmit = e => {
  e.preventDefault();
  const m = $('search').value.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
  if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) map.setView([+m[1], +m[2]], 9, { animate: false });
};
document.querySelectorAll('.dock-btn[data-layer]').forEach(b => {
  b.onclick = () => {
    const on = b.classList.toggle('on');
    const g = layers[b.dataset.layer];
    on ? g.addTo(map) : map.removeLayer(g);
  };
});

function cone(lat, lon, bearing, km, spread) {
  const R = 6371, rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  const dest = (b, d) => {
    const la = rad(lat), lo = rad(lon), br = rad(b), dd = d / R;
    const la2 = Math.asin(Math.sin(la) * Math.cos(dd) + Math.cos(la) * Math.sin(dd) * Math.cos(br));
    const lo2 = lo + Math.atan2(Math.sin(br) * Math.sin(dd) * Math.cos(la), Math.cos(dd) - Math.sin(la) * Math.sin(la2));
    return [deg(la2), deg(lo2)];
  };
  return [[lat, lon], dest(bearing - spread / 2, km), dest(bearing, km * 1.12), dest(bearing + spread / 2, km)];
}

function kv(label, value) {
  const r = h('div', 'kv'); r.append(h('span', '', label), h('span', '', value)); return r;
}
function section(title) { const s = h('div', 'sec'); s.append(h('h4', '', title)); return s; }

function showDetail(ev) {
  $('detail-card').hidden = false;
  $('detail-title').textContent = (ev.demo ? 'SIMULATION: ' : '') + `M${ev.magnitude} surface event`;
  const body = $('detail-body'); body.textContent = '';
  const color = CONF_COLOR[ev.confidence] || CONF_COLOR.LOW;

  const s1 = section('Seismic');
  const big = h('div', 'big', `M${ev.magnitude}`); big.style.color = color;
  s1.append(big, kv('Depth', `${ev.depth_km} km`), kv('Type', ev.event_type),
            kv('Time (UTC)', ev.time.replace('T', ' ').replace('Z', '')),
            kv('Position', `${ev.lat.toFixed(3)}, ${ev.lon.toFixed(3)}`),
            kv('Source', ev.source), kv('Confidence', ev.confidence),
            kv('Flags', (ev.flags && ev.flags.length) ? ev.flags.join(', ') : 'none'));
  const s2 = section('Thermal check');
  const t = ev.thermal;
  s2.append(kv('Status', !t || !t.checked ? 'Not checked yet' : (t.anomaly ? 'Anomaly detected' : 'No anomaly')));
  if (t && t.source) s2.append(kv('Source', t.source));
  const s3 = section('Wind and plume');
  if (ev.wind) {
    s3.append(kv('Wind speed', `${ev.wind.speed_kmh} km/h`), kv('Blowing from', `${ev.wind.from_deg} deg`),
              kv('Plume toward', `${ev.wind.toward_deg} deg`), kv('Precipitation', ev.wind.precip ? 'Yes' : 'No'),
              h('p', 'note', 'Cones show 1, 3 and 6 hour reach. Simple geometry, not a dispersion model.'));
  } else {
    s3.append(h('p', 'note', 'Wind data not available yet for this event.'));
  }
  const s4 = section('Gas and aerosol analysis');
  s4.append(kv('Status', ev.gas_analysis ? ev.gas_analysis.status : 'PENDING'),
            h('p', 'note', 'Satellite gas data arrives hours later and cannot identify weapon type.'));
  body.append(s1, s2, s3, s4);

  layers.plume.clearLayers();
  if (ev.wind) {
    const hours = (ev.plume && ev.plume.hours) || [1, 3, 6];
    hours.slice().reverse().forEach((hr, i) => {
      L.polygon(cone(ev.lat, ev.lon, ev.wind.toward_deg, ev.wind.speed_kmh * hr, 28),
        { color, weight: 1, fillColor: color, fillOpacity: 0.12 + 0.08 * i }).addTo(layers.plume);
    });
  }
  map.setView([ev.lat, ev.lon], 8, { animate: false });
}
$('detail-close').onclick = () => { $('detail-card').hidden = true; layers.plume.clearLayers(); };

function renderEvents(events) {
  layers.events.clearLayers();
  const list = $('events-list'); list.textContent = '';
  $('event-count').textContent = events.length;
  if (!events.length) list.append(h('div', 'empty', 'No surface events in the monitored region right now.'));
  events.forEach(ev => {
    const color = CONF_COLOR[ev.confidence] || CONF_COLOR.LOW;
    L.circleMarker([ev.lat, ev.lon], { radius: 8, fillColor: color, color: '#fff', weight: 2, fillOpacity: 1 })
      .on('click', () => showDetail(ev)).addTo(layers.events);
    const row = h('div', 'row');
    const mag = h('div', 'mag', `M${ev.magnitude}`); mag.style.background = color;
    const main = h('div', 'row-main');
    main.append(h('div', 'row-title', `${ev.event_type}, depth ${ev.depth_km} km`),
                h('div', 'row-sub', `${ev.lat.toFixed(2)}, ${ev.lon.toFixed(2)} | ${ev.time.slice(11, 16)} UTC`));
    row.append(mag, main, h('span', ev.demo ? 'tag demo' : 'tag', ev.demo ? 'SIMULATED' : ev.confidence));
    row.onclick = () => showDetail(ev);
    list.append(row);
  });
}

function setStatus(text, level) {
  $('status-text').textContent = text;
  $('status-chip').className = 'chip ' + level;
}

function drawRegion(b) {
  layers.region.clearLayers();
  L.rectangle([[b.south, b.west], [b.north, b.east]],
    { color: '#4a90c2', weight: 1.5, dashArray: '6 6', fill: false, interactive: false }).addTo(layers.region);
}

function renderFast(features, cfg, skip) {
  layers.fast.clearLayers();
  const b = cfg.bbox;
  features.forEach(f => {
    const [lon, lat, depth] = f.geometry.coordinates, p = f.properties;
    if (p.mag == null || depth == null || p.mag < cfg.min_magnitude || depth > cfg.max_depth_km) return;
    if (lat < b.south || lat > b.north || lon < b.west || lon > b.east || skip.has(f.id)) return;
    L.circleMarker([lat, lon], { radius: 6, fillColor: '#9aa5b1', color: '#fff', weight: 1.5, fillOpacity: .9 })
      .bindTooltip(`Unverified: M${p.mag}, depth ${depth} km`).addTo(layers.fast);
  });
}

let demoOn = false;
const DEMO_EVENT = { id: 'demo', demo: true, source: 'SIMULATED', lat: 32.65, lon: 51.67, magnitude: 2.8, depth_km: 0,
  event_type: 'explosion', confidence: 'HIGH', time: new Date().toISOString().slice(0, 19) + 'Z',
  thermal: { checked: true, anomaly: true, source: 'SIMULATED' },
  wind: { speed_kmh: 28, from_deg: 255, toward_deg: 75, precip: false },
  plume: { hours: [1, 3, 6] }, gas_analysis: { status: 'PENDING' } };

$('demo-btn').onclick = () => {
  demoOn = !demoOn;
  $('demo-btn').classList.toggle('on', demoOn);
  if (demoOn) { renderEvents([DEMO_EVENT]); showDetail(DEMO_EVENT); setStatus('Simulation mode - synthetic data', 'amber'); }
  else { $('detail-card').hidden = true; layers.plume.clearLayers(); loadAll(); }
};

async function loadAll() {
  let cfg = DEFAULT_CFG, ids = new Set();
  try {
    const r = await fetch(`${RAW_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const a = await r.json();
    cfg = a.config; ids = new Set(a.events.map(e => e.id));
    drawRegion(cfg.bbox);
    if (!demoOn) {
      renderEvents(a.events);
      const age = Math.round((Date.now() - new Date(a.generated_at)) / 60000);
      if (age > STALE_MIN) setStatus(`Analysis feed stale (${age} min)`, 'red');
      else setStatus(`Status: ${a.status} | updated ${age} min ago`, a.status === 'NORMAL' ? 'green' : 'amber');
    }
  } catch (e) {
    drawRegion(cfg.bbox);
    if (!demoOn) setStatus('Analysis feed unreachable', 'red');
  }
  try {
    const r = await fetch(USGS_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    renderFast((await r.json()).features || [], cfg, ids);
  } catch (e) { console.warn('USGS fast layer failed', e); }
}
loadAll();
setInterval(loadAll, REFRESH_MS);

// ---- UI additions: collapsible cards, fullscreen, region info ----
document.querySelectorAll('.chev').forEach(b => {
  b.onclick = () => b.closest('.card').classList.toggle('collapsed');
});
$('zfull').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();

const _drawRegion = drawRegion;
drawRegion = function (b) {
  _drawRegion(b);
  const box = $('region-info'); box.textContent = '';
  box.append(kv('South / North', `${b.south} / ${b.north}`), kv('West / East', `${b.west} / ${b.east}`),
             kv('Page refresh', 'every 60 s'), kv('Analysis feed', 'GitHub Actions, 5-20 min'));
};

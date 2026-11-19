// ---- Config ----
const RAW_URL = 'https://raw.githubusercontent.com/BayatQuantum/osint-cbrn-tracker/data/alert.json';
const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson';
const STALE_MIN = 45;      // analysis feed older than this = stale (includes CDN cache)
const REFRESH_MS = 60000;
const DEFAULT_CFG = { bbox: { south: 25, west: 44, north: 40, east: 64 }, min_magnitude: 2.0, max_depth_km: 2.5 };

// ---- Map ----
const regionBounds = [[10.0, 25.0], [48.0, 80.0]];
const map = L.map('map', {
    center: [32.4279, 53.6880], zoom: 6, minZoom: 4,
    maxBounds: regionBounds, maxBoundsViscosity: 0.9, zoomControl: false
});
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 18
}).addTo(map);

// ---- UTC clock ----
function updateClock() {
    const n = new Date();
    const p = v => String(v).padStart(2, '0');
    document.getElementById('utc-clock').innerText =
        `${p(n.getUTCHours())}:${p(n.getUTCMinutes())}:${p(n.getUTCSeconds())} UTC`;
}
setInterval(updateClock, 1000);
updateClock();

// ---- Plume geometry (simple cone, NOT a real dispersion model) ----
function calculatePlume(lat, lon, bearingDeg, distanceKm, spreadDeg = 28) {
    const R = 6371;
    const toRad = d => (d * Math.PI) / 180;
    const toDeg = r => (r * 180) / Math.PI;
    function dest(sLat, sLon, brng, dist) {
        const lat1 = toRad(sLat), lon1 = toRad(sLon), b = toRad(brng), d = dist / R;
        const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
        const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1),
                                       Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
        return [toDeg(lat2), toDeg(lon2)];
    }
    return [[lat, lon],
            dest(lat, lon, bearingDeg - spreadDeg / 2, distanceKm),
            dest(lat, lon, bearingDeg, distanceKm * 1.12),
            dest(lat, lon, bearingDeg + spreadDeg / 2, distanceKm)];
}

const alertLayer = L.layerGroup().addTo(map);   // verified/analysed events (alert.json)
const fastLayer = L.layerGroup().addTo(map);    // unverified (direct USGS)
const zoneLayer = L.layerGroup().addTo(map);    // monitored bbox outline

// ---- Demo simulation (test button) ----
let activeMarker = null, activePlume = null;
function simulatePlume(lat, lon, title, mag, depth, windAngle, windSpeed) {
    resetSimulation();
    activeMarker = L.circleMarker([lat, lon], { radius: 8, fillColor: '#ef4444', color: '#fbbf24', weight: 2, fillOpacity: 1 }).addTo(map);
    activePlume = L.polygon(calculatePlume(lat, lon, windAngle, windSpeed * 3),
        { color: '#dc2626', weight: 1.5, fillColor: '#ef4444', fillOpacity: 0.38 }).addTo(map);
    map.flyTo([lat, lon], 7, { duration: 1.2 });
    const card = document.getElementById('telemetry-card');
    card.style.display = 'block';
    document.getElementById('telemetry-title').innerText = `DEMO: ${title} (M${mag})`;
    document.getElementById('telemetry-desc').innerText =
        `Simulated data. Surface anomaly (depth ${depth} km). Plume moving toward ${windAngle} deg at ${windSpeed} km/h.`;
}
function resetSimulation() {
    if (activeMarker) map.removeLayer(activeMarker);
    if (activePlume) map.removeLayer(activePlume);
    activeMarker = activePlume = null;
    document.getElementById('telemetry-card').style.display = 'none';
}
function resetMapView() { map.flyTo([32.4279, 53.6880], 6, { duration: 1 }); }

// ---- Status banner (created here, no HTML change needed) ----
const banner = document.createElement('div');
banner.style.cssText = 'position:absolute;top:64px;left:50%;transform:translateX(-50%);z-index:1100;' +
    'padding:6px 14px;border-radius:6px;font:600 12px Inter,sans-serif;color:#fff;background:#4b5563;';
document.body.appendChild(banner);
function setBanner(text, level) {
    banner.textContent = text;
    banner.style.background = level === 'bad' ? '#b91c1c' : level === 'warn' ? '#b45309' : '#374151';
}

const CONF_COLOR = { LOW: '#f59e0b', MEDIUM: '#ea580c', HIGH: '#dc2626' };

function describe(ev) {
    return `M${ev.magnitude} | depth ${ev.depth_km} km | ${ev.event_type} | ` +
           `${ev.time.replace('T', ' ').replace('Z', ' UTC')}`;
}

function renderAlert(alert) {
    alertLayer.clearLayers();
    zoneLayer.clearLayers();
    const b = alert.config.bbox;
    L.rectangle([[b.south, b.west], [b.north, b.east]],
        { color: '#2563eb', weight: 1, dashArray: '6 6', fill: false, interactive: false }).addTo(zoneLayer);

    const list = document.getElementById('triggers-list');
    list.textContent = '';
    if (alert.events.length === 0) {
        const d = document.createElement('div');
        d.className = 'trigger-item';
        d.textContent = 'No surface events in monitored region.';
        list.appendChild(d);
    }
    alert.events.forEach((ev, i) => {
        const color = CONF_COLOR[ev.confidence] || '#f59e0b';
        L.circleMarker([ev.lat, ev.lon], { radius: 8, fillColor: color, color: '#fff', weight: 2, fillOpacity: 1 })
            .bindTooltip(`${ev.confidence}: ${describe(ev)}`).addTo(alertLayer);
        if (ev.wind) {
            L.polygon(calculatePlume(ev.lat, ev.lon, ev.wind.toward_deg, ev.wind.speed_kmh * 3),
                { color, weight: 1.5, fillColor: color, fillOpacity: 0.3 }).addTo(alertLayer);
        }
        const row = document.createElement('div');
        row.className = 'trigger-item';
        row.textContent = `${i + 1}. [${ev.confidence}] ${describe(ev)}`;
        row.onclick = () => map.flyTo([ev.lat, ev.lon], 8, { duration: 1 });
        list.appendChild(row);
    });
}

function checkFreshness(alert) {
    const ageMin = (Date.now() - new Date(alert.generated_at).getTime()) / 60000;
    const local = new Date(alert.generated_at).toLocaleString();
    if (ageMin > STALE_MIN) {
        setBanner(`Analysis feed STALE (${Math.round(ageMin)} min old, last ${local})`, 'bad');
    } else {
        setBanner(`Analysis feed OK | updated ${local} | status ${alert.status}`, alert.status === 'NORMAL' ? 'ok' : 'warn');
    }
}

function renderFast(features, cfg, confirmedIds) {
    fastLayer.clearLayers();
    const b = cfg.bbox;
    features.forEach(f => {
        const [lon, lat, depth] = f.geometry.coordinates;
        const p = f.properties;
        if (p.mag == null || depth == null || p.mag < cfg.min_magnitude || depth > cfg.max_depth_km) return;
        if (lat < b.south || lat > b.north || lon < b.west || lon > b.east) return;
        if (confirmedIds.has(f.id)) return;
        L.circleMarker([lat, lon], { radius: 6, fillColor: '#6b7280', color: '#fff', weight: 1.5, fillOpacity: 0.9 })
            .bindTooltip(`UNVERIFIED: M${p.mag} | depth ${depth} km | ${p.type || 'unknown'}`).addTo(fastLayer);
    });
}

async function loadAll() {
    let cfg = DEFAULT_CFG, ids = new Set();
    try {
        const r = await fetch(`${RAW_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(r.status);
        const alert = await r.json();
        cfg = alert.config;
        ids = new Set(alert.events.map(e => e.id));
        renderAlert(alert);
        checkFreshness(alert);
    } catch (e) {
        setBanner('Analysis feed unreachable', 'bad');
    }
    try {
        const r = await fetch(USGS_URL, { cache: 'no-store' });
        if (!r.ok) throw new Error(r.status);
        renderFast((await r.json()).features || [], cfg, ids);
    } catch (e) {
        console.warn('USGS fast layer failed', e);
    }
}
loadAll();
setInterval(loadAll, REFRESH_MS);

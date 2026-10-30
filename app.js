// 1. Initialize Map (Locked to Middle East, centered on Iran)
const regionBounds = [
    [18.0, 32.0],
    [44.0, 72.0]
];

const map = L.map('map', {
    center: [32.4279, 53.6880],
    zoom: 6,
    minZoom: 5,
    maxBounds: regionBounds,
    maxBoundsViscosity: 0.9,
    zoomControl: false
});

// 2. Load Bright Day Map with Clear Borders (OpenStreetMap / Carto Voyager style similar to FR24)
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 18
}).addTo(map);

// 3. Live UTC Clock (Like FlightRadar24 Top Bar)
function updateClock() {
    const now = new Date();
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    const seconds = String(now.getUTCSeconds()).padStart(2, '0');
    document.getElementById('utc-clock').innerText = `${hours}:${minutes}:${seconds} UTC`;
}
setInterval(updateClock, 1000);
updateClock();

// 4. Add Monitored City Pins (Blue pins like FR24 airports)
const monitoredZones = [
    { name: "Tehran Sector", coords: [35.6892, 51.3890] },
    { name: "Isfahan Sector", coords: [32.6546, 51.6680] },
    { name: "Bushehr Sector", coords: [28.9234, 50.8203] },
    { name: "Arak Sector", coords: [34.0954, 49.7013] },
    { name: "Tabriz Sector", coords: [38.0962, 46.2738] }
];

monitoredZones.forEach(zone => {
    L.circleMarker(zone.coords, {
        radius: 5,
        fillColor: "#3b82f6",
        color: "#ffffff",
        weight: 1.5,
        fillOpacity: 0.9
    }).bindTooltip(zone.name, { direction: 'top' }).addTo(map);
});

// 5. Plume Cone Calculation & Simulation
let activeMarker = null;
let activePlume = null;

function calculatePlume(lat, lon, bearingDeg, distanceKm, spreadDeg = 28) {
    const R = 6371;
    const toRad = d => (d * Math.PI) / 180;
    const toDeg = r => (r * 180) / Math.PI;

    function dest(sLat, sLon, brng, dist) {
        const lat1 = toRad(sLat), lon1 = toRad(sLon), b = toRad(brng), d = dist / R;
        const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
        const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
        return [toDeg(lat2), toDeg(lon2)];
    }

    const left = dest(lat, lon, bearingDeg - spreadDeg / 2, distanceKm);
    const center = dest(lat, lon, bearingDeg, distanceKm * 1.12);
    const right = dest(lat, lon, bearingDeg + spreadDeg / 2, distanceKm);

    return [[lat, lon], left, center, right];
}

function simulatePlume(lat, lon, title, mag, depth, windAngle, windSpeed) {
    resetSimulation();

    activeMarker = L.circleMarker([lat, lon], {
        radius: 8,
        fillColor: "#ef4444",
        color: "#fbbf24",
        weight: 2,
        fillOpacity: 1
    }).addTo(map);

    const coords = calculatePlume(lat, lon, windAngle, windSpeed * 3);
    activePlume = L.polygon(coords, {
        color: '#dc2626',
        weight: 1.5,
        fillColor: '#ef4444',
        fillOpacity: 0.38
    }).addTo(map);

    map.flyTo([lat, lon], 7, { duration: 1.2 });

    const card = document.getElementById('telemetry-card');
    card.style.display = 'block';
    document.getElementById('telemetry-title').innerText = `${title} (M${mag})`;
    document.getElementById('telemetry-desc').innerText = 
        `Surface anomaly (Depth: ${depth}km) validated. Plume moving towards ${windAngle}° at ${windSpeed} km/h. Evacuate perpendicular to the red dispersion cone.`;
}

function resetSimulation() {
    if (activeMarker) map.removeLayer(activeMarker);
    if (activePlume) map.removeLayer(activePlume);
    document.getElementById('telemetry-card').style.display = 'none';
}

function resetMapView() {
    map.flyTo([32.4279, 53.6880], 6, { duration: 1 });
}

// Map view — Leaflet + OpenStreetMap (no API key required)
// Requires: pooldata (global), locationFilter (global from location-search.js)

// ─── Polygon data ─────────────────────────────────────────────────────────────

let _polygonData = null; // { poolName: { coords, type_label, also_has } }

async function _loadPolygons() {
    if (_polygonData) return;
    try {
        const res = await fetch('pool-polygons.json');
        _polygonData = await res.json();
    } catch (e) {
        _polygonData = {};
    }
}

function _polygonToSVG(coords, width, height) {
    if (!coords || coords.length < 3) return '';

    // coords are [lat, lng] — project to pixel space
    const lats = coords.map(c => c[0]);
    const lngs = coords.map(c => c[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const dLat = maxLat - minLat || 1e-6;
    const dLng = maxLng - minLng || 1e-6;

    // Preserve aspect ratio, fit within width x height with padding
    const pad = 4;
    const scaleX = (width  - pad * 2) / dLng;
    const scaleY = (height - pad * 2) / dLat;
    const scale  = Math.min(scaleX, scaleY);
    const offX   = pad + ((width  - pad * 2) - dLng * scale) / 2;
    const offY   = pad + ((height - pad * 2) - dLat * scale) / 2;

    const pts = coords.map(([lat, lng]) => {
        const x = offX + (lng - minLng) * scale;
        const y = offY + (maxLat - lat)  * scale; // flip Y
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">` +
           `<polygon points="${pts}" fill="#00bbff" fill-opacity="0.3" stroke="#0078c6" stroke-width="1.5"/>` +
           `</svg>`;
}

function _buildPopupHTML(pool) {
    const poly = _polygonData && _polygonData[pool['Pool']];

    // ── Status badge ──────────────────────────────────────────────────────────
    const statusText = isPoolOpen(pool);
    const statusColor = statusText === 'OPEN' ? '#198754' : statusText === 'CLEANING' ? '#0dcaf0' : '#dc3545';
    const badgeHTML = `<span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:0.75em;font-weight:700;color:#fff;background:${statusColor};vertical-align:middle;margin-left:6px">${statusText}</span>`;

    // ── Pool size diagram ─────────────────────────────────────────────────────
    let sizeHTML = '';
    if (poly) {
        const svg = _polygonToSVG(poly.coords, 120, 60);
        const alsoNote = poly.also_has && poly.also_has.length
            ? `<div style="font-size:0.75em;color:#6c757d;margin-top:2px">Also has: ${poly.also_has.join(', ')}</div>`
            : '';
        sizeHTML = `<div style="margin:8px 0 4px;text-align:center">` +
                   svg +
                   `<div style="font-size:0.8em;color:#444;margin-top:3px">${poly.type_label}</div>` +
                   alsoNote +
                   `</div>`;
    }

    // ── Distance ──────────────────────────────────────────────────────────────
    const distHTML = pool._distanceMiles != null
        ? `<div style="font-size:0.8em;color:#6c757d;margin-top:4px">${pool._distanceMiles.toFixed(1)} mi away</div>`
        : '';

    // ── Maps link ─────────────────────────────────────────────────────────────
    const mapsHTML = `<div style="margin-top:6px"><a href="${pool['Google map link']}" target="_blank" rel="noopener" style="font-size:0.85em">↗ Google Maps</a></div>`;

    return `<div style="min-width:130px">` +
           `<b>${pool['Pool']}</b>${badgeHTML}` +
           sizeHTML +
           distHTML +
           mapsHTML +
           `</div>`;
}

// ─── State ────────────────────────────────────────────────────────────────────

let _map = null;
let _poolMarkers = [];
let _userMarker = null;
let _mapVisible = false;

// NYC default center (used when no location search is active)
const NYC_CENTER = [40.73, -73.93];
const NYC_ZOOM = 11;

// ─── Init ─────────────────────────────────────────────────────────────────────

function _initMap() {
    if (_map) return;
    _map = L.map('map-view').setView(NYC_CENTER, NYC_ZOOM);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
    }).addTo(_map);
}

// ─── Markers ──────────────────────────────────────────────────────────────────

const _poolIcon = L.divIcon({
    className: '',
    html: '<div style="width:14px;height:14px;border-radius:50%;background:#00bbff;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10],
});

const _userIcon = L.divIcon({
    className: '',
    html: '<div style="width:18px;height:18px;border-radius:50%;background:#dc3545;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -12],
});

function _clearPoolMarkers() {
    _poolMarkers.forEach(m => _map.removeLayer(m));
    _poolMarkers = [];
}

function _clearUserMarker() {
    if (_userMarker) { _map.removeLayer(_userMarker); _userMarker = null; }
}

function _addPoolMarkers(pools) {
    _clearPoolMarkers();
    pools.forEach(pool => {
        const marker = L.marker([pool.latitude, pool.longitude], { icon: _poolIcon });
        marker.bindPopup(() => _buildPopupHTML(pool), { maxWidth: 220 });
        marker.addTo(_map);
        _poolMarkers.push(marker);
    });
}

function _addUserMarker(lat, lng) {
    _clearUserMarker();
    _userMarker = L.marker([lat, lng], { icon: _userIcon })
        .bindPopup('<b>Your searched location</b>')
        .addTo(_map);
}

function _fitBounds(pools, userLat, userLng) {
    const points = pools.map(p => [p.latitude, p.longitude]);
    if (userLat != null) points.push([userLat, userLng]);
    if (points.length === 0) { _map.setView(NYC_CENTER, NYC_ZOOM); return; }
    if (points.length === 1) { _map.setView(points[0], 14); return; }
    _map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
}

// ─── Sync map to current visible cards ───────────────────────────────────────

function syncMapToCurrentFilters() {
    if (!_mapVisible || !_map) return;

    const visibleNames = new Set(
        Array.from(document.querySelectorAll('#card-container .card:not([style*="display: none"])'))
            .map(card => card.dataset.poolName)
    );
    // Also include cards with no inline style (display not explicitly set)
    Array.from(document.querySelectorAll('#card-container .card'))
        .filter(card => !card.style.display || card.style.display !== 'none')
        .forEach(card => visibleNames.add(card.dataset.poolName));

    const visiblePools = pooldata.filter(p => visibleNames.has(p['Pool']));
    _addPoolMarkers(visiblePools);
}

// ─── Toggle: show / hide views ────────────────────────────────────────────────

async function showMapView() {
    _mapVisible = true;
    await _loadPolygons();

    document.getElementById('card-container').style.display = 'none';
    document.getElementById('map-container').style.display = '';
    document.getElementById('toggle-list-btn').classList.remove('active');
    document.getElementById('toggle-map-btn').classList.add('active');
    const _ml = document.getElementById('mob-toggle-list');
    const _mm = document.getElementById('mob-toggle-map');
    if (_ml) _ml.classList.remove('active');
    if (_mm) _mm.classList.add('active');

    _initMap();

    // Collect currently visible pools from the card list
    const visibleNames = new Set(
        Array.from(document.querySelectorAll('#card-container .card'))
            .filter(card => !card.style.display || card.style.display !== 'none')
            .map(card => card.dataset.poolName)
    );
    const visiblePools = pooldata.filter(p => visibleNames.has(p['Pool']));

    _addPoolMarkers(visiblePools);

    if (locationFilter) {
        _addUserMarker(locationFilter.lat, locationFilter.lng);
        _fitBounds(visiblePools, locationFilter.lat, locationFilter.lng);
    } else {
        _clearUserMarker();
        _fitBounds(visiblePools, null, null);
    }

    // Leaflet needs a size invalidation after becoming visible
    setTimeout(() => _map.invalidateSize(), 50);
}

function showListView() {
    _mapVisible = false;
    document.getElementById('map-container').style.display = 'none';
    document.getElementById('card-container').style.display = '';
    document.getElementById('toggle-list-btn').classList.add('active');
    document.getElementById('toggle-map-btn').classList.remove('active');
    const _ml = document.getElementById('mob-toggle-list');
    const _mm = document.getElementById('mob-toggle-map');
    if (_ml) _ml.classList.add('active');
    if (_mm) _mm.classList.remove('active');
}

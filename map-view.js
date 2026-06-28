// Map view — Leaflet + OpenStreetMap (no API key required)
// Requires: pooldata (global), locationFilter (global from location-search.js)

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
        const distLine = pool._distanceMiles != null
            ? `<div style="font-size:0.8em;color:#6c757d">${pool._distanceMiles.toFixed(1)} mi away</div>`
            : '';
        marker.bindPopup(
            `<b>${pool['Pool']}</b>${distLine}` +
            `<br><a href="${pool['Google map link']}" target="_blank" rel="noopener">Google Maps</a>`
        );
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

function showMapView() {
    _mapVisible = true;

    document.getElementById('card-container').style.display = 'none';
    document.getElementById('map-container').style.display = '';
    document.getElementById('toggle-list-btn').classList.remove('active');
    document.getElementById('toggle-map-btn').classList.add('active');

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
}

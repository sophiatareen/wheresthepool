// Location-based pool search logic
// Uses Places REST API + Geocoding REST API via fetch() — no Maps JS SDK required.
// Requires: GOOGLE_MAPS_API_KEY (global), pooldata (global), refreshFilters(), cardContainer, createCard()

// ─── State ────────────────────────────────────────────────────────────────────

let locationFilter = null; // { lat, lng, radiusMiles } or null
let _autocompleteDebounceTimer = null;
let _selectedFromDropdown = false;

// ─── Distance calculation (Haversine) ────────────────────────────────────────

function haversineDistanceMiles(lat1, lng1, lat2, lng2) {
    const R = 3958.8;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Returns pools within radiusMiles of (lat, lng), sorted by distance asc.
// Each returned object gets a _distanceMiles property.
function getPoolsWithinRadius(lat, lng, radiusMiles) {
    return pooldata
        .map(pool => {
            pool._distanceMiles = haversineDistanceMiles(lat, lng, pool.latitude, pool.longitude);
            return pool;
        })
        .filter(pool => pool._distanceMiles <= radiusMiles)
        .sort((a, b) => a._distanceMiles - b._distanceMiles);
}

// ─── Card rendering ───────────────────────────────────────────────────────────

function renderCards(pools) {
    cardContainer.innerHTML = '';
    pools.forEach(pool => createCard(pool));
}

function makeDistanceElement(pool) {
    if (pool._distanceMiles == null) return null;
    const el = document.createElement('div');
    el.className = 'pool-distance text-muted';
    el.style.fontSize = '0.85em';
    el.innerText = pool._distanceMiles < 0.1
        ? 'Less than 0.1 mi away'
        : pool._distanceMiles.toFixed(1) + ' mi away';
    return el;
}

// ─── Apply / clear location search ───────────────────────────────────────────

function applyLocationSearch(lat, lng) {
    const radiusMiles = Number(document.getElementById('radius-select').value);
    locationFilter = { lat, lng, radiusMiles };

    sessionStorage.setItem('wtp_location', JSON.stringify({ lat, lng }));
    sessionStorage.setItem('wtp_radius', radiusMiles);

    const results = getPoolsWithinRadius(lat, lng, radiusMiles);
    renderCards(results);
    updateEmptyState(results.length, radiusMiles);
    refreshFilters();
    document.getElementById('clear-location-btn').style.display = '';
}

function clearLocationSearch() {
    locationFilter = null;
    sessionStorage.removeItem('wtp_location');
    sessionStorage.removeItem('wtp_radius');
    document.getElementById('location-search-input').value = '';
    document.getElementById('clear-location-btn').style.display = 'none';
    document.getElementById('location-empty-state').style.display = 'none';
    hideDropdown();

    pooldata.forEach(p => delete p._distanceMiles);
    pooldata.sort((a, b) =>
        a['Borough'].localeCompare(b['Borough']) || a['Pool'].localeCompare(b['Pool'])
    );
    renderCards(pooldata);
    refreshFilters();
}

function updateEmptyState(count, radiusMiles) {
    const empty = document.getElementById('location-empty-state');
    let found = document.getElementById('location-results-found');
    if (!found) {
        found = document.createElement('div');
        found.id = 'location-results-found';
        found.className = 'text-light small mt-1';
        found.style.display = 'none';
        empty.parentNode.insertBefore(found, empty);
    }

    if (count === 0) {
        empty.style.display = '';
        empty.innerText = `Where ARE the pools? Not within ${radiusMiles} miles, sadly. We only cover NYC right now - try a NYC zip or widen your radius.`;
        found.style.display = 'none';
    } else {
        empty.style.display = 'none';
        found.style.display = '';
        found.innerText = `Found ${count} pool${count !== 1 ? 's' : ''} near you!`;
    }
}

// ─── Places Autocomplete (REST) ───────────────────────────────────────────────

async function fetchSuggestions(input) {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        },
        body: JSON.stringify({
            input,
            includedRegionCodes: ['us'],
        }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.suggestions || []).map(s => ({
        label: s.placePrediction.text.text,
        placeId: s.placePrediction.placeId,
    }));
}

// Fetch coordinates for a known place ID via Places API (New) — no Geocoding API needed.
async function geocodePlaceId(placeId) {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
        headers: {
            'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
            'X-Goog-FieldMask': 'location',
        },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.location) {
        return { lat: data.location.latitude, lng: data.location.longitude };
    }
    return null;
}

// Geocode raw text: zip codes go to Geocoding API (reliable for 5-digit zips);
// everything else goes to Places searchText.
async function geocodeText(text) {
    if (/^\d{5}(-\d{4})?$/.test(text.trim())) {
        return _geocodeZip(text.trim());
    }
    return _geocodeTextSearch(text);
}

async function _geocodeZip(zip) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(zip)}&region=us&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === 'OK' && data.results[0]) {
        const loc = data.results[0].geometry.location;
        return { lat: loc.lat, lng: loc.lng };
    }
    return null;
}

async function _geocodeTextSearch(text) {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
            'X-Goog-FieldMask': 'places.location',
        },
        body: JSON.stringify({
            textQuery: text,
            locationBias: {
                circle: {
                    center: { latitude: 40.73, longitude: -73.93 },
                    radius: 100000,
                },
            },
        }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.places && data.places[0] && data.places[0].location) {
        return {
            lat: data.places[0].location.latitude,
            lng: data.places[0].location.longitude,
        };
    }
    return null;
}

// ─── Dropdown UI ──────────────────────────────────────────────────────────────

function getOrCreateDropdown() {
    let dd = document.getElementById('location-autocomplete-dropdown');
    if (!dd) {
        dd = document.createElement('ul');
        dd.id = 'location-autocomplete-dropdown';
        dd.className = 'list-group position-absolute w-100';
        dd.style.cssText = 'z-index:9999; top:100%; left:0; max-height:260px; overflow-y:auto; display:none';
        const wrapper = document.getElementById('location-search-input').parentNode;
        wrapper.style.position = 'relative';
        wrapper.appendChild(dd);
    }
    return dd;
}

function showDropdown(suggestions, onSelect) {
    const dd = getOrCreateDropdown();
    dd.innerHTML = '';
    if (!suggestions.length) { dd.style.display = 'none'; return; }

    suggestions.forEach((s, i) => {
        const li = document.createElement('li');
        li.className = 'list-group-item list-group-item-action';
        li.style.cursor = 'pointer';
        li.textContent = s.label;
        li.addEventListener('mousedown', e => {
            e.preventDefault(); // prevent input blur before click registers
            _selectedFromDropdown = true;
            onSelect(s);
            dd.style.display = 'none';
        });
        dd.appendChild(li);
    });
    dd.style.display = '';
}

function hideDropdown() {
    const dd = document.getElementById('location-autocomplete-dropdown');
    if (dd) dd.style.display = 'none';
}

// ─── Input wiring ─────────────────────────────────────────────────────────────

function initLocationSearch() {
    const input = document.getElementById('location-search-input');

    input.addEventListener('input', () => {
        const val = input.value.trim();
        _selectedFromDropdown = false;
        clearTimeout(_autocompleteDebounceTimer);

        if (val.length < 2) { hideDropdown(); return; }

        _autocompleteDebounceTimer = setTimeout(async () => {
            const suggestions = await fetchSuggestions(val);
            showDropdown(suggestions, async (s) => {
                input.value = s.label;
                const coords = await geocodePlaceId(s.placeId);
                if (coords) {
                    applyLocationSearch(coords.lat, coords.lng);
                } else {
                    showInputError('Could not resolve location. Try again.');
                }
            });
        }, 300);
    });

    input.addEventListener('keydown', async e => {
        if (e.key === 'Escape') { hideDropdown(); return; }
        if (e.key !== 'Enter') return;
        hideDropdown();

        const val = input.value.trim();
        if (!val) return;
        const coords = await geocodeText(val);
        if (coords) {
            applyLocationSearch(coords.lat, coords.lng);
        } else {
            showInputError('Address not found. Please try a different zip code or address.');
        }
    });

    input.addEventListener('blur', () => {
        // Small delay so mousedown on a suggestion registers first
        setTimeout(hideDropdown, 150);
    });

    restoreSessionLocation();
}

function showInputError(msg) {
    const input = document.getElementById('location-search-input');
    input.classList.add('is-invalid');
    let feedback = document.getElementById('location-input-feedback');
    if (!feedback) {
        feedback = document.createElement('div');
        feedback.id = 'location-input-feedback';
        feedback.className = 'invalid-feedback';
        input.parentNode.appendChild(feedback);
    }
    feedback.innerText = msg;
    input.addEventListener('input', () => input.classList.remove('is-invalid'), { once: true });
}

// ─── "Use my location" geolocation ───────────────────────────────────────────

function useMyLocation() {
    const btn = document.getElementById('use-my-location-btn');
    if (!navigator.geolocation) {
        showLocationStatus('Geolocation is not supported by your browser.', 'error');
        return;
    }

    btn.disabled = true;
    btn.innerText = 'Locating…';
    showLocationStatus('', '');

    navigator.geolocation.getCurrentPosition(
        position => {
            btn.disabled = false;
            btn.innerText = 'Use my location';
            document.getElementById('location-search-input').value = 'Current location';
            applyLocationSearch(position.coords.latitude, position.coords.longitude);
        },
        err => {
            btn.disabled = false;
            btn.innerText = 'Use my location';
            const msgs = {
                [err.PERMISSION_DENIED]: 'Location access denied. Enter an address above.',
                [err.TIMEOUT]: 'Location timed out. Enter an address above.',
            };
            showLocationStatus(msgs[err.code] || 'Could not get location. Enter an address above.', 'error');
        },
        { timeout: 10000 }
    );
}

function showLocationStatus(msg, type) {
    const el = document.getElementById('location-status');
    el.innerText = msg;
    el.style.display = msg ? '' : 'none';
    el.className = type === 'error' ? 'text-warning small mt-1' : 'text-light small mt-1';
}

// ─── Session persistence ──────────────────────────────────────────────────────

function restoreSessionLocation() {
    const saved = sessionStorage.getItem('wtp_location');
    const savedRadius = sessionStorage.getItem('wtp_radius');
    if (!saved) return;
    try {
        const { lat, lng } = JSON.parse(saved);
        if (savedRadius) document.getElementById('radius-select').value = savedRadius;
        applyLocationSearch(lat, lng);
    } catch (e) {
        sessionStorage.removeItem('wtp_location');
    }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

// No async SDK to wait for — wire up immediately when script loads.
initLocationSearch();

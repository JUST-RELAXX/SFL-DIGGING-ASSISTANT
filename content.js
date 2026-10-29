// (silent — script loaded)

let currentTheme = 'none'; // 'none' = default basic grid, or a theme key
let auraEnabled = false;     // manual toggle from sidepanel
let auraAutoActive = false;  // auto-enabled when grid is active + character is in grid area
let perfTier = 'high';       // ultra | high | medium | potato
let preserveUnderlying = false; // when true, perf tiers skip underlying theme effects
let customConfig = null; // custom theme config object from builder
let predictionEnabled = true; // digging prediction solver toggle
let lastSolvedBoard = null;   // cached solver result

// Performance tier config — hover/glow ALWAYS enabled, only particle count scales
const PERF_CONFIG = {
    ultra: { particles: 30, animDuration: 2500 },
    high: { particles: 20, animDuration: 2500 },
    medium: { particles: 10, animDuration: 2500 },
    potato: { particles: 3, animDuration: 1500 }
};

// =============================================================================
// INJECT BRIDGE
// =============================================================================
const bridgeScript = document.createElement('script');
bridgeScript.src = chrome.runtime.getURL('bridge.js');
bridgeScript.onload = () => { }; // (silent)
(document.head || document.documentElement).appendChild(bridgeScript);

// Inject prediction solver engine
const solverScript = document.createElement('script');
solverScript.src = chrome.runtime.getURL('digging-solver.js');
solverScript.onload = () => { }; // (silent)
(document.head || document.documentElement).appendChild(solverScript);

// =============================================================================
// STATE
// =============================================================================
let appState = 'IDLE';
let masterGrid = null;
let isGridLocked = true;

// WASD
let walkSpeed = 3.3;
let gridX = 0, gridY = 0;
let animationFrameId = null;
const keys = { w: false, a: false, s: false, d: false };

// The dig grid's KNOWN world position (from SFL source code)
// These are set automatically from the bridge ΓÇö no manual calibration needed!
let gridWorldX = null, gridWorldY = null;
let gridCellSize = 16;
let currentGridData = null;  // persists API colors across grid toggles
let currentPatterns = [];    // buried item patterns (from API)
let currentCompletedPatterns = []; // completed formation instances (from API)
let currentStreak = { count: 0, collectedAt: 0, totalClaimed: 0 };
let currentExtraDigs = 0;
let _hiddenAllSnapshot = null; // remembers what was visible before Hide All
let _pendingShowAllOverlays = null; // bar/panels waiting on a fresh camera read before they can be created (see handleAutoAlign)
let currentCollectibles = {};
let currentBumpkin = {};
let currentFarmHands = {};
let currentInventory = {};

// Panel visibility toggles
let statsBarVisible = false;
let tallyStripVisible = false;
let hintsVisible = false;
let patternsVisible = false;
let treasureStatVisible = false;
let cachedP2PPrices = null; // { Wood: price, Stone: price, ... } from sfl.world
let cachedExchangeRates = null; // { sfl: {...}, matic: {...} } from sfl.world
let statsTimerInterval = null; // setInterval handle for countdown
const PANEL_GAP = 12; // px gap between grid and side panels — single source of truth

// Mode
let deviceMode = 'mid';
let domIntervalMs = 0;
let lastSeenTS = '0';

// Load saved state
chrome.storage.local.get(['walkSpeed', 'deviceMode', 'domIntervalMs', 'auraEnabled', 'perfTier', 'gridCalibX', 'gridCalibY', 'preserveUnderlying', 'predictionEnabled', 'sflFarmId'], (r) => {
    if (r.walkSpeed !== undefined) walkSpeed = r.walkSpeed;
    if (r.deviceMode) deviceMode = r.deviceMode;
    if (r.domIntervalMs !== undefined) domIntervalMs = r.domIntervalMs;
    if (r.auraEnabled !== undefined) auraEnabled = r.auraEnabled;
    if (r.perfTier) perfTier = r.perfTier;
    if (r.gridCalibX !== undefined) gridCalibX = r.gridCalibX;
    if (r.gridCalibY !== undefined) gridCalibY = r.gridCalibY;
    if (r.preserveUnderlying !== undefined) preserveUnderlying = r.preserveUnderlying;
    if (r.predictionEnabled !== undefined) predictionEnabled = r.predictionEnabled;

    // AUTO-SYNC: if a farm ID was saved, fetch data immediately so panels
    // have real data without requiring a manual Sync click.
    if (r.sflFarmId) {
        chrome.runtime.sendMessage({ action: 'fetch_farm_data', farmId: r.sflFarmId }, (response) => {
            if (chrome.runtime.lastError) { console.warn('[SFL] Auto-sync failed:', chrome.runtime.lastError.message); return; }
            if (response && response.success) {
                const digging = response.data?.farm?.desert?.digging;
                const farm = response.data?.farm;
                if (!digging?.grid || !Array.isArray(digging.grid)) return;
                const mergedCollectibles = {};
                for (const src of [farm?.collectibles, farm?.home?.collectibles, farm?.interior?.ground?.collectibles, farm?.interior?.level_one?.collectibles]) {
                    if (!src || typeof src !== 'object') continue;
                    for (const [name, arr] of Object.entries(src)) {
                        if (!Array.isArray(arr)) continue;
                        mergedCollectibles[name] = (mergedCollectibles[name] || []).concat(arr);
                    }
                }
                currentGridData = digging.grid;
                currentPatterns = digging.patterns || [];
                currentCompletedPatterns = digging.completedPatterns || [];
                currentStreak = digging.streak || { count: 0, collectedAt: 0, totalClaimed: 0 };
                currentExtraDigs = digging.extraDigs || 0;
                currentCollectibles = mergedCollectibles;
                currentBumpkin = farm?.bumpkin || {};
                currentFarmHands = farm?.farmHands || {};
                currentInventory = farm?.inventory || {};
                if (masterGrid) applyLiveGridState(currentGridData, currentPatterns);
                refreshPanels();
                console.log('[SFL] Auto-sync complete:', digging.grid.length, 'dug');
            }
        });
    }
    // (silent — config loaded)
});

// =============================================================================
// TRACKING INDICATOR
// =============================================================================
const trackingIndicator = document.createElement('div');
trackingIndicator.id = 'sfl-tracking-indicator';
trackingIndicator.innerHTML = `
    <span class="indicator-dot"></span>
    <span id="sfl-mode-label">TRACKING</span>
    <span class="indicator-hint">Alt+1 re-snap</span>
`;
document.body.appendChild(trackingIndicator);

function updateIndicatorLabel() {
    const label = document.getElementById('sfl-mode-label');
    if (!label) return;
    const m = { low: 'LOW-END', mid: 'MID-RANGE', high: 'HIGH-END' };
    label.textContent = m[deviceMode] || 'TRACKING';
}

// =============================================================================
// FULL-SCREEN VIEW DETECTION — Hide grid entirely for Marketplace, etc.
// Grid z-index is set to 2 in CSS so it's ALWAYS behind game UI panels (and so are the
// overlays, which sit in a layer that mirrors the grid wrapper).
// Here we hide grid + overlays wherever they make no sense: full-screen views
// (Marketplace …) and every game scene except the Beach, where the dig site is.
// =============================================================================
let gridPanelState = 'normal'; // 'normal' | 'hidden'

// Which Phaser scene is on screen? bridge.js writes its key into #sfl-camera-data.
// The dig site only exists in the Beach scene. In any other scene (plaza, home, retreat …),
// or when the world isn't rendering at all (farm view), the camera data belongs to a different
// map (or is frozen) and the grid would float around at meaningless coordinates.
const DIG_SCENE_KEY = 'beach';   // BeachScene in the game source (gridX=160, gridY=128)
const CAM_STALE_MS = 2500;
let _camTsSeen = null, _camTsSeenAt = 0;
function isDigSceneActive() {
    const el = document.getElementById('sfl-camera-data');
    if (!el) return true;                                   // bridge not injected (yet) → don't interfere
    const now = Date.now();
    if (el.dataset.ts !== _camTsSeen) { _camTsSeen = el.dataset.ts; _camTsSeenAt = now; }
    const scene = el.dataset.scene;                         // undefined when running an older bridge.js
    if (scene !== undefined && scene !== DIG_SCENE_KEY) return false;
    // The bridge bumps ts every frame while the world renders. If it stops, the world is gone.
    return (now - _camTsSeenAt) < CAM_STALE_MS;
}

function checkForFullScreenViews() {
    const wrapper = document.getElementById('sfl-grid-wrapper');
    if (!wrapper || appState !== 'TRACKING') return;

    const svg = document.getElementById('sfl-silhouette-debug');
    const hash = window.location.hash.toLowerCase();
    const isFullScreen = hash.includes('marketplace') || hash.includes('/shop');
    const shouldHide = isFullScreen || !isDigSceneActive();
    const isHidden = wrapper.style.display === 'none';     // read the real DOM state (the wrapper can be re-created)

    if (shouldHide && !isHidden) {
        wrapper.style.display = 'none';                     // the bar is a child, and the overlay layer mirrors display:none, so panels vanish too → they vanish with it
        if (svg) svg.style.display = 'none';
        trackingIndicator.style.display = 'none';
    } else if (!shouldHide && isHidden) {
        wrapper.style.display = '';
        if (svg) svg.style.display = '';
        trackingIndicator.style.display = 'flex';
    }
    gridPanelState = shouldHide ? 'hidden' : 'normal';
}

setInterval(checkForFullScreenViews, 150);


// =============================================================================
// AUTO-ALIGNMENT: Alt+1 reads camera + uses known grid world coords
// No manual calibration, no dragging, no four-corner clicks
// =============================================================================
window.addEventListener('message', (e) => {
    if (!e.data || e.source !== window) return;
    if (e.data.type === 'SFL_GRID_CAMERA_RESULT') handleAutoAlign(e.data.data);

    // Live dig update: bridge.js intercepted updated grid from game API
    if (e.data.type === 'SFL_GRID_AUTO_UPDATE') {
        // (silent — auto-update received)
        currentGridData = e.data.grid;
        if (e.data.patterns) currentPatterns = e.data.patterns;
        if (e.data.completedPatterns) currentCompletedPatterns = e.data.completedPatterns;
        if (e.data.streak) currentStreak = e.data.streak;
        if (e.data.extraDigs !== undefined) currentExtraDigs = e.data.extraDigs;
        if (masterGrid) applyLiveGridState(currentGridData, currentPatterns);
        refreshPanels();
    }

    // Dig result: a specific tile was just dug, with item info
    if (e.data.type === 'SFL_DIG_RESULT') {
        const { row, col, item } = e.data;
        handleDigResult(row, col, item);
    }
});

function handleAutoAlign(cam) {
    if (!cam || !cam.found) {
        console.warn("[Grid] Bridge could not read camera. Is the game loaded?");
        _pendingShowAllOverlays = null; // don't let a stale request fire on some later, unrelated align
        return;
    }

    // Use the known grid world position from the SFL source code
    gridWorldX = cam.gridWorldX;  // 160
    gridWorldY = cam.gridWorldY;  // 128
    gridCellSize = cam.gridCellSize || 16;

    // (silent — auto-align)

    // Ensure the grid is visible
    if (!masterGrid) createGrid();

    // Snap the overlay to the exact screen position
    snapToScreen(cam);

    // Start tracking
    if (appState !== 'TRACKING') startTracking();

    // Not on the Beach (plaza, home …)? Hide right away instead of flashing the grid for a moment
    checkForFullScreenViews();

    // Show All (sidepanel) restores through this SAME path, so by the time these run the
    // wrapper already has its correct position/size — see the note above handleAutoAlign.
    if (_pendingShowAllOverlays) {
        const p = _pendingShowAllOverlays;
        _pendingShowAllOverlays = null;
        if (p.stats) { statsBarVisible = true; createStatsBar(); }
        if (p.hints) { hintsVisible = true; createHintsPanel(); }
        if (p.patterns) { patternsVisible = true; createFormationsPanel(); }
        if (p.treasure) { treasureStatVisible = true; createTreasureStatPanel(); }
    }
}

// Calibration offsets (pixels) — adjusted from sidepanel
let gridCalibX = 0;
let gridCalibY = 0;

function snapToScreen(cam) {
    if (!masterGrid || gridWorldX === null) return;
    const w = document.getElementById('sfl-grid-wrapper');
    if (!w) return;
    const sx = cam.canvasDisplayW / cam.canvasInternalW;
    const sy = cam.canvasDisplayH / cam.canvasInternalH;
    gridX = (gridWorldX - cam.scrollX) * cam.zoom * sx + cam.cameraX * sx + cam.canvasLeft;
    gridY = (gridWorldY - cam.scrollY) * cam.zoom * sy + cam.cameraY * sy + cam.canvasTop;

    // DYNAMIC SIZE: match the game's actual grid size at current zoom
    const screenCellW = gridCellSize * cam.zoom * sx;
    const screenCellH = gridCellSize * cam.zoom * sy;
    const gridPixelW = screenCellW * 10;
    const gridPixelH = screenCellH * 10;

    // Apply user calibration offset
    w.style.left = (gridX + gridCalibX) + 'px';
    w.style.top = (gridY + gridCalibY) + 'px';
    w.style.width = gridPixelW + 'px';
    w.style.height = gridPixelH + 'px';
    w.style.transform = 'none';

    // (silent — snapped)
}

// =============================================================================
// READ CAMERA FROM SHARED DOM + TIMESTAMP CHECK
// =============================================================================
function readCameraFromDOM() {
    const el = document.getElementById('sfl-camera-data');
    if (!el || el.dataset.found !== '1') return null;
    return {
        scrollX: parseFloat(el.dataset.sx), scrollY: parseFloat(el.dataset.sy),
        zoom: parseFloat(el.dataset.z),
        cameraX: parseFloat(el.dataset.cx), cameraY: parseFloat(el.dataset.cy),
        canvasLeft: parseFloat(el.dataset.cl), canvasTop: parseFloat(el.dataset.ct),
        canvasDisplayW: parseFloat(el.dataset.cdw), canvasDisplayH: parseFloat(el.dataset.cdh),
        canvasInternalW: parseFloat(el.dataset.ciw), canvasInternalH: parseFloat(el.dataset.cih),
        ts: el.dataset.ts
    };
}

function correctDriftIfFresh() {
    const cam = readCameraFromDOM();
    if (!cam || gridWorldX === null || !masterGrid) return;
    if (cam.ts === lastSeenTS) return;
    lastSeenTS = cam.ts;
    const w = document.getElementById('sfl-grid-wrapper');
    if (!w) return;

    const sx = cam.canvasDisplayW / cam.canvasInternalW;
    const sy = cam.canvasDisplayH / cam.canvasInternalH;
    const correctX = (gridWorldX - cam.scrollX) * cam.zoom * sx + cam.cameraX * sx + cam.canvasLeft;
    const correctY = (gridWorldY - cam.scrollY) * cam.zoom * sy + cam.cameraY * sy + cam.canvasTop;
    const errX = correctX - gridX;
    const errY = correctY - gridY;
    if (Math.abs(errX) > 1 || Math.abs(errY) > 1) {
        gridX = correctX;
        gridY = correctY;
        w.style.left = (gridX + gridCalibX) + 'px';
        w.style.top = (gridY + gridCalibY) + 'px';
        w.style.transform = 'none';
    }
}

function fullDOMSnap() {
    const cam = readCameraFromDOM();
    if (!cam || gridWorldX === null || !masterGrid) return;
    const w = document.getElementById('sfl-grid-wrapper');
    if (!w) return;
    const sx = cam.canvasDisplayW / cam.canvasInternalW;
    const sy = cam.canvasDisplayH / cam.canvasInternalH;
    gridX = (gridWorldX - cam.scrollX) * cam.zoom * sx + cam.cameraX * sx + cam.canvasLeft;
    gridY = (gridWorldY - cam.scrollY) * cam.zoom * sy + cam.cameraY * sy + cam.canvasTop;
    w.style.left = (gridX + gridCalibX) + 'px';
    w.style.top = (gridY + gridCalibY) + 'px';
    w.style.transform = 'none';
}

// =============================================================================
// TRACKING
// =============================================================================
function getIntervalForMode() {
    if (deviceMode === 'low') return domIntervalMs > 0 ? domIntervalMs : 5000;
    if (deviceMode === 'mid') return domIntervalMs;
    return 0;
}

function startTracking() {
    if (!masterGrid || gridWorldX === null) return;
    appState = 'TRACKING';
    keys.w = keys.a = keys.s = keys.d = false;
    lastSeenTS = '0';
    _camTsSeen = null; _camTsSeenAt = Date.now();   // fresh grace period for the 'is the world still rendering?' check
    syncGridCoordinates();
    trackingIndicator.style.display = 'flex';
    updateIndicatorLabel();
    window.postMessage({ type: 'SFL_GRID_START_TRACKING', mode: deviceMode, interval: getIntervalForMode() }, '*');
    if (!animationFrameId) gameLoop();
    // (silent — tracking on)
}

function stopTracking() {
    if (appState !== 'TRACKING') return;
    appState = 'IDLE';
    if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
    keys.w = keys.a = keys.s = keys.d = false;
    trackingIndicator.style.display = 'none';
    window.postMessage({ type: 'SFL_GRID_STOP_TRACKING' }, '*');
    // (silent — tracking off)
}

// =============================================================================
// GAME LOOP
// =============================================================================
function syncGridCoordinates() {
    const w = document.getElementById('sfl-grid-wrapper');
    if (!w) return;
    const r = w.getBoundingClientRect();
    gridX = r.left; gridY = r.top;
}

function gameLoop() {
    if (appState !== 'TRACKING' || !masterGrid) { animationFrameId = null; return; }
    if (deviceMode === 'high') { fullDOMSnap(); }
    else { applyWASD(); correctDriftIfFresh(); }
    // Update character silhouette (works on ALL grids)
    updateCharacterCutout();
    animationFrameId = requestAnimationFrame(gameLoop);
}

// Creates a transparent hole in the grid overlay shaped like the player character
let cachedPolyStr = '';
let cachedPolyParsed = null;

// --- Silhouette SVG overlay (visible aura around character) ---
let debugSvg = null;
// Small blur on the character-hole edge only (a few px) — softens the boundary between the
// grid overlay and the revealed character instead of a hard geometric cut. Raise/lower to taste.
const CUTOUT_FEATHER_PX = 3;
let cutoutSvg = null, cutoutRectEl = null, cutoutHoleEl = null;
function ensureCutoutMask() {
    if (cutoutSvg) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
    svg.innerHTML =
        '<defs>' +
        '<filter id="sfl-cutout-feather"><feGaussianBlur stdDeviation="' + CUTOUT_FEATHER_PX + '" /></filter>' +
        '<mask id="sfl-cutout-mask" maskUnits="userSpaceOnUse" x="-20000" y="-20000" width="40000" height="40000">' +
        '<rect id="sfl-cutout-rect" fill="white" />' +
        '<path id="sfl-cutout-hole" fill="black" filter="url(#sfl-cutout-feather)" />' +
        '</mask></defs>';
    document.body.appendChild(svg);
    cutoutSvg = svg;
    cutoutRectEl = svg.querySelector('#sfl-cutout-rect');
    cutoutHoleEl = svg.querySelector('#sfl-cutout-hole');
}

function ensureDebugSvg() {
    if (debugSvg) return debugSvg;
    debugSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    debugSvg.id = 'sfl-silhouette-debug';
    debugSvg.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2;pointer-events:none;opacity:1;transition:opacity 0.4s ease;';;
    document.body.appendChild(debugSvg);
    return debugSvg;
}

function hideAuraSvg() {
    if (debugSvg) { debugSvg.style.opacity = '0'; }
}

function updateCharacterCutout() {
    const w = document.getElementById('sfl-grid-wrapper');
    const camEl = document.getElementById('sfl-camera-data');
    const hasPlayer = camEl && camEl.dataset.pf === '1';

    // When grid is hidden for full-screen views, skip silhouette
    if (gridPanelState === 'hidden') {
        if (w) { w.style.maskImage = 'none'; w.style.webkitMaskImage = 'none'; }
        hideAuraSvg();
        return;
    }

    // Determine if silhouette should be active
    const gridActive = !!(w && masterGrid && appState === 'TRACKING');
    const shouldShowAura = auraEnabled || gridActive;

    if (!hasPlayer || !shouldShowAura) {
        // MASK ON WRAPPER: cuts through ALL layers (tiles + edge effects like fire/glow)
        // This ensures character is 100% visible while themes stay at full vibrancy.
        if (w) { w.style.maskImage = 'none'; w.style.webkitMaskImage = 'none'; }
        hideAuraSvg();
        return;
    }

    const px = parseFloat(camEl.dataset.px);
    const py = parseFloat(camEl.dataset.py);

    // Check if character is near the grid — use masterGrid bounds for accuracy
    let isOnGrid = false;
    if (masterGrid) {
        const gr = masterGrid.getBoundingClientRect();
        const relX = px - gr.left;
        const relY = py - gr.top;
        isOnGrid = relX > -60 && relX < gr.width + 60 && relY > -60 && relY < gr.height + 60;
    }

    // =========================================================================
    // BUILD FEATHERED CUTOUT on WRAPPER (see ensureCutoutMask/CUTOUT_FEATHER_PX above)
    // The hole area covers 300px beyond the wrapper, same as before, to keep clear of
    // edge-effect overflow (fire/glow) at the wrapper's own border.
    // =========================================================================
    if (w) {
        const wr = w.getBoundingClientRect();
        const EXT = 300;

        // --- Character silhouette hole (pixel-perfect) ---
        let charPath = '';
        if (isOnGrid) {
            const relX = px - wr.left;
            const relY = py - wr.top;

            if (camEl.dataset.pSil === '1') {
                try {
                    const rawPoly = camEl.dataset.pPoly;
                    if (rawPoly !== cachedPolyStr) {
                        cachedPolyStr = rawPoly;
                        cachedPolyParsed = JSON.parse(rawPoly);
                    }
                    const poly = cachedPolyParsed;
                    if (poly && poly.length > 2) {
                        const fw = parseFloat(camEl.dataset.pFw);
                        const fh = parseFloat(camEl.dataset.pFh);
                        const flip = camEl.dataset.pFlip === '1';
                        const scale = parseFloat(camEl.dataset.pScale) || 1;
                        const yOffset = 3;

                        for (let i = 0; i < poly.length; i++) {
                            const p = poly[i];
                            const localX = flip ? (fw - p.x) : p.x;
                            const sx = relX + (localX - fw / 2) * scale;
                            const sy = relY + (p.y - fh / 2) * scale + yOffset * scale;
                            charPath += (i === 0 ? ' M ' : ' L ') + sx.toFixed(1) + ' ' + sy.toFixed(1);
                        }
                        charPath += ' Z';
                    }
                } catch (e) {
                    const r = 45;
                    charPath = ` M ${relX} ${relY - r} A ${r} ${r} 0 1 0 ${relX} ${relY + r} A ${r} ${r} 0 1 0 ${relX} ${relY - r} Z`;
                }
                if (!charPath) {
                    const r = 45;
                    charPath = ` M ${relX} ${relY - r} A ${r} ${r} 0 1 0 ${relX} ${relY + r} A ${r} ${r} 0 1 0 ${relX} ${relY - r} Z`;
                }
            } else {
                const r = 45;
                charPath = ` M ${relX} ${relY - r} A ${r} ${r} 0 1 0 ${relX} ${relY + r} A ${r} ${r} 0 1 0 ${relX} ${relY - r} Z`;
            }
        }

        // Apply the feathered cutout
        if (charPath) {
            ensureCutoutMask();
            cutoutRectEl.setAttribute('x', -EXT);
            cutoutRectEl.setAttribute('y', -EXT);
            cutoutRectEl.setAttribute('width', wr.width + EXT * 2);
            cutoutRectEl.setAttribute('height', wr.height + EXT * 2);
            cutoutHoleEl.setAttribute('d', charPath);
            w.style.maskImage = 'url(#sfl-cutout-mask)';
            w.style.webkitMaskImage = 'url(#sfl-cutout-mask)';
        } else {
            w.style.maskImage = 'none';
            w.style.webkitMaskImage = 'none';
        }
    }

    // Visible silhouette aura (SVG polygon around character)
    if ((auraEnabled || isOnGrid) && camEl.dataset.pSil === '1') {
        try {
            const rawPoly = camEl.dataset.pPoly;
            if (rawPoly !== cachedPolyStr) {
                cachedPolyStr = rawPoly;
                cachedPolyParsed = JSON.parse(rawPoly);
            }
            const poly = cachedPolyParsed;
            if (poly && poly.length > 2) {
                const fw = parseFloat(camEl.dataset.pFw);
                const fh = parseFloat(camEl.dataset.pFh);
                const flip = camEl.dataset.pFlip === '1';
                const scale = parseFloat(camEl.dataset.pScale) || 1;
                const yOffset = 3;

                let debugPoints = '';
                for (let i = 0; i < poly.length; i++) {
                    const p = poly[i];
                    const localX = flip ? (fw - p.x) : p.x;
                    const absSx = px + (localX - fw / 2) * scale;
                    const absSy = py + (p.y - fh / 2) * scale + yOffset * scale;
                    debugPoints += absSx.toFixed(1) + ',' + absSy.toFixed(1) + ' ';
                }

                const svg = ensureDebugSvg();
                // Silhouette tracking keeps running every frame (still needed below to punch the
                // character-shaped hole in the grid) — only the VISIBLE gold outline is suppressed.
                // stroke alpha = 0: same polygon, same fade timing, just invisible.
                svg.style.opacity = isOnGrid ? '1' : (auraEnabled ? '0.5' : '0');
                svg.innerHTML = `<polygon points="${debugPoints}" fill="none" stroke="rgba(255,215,0,0)" stroke-width="2" stroke-linejoin="round"/>`;
                return;
            }
        } catch (e) { /* ignore */ }
    }

    // No silhouette data or not needed
    if (!isOnGrid && !auraEnabled) hideAuraSvg();
}

function applyWASD() {
    let mx = 0, my = 0;
    if (keys.w) my += 1;
    if (keys.s) my -= 1;
    if (keys.a) mx += 1;
    if (keys.d) mx -= 1;
    if (mx !== 0 || my !== 0) {
        const w = document.getElementById('sfl-grid-wrapper');
        if (!w) return;
        const len = Math.sqrt(mx * mx + my * my);
        gridX += (mx / len) * walkSpeed;
        gridY += (my / len) * walkSpeed;
        w.style.left = (gridX + gridCalibX) + 'px';
        w.style.top = (gridY + gridCalibY) + 'px';
        w.style.transform = 'none';
    }
}

// =============================================================================
// SIDEPANEL MESSAGES
// =============================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleGrid') {
        if (masterGrid) { removeGrid(); stopTracking(); }
        else { window.postMessage({ type: 'SFL_GRID_READ_CAMERA' }, '*'); } // same fresh-position path as Alt+1
    }
    else if (request.action === 'hideAll') {
        if (_hiddenAllSnapshot === null) {
            // Currently showing something → hide everything, remember state
            _hiddenAllSnapshot = {
                grid: !!masterGrid,
                stats: statsBarVisible,
                hints: hintsVisible,
                patterns: patternsVisible,
                treasure: treasureStatVisible,
            };
            removeGrid(); stopTracking();
            if (statsBarVisible) { statsBarVisible = false; removeStatsBar(); }
            if (hintsVisible) { hintsVisible = false; removeHintsPanel(); }
            if (patternsVisible) { patternsVisible = false; removeFormationsPanel(); }
            if (treasureStatVisible) { treasureStatVisible = false; removeTreasureStatPanel(); }
            stopPanelTracking();
            sendResponse({ nowHidden: true });
        } else {
            // Currently hidden → restore exactly what was showing before.
            // Route through the fresh-camera-read path (see handleAutoAlign) rather than calling
            // createGrid()/createXPanel() directly, so everything is created against the grid's
            // real, current position instead of wherever a brand-new element defaults to.
            const snap = _hiddenAllSnapshot;
            _hiddenAllSnapshot = null;
            if (snap.grid || snap.stats || snap.hints || snap.patterns || snap.treasure) {
                _pendingShowAllOverlays = { stats: snap.stats, hints: snap.hints, patterns: snap.patterns, treasure: snap.treasure };
                window.postMessage({ type: 'SFL_GRID_READ_CAMERA' }, '*');
            }
            sendResponse({ nowHidden: false });
        }
        return true;
    }
    else if (request.action === 'setLockState') { isGridLocked = request.isLocked; updateGridMode(); }
    else if (request.action === 'resetPosition') {
        const w = document.getElementById('sfl-grid-wrapper');
        if (w) { w.style.top = '50%'; w.style.left = '50%'; w.style.transform = 'translate(-50%,-50%)'; syncGridCoordinates(); }
    }
    else if (request.action === 'colorGrid') {
        currentGridData = request.apiGridData;
        if (masterGrid) applyGridColors(currentGridData);
    }
    else if (request.action === 'syncFarmData') {
        currentGridData = request.apiGridData;
        currentPatterns = request.patterns || [];
        currentCompletedPatterns = request.completedPatterns || [];
        currentStreak = request.streak || { count: 0, collectedAt: 0, totalClaimed: 0 };
        currentExtraDigs = request.extraDigs || 0;
        currentCollectibles = request.collectibles || {};
        currentBumpkin = request.bumpkin || {};
        currentFarmHands = request.farmHands || {};
        currentInventory = request.inventory || {};
        if (masterGrid) applyLiveGridState(currentGridData, currentPatterns);
        refreshPanels();
    }
    else if (request.action === 'updateSpeed') { walkSpeed = request.speed; chrome.storage.local.set({ walkSpeed }); }
    else if (request.action === 'setMode') {
        deviceMode = request.mode;
        chrome.storage.local.set({ deviceMode });
        if (appState === 'TRACKING') {
            window.postMessage({ type: 'SFL_GRID_STOP_TRACKING' }, '*');
            lastSeenTS = '0';
            window.postMessage({ type: 'SFL_GRID_START_TRACKING', mode: deviceMode, interval: getIntervalForMode() }, '*');
        }
    }
    else if (request.action === 'setDOMInterval') {
        domIntervalMs = request.interval;
        chrome.storage.local.set({ domIntervalMs });
        if (appState === 'TRACKING' && deviceMode !== 'high') {
            window.postMessage({ type: 'SFL_GRID_STOP_TRACKING' }, '*');
            lastSeenTS = '0';
            window.postMessage({ type: 'SFL_GRID_START_TRACKING', mode: deviceMode, interval: getIntervalForMode() }, '*');
        }
    }
    else if (request.action === 'setGridTheme') {
        currentTheme = request.theme;
        chrome.storage.local.set({ gridTheme: currentTheme });
        applyTheme(currentTheme);
    }
    else if (request.action === 'setAura') {
        auraEnabled = request.enabled;
        chrome.storage.local.set({ auraEnabled });
        if (!auraEnabled && appState !== 'TRACKING') hideAuraSvg();
    }
    else if (request.action === 'setPerformance') {
        perfTier = request.tier;
        chrome.storage.local.set({ perfTier });
        // Apply perf class to wrapper for CSS to read
        const w = document.getElementById('sfl-grid-wrapper');
        if (w) {
            w.dataset.perf = perfTier;
            w.dataset.quality = perfTier;
        }
        // (silent — perf tier)
    }
    else if (request.action === 'setPreserveEffects') {
        const preserve = request.preserve;
        chrome.storage.local.set({ preserveUnderlying: preserve });
        const w = document.getElementById('sfl-grid-wrapper');
        if (w) w.dataset.preserve = preserve ? 'true' : 'false';
        // (silent — preserve toggle)
    }
    else if (request.action === 'setPrediction') {
        predictionEnabled = request.enabled;
        chrome.storage.local.set({ predictionEnabled });
        if (masterGrid && currentGridData) {
            if (predictionEnabled) {
                applyPredictionOverlay(currentGridData, currentPatterns);
            } else {
                clearPredictionOverlay();
            }
        }
        // (silent — prediction toggle)
    }
    else if (request.action === 'setCustomTheme') {
        customConfig = request.config;
        chrome.storage.local.set({ activeCustomConfig: customConfig });
        currentTheme = 'custom';
        chrome.storage.local.set({ gridTheme: currentTheme });
        applyTheme('custom');
    }
    else if (request.action === 'setCalibration') {
        gridCalibX = request.x || 0;
        gridCalibY = request.y || 0;
        chrome.storage.local.set({ gridCalibX, gridCalibY });
        // Immediately reposition the wrapper
        const w = document.getElementById('sfl-grid-wrapper');
        if (w && gridX !== null) {
            w.style.left = (gridX + gridCalibX) + 'px';
            w.style.top = (gridY + gridCalibY) + 'px';
        }
        // (silent — calibration)
    }
    sendResponse({ status: "ok" }); return true;
});

// =============================================================================
// KEYBOARD
// =============================================================================
window.addEventListener('keydown', (e) => {
    // Alt+1: TOGGLE — first press opens + aligns, second press hides
    if (e.altKey && e.key === '1') {
        e.preventDefault(); e.stopPropagation();
        if (masterGrid && appState === 'TRACKING') {
            removeGrid();
            stopTracking();
            console.log("[Grid] Alt+1: Grid hidden.");
        } else {
            console.log("[Grid] Alt+1: Auto-aligning to dig grid...");
            window.postMessage({ type: 'SFL_GRID_READ_CAMERA' }, '*');
        }
        return;
    }
    // Alt+2: Toggle stats bar
    if (e.altKey && e.key === '2') {
        e.preventDefault(); e.stopPropagation();
        statsBarVisible = !statsBarVisible;
        if (statsBarVisible) createStatsBar(); else removeStatsBar();
        return;
    }
    // Alt+3: Toggle hints panel
    if (e.altKey && e.key === '3') {
        e.preventDefault(); e.stopPropagation();
        hintsVisible = !hintsVisible;
        if (hintsVisible) createHintsPanel(); else removeHintsPanel();
        return;
    }
    // Alt+4: Toggle patterns panel
    if (e.altKey && e.key === '4') {
        e.preventDefault(); e.stopPropagation();
        patternsVisible = !patternsVisible;
        if (patternsVisible) createFormationsPanel(); else removeFormationsPanel();
        return;
    }
    // Alt+5: Toggle treasure stat panel
    if (e.altKey && e.key === '5') {
        e.preventDefault(); e.stopPropagation();
        treasureStatVisible = !treasureStatVisible;
        if (treasureStatVisible) createTreasureStatPanel(); else removeTreasureStatPanel();
        return;
    }
    // Alt+E: Show everything at once
    if (e.altKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault(); e.stopPropagation();
        const anyHidden = !statsBarVisible || !hintsVisible || !patternsVisible || !treasureStatVisible;
        if (anyHidden) {
            if (!statsBarVisible) { statsBarVisible = true; createStatsBar(); }
            if (!hintsVisible) { hintsVisible = true; createHintsPanel(); }
            if (!patternsVisible) { patternsVisible = true; createFormationsPanel(); }
            if (!treasureStatVisible) { treasureStatVisible = true; createTreasureStatPanel(); }
        } else {
            statsBarVisible = false; removeStatsBar();
            hintsVisible = false; removeHintsPanel();
            patternsVisible = false; removeFormationsPanel();
            treasureStatVisible = false; removeTreasureStatPanel();
        }
        return;
    }
    // (E key no longer stops tracking — tracking is persistent)
    if (appState === 'TRACKING' && masterGrid && deviceMode !== 'high') {
        const k = e.key.toLowerCase();
        if (e.code === 'Space') { keys.w = keys.a = keys.s = keys.d = false; return; }
        if (keys.hasOwnProperty(k)) keys[k] = true;
    }
}, true);

window.addEventListener('keyup', (e) => {
    if (appState === 'TRACKING' && deviceMode !== 'high') {
        const k = e.key.toLowerCase();
        if (keys.hasOwnProperty(k)) keys[k] = false;
    }
}, true);

// =============================================================================
// GRID
// =============================================================================
function createGrid() {
    // Create wrapper for theme effects (::before/::after pseudo-elements)
    let gridWrapper = document.getElementById('sfl-grid-wrapper');
    if (!gridWrapper) {
        gridWrapper = document.createElement('div');
        gridWrapper.id = 'sfl-grid-wrapper';
        document.body.appendChild(gridWrapper);
    }

    masterGrid = document.createElement('div');
    masterGrid.id = 'sfl-master-grid';

    // Tile type distribution for visual theming
    // In themed mode: ALL tiles get colored types (no 'empty')
    // In default mode: keep original distribution
    const themedTypes = [
        { name: 'blue', chance: 0.35 },
        { name: 'yellow', chance: 0.35 },
        { name: 'red', chance: 0.30 }
    ];
    const defaultTypes = [
        { name: 'empty', chance: 0.50 },
        { name: 'blue', chance: 0.25 },
        { name: 'yellow', chance: 0.15 },
        { name: 'red', chance: 0.10 }
    ];
    function getRandomType() {
        const types = currentTheme !== 'none' ? themedTypes : defaultTypes;
        const rand = Math.random();
        let cum = 0;
        for (let t of types) { cum += t.chance; if (rand <= cum) return t.name; }
        return 'blue';
    }

    for (let i = 0; i < 100; i++) {
        const c = document.createElement('div');
        c.className = 'sfl-grid-cell';
        c.dataset.x = i % 10;
        c.dataset.y = Math.floor(i / 10);
        c.dataset.type = getRandomType();
        c.dataset.tileState = '';

        // Staggered pop-in animation
        const row = Math.floor(i / 10), col = i % 10;
        c.style.animationDelay = `${(row + col) * 0.03}s`;

        masterGrid.appendChild(c);
    }

    gridWrapper.appendChild(masterGrid);

    // If a theme is active, apply absolute positioning for pixel-perfect alignment
    if (currentTheme !== 'none') {
        const tileW = masterGrid.offsetWidth / 10;
        const tileH = masterGrid.offsetHeight / 10;
        const cells = masterGrid.querySelectorAll('.sfl-grid-cell');
        cells.forEach((cell, i) => {
            const col = i % 10, row = Math.floor(i / 10);
            cell.style.position = 'absolute';
            cell.style.left = `${col * tileW}px`;
            cell.style.top = `${row * tileH}px`;
            cell.style.width = `${tileW}px`;
            cell.style.height = `${tileH}px`;
        });
    }

    updateGridMode(); makeDraggable(gridWrapper);

    // Mouse spotlight tracking
    masterGrid.addEventListener('mousemove', (e) => {
        const rect = masterGrid.getBoundingClientRect();
        masterGrid.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
        masterGrid.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
    });

    // Click-to-dig interaction (themed tiles only — forwards to real game)
    masterGrid.addEventListener('click', (e) => {
        if (currentTheme === 'none') return; // Default grid: no interactive tiles
        const cell = e.target.closest('.sfl-grid-cell');
        if (!cell) return;
        // Skip already-revealed, pending, or digging tiles
        if (cell.dataset.tileState === 'revealed' || cell.dataset.tileState === 'pending' || cell.dataset.tileState === 'digging') return;

        const col = parseInt(cell.dataset.x);
        const row = parseInt(cell.dataset.y);

        // Mark as pending
        cell.dataset.tileState = 'pending';
        cell.classList.add('tile-pending');

        // Forward click to the real game canvas via bridge
        window.postMessage({ type: 'SFL_GRID_CLICK_TILE', row, col }, '*');
        console.log(`[Grid] Tile clicked: (${col},${row}) — forwarding to game...`);

        // Safety timeout: if no result after 5s, revert to clickable
        setTimeout(() => {
            if (cell.dataset.tileState === 'pending') {
                cell.dataset.tileState = 'hidden';
                cell.classList.remove('tile-pending');
                console.warn(`[Grid] Tile (${col},${row}) — no response, reverting.`);
            }
        }, 5000);
    });

    // Apply cached theme
    applyTheme(currentTheme);

    // Apply any cached grid data
    if (currentGridData) {
        applyLiveGridState(currentGridData, currentPatterns);
    }
    // (silent — grid created)
    restoreOverlays();   // the overlays live and die with the wrapper → rebuild the ones that are toggled on
}

function updateGridMode() {
    const w = document.getElementById('sfl-grid-wrapper');
    if (!w) return;
    w.classList.toggle('sfl-mode-locked', isGridLocked);
    w.classList.toggle('sfl-mode-unlocked', !isGridLocked);
}

function removeGrid() {
    const w = document.getElementById('sfl-grid-wrapper');
    if (w) {
        // Remove data-theme to kill ::before/::after backgrounds
        w.removeAttribute('data-theme');
        w.removeAttribute('data-perf');
        w.remove();   // the Alt+2 bar is a child, so it goes with it
    }
    teardownOverlayLayer();   // the side panels live in the overlay layer
    stopPanelTracking();
    masterGrid = null;
}

// =============================================================================
// ITEM TIER CLASSIFICATION — determines animation intensity
// Maps actual SFL API item names → tier categories
// =============================================================================
function getItemTier(itemName) {
    const name = (itemName || '').toLowerCase();
    // Tier 5 (Sand) — empty dig, base animation
    if (name === 'sand' || name.includes('seaweed')) return 'sand';
    // Tier 4 (Crab) — minor hint pulse
    if (name === 'crab' || name.includes('crab')) return 'crab';
    // Tier 2 (Bone) — spectral resonance
    if (name.includes('camel bone') || name.includes('bone')) return 'bone';
    // Tier 1 (Rare/Jackpot) — EXTREME animations
    // Seasonal artefacts, puzzle pieces, hieroglyphs, pearls, bounty
    // Each season has a chapter artefact: Salt Awakening → Salt Dino Egg, Crabs and Traps → Ammonite Shell, etc.
    if (name.includes('artefact') || name.includes('seasonal artefact') ||
        name.includes('hieroglyph') || name.includes('puzzle') ||
        name.includes('scarab') || name.includes('cow skull') ||
        name.includes('ancient clock') || name.includes('broken pillar') ||
        name.includes('coprolite') || name.includes('moon crystal') ||
        name.includes('salt dino egg') || name.includes('otter pebble') ||
        name.includes('ammonite shell') || name.includes('pearl') ||
        name.includes('pirate bounty') || name.includes('dino egg')) return 'rare';
    // Tier 3 (Misc) — treasure glow
    // Coins, compass, bottles, vases, shells, coral, sea cucumber, starfish, etc.
    return 'misc';
}

// Maps named tiers → CSS tier numbers (tier-1 through tier-5)
// CSS animations use .tier-1, .tier-2 etc. class names
const TIER_TO_NUMBER = { sand: '5', misc: '3', crab: '4', bone: '2', rare: '1' };

const TIER_CONFIG = {
    sand: { durationMult: 0.4, particleMult: 0.3, velocityMult: 0.5, sizeMult: 0.8 },   // Quick, minimal, melancholic
    misc: { durationMult: 0.7, particleMult: 0.6, velocityMult: 1.5, sizeMult: 1.2 },   // Treasure glow
    crab: { durationMult: 0.85, particleMult: 1.0, velocityMult: 1.2, sizeMult: 1.0 },  // Minor hint pulse
    bone: { durationMult: 1.0, particleMult: 1.5, velocityMult: 2.0, sizeMult: 1.5 },   // Spectral resonance
    rare: { durationMult: 1.5, particleMult: 2.5, velocityMult: 5.0, sizeMult: 2.5 },   // JACKPOT — EPIC
};

// =============================================================================
// DIG RESULT HANDLER — plays reveal animation when game confirms a dig
// =============================================================================
function handleDigResult(row, col, item) {
    if (!masterGrid || currentTheme === 'none') return;
    const cell = masterGrid.querySelector(`.sfl-grid-cell[data-x="${col}"][data-y="${row}"]`);
    if (!cell) return;
    // Skip if already revealed
    if (cell.dataset.tileState === 'revealed') return;

    const perf = PERF_CONFIG[perfTier] || PERF_CONFIG.high;
    const tier = getItemTier(item);
    const tierConf = TIER_CONFIG[tier];

    // Transition: PENDING → DIGGING
    // Add BOTH named tier class (item-sand etc.) AND numeric tier class (tier-5 etc.)
    // CSS tier animations (.tier-1 through .tier-5) won't work without the numeric class!
    const tierNum = TIER_TO_NUMBER[tier] || '3';
    cell.dataset.tileState = 'digging';
    cell.dataset.itemTier = tier;
    cell.classList.remove('tile-pending');
    cell.classList.add('digging', `item-${tier}`, `tier-${tierNum}`);

    // Add dig-fx-container for themes that use it
    const fx = document.createElement('div');
    fx.className = 'dig-fx-container';
    cell.appendChild(fx);

    // --- JACKPOT GLOBAL EFFECTS (Tier 1 / Rare only) ---
    if (tier === 'rare' && masterGrid) {
        // Trigger grid overload glow (CSS: gridJackpotOverload animation)
        masterGrid.classList.add('jackpot-active');

        // Spawn massive "PUZZLE FOUND!" text across screen
        const text = document.createElement('div');
        text.className = 'jackpot-text';
        text.innerText = 'PUZZLE FOUND!';
        document.body.appendChild(text);

        // Clean up global effects after animation
        setTimeout(() => {
            masterGrid.classList.remove('jackpot-active');
            if (text.parentNode) text.remove();
        }, 3500);
    }

    // Spawn reveal particles (scaled by perf tier × item tier)
    // Jackpot (tier 1) spawns instantly for maximum impact; others delayed
    const particleDelay = tier === 'rare' ? 100 : 1000;
    const particleCount = Math.round(perf.particles * tierConf.particleMult);
    setTimeout(() => {
        if (particleCount > 0) spawnThemeParticles(cell, currentTheme, particleCount, tier);
    }, particleDelay);

    // Animation duration scaled by item tier
    const animDuration = Math.round(perf.animDuration * tierConf.durationMult);

    // After animation, mark as REVEALED (transparent — shows real game tile)
    setTimeout(() => {
        cell.classList.remove('digging', `item-${tier}`, `tier-${tierNum}`);
        cell.classList.add('dug', 'tile-revealed');
        cell.dataset.tileState = 'revealed';
        // Clean up fx container
        const fxEl = cell.querySelector('.dig-fx-container');
        if (fxEl) fxEl.remove();
    }, animDuration);

    // (silent — tile dig animation)
}

function applyGridColors(data) {
    if (!data || !masterGrid) return;
    // Flatten in case API returns a 2D array
    const flat = Array.isArray(data[0]) ? data.flat() : data;
    const cells = masterGrid.querySelectorAll('.sfl-grid-cell');
    cells.forEach(c => c.className = 'sfl-grid-cell');

    // Priority: sand (highest) > misc > crab > bone (lowest)
    const HINT_PRIORITY = { 'sfl-cell-sand': 4, 'sfl-cell-misc': 3, 'sfl-cell-crab': 2, 'sfl-cell-bone': 1 };
    const ALL_HINT_CLASSES = Object.keys(HINT_PRIORITY);

    function getHintClass(name) {
        if (name.includes('sand')) return 'sfl-cell-sand';
        if (name.includes('crab')) return 'sfl-cell-crab';
        if (name.includes('bone') || name.includes('artefact') || name.includes('hieroglyph') || name.includes('map')) return 'sfl-cell-bone';
        return 'sfl-cell-misc';
    }

    function getCurrentPriority(cell) {
        for (const cls of ALL_HINT_CLASSES) {
            if (cell.classList.contains(cls)) return HINT_PRIORITY[cls];
        }
        return 0;
    }

    function setHintIfHigher(cell, cls) {
        const newPri = HINT_PRIORITY[cls] || 0;
        const curPri = getCurrentPriority(cell);
        if (newPri > curPri) {
            ALL_HINT_CLASSES.forEach(c => cell.classList.remove(c));
            cell.classList.add(cls);
        }
    }

    flat.forEach(h => {
        const x = h.x, y = h.y;
        const n = (h.name || (h.items ? Object.keys(h.items)[0] : '')).toLowerCase();
        const cls = getHintClass(n);
        [{ nx: x, ny: y }, { nx: x, ny: y - 1 }, { nx: x, ny: y + 1 }, { nx: x - 1, ny: y }, { nx: x + 1, ny: y }].forEach(c => {
            if (c.nx >= 0 && c.nx < 10 && c.ny >= 0 && c.ny < 10) { const cell = cells[c.ny * 10 + c.nx]; if (cell) setHintIfHigher(cell, cls); }
        });
    });
}

// =============================================================================
// LIVE GRID STATE (auto-update from intercepted game API)
// Marks dug cells + colors nearby cells based on what was found
// =============================================================================
function applyLiveGridState(gridData, patterns) {
    if (!masterGrid) return;
    const cells = masterGrid.querySelectorAll('.sfl-grid-cell');

    if (!gridData || gridData.length === 0) return;

    const flat = Array.isArray(gridData[0]) ? gridData.flat() : gridData;

    // Build a set of dug tile positions for quick lookup
    const dugSet = new Set(flat.map(h => `${h.x},${h.y}`));

    // Priority: sand (highest) > misc > crab > bone (lowest)
    const HINT_PRIORITY = { 'sfl-cell-sand': 4, 'sfl-cell-misc': 3, 'sfl-cell-crab': 2, 'sfl-cell-bone': 1 };
    const ALL_HINT_CLASSES = Object.keys(HINT_PRIORITY);

    function getHintClass(name) {
        if (name.includes('sand')) return 'sfl-cell-sand';
        if (name.includes('crab')) return 'sfl-cell-crab';
        if (name.includes('bone') || name.includes('artefact') || name.includes('hieroglyph') || name.includes('map')) return 'sfl-cell-bone';
        return 'sfl-cell-misc';
    }

    function getCurrentPriority(cell) {
        for (const cls of ALL_HINT_CLASSES) {
            if (cell.classList.contains(cls)) return HINT_PRIORITY[cls];
        }
        return 0;
    }

    function setHintIfHigher(cell, cls) {
        const newPri = HINT_PRIORITY[cls] || 0;
        const curPri = getCurrentPriority(cell);
        if (newPri > curPri) {
            ALL_HINT_CLASSES.forEach(c => cell.classList.remove(c));
            cell.classList.add(cls);
        }
    }

    if (currentTheme !== 'none') {
        // THEMED MODE: mark dug tiles as revealed (transparent)
        cells.forEach(c => {
            const key = `${c.dataset.x},${c.dataset.y}`;
            if (dugSet.has(key) && c.dataset.tileState !== 'revealed' && c.dataset.tileState !== 'digging') {
                c.classList.add('tile-revealed', 'dug');
                c.classList.remove('tile-pending');
                c.dataset.tileState = 'revealed';
            }
        });
    } else {
        // DEFAULT MODE: color-coding with priority
        cells.forEach(c => {
            c.className = 'sfl-grid-cell';
            c.style.opacity = '';
        });

        flat.forEach(h => {
            const x = h.x, y = h.y;
            const dugCell = cells[y * 10 + x];
            if (!dugCell) return;

            const n = (h.name || (h.items ? Object.keys(h.items)[0] : '')).toLowerCase();
            const cls = getHintClass(n);

            dugCell.classList.add('sfl-cell-dug');
            dugCell.classList.add(cls);

            [{ nx: x, ny: y - 1 }, { nx: x, ny: y + 1 }, { nx: x - 1, ny: y }, { nx: x + 1, ny: y }].forEach(c => {
                if (c.nx >= 0 && c.nx < 10 && c.ny >= 0 && c.ny < 10) {
                    const adj = cells[c.ny * 10 + c.nx];
                    if (adj && !adj.classList.contains('sfl-cell-dug')) {
                        setHintIfHigher(adj, cls);
                    }
                }
            });
        });
    }

    // (silent — live state applied)

    // Run prediction solver if enabled
    if (predictionEnabled) {
        applyPredictionOverlay(gridData, patterns);
    }
}

// =============================================================================
// PREDICTION OVERLAY
// Runs the digging solver and applies visual prediction classes to grid cells
// =============================================================================

// Map item names to local icon base names in the ITEMS/ folder (no extension)
// Loader tries .png first, then .webp fallback
const ITEM_ICON_MAP = {
    'Camel Bone': 'camel_bone',
    'Salt Dino Egg': 'salt_dino_egg',
    'Old Bottle': 'old_bottle',
    'Cockle Shell': 'cockle_shell',
    'Wooden Compass': 'wooden_compass',
    'Sea Cucumber': 'sea_cucumber',
    'Pipi': 'pipi',
    'Seaweed': 'seaweed',
    'Starfish': 'starfish',
    'Clam Shell': 'clam_shell',
    'Coral': 'coral',
    'Pearl': 'pearl',
    'Pirate Bounty': 'pirate_bounty',
    'Stone': 'stone',
    'Wood': 'wood',
    'Vase': 'vase',
    'Hieroglyph': 'hieroglyph',
    'Cow Skull': 'cow_skull',
    'Scarab': 'scarab',
    'Ancient Clock': 'ancient_clock',
    'Broken Pillar': 'broken_pillar',
    'Coprolite': 'coprolite',
    'Moon Crystal': 'moon_crystal',
    'Ammonite Shell': 'ammonite_shell',
    'Otter Pebble': 'otter_pebble',
};

const PREDICTION_CLASSES = [
    'sfl-cell-guaranteed',
    'sfl-cell-prediction-empty',
    'sfl-cell-prediction-possible',
    'sfl-cell-prediction-crab',
    'sfl-cell-prediction-sand',
];

function clearPredictionOverlay() {
    if (!masterGrid) return;
    const cells = masterGrid.querySelectorAll('.sfl-grid-cell');
    cells.forEach(cell => {
        PREDICTION_CLASSES.forEach(cls => cell.classList.remove(cls));
        // Remove prediction labels, icons, dig markers, sand/crab icons, morph containers
        cell.querySelectorAll('.sfl-prediction-label, .sfl-prediction-icon, .sfl-prediction-dig-marker, .sfl-prediction-sand-icon, .sfl-prediction-crab-icon, .sfl-morph-container').forEach(el => el.remove());
        cell.style.position = '';
    });
    lastSolvedBoard = null;
    // (silent — overlay cleared)
}

// Append a sand icon to a cell (for empty/predicted-sand tiles)
function appendSandIcon(cell) {
    const icon = document.createElement('img');
    icon.className = 'sfl-prediction-icon sfl-prediction-sand-icon';
    icon.src = chrome.runtime.getURL('ITEMS/sand.png');
    icon.alt = 'Sand';
    icon.onerror = () => {
        const webpSrc = chrome.runtime.getURL('ITEMS/sand.webp');
        if (icon.src !== webpSrc) {
            icon.src = webpSrc;
        } else {
            icon.remove();
        }
    };
    cell.appendChild(icon);
}

// Append a crab icon to a cell (for predicted-crab tiles)
function appendCrabIcon(cell) {
    const icon = document.createElement('img');
    icon.className = 'sfl-prediction-icon sfl-prediction-crab-icon';
    icon.src = chrome.runtime.getURL('ITEMS/crab.png');
    icon.alt = 'Crab';
    icon.onerror = () => {
        const webpSrc = chrome.runtime.getURL('ITEMS/crab.webp');
        if (icon.src !== webpSrc) {
            icon.src = webpSrc;
        } else {
            icon.remove();
        }
    };
    cell.appendChild(icon);
}

// Append a morphing sand↔crab animation (for 'empty' tiles — our own predictions
// where we know "no treasure" but can't determine sand vs crab yet)
function appendMorphIcons(cell) {
    const container = document.createElement('div');
    container.className = 'sfl-morph-container';

    // Sand icon (visible first)
    const sandImg = document.createElement('img');
    sandImg.className = 'sfl-morph-sand';
    sandImg.src = chrome.runtime.getURL('ITEMS/sand.png');
    sandImg.alt = 'Sand';
    sandImg.onerror = () => {
        const webpSrc = chrome.runtime.getURL('ITEMS/sand.webp');
        if (sandImg.src !== webpSrc) sandImg.src = webpSrc;
        else sandImg.remove();
    };

    // Crab icon (hidden first, fades in)
    const crabImg = document.createElement('img');
    crabImg.className = 'sfl-morph-crab';
    crabImg.src = chrome.runtime.getURL('ITEMS/crab.png');
    crabImg.alt = 'Crab';
    crabImg.onerror = () => {
        const webpSrc = chrome.runtime.getURL('ITEMS/crab.webp');
        if (crabImg.src !== webpSrc) crabImg.src = webpSrc;
        else crabImg.remove();
    };

    container.appendChild(sandImg);
    container.appendChild(crabImg);
    cell.appendChild(container);
}

function applyPredictionOverlay(gridData, patterns) {
    if (!masterGrid || !gridData) return;

    // Wait for solver to be injected (it runs in page context via bridge)
    // The solver is injected into the page, but content script runs in isolated world.
    // So we run the solver inline here instead — it's pure JS, no DOM needed.
    // Since digging-solver.js is injected into the PAGE world (like bridge.js),
    // we need to run the solver logic in content script context directly.
    // We use a self-contained inline solver for the content script.

    const flat = Array.isArray(gridData[0]) ? gridData.flat() : gridData;
    if (flat.length === 0) return;

    // Run solver (inline — same logic as digging-solver.js)
    const solved = runContentSolver(flat, patterns || []);
    if (!solved) return;
    lastSolvedBoard = solved;

    const cells = masterGrid.querySelectorAll('.sfl-grid-cell');

    // Clear previous predictions
    cells.forEach(cell => {
        PREDICTION_CLASSES.forEach(cls => cell.classList.remove(cls));
        cell.querySelectorAll('.sfl-prediction-label, .sfl-prediction-icon, .sfl-prediction-dig-marker, .sfl-morph-container').forEach(el => el.remove());
    });

    // Apply prediction classes
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const sc = solved.cells[y][x];
            const cell = cells[y * 10 + x];
            if (!cell || sc.dug) continue;

            if (sc.status === 'guaranteed' || sc.predicted) {
                // position: relative is now handled by CSS
            }

            switch (sc.status) {
                case 'guaranteed':
                    cell.classList.add('sfl-cell-guaranteed');
                    // Add item prediction label + icon if formation-proven
                    if (sc.predicted) {
                        const label = document.createElement('span');
                        label.className = 'sfl-prediction-label';
                        label.textContent = sc.predicted.item;
                        cell.appendChild(label);

                        // Try to load item icon from ITEMS/ folder (.png first, .webp fallback)
                        const iconBase = ITEM_ICON_MAP[sc.predicted.item];
                        if (iconBase) {
                            const icon = document.createElement('img');
                            icon.className = 'sfl-prediction-icon';
                            icon.src = chrome.runtime.getURL('ITEMS/' + iconBase + '.png');
                            icon.alt = sc.predicted.item;
                            icon.onerror = () => {
                                // Try .webp fallback
                                const webpSrc = chrome.runtime.getURL('ITEMS/' + iconBase + '.webp');
                                if (icon.src !== webpSrc) {
                                    icon.src = webpSrc;
                                } else {
                                    icon.remove(); // neither format found
                                }
                            };
                            cell.appendChild(icon);
                        }
                    } else {
                        // Generic "dig here" marker
                        const marker = document.createElement('span');
                        marker.className = 'sfl-prediction-dig-marker';
                        marker.textContent = '⛏️';
                        cell.appendChild(marker);
                    }
                    break;
                case 'empty':
                    cell.classList.add('sfl-cell-prediction-empty');
                    appendMorphIcons(cell);
                    break;
                case 'possible':
                    cell.classList.add('sfl-cell-prediction-possible');
                    break;
                case 'crab':
                    cell.classList.add('sfl-cell-prediction-crab');
                    appendCrabIcon(cell);
                    break;
                case 'sand':
                    cell.classList.add('sfl-cell-prediction-sand');
                    appendSandIcon(cell);
                    break;
            }
        }
    }

    if (solved.tally.dug > 0 && solved.tally.sand === 0 && solved.tally.crabs === 0) {
        console.warn('%c[SFL HEALTH] ⚠️ SOLVER: Dug cells exist but NO Sand/Crab found!', 'color: #f59e0b; font-weight: bold');
        console.warn('  → hItem() may not be reading item names correctly');
        console.warn('  → Check if API changed how items are stored in grid tiles');
    }
    if (solved.tally.dug > 3 && solved.tally.guaranteed === 0 && solved.tally.empty === 0 && solved.tally.possible === 0) {
        console.warn('%c[SFL HEALTH] ⚠️ SOLVER: Many tiles dug but zero predictions!', 'color: #f59e0b; font-weight: bold');
        console.warn('  → Solver may not be classifying items correctly');
    }

    // (silent — prediction overlay applied)
}

// =============================================================================
// INLINE SOLVER — runs in content script context (isolated world)
// Full port of the digging solver for use without page-world injection
// =============================================================================
function runContentSolver(gridFlat, patterns) {
    const DIG = 10;
    const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

    function nbrs(x, y) {
        const out = [];
        for (const [dx, dy] of DIRS) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < DIG && ny >= 0 && ny < DIG) out.push([nx, ny]);
        }
        return out;
    }

    function hItem(hole) {
        if (!hole) return null;
        // Support both old format (hole.items) and new format (hole.name)
        if (hole.items && typeof hole.items === 'object') {
            const key = Object.keys(hole.items)[0];
            if (key) return key;
        }
        if (hole.name) return hole.name;
        return null;
    }

    // Build hole grid
    const board = Array.from({ length: DIG }, () => Array(DIG).fill(undefined));
    for (const h of gridFlat) {
        if (h.y >= 0 && h.y < DIG && h.x >= 0 && h.x < DIG) board[h.y][h.x] = h;
    }

    // Classify cells
    const cells = [];
    const itemsFound = [];
    for (let y = 0; y < DIG; y++) {
        cells[y] = [];
        for (let x = 0; x < DIG; x++) {
            const item = hItem(board[y][x]);
            const dug = item !== null;
            let kind = null;
            if (item === 'Sand') kind = 'sand';
            else if (item === 'Crab') kind = 'crab';
            else if (dug) kind = 'treasure';
            cells[y][x] = { x, y, item, dug, kind, status: 'unknown' };
            if (dug) {
                itemsFound.push(`(${x},${y})=${item}→${kind}`);
                if (dug && kind === null) {
                    console.warn(`%c[SFL HEALTH] ⚠️ SOLVER: Dug tile (${x},${y}) item "${item}" not classified as sand/crab/treasure`, 'color: #f59e0b; font-weight: bold');
                    console.warn(`  → Add classification rule for "${item}" in runContentSolver()`);
                }
            }
        }
    }

    // Status pass
    for (let y = 0; y < DIG; y++) for (let x = 0; x < DIG; x++) {
        const c = cells[y][x];
        if (c.dug) { c.status = c.kind === 'treasure' ? 'treasure' : c.kind === 'sand' ? 'clue-sand' : 'clue-crab'; continue; }
        let hasSand = false, hasCrab = false;
        for (const [nx, ny] of nbrs(x, y)) {
            const k = cells[ny][nx].kind;
            if (k === 'sand') hasSand = true;
            if (k === 'crab') hasCrab = true;
        }
        c.status = hasSand ? 'empty' : hasCrab ? 'possible' : 'unknown';
    }

    // Propagation: guaranteed
    for (let y = 0; y < DIG; y++) for (let x = 0; x < DIG; x++) {
        const cr = cells[y][x];
        if (cr.kind !== 'crab') continue;
        const ns = nbrs(x, y).map(([nx, ny]) => cells[ny][nx]);
        if (ns.some(n => n.kind === 'treasure')) continue;
        const cands = ns.filter(n => !n.dug && n.status !== 'empty');
        if (cands.length === 1 && cands[0].status !== 'guaranteed') cands[0].status = 'guaranteed';
    }

    // Formation solver
    const ARTEFACT = 'Otter Pebble';
    const FORMATIONS = {
        MONDAY_ARTEFACT_FORMATION: [{ x: 0, y: -1, name: 'Camel Bone' }, { x: 1, y: -1, name: 'Seasonal Artefact' }],
        TUESDAY_ARTEFACT_FORMATION: [{ x: 1, y: 0, name: 'Seasonal Artefact' }, { x: 1, y: 2, name: 'Camel Bone' }],
        WEDNESDAY_ARTEFACT_FORMATION: [{ x: 0, y: 0, name: 'Camel Bone' }, { x: 1, y: 0, name: 'Seasonal Artefact' }],
        THURSDAY_ARTEFACT_FORMATION: [{ x: 0, y: 0, name: 'Camel Bone' }, { x: 1, y: -1, name: 'Seasonal Artefact' }],
        FRIDAY_ARTEFACT_FORMATION: [{ x: 2, y: 0, name: 'Camel Bone' }, { x: 3, y: 0, name: 'Seasonal Artefact' }],
        SATURDAY_ARTEFACT_FORMATION: [{ x: 1, y: 0, name: 'Seasonal Artefact' }, { x: 1, y: -1, name: 'Camel Bone' }],
        SUNDAY_ARTEFACT_FORMATION: [{ x: 0, y: -2, name: 'Seasonal Artefact' }],
        ARTEFACT_ONE: [{ x: 0, y: 0, name: 'Seasonal Artefact' }, { x: 0, y: 1, name: 'Camel Bone' }, { x: 0, y: 2, name: 'Camel Bone' }],
        ARTEFACT_TWO: [{ x: 0, y: 0, name: 'Seasonal Artefact' }, { x: 1, y: 0, name: 'Camel Bone' }, { x: 0, y: 2, name: 'Camel Bone' }],
        ARTEFACT_THREE: [{ x: 0, y: 0, name: 'Seasonal Artefact' }],
        ARTEFACT_FOUR: [{ x: 0, y: 0, name: 'Seasonal Artefact' }, { x: 0, y: 1, name: 'Camel Bone' }, { x: 0, y: 2, name: 'Camel Bone' }, { x: 0, y: 3, name: 'Camel Bone' }],
        ARTEFACT_FIVE: [{ x: 0, y: 0, name: 'Seasonal Artefact' }, { x: -1, y: 0, name: 'Camel Bone' }, { x: -2, y: 0, name: 'Camel Bone' }],
        ARTEFACT_SIX: [{ x: 0, y: 0, name: 'Seasonal Artefact' }, { x: -1, y: 0, name: 'Camel Bone' }, { x: -2, y: -1, name: 'Camel Bone' }],
        ARTEFACT_SEVEN: [{ x: 0, y: 0, name: 'Seasonal Artefact' }, { x: 1, y: 1, name: 'Camel Bone' }],
        ARTEFACT_EIGHT: [{ x: 0, y: 0, name: 'Seasonal Artefact' }, { x: 1, y: 0, name: 'Camel Bone' }, { x: 0, y: 2, name: 'Camel Bone' }],
        ARTEFACT_NINE: [{ x: 0, y: 0, name: 'Seasonal Artefact' }, { x: 0, y: 1, name: 'Camel Bone' }, { x: 0, y: -1, name: 'Camel Bone' }, { x: -1, y: -1, name: 'Camel Bone' }],
        ARTEFACT_TEN: [{ x: 0, y: 0, name: 'Seasonal Artefact' }, { x: 0, y: 1, name: 'Camel Bone' }, { x: -1, y: 0, name: 'Camel Bone' }, { x: -1, y: 1, name: 'Camel Bone' }],
        ARTEFACT_ELEVEN: [{ x: 0, y: 0, name: 'Seasonal Artefact' }, { x: 0, y: 1, name: 'Camel Bone' }, { x: 1, y: 1, name: 'Camel Bone' }],
        ARTEFACT_TWELVE: [{ x: 0, y: 0, name: 'Seasonal Artefact' }, { x: 0, y: 1, name: 'Camel Bone' }, { x: -1, y: 1, name: 'Camel Bone' }, { x: 1, y: 1, name: 'Camel Bone' }],
        ARTEFACT_THIRTEEN: [{ x: 0, y: 0, name: 'Seasonal Artefact' }, { x: 2, y: 0, name: 'Camel Bone' }],
        ARTEFACT_FOURTEEN: [{ x: 0, y: 0, name: 'Seasonal Artefact' }, { x: 0, y: 2, name: 'Camel Bone' }],
        ARTEFACT_FIFTEEN: [{ x: 0, y: 0, name: 'Camel Bone' }, { x: 1, y: 0, name: 'Seasonal Artefact' }, { x: 2, y: 0, name: 'Camel Bone' }],
        ARTEFACT_SIXTEEN: [{ x: 0, y: 0, name: 'Seasonal Artefact' }, { x: 1, y: 0, name: 'Camel Bone' }, { x: 1, y: 1, name: 'Camel Bone' }],
        ARTEFACT_SEVENTEEN: [{ x: 0, y: 0, name: 'Camel Bone' }, { x: 1, y: 0, name: 'Camel Bone' }, { x: 1, y: 1, name: 'Seasonal Artefact' }],
        ARTEFACT_EIGHTEEN: [{ x: 0, y: 0, name: 'Seasonal Artefact' }, { x: 1, y: 0, name: 'Camel Bone' }, { x: 0, y: 1, name: 'Camel Bone' }, { x: 1, y: 1, name: 'Camel Bone' }],
        ARTEFACT_NINETEEN: [{ x: 0, y: 0, name: 'Camel Bone' }, { x: 1, y: 0, name: 'Camel Bone' }, { x: 2, y: 0, name: 'Camel Bone' }, { x: 1, y: 1, name: 'Seasonal Artefact' }],
        ARTEFACT_TWENTY: [{ x: 0, y: 0, name: 'Camel Bone' }, { x: 1, y: 0, name: 'Camel Bone' }, { x: 0, y: 1, name: 'Seasonal Artefact' }, { x: 1, y: 1, name: 'Camel Bone' }],
        ARTEFACT_TWENTY_ONE: [{ x: 0, y: 0, name: 'Seasonal Artefact' }, { x: 1, y: 0, name: 'Camel Bone' }, { x: 2, y: 0, name: 'Camel Bone' }, { x: 0, y: 1, name: 'Camel Bone' }, { x: 1, y: 1, name: 'Camel Bone' }],
        ARTEFACT_TWENTY_TWO: [{ x: 0, y: 0, name: 'Camel Bone' }, { x: 1, y: 0, name: 'Camel Bone' }, { x: 2, y: 0, name: 'Camel Bone' }, { x: 0, y: 1, name: 'Camel Bone' }, { x: 1, y: 1, name: 'Seasonal Artefact' }],
        ARTEFACT_TWENTY_THREE: [{ x: 0, y: 0, name: 'Camel Bone' }, { x: 1, y: 0, name: 'Camel Bone' }, { x: 2, y: 0, name: 'Camel Bone' }, { x: 1, y: 1, name: 'Camel Bone' }, { x: 2, y: 1, name: 'Seasonal Artefact' }],
        ARTEFACT_TWENTY_FOUR: [{ x: 0, y: 0, name: 'Camel Bone' }, { x: 1, y: 0, name: 'Seasonal Artefact' }, { x: 2, y: 0, name: 'Camel Bone' }, { x: 0, y: 1, name: 'Camel Bone' }, { x: 2, y: 1, name: 'Camel Bone' }],
        HIEROGLYPH: [{ x: 0, y: 0, name: 'Vase' }, { x: 1, y: 0, name: 'Vase' }, { x: 0, y: 1, name: 'Hieroglyph' }],
        OLD_BOTTLE: [{ x: 0, y: 0, name: 'Old Bottle' }, { x: 1, y: 0, name: 'Old Bottle' }, { x: 0, y: 1, name: 'Old Bottle' }, { x: 1, y: 1, name: 'Old Bottle' }],
        COCKLE: [{ x: 0, y: 0, name: 'Cockle Shell' }, { x: 1, y: 1, name: 'Cockle Shell' }, { x: 2, y: 2, name: 'Cockle Shell' }],
        WOODEN_COMPASS: [{ x: 0, y: 0, name: 'Wood' }, { x: 1, y: 0, name: 'Wooden Compass' }, { x: 2, y: 0, name: 'Wood' }],
        SEA_CUCUMBERS: [{ x: 0, y: 0, name: 'Sea Cucumber' }, { x: 1, y: 0, name: 'Sea Cucumber' }, { x: 2, y: 0, name: 'Sea Cucumber' }, { x: 3, y: 0, name: 'Pipi' }],
        SEAWEED: [{ x: 0, y: 0, name: 'Seaweed' }, { x: 1, y: 0, name: 'Seaweed' }, { x: 2, y: 0, name: 'Seaweed' }, { x: 2, y: 1, name: 'Starfish' }],
        CLAM_SHELLS: [{ x: 0, y: 0, name: 'Clam Shell' }, { x: 1, y: 0, name: 'Clam Shell' }, { x: 0, y: -1, name: 'Clam Shell' }, { x: 1, y: -1, name: 'Clam Shell' }],
        CORAL: [{ x: 0, y: 1, name: 'Stone' }, { x: 0, y: 0, name: 'Coral' }, { x: 0, y: -1, name: 'Stone' }],
        PEARL: [{ x: 0, y: 1, name: 'Stone' }, { x: 0, y: 0, name: 'Pearl' }, { x: 0, y: -1, name: 'Stone' }],
        PIRATE_BOUNTY: [{ x: 0, y: 0, name: 'Pirate Bounty' }],
    };

    const ky = (x, y) => y * DIG + x;

    // Resolve formations
    const instances = (patterns || []).map(name => {
        const f = FORMATIONS[name];
        if (!f) return null;
        return {
            name,
            plots: f.map(p => ({ dx: p.x, dy: p.y, item: p.name === 'Seasonal Artefact' ? ARTEFACT : p.name }))
        };
    }).filter(Boolean);

    // Placements
    function placements(cs, f) {
        const xs = f.plots.map(p => p.dx), ys = f.plots.map(p => p.dy);
        const mnX = Math.min(...xs), mxX = Math.max(...xs), mnY = Math.min(...ys), mxY = Math.max(...ys);
        const out = [];
        for (let dx = -mnX; dx <= DIG - 1 - mxX; dx++) {
            for (let dy = -mnY; dy <= DIG - 1 - mxY; dy++) {
                const all = [], dg = [], ud = [];
                let ok = true;
                for (const p of f.plots) {
                    const px = p.dx + dx, py = p.dy + dy;
                    const cl = cs[py][px], k = ky(px, py);
                    all.push(k);
                    if (cl.dug) { if (cl.item !== p.item) { ok = false; break; } dg.push(k); }
                    else { if (cl.status === 'empty') { ok = false; break; } ud.push({ x: px, y: py, item: p.item, formation: f.name }); }
                }
                if (ok) out.push({ name: f.name, cells: all, dug: dg, undug: ud });
            }
        }
        return out;
    }

    // Formation solver (with bail)
    const need = [];
    for (let y = 0; y < DIG; y++) for (let x = 0; x < DIG; x++) if (cells[y][x].kind === 'treasure') need.push(ky(x, y));

    let forced = [], excludedTreasure = new Set();
    if (instances.length > 0) {
        const perInst = instances.map(f => placements(cells, f));
        const allValid = !perInst.some(p => p.length === 0);

        if (allValid) {
            const order = perInst.map((_, i) => i).sort((a, b) => perInst[a].length - perInst[b].length);
            const ordered = order.map(i => perInst[i]);

            const lastCov = new Map();
            ordered.forEach((pls, d) => { for (const pl of pls) for (const c of pl.dug) lastCov.set(c, Math.max(lastCov.get(c) ?? -1, d)); });
            let canSearch = true;
            for (const c of need) if (!lastCov.has(c)) { canSearch = false; break; }

            if (canSearch) {
                const deadAt = ordered.map(() => []);
                for (const c of need) deadAt[lastCov.get(c)].push(c);
                const occ = new Set(), cov = new Set(), chosen = [], solutions = [];
                let steps = 0, bailed = false;
                const search = (d) => {
                    if (bailed) return;
                    if (++steps > 1000000) { bailed = true; return; }
                    if (d === ordered.length) { for (const c of need) if (!cov.has(c)) return; solutions.push(chosen.slice()); if (solutions.length > 4000) bailed = true; return; }
                    for (const pl of ordered[d]) {
                        let clash = false; for (const c of pl.cells) if (occ.has(c)) { clash = true; break; }
                        if (clash) continue;
                        const ac = []; for (const c of pl.cells) occ.add(c); for (const c of pl.dug) if (!cov.has(c)) { cov.add(c); ac.push(c); }
                        let dead = false; for (const c of deadAt[d]) if (!cov.has(c)) { dead = true; break; }
                        if (!dead) { chosen.push(pl); search(d + 1); chosen.pop(); }
                        for (const c of pl.cells) occ.delete(c); for (const c of ac) cov.delete(c);
                        if (bailed) return;
                    }
                };
                search(0);

                if (!bailed && solutions.length > 0) {
                    // Extract forced tiles
                    const items = new Map(), names = new Map(), cc = new Map();
                    for (const sol of solutions) { const seen = new Set(); for (const pl of sol) for (const u of pl.undug) { const k = ky(u.x, u.y); let is = items.get(k); if (!is) items.set(k, is = new Set()); is.add(u.item); let ns = names.get(k); if (!ns) names.set(k, ns = new Set()); ns.add(u.formation); if (!seen.has(k)) { seen.add(k); cc.set(k, (cc.get(k) ?? 0) + 1); } } }
                    const fMap = new Map(), conflicts = new Set();
                    for (const [k, is] of items) {
                        if (is.size !== 1 || cc.get(k) !== solutions.length) continue;
                        const ns = names.get(k);
                        const t = { x: k % DIG, y: Math.floor(k / DIG), item: [...is][0], formation: ns.size === 1 ? [...ns][0] : '' };
                        const tk = `${t.x}-${t.y}`;
                        const ex = fMap.get(tk);
                        if (ex && ex.item !== t.item) { conflicts.add(tk); continue; }
                        if (!ex || (!ex.formation && t.formation)) fMap.set(tk, t);
                    }
                    for (const k of conflicts) fMap.delete(k);
                    forced = [...fMap.values()];

                    // Excluded treasure
                    const possTreasure = new Set();
                    for (const sol of solutions) for (const pl of sol) for (const c of pl.cells) possTreasure.add(c);
                    for (let y = 0; y < DIG; y++)for (let x = 0; x < DIG; x++) { const k = ky(x, y); if (!cells[y][x].dug && !possTreasure.has(k)) excludedTreasure.add(k); }
                } else {
                    // Fallback: fast forced
                    forced = fastForcedInline(cells, instances);
                }
            } else {
                forced = fastForcedInline(cells, instances);
            }
        } else {
            forced = fastForcedInline(cells, instances);
        }
    }

    // Apply forced tiles
    for (const t of forced) {
        const c = cells[t.y][t.x];
        if (c.dug) continue;
        cells[t.y][t.x] = { ...c, status: 'guaranteed', predicted: { item: t.item, formation: t.formation } };
    }

    // Mark predictions (crab/sand)
    // CRITICAL: use a snapshot of cells for neighbour lookups so the pass is
    // order-independent (matching Elias's original solver exactly).
    const snapshot = cells.map(row => row.map(c => ({ ...c })));
    const treasureFree = snapshot.map(row => row.map(c => c.status === 'empty' || excludedTreasure.has(c.y * DIG + c.x)));
    const canHold = (n) => { if (n.dug) return n.kind === 'treasure'; if (n.status === 'guaranteed') return true; return !treasureFree[n.y][n.x]; };
    for (let y = 0; y < DIG; y++) for (let x = 0; x < DIG; x++) {
        const c = snapshot[y][x];
        if (c.dug || c.status === 'guaranteed') continue;
        if (!treasureFree[y][x]) continue;
        // Read neighbours from the SNAPSHOT, not the mutated cells array
        const ns = nbrs(x, y).map(([nx, ny]) => snapshot[ny][nx]);
        if (ns.some(n => n.kind === 'treasure' || n.status === 'guaranteed')) cells[y][x] = { ...c, status: 'crab' };
        else if (ns.every(n => !canHold(n))) cells[y][x] = { ...c, status: 'sand' };
    }

    // Tally
    const tally = { guaranteed: 0, possible: 0, empty: 0, dug: 0, crabs: 0, sand: 0, crabPredicted: 0, sandPredicted: 0 };
    for (let y = 0; y < DIG; y++) for (let x = 0; x < DIG; x++) {
        const c = cells[y][x];
        if (c.dug) tally.dug++;
        if (c.kind === 'crab') tally.crabs++;
        if (c.kind === 'sand') tally.sand++;
        if (c.status === 'guaranteed') tally.guaranteed++;
        else if (c.status === 'possible') tally.possible++;
        else if (c.status === 'empty') tally.empty++;
        else if (c.status === 'crab') tally.crabPredicted++;
        else if (c.status === 'sand') tally.sandPredicted++;
    }

    return { cells, tally };
}

function fastForcedInline(cells, instances) {
    const DIG = 10, ky = (x, y) => y * DIG + x;
    function pl(cs, f) {
        const xs = f.plots.map(p => p.dx), ys = f.plots.map(p => p.dy);
        const mnX = Math.min(...xs), mxX = Math.max(...xs), mnY = Math.min(...ys), mxY = Math.max(...ys);
        const out = [];
        for (let dx = -mnX; dx <= DIG - 1 - mxX; dx++)for (let dy = -mnY; dy <= DIG - 1 - mxY; dy++) {
            const all = [], dg = [], ud = []; let ok = true;
            for (const p of f.plots) {
                const px = p.dx + dx, py = p.dy + dy, cl = cs[py][px], k = ky(px, py); all.push(k);
                if (cl.dug) { if (cl.item !== p.item) { ok = false; break; } dg.push(k); }
                else { if (cl.status === 'empty') { ok = false; break; } ud.push({ x: px, y: py, item: p.item, formation: f.name }); }
            }
            if (ok) out.push({ name: f.name, cells: all, dug: dg, undug: ud });
        }
        return out;
    }
    const byName = new Map();
    for (const f of instances) if (!byName.has(f.name)) byName.set(f.name, f);
    const itemNames = new Map();
    for (const f of byName.values()) for (const p of f.plots) { let s = itemNames.get(p.item); if (!s) { s = new Set(); itemNames.set(p.item, s); } s.add(f.name); }
    const cache = new Map();
    const getPl = (f) => { let p = cache.get(f.name); if (!p) { p = pl(cells, f); cache.set(f.name, p); } return p; };
    const fMap = new Map(), conflicts = new Set();
    const addForced = (t) => { const k = `${t.x}-${t.y}`; const ex = fMap.get(k); if (ex && ex.item !== t.item) { conflicts.add(k); return; } if (!ex || (!ex.formation && t.formation)) fMap.set(k, t); };
    for (const f of byName.values()) { const ps = getPl(f); if (ps.length === 1) for (const u of ps[0].undug) addForced(u); }
    for (let y = 0; y < DIG; y++)for (let x = 0; x < DIG; x++) { const c = cells[y][x]; if (c.kind !== 'treasure' || !c.item) continue; const ns = itemNames.get(c.item); if (!ns || ns.size !== 1) continue; const f = byName.get([...ns][0]); if (!f) continue; const cov = getPl(f).filter(p => p.dug.includes(ky(x, y))); if (cov.length === 1) for (const u of cov[0].undug) addForced(u); }
    for (const k of conflicts) fMap.delete(k);
    return [...fMap.values()];
}

// =============================================================================
// GAME FORMULA HELPERS — ported from official desert.ts + chapters.ts + treasure.ts
// =============================================================================

const CHAPTER_DATES = {
    'Solar Flare': { start: '2023-01-01', end: '2023-05-01' },
    'Dawn Breaker': { start: '2023-05-01', end: '2023-08-01' },
    "Witches' Eve": { start: '2023-08-01', end: '2023-11-01' },
    'Catch the Kraken': { start: '2023-11-01', end: '2024-02-01' },
    'Spring Blossom': { start: '2024-02-01', end: '2024-05-01' },
    'Clash of Factions': { start: '2024-05-01', end: '2024-08-01' },
    "Pharaoh's Treasure": { start: '2024-08-01', end: '2024-11-01' },
    'Bull Run': { start: '2024-11-01', end: '2025-02-03' },
    'Winds of Change': { start: '2025-02-03', end: '2025-05-01' },
    'Great Bloom': { start: '2025-05-01', end: '2025-08-04' },
    'Better Together': { start: '2025-08-04', end: '2025-11-03' },
    'Paw Prints': { start: '2025-11-03', end: '2026-02-02' },
    'Crabs and Traps': { start: '2026-02-02', end: '2026-05-04' },
    'Salt Awakening': { start: '2026-05-04', end: '2026-08-03' },
    'Ascension Age': { start: '2026-08-03', end: '2026-11-02' },
};

const CHAPTER_ARTEFACT_MAP = {
    'Bull Run': 'Cow Skull',
    "Pharaoh's Treasure": 'Scarab',
    'Solar Flare': 'Scarab',
    'Dawn Breaker': 'Scarab',
    "Witches' Eve": 'Scarab',
    'Catch the Kraken': 'Scarab',
    'Spring Blossom': 'Scarab',
    'Clash of Factions': 'Scarab',
    'Winds of Change': 'Ancient Clock',
    'Great Bloom': 'Broken Pillar',
    'Better Together': 'Coprolite',
    'Paw Prints': 'Moon Crystal',
    'Crabs and Traps': 'Ammonite Shell',
    'Salt Awakening': 'Salt Dino Egg',
    'Ascension Age': 'Otter Pebble',
};

// Official BASE sell prices from treasure.ts (before boosts)
const BASE_TREASURE_PRICES = {
    'Sand': 10, 'Crab': 15,
    'Camel Bone': 10, 'Old Bottle': 22.5,
    'Sea Cucumber': 22.5, 'Vase': 50, 'Seaweed': 75, 'Cockle Shell': 100,
    'Starfish': 112.5, 'Wooden Compass': 131.25, 'Iron Compass': 187.5,
    'Emerald Compass': 187.5, 'Pipi': 187.5, 'Hieroglyph': 250,
    'Clam Shell': 375, 'Coral': 1500, 'Pearl': 3750, 'Pirate Bounty': 7500,
    'Scarab': 200, 'Cow Skull': 200, 'Ancient Clock': 200,
    'Broken Pillar': 200, 'Coprolite': 200, 'Moon Crystal': 200,
    'Ammonite Shell': 200, 'Salt Dino Egg': 200, 'Otter Pebble': 200,
};

// Tool recipes from tools.ts
const TREASURE_TOOLS = {
    'Sand Shovel': { coinCost: 20, ingredients: { Wood: 2, Stone: 1 } },
    'Sand Drill': { coinCost: 40, ingredients: { Oil: 1, Crimstone: 1 } },
};

// =============================================================================
// Collectible / Wearable detection — matches game source exactly
// =============================================================================

// Matches isCollectibleBuilt from collectibleBuilt.ts:
// An item counts if it has coordinates AND readyAt <= now AND is not used
function isCollectibleReady(placed) {
    if (!placed || typeof placed !== 'object') return false;
    return (placed.readyAt == null || placed.readyAt <= Date.now()) &&
        !!placed.coordinates &&
        !placed.used;
}

// Check if a named collectible is built anywhere in the merged collectibles map
// (sidepanel.js already merges farm, home, interior.ground, interior.level_one)
function isCollectibleBuilt(name) {
    const arr = currentCollectibles[name];
    if (!Array.isArray(arr)) return false;
    return arr.some(isCollectibleReady);
}

// Matches isWearableActive from wearables.ts:
// Checks both the main bumpkin and all farmHand bumpkins
function isWearableEquipped(name) {
    const mainEquipped = currentBumpkin?.equipped || {};
    if (Object.values(mainEquipped).includes(name)) return true;
    // Check farmHands
    const bumpkins = currentFarmHands?.bumpkins || {};
    for (const fh of Object.values(bumpkins)) {
        const eq = fh?.equipped || {};
        if (Object.values(eq).includes(name)) return true;
    }
    return false;
}

// =============================================================================
// DESERT-DIG BOOSTS — the COMPLETE list, taken from the game source:
//   daily digs      → getRegularMaxDigs (types/desert.ts)
//   treasure prices → treasureSold.ts
//   wording         → collectibleItemBuffs.ts / bumpkinItemBuffs.ts (same text as the in-game tooltips)
// (Desert Gnome / Desert Rose are NOT dig boosts — they speed up cooking / give bonus flowers.)
// =============================================================================
const DESERT_BOOSTS = [
    { name: 'Heart of Davy Jones', kind: 'collectible', effects: ['+20 daily digs'] },
    { name: 'Meerkat',             kind: 'collectible', effects: ['+5 daily digs', '+1 Sand'] },
    { name: 'Bionic Drill',        kind: 'wearable',    effects: ['+5 daily digs'] },
    { name: 'Pharaoh Chicken',     kind: 'collectible', effects: ['+1 daily dig'] },
    { name: 'Ancient Shovel',      kind: 'wearable',    effects: ['Dig without a Sand Shovel'] },
    { name: 'Treasure Map',        kind: 'collectible', effects: ['+20% treasure sale price'] },
    { name: 'Camel',               kind: 'collectible', effects: ['+30% treasure sale price', '+1 Sand'] },
];
function getActiveDesertBoosts() {
    return DESERT_BOOSTS.filter(b => b.kind === 'wearable' ? isWearableEquipped(b.name) : isCollectibleBuilt(b.name));
}

// =============================================================================
// Sell price with boosts — matches getSellPrice from treasureSold.ts
// =============================================================================
function getSellPriceWithBoosts(itemName) {
    const base = BASE_TREASURE_PRICES[itemName];
    if (base == null) return { price: 0, boosts: [] }; // Sand, Crab, Wood, Stone etc.
    let price = base;
    const boosts = [];
    if (isCollectibleBuilt('Treasure Map')) {
        price += base * 0.2;
        boosts.push('Treasure Map +20%');
    }
    if (isCollectibleBuilt('Camel')) {
        price += base * 0.3;
        boosts.push('Camel +30%');
    }
    return { price, boosts };
}

// =============================================================================
// Chapter / Artefact detection
// =============================================================================
function getCurrentChapterName() {
    const now = new Date();
    for (const [name, dates] of Object.entries(CHAPTER_DATES)) {
        if (now >= new Date(dates.start + 'T00:00:00Z') && now < new Date(dates.end + 'T00:00:00Z')) {
            return name;
        }
    }
    return 'Ascension Age'; // fallback to latest
}

function getCurrentArtefactName() {
    return CHAPTER_ARTEFACT_MAP[getCurrentChapterName()] || 'Otter Pebble';
}

// =============================================================================
// Grid data helpers
// =============================================================================
function getHoleItem(hole) {
    if (!hole) return null;
    if (hole.items && typeof hole.items === 'object') {
        const k = Object.keys(hole.items)[0];
        if (k) return k;
    }
    if (hole.name) return hole.name;
    return null;
}

function getFlatGrid() {
    if (!currentGridData) return [];
    if (Array.isArray(currentGridData)) {
        return Array.isArray(currentGridData[0]) ? currentGridData.flat() : currentGridData;
    }
    return Object.values(currentGridData);
}

// =============================================================================
// Remaining digs — matches getRegularMaxDigs from desert.ts
// =============================================================================
function computeRegularMaxDigs() {
    let maxDigs = 25;
    // Heart of Davy Jones: +20
    if (isCollectibleBuilt('Heart of Davy Jones')) maxDigs += 20;
    // Pharaoh Chicken: +1
    if (isCollectibleBuilt('Pharaoh Chicken')) maxDigs += 1;
    // Meerkat: +5
    if (isCollectibleBuilt('Meerkat')) maxDigs += 5;
    // Bionic Drill (wearable): +5
    if (isWearableEquipped('Bionic Drill')) maxDigs += 5;
    return maxDigs;
}

function computeRemainingDigs() {
    // Number of DIGS = outer grid length (each entry may contain several holes).
    // Do NOT use getFlatGrid().length here — that counts holes, not digs, and
    // will over-count. Official source: getRemainingDigs in desert.ts.
    const dugCount = Array.isArray(currentGridData) ? currentGridData.length : 0;
    const extraDigs = currentExtraDigs || 0;

    let digsLeft = computeRegularMaxDigs() - dugCount;
    if (digsLeft < 0) digsLeft = 0;   // player bought extra digs past the cap

    return digsLeft + extraDigs;
}

function secondsTillDesertStorm() {
    const now = Date.now();
    const next = new Date(now);
    next.setUTCHours(24, 0, 0, 0);
    return Math.floor((next.getTime() - now) / 1000);
}

function formatTime(totalSecs) {
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    return `${h}h ${m}m left`;
}

function computeTreasuresFound() {
    const flat = getFlatGrid();
    return flat.filter(h => {
        const item = getHoleItem(h);
        return item && item !== 'Sand' && item !== 'Crab';
    }).length;
}

function computeArtefactsFound() {
    const flat = getFlatGrid();
    const artefact = getCurrentArtefactName();
    return flat.filter(h => getHoleItem(h) === artefact).length;
}

function hasClaimedReward() {
    const streak = currentStreak || {};
    if (!streak.collectedAt) return false;
    return new Date().toISOString().substring(0, 10) ===
        new Date(streak.collectedAt).toISOString().substring(0, 10);
}

// =============================================================================
// ALT+2: STATS BAR (top bar — no tally, tally is separate below grid)
// =============================================================================
function createStatsBar() {
    removeStatsBar();
    const wrapper = document.getElementById('sfl-grid-wrapper');
    if (!wrapper) return;
    const bar = document.createElement('div');
    bar.id = 'sfl-stats-bar';
    bar.className = 'sfl-bar';   // all styling lives in panels.css
    bar.innerHTML = buildStatsBarHTML();
    wrapper.appendChild(bar);

    // Also show tally strip below grid
    tallyStripVisible = true;
    createTallyStrip();

    // Start countdown timer
    if (statsTimerInterval) clearInterval(statsTimerInterval);
    statsTimerInterval = setInterval(() => {
        const existing = document.getElementById('sfl-stats-bar');
        if (existing) existing.innerHTML = buildStatsBarHTML();
        updateTallyStrip();
    }, 60000);
}

function iconImg(src, size) {
    size = size || 16;
    // A CSS-background <span>, NOT an <img>: the game's Tailwind base CSS gives every
    // <img> max-width:100%, which makes browsers count it as 0px wide when they size
    // shrink-wrapped boxes (icons then overflow their item and overlap the text).
    return `<span class="sfl-ico" style="width:${size}px;height:${size}px;background-image:url('${src}')"></span>`;
}
function gameIcon(name, size) { return iconImg(chrome.runtime.getURL('ITEMS/' + name), size); }
function rootIcon(name, size) { return iconImg(chrome.runtime.getURL(name), size); }

// Animation helpers for panel open/close
const PANEL_EASE = 'cubic-bezier(0.4,0,0.2,1)';
function animateIn(el, direction) {
    // Web Animations API instead of inline CSS transitions, so it can never
    // clash with the .sfl-animating layout transitions in panels.css.
    const dy = (direction === 'up') ? 16 : -16;
    el.animate(
        [{ transform: `translateY(${dy}px)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
        { duration: 350, easing: PANEL_EASE }
    );
}
function animateOutAndRemove(el, direction, done) {
    if (!el) { if (done) done(); return; }
    // Mark as leaving: refitAllPanels() stops counting it, so the panel that
    // stays starts growing into the freed space IMMEDIATELY (in sync with the fade).
    el.dataset.leaving = '1';
    el.style.pointerEvents = 'none';
    refitAllPanels();   // the sibling panel starts growing into the freed space now
    const dy = (direction === 'up') ? -16 : 16;
    el.animate(
        [{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${dy}px)`, opacity: 0 }],
        { duration: 350, easing: PANEL_EASE, fill: 'forwards' }
    );
    setTimeout(() => {
        el.remove();
        if (!document.querySelector('.sfl-side-panel:not(.sfl-measuring)')) { removeFitProbe(); teardownOverlayLayer(); }
        if (done) done();
    }, 360);
}

function buildStatsBarHTML() {
    const digsLeft = computeRemainingDigs();
    const timeLeft = formatTime(secondsTillDesertStorm());   // already reads "16h 37m left"
    const treasures = computeTreasuresFound();
    const artefacts = computeArtefactsFound();
    const streak = currentStreak || {};
    const claimed = hasClaimedReward();

    // One item = icon + text, kept together (flex gap) so an icon can never sit on top of text.
    const item = (color, icon, text) =>
        `<span class="sfl-bar-item" style="color:${color}">${icon}<span>${text}</span></span>`;

    return item('#60a5fa', rootIcon('sand_shovel.png', 22), `${digsLeft} digs left`) +
        item('#c084fc', gameIcon('stopwatch.png', 22), timeLeft) +
        item('#fbbf24', gameIcon('pirate_bounty.webp', 22), `${treasures} treasures`) +
        item('#f472b6', gameIcon('otter_pebble.webp', 22), `${artefacts}/3 artefacts`) +
        // min-width reserves room for 3 digits, so a streak of 100+ never squeezes the bar
        item('#34d399', gameIcon('happy.png', 22), `Streak <span class="sfl-bar-num">${streak.count || 0}</span>`);
}

function removeStatsBar() {
    const el = document.getElementById('sfl-stats-bar');
    if (el) el.remove();
    if (statsTimerInterval) { clearInterval(statsTimerInterval); statsTimerInterval = null; }
    tallyStripVisible = false;
    removeTallyStrip();
}

function updateStatsBar() {
    const el = document.getElementById('sfl-stats-bar');
    if (el) el.innerHTML = buildStatsBarHTML();
    if (tallyStripVisible) updateTallyStrip();
}

// =============================================================================
// TALLY STRIP — separate pill-shaped row below the grid
// =============================================================================
function createTallyStrip() {
    removeTallyStrip();
    const strip = document.createElement('div');
    strip.id = 'sfl-tally-strip';
    // Position below the grid wrapper
    const wrapper = document.getElementById('sfl-grid-wrapper');
    if (wrapper) {
        strip.style.cssText = 'position:absolute;bottom:-36px;left:50%;transform:translateX(-50%);z-index:10000;display:flex;gap:12px;padding:6px 16px;background:rgba(15,23,42,0.45);backdrop-filter:blur(16px) saturate(140%);-webkit-backdrop-filter:blur(16px) saturate(140%);box-shadow:0 0 0 0.5px rgba(255,255,255,0.2) inset, 0 1px 4px rgba(255,255,255,0.1) inset, 0 4px 16px rgba(0,0,0,0.4), 0 12px 40px rgba(0,0,0,0.25);color:#fff;font:14px/1.4 monospace;border-radius:12px;pointer-events:none;white-space:nowrap;';
        wrapper.appendChild(strip);
    } else {
        // Fallback: fixed at bottom center
        strip.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:10000;display:flex;gap:12px;padding:6px 16px;background:rgba(15,23,42,0.45);backdrop-filter:blur(16px) saturate(140%);-webkit-backdrop-filter:blur(16px) saturate(140%);box-shadow:0 0 0 0.5px rgba(255,255,255,0.2) inset, 0 1px 4px rgba(255,255,255,0.1) inset, 0 4px 16px rgba(0,0,0,0.4), 0 12px 40px rgba(0,0,0,0.25);color:#fff;font:14px/1.4 monospace;border-radius:12px;pointer-events:none;white-space:nowrap;';
        document.body.appendChild(strip);
    }
    strip.innerHTML = buildTallyHTML();
}

function buildTallyHTML() {
    if (lastSolvedBoard && lastSolvedBoard.tally) {
        const t = lastSolvedBoard.tally;
        return `<span style="color:#4ade80">${t.guaranteed} sure digs</span>` +
            `<span style="color:#94a3b8">·</span>` +
            `<span style="color:#facc15">${t.possible} maybes</span>` +
            `<span style="color:#94a3b8">·</span>` +
            `<span style="color:#ef4444">${t.empty} safe-empty</span>`;
    }
    return '<span style="color:#6b7280">No solver data yet</span>';
}

function removeTallyStrip() {
    const el = document.getElementById('sfl-tally-strip');
    if (el) el.remove();
}

function updateTallyStrip() {
    const el = document.getElementById('sfl-tally-strip');
    if (el) el.innerHTML = buildTallyHTML();
}

// =============================================================================
// ALT+3: HINTS PANEL — documents THIS extension's actual CSS tile colors
// =============================================================================
function buildHintsPanelHTML() {
    const colors = [
        {
            color: 'rgba(239, 68, 68, 0.35)', border: null,
            title: 'Sand', desc: 'Could be a Crab or Sand until guaranteed.'
        },
        {
            color: 'rgba(234, 179, 8, 0.35)', border: null,
            title: 'Crab', desc: 'Found a crab — treasure is adjacent.'
        },
        {
            color: 'rgba(14, 165, 233, 0.50)', border: 'rgba(56, 189, 248, 0.4)',
            title: 'Treasure', desc: 'Found a misc treasure item.'
        },
        {
            color: 'rgba(34, 197, 94, 0.6)', border: '#86efac',
            title: 'Artefact', desc: 'Bone-category item. Pulses.', pulse: true
        },
    ];

    let html = '<div class="sfl-ptitle">How the colours work</div>';
    html += '<div class="sfl-psub">Solver Predictions</div>';
    html += '<div class="sfl-legend">';
    for (const c of colors) {
        const borderStyle = c.border ? `border:1px solid ${c.border};` : '';
        html += `<div class="sfl-legend-row">` +
            `<span class="sfl-swatch${c.pulse ? ' pulse' : ''}" style="background:${c.color};${borderStyle}"></span>` +
            `<div><div class="sfl-legend-name">${c.title}${c.pulse ? ' 💚' : ''}</div>` +
            `<div class="sfl-legend-desc">${c.desc}</div></div></div>`;
    }
    html += '</div>';
    return html;
}

function createHintsPanel() {
    // Immediate remove (not animated) when replacing
    const old = document.getElementById('sfl-hints-panel');
    if (old) old.remove();
    const wrapper = document.getElementById('sfl-grid-wrapper');
    if (!wrapper) return;
    const panel = document.createElement('div');
    panel.id = 'sfl-hints-panel';
    panel.className = 'sfl-side-panel sfl-side-panel-right';   // all styling lives in panels.css
    panel.dataset.panelSide = 'right';
    panel._born = performance.now();
    panel.innerHTML = panelBody(buildHintsPanelHTML(), 'evenly');
    ensureOverlayLayer(wrapper).appendChild(panel);   // lives in the overlay layer (see ensureOverlayLayer)
    refitAllPanels();            // slot + size + content scale, before the first paint
    animateIn(panel, 'down');
    startPanelTracking();
}

function removeHintsPanel() {
    const el = document.getElementById('sfl-hints-panel');
    animateOutAndRemove(el, 'up');
}

// =============================================================================
// ALT+4: PATTERNS PANEL
// =============================================================================
function humanizeFormationName(key) {
    return key.toLowerCase().replace(/_/g, ' ').replace(/\bformation\b/g, '').trim().replace(/\b\w/g, c => c.toUpperCase());
}

function getFormationPlots(patName) {
    const DIGGING_FORMATIONS = {
        MONDAY_ARTEFACT_FORMATION: [{ x: 0, y: -1, name: "Camel Bone" }, { x: 1, y: -1, name: "Seasonal Artefact" }],
        TUESDAY_ARTEFACT_FORMATION: [{ x: 1, y: 0, name: "Seasonal Artefact" }, { x: 1, y: 2, name: "Camel Bone" }],
        WEDNESDAY_ARTEFACT_FORMATION: [{ x: 0, y: 0, name: "Camel Bone" }, { x: 1, y: 0, name: "Seasonal Artefact" }],
        THURSDAY_ARTEFACT_FORMATION: [{ x: 0, y: 0, name: "Camel Bone" }, { x: 1, y: -1, name: "Seasonal Artefact" }],
        FRIDAY_ARTEFACT_FORMATION: [{ x: 2, y: 0, name: "Camel Bone" }, { x: 3, y: 0, name: "Seasonal Artefact" }],
        SATURDAY_ARTEFACT_FORMATION: [{ x: 1, y: 0, name: "Seasonal Artefact" }, { x: 1, y: -1, name: "Camel Bone" }],
        SUNDAY_ARTEFACT_FORMATION: [{ x: 0, y: -2, name: "Seasonal Artefact" }],
        ARTEFACT_ONE: [{ x: 0, y: 0, name: "Seasonal Artefact" }, { x: 0, y: 1, name: "Camel Bone" }, { x: 0, y: 2, name: "Camel Bone" }],
        ARTEFACT_TWO: [{ x: 0, y: 0, name: "Seasonal Artefact" }, { x: 1, y: 0, name: "Camel Bone" }, { x: 0, y: 2, name: "Camel Bone" }],
        ARTEFACT_THREE: [{ x: 0, y: 0, name: "Seasonal Artefact" }],
        ARTEFACT_FOUR: [{ x: 0, y: 0, name: "Seasonal Artefact" }, { x: 0, y: 1, name: "Camel Bone" }, { x: 0, y: 2, name: "Camel Bone" }, { x: 0, y: 3, name: "Camel Bone" }],
        ARTEFACT_FIVE: [{ x: 0, y: 0, name: "Seasonal Artefact" }, { x: -1, y: 0, name: "Camel Bone" }, { x: -2, y: 0, name: "Camel Bone" }],
        ARTEFACT_SIX: [{ x: 0, y: 0, name: "Seasonal Artefact" }, { x: -1, y: 0, name: "Camel Bone" }, { x: -2, y: -1, name: "Camel Bone" }],
        ARTEFACT_SEVEN: [{ x: 0, y: 0, name: "Seasonal Artefact" }, { x: 1, y: 1, name: "Camel Bone" }],
        ARTEFACT_EIGHT: [{ x: 0, y: 0, name: "Seasonal Artefact" }, { x: 1, y: 0, name: "Camel Bone" }, { x: 0, y: 2, name: "Camel Bone" }],
        ARTEFACT_NINE: [{ x: 0, y: 0, name: "Seasonal Artefact" }, { x: 0, y: 1, name: "Camel Bone" }, { x: 0, y: -1, name: "Camel Bone" }, { x: -1, y: -1, name: "Camel Bone" }],
        ARTEFACT_TEN: [{ x: 0, y: 0, name: "Seasonal Artefact" }, { x: 0, y: 1, name: "Camel Bone" }, { x: -1, y: 0, name: "Camel Bone" }, { x: -1, y: 1, name: "Camel Bone" }],
        ARTEFACT_ELEVEN: [{ x: 0, y: 0, name: "Seasonal Artefact" }, { x: 0, y: 1, name: "Camel Bone" }, { x: 1, y: 1, name: "Camel Bone" }],
        ARTEFACT_TWELVE: [{ x: 0, y: 0, name: "Seasonal Artefact" }, { x: 0, y: 1, name: "Camel Bone" }, { x: -1, y: 1, name: "Camel Bone" }, { x: 1, y: 1, name: "Camel Bone" }],
        ARTEFACT_THIRTEEN: [{ x: 0, y: 0, name: "Seasonal Artefact" }, { x: 2, y: 0, name: "Camel Bone" }],
        ARTEFACT_FOURTEEN: [{ x: 0, y: 0, name: "Seasonal Artefact" }, { x: 0, y: 2, name: "Camel Bone" }],
        ARTEFACT_FIFTEEN: [{ x: 0, y: 0, name: "Camel Bone" }, { x: 1, y: 0, name: "Seasonal Artefact" }, { x: 2, y: 0, name: "Camel Bone" }],
        ARTEFACT_SIXTEEN: [{ x: 0, y: 0, name: "Seasonal Artefact" }, { x: 1, y: 0, name: "Camel Bone" }, { x: 1, y: 1, name: "Camel Bone" }],
        ARTEFACT_SEVENTEEN: [{ x: 0, y: 0, name: "Camel Bone" }, { x: 1, y: 0, name: "Camel Bone" }, { x: 1, y: 1, name: "Seasonal Artefact" }],
        ARTEFACT_EIGHTEEN: [{ x: 0, y: 0, name: "Seasonal Artefact" }, { x: 1, y: 0, name: "Camel Bone" }, { x: 0, y: 1, name: "Camel Bone" }, { x: 1, y: 1, name: "Camel Bone" }],
        ARTEFACT_NINETEEN: [{ x: 0, y: 0, name: "Camel Bone" }, { x: 1, y: 0, name: "Camel Bone" }, { x: 2, y: 0, name: "Camel Bone" }, { x: 1, y: 1, name: "Seasonal Artefact" }],
        ARTEFACT_TWENTY: [{ x: 0, y: 0, name: "Camel Bone" }, { x: 1, y: 0, name: "Camel Bone" }, { x: 0, y: 1, name: "Seasonal Artefact" }, { x: 1, y: 1, name: "Camel Bone" }],
        ARTEFACT_TWENTY_ONE: [{ x: 0, y: 0, name: "Seasonal Artefact" }, { x: 1, y: 0, name: "Camel Bone" }, { x: 2, y: 0, name: "Camel Bone" }, { x: 0, y: 1, name: "Camel Bone" }, { x: 1, y: 1, name: "Camel Bone" }],
        ARTEFACT_TWENTY_TWO: [{ x: 0, y: 0, name: "Camel Bone" }, { x: 1, y: 0, name: "Camel Bone" }, { x: 2, y: 0, name: "Camel Bone" }, { x: 0, y: 1, name: "Camel Bone" }, { x: 1, y: 1, name: "Seasonal Artefact" }],
        ARTEFACT_TWENTY_THREE: [{ x: 0, y: 0, name: "Camel Bone" }, { x: 1, y: 0, name: "Camel Bone" }, { x: 2, y: 0, name: "Camel Bone" }, { x: 1, y: 1, name: "Camel Bone" }, { x: 2, y: 1, name: "Seasonal Artefact" }],
        ARTEFACT_TWENTY_FOUR: [{ x: 0, y: 0, name: "Camel Bone" }, { x: 1, y: 0, name: "Seasonal Artefact" }, { x: 2, y: 0, name: "Camel Bone" }, { x: 0, y: 1, name: "Camel Bone" }, { x: 2, y: 1, name: "Camel Bone" }],
        HIEROGLYPH: [{ x: 0, y: 0, name: "Vase" }, { x: 1, y: 0, name: "Vase" }, { x: 0, y: 1, name: "Hieroglyph" }],
        OLD_BOTTLE: [{ x: 0, y: 0, name: "Old Bottle" }, { x: 1, y: 0, name: "Old Bottle" }, { x: 0, y: 1, name: "Old Bottle" }, { x: 1, y: 1, name: "Old Bottle" }],
        COCKLE: [{ x: 0, y: 0, name: "Cockle Shell" }, { x: 1, y: 1, name: "Cockle Shell" }, { x: 2, y: 2, name: "Cockle Shell" }],
        WOODEN_COMPASS: [{ x: 0, y: 0, name: "Wood" }, { x: 1, y: 0, name: "Wooden Compass" }, { x: 2, y: 0, name: "Wood" }],
        SEA_CUCUMBERS: [{ x: 0, y: 0, name: "Sea Cucumber" }, { x: 1, y: 0, name: "Sea Cucumber" }, { x: 2, y: 0, name: "Sea Cucumber" }, { x: 3, y: 0, name: "Pipi" }],
        SEAWEED: [{ x: 0, y: 0, name: "Seaweed" }, { x: 1, y: 0, name: "Seaweed" }, { x: 2, y: 0, name: "Seaweed" }, { x: 2, y: 1, name: "Starfish" }],
        CLAM_SHELLS: [{ x: 0, y: 0, name: "Clam Shell" }, { x: 1, y: 0, name: "Clam Shell" }, { x: 0, y: -1, name: "Clam Shell" }, { x: 1, y: -1, name: "Clam Shell" }],
        CORAL: [{ x: 0, y: 1, name: "Stone" }, { x: 0, y: 0, name: "Coral" }, { x: 0, y: -1, name: "Stone" }],
        PEARL: [{ x: 0, y: 1, name: "Stone" }, { x: 0, y: 0, name: "Pearl" }, { x: 0, y: -1, name: "Stone" }],
        PIRATE_BOUNTY: [{ x: 0, y: 0, name: "Pirate Bounty" }],
    };
    return DIGGING_FORMATIONS[patName] || [];
}

function getIconForFormationItem(itemName) {
    if (!itemName) return null;
    const map = {
        'camel bone': 'camel_bone.webp', 'clam shell': 'clam_shell.webp',
        'cockle shell': 'cockle_shell.webp',
        'coral': 'coral.png', 'crab': 'crab.png', 'hieroglyph': 'hieroglyph.webp', 'old bottle': 'old_bottle.png',
        'otter pebble': 'otter_pebble.webp', 'pearl': 'pearl.webp', 'pipi': 'pipi.webp',
        'salt dino egg': 'salt_dino_egg.webp', 'sand': 'sand.webp', 'sea cucumber': 'sea_cucumber.png',
        'seaweed': 'seaweed.webp', 'starfish': 'starfish.png', 'stone': 'stone.png',
        'vase': 'vase.webp', 'wood': 'wood.png', 'wooden compass': 'wooden_compass.webp',
        // Artefact icons — only those with actual files in ITEMS/
        'cow skull': 'sand.webp', 'scarab': 'sand.webp', 'ancient clock': 'sand.webp',
        'broken pillar': 'sand.webp', 'coprolite': 'sand.webp', 'moon crystal': 'sand.webp',
        'ammonite shell': 'sand.webp',
    };
    let key = itemName.toLowerCase().trim();
    // Dynamic artefact resolution — resolve "Seasonal Artefact" to the current chapter's actual item
    if (key === 'seasonal artefact') {
        key = getCurrentArtefactName().toLowerCase();
    }
    return map[key] || 'sand.webp';
}

function renderMiniGrid(plots) {
    if (!plots || plots.length === 0) return '';
    const xs = plots.map(p => p.x), ys = plots.map(p => p.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const maxX = Math.max(...xs), maxY = Math.max(...ys);
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const plotMap = {};
    for (const p of plots) plotMap[`${p.x - minX},${p.y - minY}`] = p.name || 'Unknown';

    // Cell size comes from --sfl-cell in panels.css (scales with the panel).
    let html = `<div class="sfl-mini" style="--cols:${w};--rows:${h}">`;
    for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
            const itemName = plotMap[`${c},${r}`];
            if (itemName) {
                const icon = getIconForFormationItem(itemName);
                html += `<div class="sfl-mcell on"><img src="${chrome.runtime.getURL('ITEMS/' + icon)}" title="${itemName}" alt=""></div>`;
            } else {
                html += '<div class="sfl-mcell"></div>';
            }
        }
    }
    return html + '</div>';
}

function createFormationsPanel() {
    // Immediate remove (not animated) when replacing
    const old = document.getElementById('sfl-patterns-panel');
    if (old) old.remove();
    const wrapper = document.getElementById('sfl-grid-wrapper');
    if (!wrapper) return;
    const panel = document.createElement('div');
    panel.id = 'sfl-patterns-panel';
    panel.className = 'sfl-side-panel sfl-side-panel-right';
    panel.dataset.panelSide = 'right';
    panel._born = performance.now();
    panel.innerHTML = panelBody(buildPatternsPanelHTML(), 'center');
    ensureOverlayLayer(wrapper).appendChild(panel);   // lives in the overlay layer (see ensureOverlayLayer)
    refitAllPanels();
    animateIn(panel, 'up');
    startPanelTracking();
}

function buildFormationCard(patName, isCompleted) {
    const coords = getFormationPlots(patName);
    if (!coords || coords.length === 0) return '';

    let minX = 0, minY = 0, maxX = 0, maxY = 0;
    for (const c of coords) {
        if (c.x < minX) minX = c.x;
        if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.y > maxY) maxY = c.y;
    }
    const cols = maxX - minX + 1;
    const rows = maxY - minY + 1;

    let gridHTML = `<div style="display:grid;grid-template-columns:repeat(${cols}, 14px);grid-template-rows:repeat(${rows}, 14px);gap:2px;margin:8px auto;">`;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const worldX = c + minX;
            const worldY = r + minY;
            const item = coords.find(pt => pt.x === worldX && pt.y === worldY);
            let bg = 'rgba(255,255,255,0.05)';
            if (item) {
                if (item.name === 'Seasonal Artefact') bg = isCompleted ? '#831843' : '#f472b6';
                else bg = isCompleted ? '#3f3f46' : '#a1a1aa';
            }
            gridHTML += `<div style="width:14px;height:14px;background:${bg};border-radius:2px;"></div>`;
        }
    }
    gridHTML += `</div>`;

    const name = humanizeFormationName(patName);
    const opacity = isCompleted ? '0.5' : '1';
    const textColor = isCompleted ? '#64748b' : '#e2e8f0';
    const textDecor = isCompleted ? 'line-through' : 'none';

    return `<div style="background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px;text-align:center;display:flex;flex-direction:column;justify-content:center;opacity:${opacity};">
        <div style="font-size:12px;font-weight:bold;color:${textColor};text-decoration:${textDecor};margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
        ${gridHTML}
    </div>`;
}

function buildPatternsPanelHTML() {
    let html = '<div class="sfl-ptitle">Known Formations</div>';

    if (!currentPatterns || currentPatterns.length === 0) {
        html += '<div class="sfl-muted sfl-empty">No pattern data — sync farm first.</div>';
        return html;
    }

    // How many times each formation name appears in completedPatterns —
    // needed because the SAME name can appear more than once in currentPatterns
    // (two separate board instances of one formation), and only the first N
    // occurrences (N = how many times it's actually been completed) should
    // render as done.
    const completedCounts = {};
    for (const p of currentCompletedPatterns) {
        completedCounts[p] = (completedCounts[p] || 0) + 1;
    }
    const seenSoFar = {};

    // Same occurrence counting for solver-predicted completions
    const predictedCounts = {};
    const uniquePatterns = [...new Set(currentPatterns)];
    for (const p of uniquePatterns) {
        const n = countPatternSolverComplete(p);
        if (n > 0) predictedCounts[p] = n;
    }
    const predictedSeenSoFar = {};

    html += '<div class="sfl-formations">';
    for (const pat of currentPatterns) {
        seenSoFar[pat] = (seenSoFar[pat] || 0) + 1;
        const isCompleted = seenSoFar[pat] <= (completedCounts[pat] || 0);

        const isPredicted = !isCompleted && (predictedSeenSoFar[pat] || 0) < (predictedCounts[pat] || 0);
        if (isPredicted) predictedSeenSoFar[pat] = (predictedSeenSoFar[pat] || 0) + 1;
        const miniGrid = renderMiniGrid(getFormationPlots(pat));

        let check = '';
        if (isCompleted) check = '<div class="sfl-mcheck">✓</div>';
        else if (isPredicted) check = '<div class="sfl-mcheck predicted">✓</div>';

        html += `<div class="sfl-fcard">${miniGrid}${check}</div>`;
    }
    html += '</div>';
    return html;
}

// Count how many board instances of a formation are solver-guaranteed
function countPatternSolverComplete(patName) {
    if (!lastSolvedBoard || !lastSolvedBoard.cells) return 0;
    const plots = getFormationPlots(patName);
    if (!plots || plots.length === 0) return 0;
    const artefact = getCurrentArtefactName();
    const sc = lastSolvedBoard.cells;
    const xs = plots.map(p => p.x), ys = plots.map(p => p.y);
    const mnX = Math.min(...xs), mxX = Math.max(...xs);
    const mnY = Math.min(...ys), mxY = Math.max(...ys);
    let count = 0;
    for (let dx = -mnX; dx <= 9 - mxX; dx++) {
        for (let dy = -mnY; dy <= 9 - mxY; dy++) {
            let allMatch = true;
            for (const p of plots) {
                const gx = p.x + dx, gy = p.y + dy;
                if (gx < 0 || gx > 9 || gy < 0 || gy > 9) { allMatch = false; break; }
                const cell = sc[gy][gx];
                const expectedItem = p.name === 'Seasonal Artefact' ? artefact : p.name;
                if (cell.dug) {
                    if (cell.item !== expectedItem) { allMatch = false; break; }
                } else if (cell.status === 'guaranteed' && cell.predicted) {
                    if (cell.predicted.item !== expectedItem) { allMatch = false; break; }
                } else {
                    allMatch = false; break;
                }
            }
            if (allMatch) count++;
        }
    }
    return count;
}
// Backwards-compatible wrapper for any other callers
function isPatternSolverComplete(patName) { return countPatternSolverComplete(patName) > 0; }

function removeFormationsPanel() {
    const el = document.getElementById('sfl-patterns-panel');
    animateOutAndRemove(el, 'down');
}

function updatePatternsPanel() {
    const el = document.getElementById('sfl-patterns-panel');
    if (el && !el.dataset.leaving) setPanelContent(el, buildPatternsPanelHTML());
}

// =============================================================================
// ALT+5: TREASURE STAT PANEL — two sections separated by visible line
// Section 1: Exchange rates (from sfl.world Exchange API)
// Section 2: Treasure stats (earnings, tool costs, per-item breakdown)
// =============================================================================
function createTreasureStatPanel() {
    // Immediate remove (not animated) when replacing
    const old = document.getElementById('sfl-treasure-stat-panel');
    if (old) old.remove();
    const wrapper = document.getElementById('sfl-grid-wrapper');
    if (!wrapper) return;
    const panel = document.createElement('div');
    panel.id = 'sfl-treasure-stat-panel';
    panel.className = 'sfl-side-panel sfl-side-panel-left';
    panel.dataset.panelSide = 'left';
    panel._born = performance.now();
    panel.innerHTML = panelBody(buildTreasureStatHTML(), 'between');
    ensureOverlayLayer(wrapper).appendChild(panel);   // lives in the overlay layer (see ensureOverlayLayer)
    refitAllPanels();
    animateIn(panel, 'down');
    startPanelTracking();

    // Fetch prices and exchange rates if not cached
    if (!cachedP2PPrices) fetchP2PPrices();
    if (!cachedExchangeRates) fetchExchangeRates();
}

const COINS_PER_FLOWER = 1515.52;

function getItemIconFile(itemName) {
    return getIconForFormationItem(itemName);
}
function itemIcon(itemName, size) {
    const file = getItemIconFile(itemName);
    return gameIcon(file, size || 14);
}

function buildActiveBoostsHTML() {
    const boosts = getActiveDesertBoosts();
    let html = '<section class="sfl-block"><div class="sfl-sec">Active Boosts</div>';
    if (boosts.length === 0) {
        html += '<div class="sfl-muted">No desert boosts active</div>';
    } else {
        for (const b of boosts) {
            html += `<div class="sfl-boost-row"><span class="sfl-boost-name">${b.name}</span>` +
                `<span class="sfl-boost-fx">${b.effects.map(x => `<span>${x}</span>`).join('')}</span></div>`;
        }
    }
    return html + '</section>';
}

function buildTreasureStatHTML() {
    const ci = pGameIcon('coins.webp');
    const fi = pGameIcon('flower.webp');
    const si = pRootIcon('sand_shovel.png');

    // ── Section 1: Exchange Rates ──
    let html = '<section class="sfl-block sfl-block-ruled">';
    html += '<div class="sfl-sec">Exchange Rates</div>';
    html += '<table class="sfl-tbl"><thead><tr><th class="item">Pair</th><th class="n">Rate</th></tr></thead><tbody>';
    html += `<tr><td class="item">${ci}${COINS_PER_FLOWER} Coins</td><td class="n">= 1 ${fi}$flower</td></tr>`;
    html += '</tbody></table></section>';

    // ── Section 2: Treasure Stat ──
    html += '<section class="sfl-block"><div class="sfl-sec">Treasure Stat</div>';

    const synced = Array.isArray(currentGridData);
    const flat = getFlatGrid();
    if (!synced) {
        html += '<div class="sfl-muted sfl-empty">No dig data — sync a farm first.</div></section>';
        return html;
    }
    if (flat.length === 0) {
        // synced, nothing dug yet — the boosts are still worth showing
        html += '<div class="sfl-muted sfl-empty">No digs yet today.</div></section>';
        html += buildActiveBoostsHTML();
        return html;
    }

    // Count items and compute boosted sell prices
    const itemCounts = {};
    for (const hole of flat) {
        const item = getHoleItem(hole);
        if (item) itemCounts[item] = (itemCounts[item] || 0) + 1;
    }

    let totalCoins = 0;
    const treasureRows = [];
    for (const [item, count] of Object.entries(itemCounts)) {
        const { price } = getSellPriceWithBoosts(item);
        const sum = price * count;
        totalCoins += sum;
        if (price > 0) {
            treasureRows.push({ item, count, price, sum });
        }
    }
    treasureRows.sort((a, b) => b.sum - a.sum);

    const totalDigs = flat.length;

    // Tool cost calculation using COINS_PER_FLOWER
    const coinToFlower = 1 / COINS_PER_FLOWER;
    let toolCostFlower = null;
    let toolCostPerDig = null;
    let profitCoins = null;

    if (cachedP2PPrices) {
        const woodP2P = cachedP2PPrices['Wood'] || 0;
        const stoneP2P = cachedP2PPrices['Stone'] || 0;
        const shovelFlowerCost = (20 * coinToFlower) + (2 * woodP2P) + (1 * stoneP2P);
        toolCostFlower = shovelFlowerCost * totalDigs;
        toolCostPerDig = shovelFlowerCost;
        profitCoins = totalCoins - (toolCostFlower / coinToFlower);
    }

    html += `<div class="sfl-kv"><span>Coins earned</span><strong class="c-gold">${ci}${totalCoins.toLocaleString()}</strong></div>`;
    const flowerVal = (totalCoins * coinToFlower).toFixed(4);
    html += `<div class="sfl-note">= ${flowerVal} ${fi}$flower (1:${COINS_PER_FLOWER})</div>`;

    if (toolCostFlower !== null) {
        html += `<div class="sfl-kv"><span>Tools cost (P2P)</span><strong class="c-red">${fi}${toolCostFlower.toFixed(4)}</strong></div>`;
        html += `<div class="sfl-kv"><span>Profit</span><strong class="${profitCoins >= 0 ? 'c-green' : 'c-red'}">${ci}${Math.round(profitCoins).toLocaleString()}</strong></div>`;
    } else {
        html += '<div class="sfl-kv"><span>Tools cost (P2P)</span><span class="sfl-muted">N/A — loading prices…</span></div>';
        html += '<div class="sfl-kv"><span>Profit</span><span class="sfl-muted">N/A</span></div>';
    }
    html += `<div class="sfl-kv"><span>Total digs</span><strong>${si}${totalDigs}</strong></div>`;
    html += '</section>';

    // ── Section 3: Active Boosts ──
    html += buildActiveBoostsHTML();

    // Per-tool table
    html += '<section class="sfl-block"><div class="sfl-sec">Tool costs</div>';
    html += '<table class="sfl-tbl"><thead><tr><th class="item">Tool</th><th class="n">×</th><th class="n">Cost P2P</th><th class="n">Per dig</th></tr></thead><tbody>';
    html += `<tr><td class="item">${si}Sand Shovel</td><td class="n">${totalDigs}</td>`;
    if (toolCostFlower !== null) {
        html += `<td class="n">${fi}${toolCostFlower.toFixed(4)}</td><td class="n">${fi}${toolCostPerDig.toFixed(4)}</td>`;
    } else {
        html += '<td class="n">N/A</td><td class="n">N/A</td>';
    }
    html += '</tr></tbody></table></section>';

    // Per-treasure table with item icons
    html += '<section class="sfl-block"><div class="sfl-sec">Treasures found</div>';
    html += '<table class="sfl-tbl"><thead><tr><th class="item">Item</th><th class="n">#</th><th class="n">Each</th><th class="n">Sum</th></tr></thead><tbody>';
    for (const row of treasureRows) {
        html += `<tr><td class="item">${pItemIcon(row.item)}${row.item}</td><td class="n">${row.count}</td>` +
            `<td class="n">${ci}${row.price}</td><td class="n">${ci}${row.sum.toLocaleString()}</td></tr>`;
    }
    html += '</tbody></table></section>';

    return html;
}

function removeTreasureStatPanel() {
    const el = document.getElementById('sfl-treasure-stat-panel');
    animateOutAndRemove(el, 'down');
}

function updateTreasureStatPanel() {
    const el = document.getElementById('sfl-treasure-stat-panel');
    if (el && !el.dataset.leaving) setPanelContent(el, buildTreasureStatHTML());
}

function fetchP2PPrices() {
    chrome.runtime.sendMessage({ action: 'fetch_sfl_prices' }, (response) => {
        if (chrome.runtime.lastError) {
            console.warn('[SFL] P2P price fetch failed:', chrome.runtime.lastError.message);
            return;
        }
        if (response && response.success && response.data) {
            cachedP2PPrices = response.data;
            updateTreasureStatPanel();
            console.log('[SFL] P2P prices loaded:', Object.keys(cachedP2PPrices).length, 'items');
        } else {
            console.warn('[SFL] P2P price fetch returned no data:', response?.error);
        }
    });
}

function fetchExchangeRates() {
    chrome.runtime.sendMessage({ action: 'fetch_sfl_exchange' }, (response) => {
        if (chrome.runtime.lastError) {
            console.warn('[SFL] Exchange rate fetch failed:', chrome.runtime.lastError.message);
            return;
        }
        if (response && response.success && response.data) {
            cachedExchangeRates = response.data;
            updateTreasureStatPanel();
            console.log('[SFL] Exchange rates loaded');
        } else {
            console.warn('[SFL] Exchange rate fetch returned no data:', response?.error);
        }
    });
}

// =============================================================================
// VIEWPORT FIT — positions fixed panels relative to the grid wrapper rect
// =============================================================================
// =============================================================================
// FLUID PANEL ENGINE
//
// Goal: panel content (text, icons, formation grids…) always uses ALL the space
// its panel has — and re-adapts, animated, whenever that space changes.
//
//   1. positionPanel()       decides the panel's box (top/left/width/height) in the grid
//                            wrapper's own coordinates — panels are the wrapper's children.
//   2. fitPanel()            finds the biggest content scale --sfl-s (a CSS
//                            variable, see panels.css) that still fits that box.
//   3. CSS does the rest: every size in a panel is em / var(--sfl-u) based, and
//                            --sfl-s is transitioned, so it animates smoothly.
//
// Why not transform:scale()? It blurs text, can't re-wrap lines, and doesn't
// change layout size. Scaling real font sizes keeps everything crisp.
// =============================================================================
const PANEL_EDGE = 4;          // px  min distance from the viewport edge
const PANEL_MIN_W = 240;       // px  narrowest a side panel may get
const PANEL_MAX_W = 460;       // px  widest a side panel may get
const PANEL_ROW_GAP = 6;       // px  gap between the two stacked right-hand panels
const FIT_S_MIN = 0.55;        //     smallest content scale (below → panel scrolls)
const FIT_S_MAX = 2.2;         //     biggest content scale
const FIT_S_EMPTY_MAX = 1.2;   //     biggest scale for "no data yet" placeholder screens
const FIT_THROTTLE_MS = 90;    //     min time between re-fits while the grid moves/zooms

// Icons for panels — sized in em by CSS, so they always match the text next to them.
// CSS-background spans (not <img>) — see the note on iconImg() for why.
function pIcon(src) { return `<span class="sfl-ic" style="background-image:url('${src}')"></span>`; }
function pGameIcon(name) { return pIcon(chrome.runtime.getURL('ITEMS/' + name)); }
function pRootIcon(name) { return pIcon(chrome.runtime.getURL(name)); }
function pItemIcon(itemName) { return pGameIcon(getIconForFormationItem(itemName)); }

// Every panel is:  .sfl-side-panel > .sfl-pfit > .sfl-pcontent > (your HTML)
// align = how leftover space is shared: 'start' | 'between' | 'evenly' | 'center'
function panelBody(html, align) {
    return `<div class="sfl-pfit"><div class="sfl-pcontent sfl-jc-${align || 'start'}">${html}</div></div>`;
}

// Swap a panel's content (after new data) and re-fit it.
function setPanelContent(panel, html) {
    const c = panel.querySelector('.sfl-pcontent');
    if (c) c.innerHTML = html;
    fitPanel(panel);
}

// Turns on the box transition for a moment (slot changes: hints closed, etc.)
function beginPanelTransition(panel, ms) {
    panel.classList.add('sfl-animating');
    clearTimeout(panel._animTimer);
    panel._animTimer = setTimeout(() => panel.classList.remove('sfl-animating'), ms || 450);
}

// A hidden clone of the panel, used to measure without disturbing the real one.
let _fitProbe = null;
function getFitProbe() {
    if (!_fitProbe || !_fitProbe.isConnected) {
        _fitProbe = document.createElement('div');
        _fitProbe.className = 'sfl-side-panel sfl-measuring';
        _fitProbe.setAttribute('aria-hidden', 'true');
        document.body.appendChild(_fitProbe);
    }
    return _fitProbe;
}
function removeFitProbe() {
    if (_fitProbe) { _fitProbe.remove(); _fitProbe = null; }
}

// Finds the largest --sfl-s at which the panel's content fits its (target) box.
// NOTE: content height is NOT strictly monotonic in the scale (flex-wrap makes it
// jump: e.g. 2 rows of cards at 1.00 but 3 rows at 1.03), so a plain binary search
// can land on a cliff. Instead: scan down in ~4% steps until something fits, refine
// with a short bisection, round DOWN, and verify the exact value we apply.
// Runs only when the box or the content changes.
function fitPanel(panel) {
    if (!panel || !panel.isConnected || !panel._tw || !panel._th) return;
    const live = panel.querySelector('.sfl-pfit');
    if (!live) return;

    const probe = getFitProbe();
    probe.style.width = panel._tw + 'px';
    probe.style.height = panel._th + 'px';
    probe.innerHTML = live.outerHTML;
    const box = probe.firstElementChild;      // .sfl-pfit     (available area)
    const content = box.firstElementChild;    // .sfl-pcontent (natural size)

    const fits = (s) => {
        probe.style.setProperty('--sfl-s', s);
        const b = box.getBoundingClientRect();
        const c = content.getBoundingClientRect();
        return c.height <= b.height + 0.25 && box.scrollWidth <= box.clientWidth + 1;
    };

    // Placeholder screens ("sync a farm first") shouldn't blow up to giant text
    const maxS = live.querySelector('.sfl-empty') ? FIT_S_EMPTY_MAX : FIT_S_MAX;

    // 1) coarse scan from big to small
    let best = null, above = maxS;
    for (let s = maxS; s >= FIT_S_MIN; s *= 0.96) {
        if (fits(s)) { best = s; break; }
        above = s;
    }
    let fitsAtMin = true;
    if (best === null) {
        best = FIT_S_MIN;
        fitsAtMin = fits(FIT_S_MIN);
        if (!fitsAtMin) {
            console.warn('[SFL] panel does not fit even at the smallest scale — overflow x/y (px):',
                box.scrollWidth - box.clientWidth,
                Math.round(content.getBoundingClientRect().height - box.getBoundingClientRect().height),
                panel.id);
        }
    } else if (best < maxS) {
        // 2) refine between the failing scale just above and the fitting one
        let lo = best, hi = above;
        for (let i = 0; i < 8; i++) {
            const mid = (lo + hi) / 2;
            if (fits(mid)) lo = mid; else hi = mid;
        }
        best = lo;
    }
    // 3) round DOWN, then verify the exact value we are about to apply
    let value = Math.floor(best * 1000) / 1000;
    for (let i = 0; i < 12 && value > FIT_S_MIN && !fits(value); i++) {
        value = Math.max(FIT_S_MIN, Math.round((value - 0.004) * 1000) / 1000);
    }
    probe.innerHTML = '';

    if (panel._lastFit === undefined) {
        // very first fit: set it instantly (don't animate from the default 1)
        panel.style.transition = 'none';
        panel.style.setProperty('--sfl-s', value);
        void panel.offsetWidth;
        panel.style.transition = '';
    } else {
        panel.style.setProperty('--sfl-s', value);   // CSS transitions it
    }
    panel.dataset.scroll = fitsAtMin ? '' : '1';
    panel._lastFit = performance.now();
    panel._fitDirty = false;
}

// Decides where a panel goes and how big it is. Called every frame (cheap: it
// only writes styles), and only re-fits the content when the box really changed.
function positionPanel(panel, wrapper, side /* 'right'|'left' */, slot /* 'top'|'bottom'|'full' */) {
    // Panels live in the overlay layer (a sibling of the grid wrapper that mirrors its box), so they move, zoom, hide and
    // stack exactly like the grid does: no per-frame tracking, and no clamping to the browser
    // window (a panel slides half off-screen with the grid, like any object in the game world).
    // Everything below is in the wrapper's own pixels; origin = top-left of its padding box.
    const W = wrapper.clientWidth, H = wrapper.clientHeight;
    if (!W || !H) return;                          // wrapper hidden (display:none) → nothing to lay out yet

    const BW = wrapper.offsetWidth, BH = wrapper.offsetHeight;   // border box = what the eye sees as "the grid"
    const bx = (BW - W) / 2, by = (BH - H) / 2;                  // border thickness

    // Width = free space beside the grid, clamped. Derived from the viewport and the grid SIZE
    // (not its position), so it stays stable while the grid moves around.
    const free = (window.innerWidth - BW) / 2 - PANEL_GAP - PANEL_EDGE;
    const pw = Math.round(Math.max(PANEL_MIN_W, Math.min(PANEL_MAX_W, free)));

    // Vertical position and height based on slot
    let top, height;
    if (slot === 'top') {
        top = -by;
        height = (BH / 2) - PANEL_ROW_GAP;
    } else if (slot === 'bottom') {
        top = -by + (BH / 2) + PANEL_ROW_GAP;
        height = (BH / 2) - PANEL_ROW_GAP;
    } else { // 'full'
        top = -by;
        height = BH;
    }
    const left = (side === 'right') ? (W + bx + PANEL_GAP) : -(bx + PANEL_GAP + pw);

    top = Math.round(top);
    const l = Math.round(left);
    height = Math.max(60, Math.round(height));

    // Slot changed (e.g. the other right-hand panel closed) → animate box + content.
    // Brand-new panels just snap (they fade in instead).
    const now = performance.now();
    const slotChanged = panel._slot !== undefined && panel._slot !== slot;
    if (slotChanged && now - (panel._born || 0) > 150) beginPanelTransition(panel);
    panel._slot = slot;
    panel.dataset.panelSlot = slot;

    panel.style.top = `${top}px`;
    panel.style.left = `${l}px`;
    panel.style.width = `${pw}px`;
    panel.style.height = `${height}px`;

    if (panel._tw !== pw || panel._th !== height) {
        panel._tw = pw; panel._th = height; panel._fitDirty = true;
    }
    // Re-fit right away for first paint / slot changes; otherwise throttle (game zoom resizes the
    // wrapper every frame) — with a trailing timer so the final size is always fitted.
    if (panel._fitDirty) {
        const wait = FIT_THROTTLE_MS - (now - (panel._lastFit === undefined ? -1e9 : panel._lastFit));
        if (panel._lastFit === undefined || slotChanged || wait <= 0) {
            fitPanel(panel);
        } else if (!panel._fitTimer) {
            panel._fitTimer = setTimeout(() => {
                panel._fitTimer = null;
                if (panel._fitDirty) fitPanel(panel);
            }, wait + 5);
        }
    }
}

function refitAllPanels() {
    const wrapper = document.getElementById('sfl-grid-wrapper');
    if (_layerWrapper && !_layerWrapper.isConnected) teardownOverlayLayer();   // the wrapper was removed
    if (!wrapper) return;
    syncOverlayBorders(wrapper);
    // Panels that are fading out don't count → the others expand right away.
    const live = (id) => {
        const el = document.getElementById(id);
        return (el && !el.dataset.leaving) ? el : null;
    };
    const hints = live('sfl-hints-panel');
    const patterns = live('sfl-patterns-panel');
    const treasure = live('sfl-treasure-stat-panel');

    // Right side: hints + patterns share the grid height; alone, each gets it all.
    if (hints) positionPanel(hints, wrapper, 'right', patterns ? 'top' : 'full');
    if (patterns) positionPanel(patterns, wrapper, 'right', hints ? 'bottom' : 'full');
    // Left side: always the full height.
    if (treasure) positionPanel(treasure, wrapper, 'left', 'full');
}
// The browser window changed size → the free space beside the grid changed
window.addEventListener('resize', () => refitAllPanels());

// =============================================================================
// OVERLAY LAYER — the home of the three side panels (stats / hints / formations)
//
// Why not simply inside #sfl-grid-wrapper? Because the wrapper carries a clip-path
// (updateCharacterCutout: the character cut-out). Whenever the player is on the grid it
// clips everything further than 300px outside the grid — the panels reach ~470px, so they
// got chopped — and ANY clip-path turns the wrapper into a "backdrop root", which stops the
// panels' backdrop blur from seeing the game world (the world showed through crisp).
//
// So the panels live in a SIBLING layer that has no clip-path, sits at the same stacking level
// as the wrapper (z-index 2 → behind the game's popups, exactly like the grid) and whose box
// mirrors the wrapper's box. A MutationObserver copies the wrapper's inline geometry the moment
// it changes — observer callbacks run before the browser renders, so the layer (and the panels
// in it) move with the grid in the same frame, with zero lag.
// =============================================================================
let _layer = null, _layerMO = null, _layerWrapper = null;
const LAYER_MIRRORED = ['left', 'top', 'width', 'height', 'transform', 'transformOrigin', 'display'];

function syncOverlayLayer() {
    const w = _layerWrapper, L = _layer;
    if (!w || !L) return;
    const s = w.style, l = L.style;
    for (const p of LAYER_MIRRORED) { if (l[p] !== s[p]) l[p] = s[p]; }
}

// The layer's padding box must coincide with the wrapper's padding box → same border widths.
function syncOverlayBorders(wrapper) {
    if (!_layer) return;
    const bl = wrapper.clientLeft, bt = wrapper.clientTop;
    const br = wrapper.offsetWidth - wrapper.clientWidth - bl;
    const bb = wrapper.offsetHeight - wrapper.clientHeight - bt;
    const v = `${bt}px ${br}px ${bb}px ${bl}px`;
    if (_layer.style.borderWidth !== v) _layer.style.borderWidth = v;
}

function ensureOverlayLayer(wrapper) {
    if (_layer && _layer.isConnected && _layerWrapper === wrapper) return _layer;
    teardownOverlayLayer();
    _layer = document.createElement('div');
    _layer.id = 'sfl-overlay-layer';
    _layer.className = 'sfl-overlay-layer';                       // z-index / pointer-events: panels.css
    _layer.style.boxSizing = getComputedStyle(wrapper).boxSizing; // same box model as the wrapper
    _layerWrapper = wrapper;
    document.body.appendChild(_layer);                            // after the wrapper → above the grid
    syncOverlayLayer();
    syncOverlayBorders(wrapper);
    _layerMO = new MutationObserver(syncOverlayLayer);
    _layerMO.observe(wrapper, { attributes: true, attributeFilter: ['style'] });
    return _layer;
}

function teardownOverlayLayer() {
    if (_layerMO) { _layerMO.disconnect(); _layerMO = null; }
    if (_layer) { _layer.remove(); _layer = null; }               // the panels inside go with it
    _layerWrapper = null;
}

// The overlay layer mirrors the grid wrapper's box, so the panels follow the grid for free (no per-frame loop).
// The only thing to watch is the wrapper's SIZE — game zoom changes it, and display:none ↔
// visible flips it between 0 and real — and re-layout/re-fit the panels when it changes.
let _panelRO = null, _panelROTarget = null;
function startPanelTracking() {
    const wrapper = document.getElementById('sfl-grid-wrapper');
    if (!wrapper) return;
    if (_panelRO && _panelROTarget === wrapper) return;   // already watching this wrapper
    if (_panelRO) _panelRO.disconnect();
    _panelROTarget = wrapper;
    _panelRO = new ResizeObserver(() => refitAllPanels());
    _panelRO.observe(wrapper);
}
function stopPanelTracking() {
    if (_panelRO) { _panelRO.disconnect(); _panelRO = null; _panelROTarget = null; }
    removeFitProbe();
}

// The bar lives in the grid wrapper and the panels in the overlay layer tied to it, so when the wrapper is re-created (Alt+1 off/on,
// hide-all/show-all …) the overlays that are toggled on have to be built again.
function restoreOverlays() {
    if (statsBarVisible && !document.getElementById('sfl-stats-bar')) createStatsBar();
    if (hintsVisible && !document.getElementById('sfl-hints-panel')) createHintsPanel();
    if (patternsVisible && !document.getElementById('sfl-patterns-panel')) createFormationsPanel();
    if (treasureStatVisible && !document.getElementById('sfl-treasure-stat-panel')) createTreasureStatPanel();
}

// =============================================================================
// REFRESH ALL VISIBLE PANELS — called after data updates
// =============================================================================
function refreshPanels() {
    if (statsBarVisible) updateStatsBar();
    if (patternsVisible) updatePatternsPanel();
    if (treasureStatVisible) updateTreasureStatPanel();
    // hintsVisible doesn't need refresh — it's static
}



function makeDraggable(el) {
    let p1 = 0, p2 = 0, p3 = 0, p4 = 0;
    el.onmousedown = (e) => {
        if (isGridLocked) return; e.preventDefault(); p3 = e.clientX; p4 = e.clientY;
        document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
        document.onmousemove = (e2) => {
            e2.preventDefault(); p1 = p3 - e2.clientX; p2 = p4 - e2.clientY; p3 = e2.clientX; p4 = e2.clientY;
            el.style.transform = 'none'; el.style.top = (el.offsetTop - p2) + 'px'; el.style.left = (el.offsetLeft - p1) + 'px';
            syncGridCoordinates();
            refitAllPanels();
        };
    };
}

// =============================================================================
// THEME ENGINE
// =============================================================================
function applyTheme(theme) {
    const wrapper = document.getElementById('sfl-grid-wrapper');
    if (!wrapper || !masterGrid) return;

    const cells = masterGrid.querySelectorAll('.sfl-grid-cell');

    // -------------------------------------------------------------------------
    // STEP 1: Capture pixel-perfect positions from DEFAULT CSS grid layout
    // The default grid aligns perfectly with the game. We capture those exact
    // positions and re-use them in themed mode as absolute coordinates.
    // This makes alignment IMMUNE to any CSS theme interference.
    // -------------------------------------------------------------------------
    let cellPositions = null;
    if (theme !== 'none') {
        // Temporarily strip ALL theme styling to get clean default layout
        wrapper.style.opacity = '0'; // prevent visual flicker
        wrapper.removeAttribute('data-theme');
        wrapper.removeAttribute('data-perf');

        // Reset cells to default grid flow
        cells.forEach(cell => {
            cell.style.position = '';
            cell.style.left = '';
            cell.style.top = '';
            cell.style.width = '';
            cell.style.height = '';
        });

        // Force synchronous layout calculation in default mode
        void masterGrid.offsetHeight;

        // Capture every cell's exact position relative to the grid
        const gridRect = masterGrid.getBoundingClientRect();
        cellPositions = [];
        cells.forEach(cell => {
            const r = cell.getBoundingClientRect();
            cellPositions.push({
                left: r.left - gridRect.left,
                top: r.top - gridRect.top,
                width: r.width,
                height: r.height
            });
        });
        console.log(`[Grid] Position capture: grid=${gridRect.width}x${gridRect.height}, tile[0]=${JSON.stringify(cellPositions[0])}, tile[99]=${JSON.stringify(cellPositions[99])}`);
    }

    // -------------------------------------------------------------------------
    // STEP 2: Apply theme
    // -------------------------------------------------------------------------
    if (theme === 'none') {
        wrapper.removeAttribute('data-theme');
        // Clean up any custom engine residue
        cleanupCustomAttributes(wrapper);
    } else {
        // Clear ALL inline styles that might conflict with CSS theme rules
        wrapper.style.animation = '';
        wrapper.style.border = '';
        wrapper.style.boxShadow = '';
        wrapper.style.backgroundColor = '';
        wrapper.style.borderRadius = '';

        // Clean up custom engine attributes when switching to a built-in theme
        const isCustom = (theme === 'custom' || theme.startsWith('custom-'));
        if (!isCustom) {
            cleanupCustomAttributes(wrapper);
        }

        // Set the new theme attribute
        // Custom themes always use data-theme="custom" for CSS matching
        const cssTheme = isCustom ? 'custom' : theme;
        wrapper.setAttribute('data-theme', cssTheme);

        // Force animation restart: set none, reflow, then clear to let CSS take over
        wrapper.style.animation = 'none';
        void wrapper.offsetHeight;
        wrapper.style.animation = '';

        // Apply custom config data-attributes after theme is set
        if (isCustom && customConfig) {
            applyCustomConfig(customConfig);
        }
    }
    wrapper.dataset.perf = perfTier;
    wrapper.dataset.quality = perfTier; // CSS uses data-quality for --jp-* vars (jackpot scale/shadow/blur)
    wrapper.dataset.preserve = preserveUnderlying ? 'true' : 'false';
    wrapper.style.opacity = ''; // restore visibility

    // Clean up any lingering jackpot effects from a previous theme
    masterGrid.classList.remove('jackpot-active');
    document.querySelectorAll('.jackpot-text').forEach(el => el.remove());

    // Themed tile type distribution (all colored, no 'empty')
    const themedTypes = ['blue', 'yellow', 'red'];

    // -------------------------------------------------------------------------
    // STEP 3: Apply captured positions + animations
    // -------------------------------------------------------------------------
    cells.forEach((cell, i) => {
        // Reset tile states on theme switch (includes numeric tier classes for CSS animations)
        cell.classList.remove('digging', 'dug', 'tile-pending', 'tile-revealing', 'tile-revealed',
            'item-sand', 'item-crab', 'item-bone', 'item-rare', 'item-misc',
            'tier-1', 'tier-2', 'tier-3', 'tier-4', 'tier-5', 'jackpot-active');
        cell.dataset.tileState = '';
        delete cell.dataset.itemTier;
        const fx = cell.querySelector('.dig-fx-container');
        if (fx) fx.remove();

        // Reassign tile types for themed mode (no 'empty' tiles)
        if (theme !== 'none') {
            cell.dataset.type = themedTypes[Math.floor(Math.random() * themedTypes.length)];
        }

        const row = Math.floor(i / 10), col = i % 10;

        if (theme !== 'none' && cellPositions) {
            // PIXEL-PERFECT: use cssText with !important to guarantee override
            const p = cellPositions[i];
            cell.style.cssText = `position: absolute !important; left: ${p.left}px !important; top: ${p.top}px !important; width: ${p.width}px !important; height: ${p.height}px !important; box-sizing: border-box !important; margin: 0 !important;`;
        } else {
            // DEFAULT: use CSS grid flow (already perfect)
            cell.style.cssText = '';
        }

        // Re-apply animation after cssText (which clears all inline styles)
        cell.offsetHeight; // force reflow
        cell.style.animationDelay = `${(row + col) * 0.02}s`;
        cell.style.animation = 'popIn 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards';
    });

    // Re-apply live grid state after pop-in animation completes
    if (currentGridData) {
        setTimeout(() => applyLiveGridState(currentGridData, currentPatterns), 800);
    }

    console.log(`[Grid] Theme applied: ${theme}`);
}

// =============================================================================
// PARTICLE PHYSICS ENGINE (performance-scaled + tier-aware)
// Matches reference Maingridesignpresets.html particle system exactly.
// =============================================================================
function spawnThemeParticles(tileElement, theme, numOverride, tier) {
    if (!masterGrid) return;
    const perf = PERF_CONFIG[perfTier] || PERF_CONFIG.high;
    const tierConf = TIER_CONFIG[tier] || TIER_CONFIG.misc;
    let numParticles = numOverride || perf.particles;

    // Quality scaling for non-jackpot tiers (matches reference exactly)
    if (tier !== 'rare') {
        if (perfTier === 'high') numParticles = Math.floor(numParticles * 0.7);
        else if (perfTier === 'medium') numParticles = Math.floor(numParticles * 0.4);
        else if (perfTier === 'potato') numParticles = Math.floor(numParticles * 0.15);
    } else {
        // Jackpot quality scaling (from reference)
        if (perfTier === 'ultra') numParticles = Math.max(numParticles, 200);
        else if (perfTier === 'high') numParticles = Math.max(numParticles, 100);
        else if (perfTier === 'medium') numParticles = Math.max(numParticles, 50);
        else if (perfTier === 'potato') numParticles = Math.max(numParticles, 15);
    }

    const tileRect = tileElement.getBoundingClientRect();
    const gridRect = masterGrid.getBoundingClientRect();
    const centerX = (tileRect.left - gridRect.left) + (tileRect.width / 2);
    const centerY = (tileRect.top - gridRect.top) + (tileRect.height / 2);

    // Theme-specific colors
    const themeColors = {
        hellfire: ['#ff4500', '#ff0000'], molten: ['#ff4500', '#ff6a00'],
        electric: ['#00ffff', '#ffffff'], cyberpunk: ['#00ffff', '#ff00ff'],
        toxic: ['#39ff14', '#00ff00'], matrix: ['#00ff00', '#39ff14'],
        void: ['#8a2be2', '#4b0082'], aurora: ['#00ffcc', '#ff69b4'],
        blood: ['#ff0000', '#8a0303'], holy: ['#ffd700', '#ffffff'],
        abyss: ['#00bfff', '#001a33'], arcane: ['#b100ff', '#ff00ff'],
        synthwave: ['#ff00ff', '#00ffff'], mecha: ['#ff6a00', '#ffffff'],
        obsidian: ['#4b0082', '#000000'], prismatic: ['#ff0000', '#00ff00'],
        frost: ['#00ffff', '#ffffff'], disco: ['#ff00ff', '#ffff00'],
        alien: ['#39ff14', '#00ffcc'], hextech: ['#00ffff', '#ffd700'],
        gold: ['#ffd700', '#ffffff'], nebula: ['#9b59b6', '#3498db'],
        arcade: ['#00ff00', '#ffffff'], mirage: ['#ff8c00', '#ffd700'],
        crystal: ['#00bfff', '#ffffff'], steampunk: ['#b87333', '#ffd700'],
        necro: ['#8a2be2', '#39ff14'], quantum: ['#00ffff', '#b100ff'],
        vaporwave: ['#ff71ce', '#01cdfe'], spinning: ['#ff4500', '#ffd700'],
    };
    let colors = themeColors[theme] || ['#ffffff', '#cccccc'];

    // Custom theme: use user-chosen colors
    if (theme === 'custom' && customConfig) {
        colors = [customConfig.primaryColor || '#00ffff', customConfig.secondaryColor || '#ff00ff'];
    }

    // Sand tier (tier 5): melancholic dark crimson override (from reference)
    if (tier === 'sand') {
        colors = ['#660000', '#220000'];
    }

    // Tier-specific velocity and size multipliers
    const velocityMult = tierConf.velocityMult || 1;
    const sizeMult = tierConf.sizeMult || 1;

    for (let i = 0; i < numParticles; i++) {
        const p = document.createElement('div');
        p.className = 'dig-particle';
        const size = (Math.random() * 8 + 4) * sizeMult;
        p.style.width = p.style.height = `${size}px`;
        p.style.backgroundColor = colors[i % 2];
        // Kill shadows on potato (except jackpot) for performance
        if (perfTier !== 'potato' || tier === 'rare') {
            p.style.boxShadow = `0 0 10px ${colors[i % 2]}`;
        }
        p.style.left = `${centerX - size / 2}px`;
        p.style.top = `${centerY - size / 2}px`;
        masterGrid.appendChild(p);

        // Physics math — velocity scaled by tier (from reference)
        const angle = Math.random() * Math.PI * 2;
        const velocity = (Math.random() * 100 + 50) * velocityMult;
        const dx = Math.cos(angle) * velocity;
        const dy = Math.sin(angle) * velocity;
        const rot = Math.random() * 720 - 360;

        // Jackpot particles hang 1.5x longer (from reference)
        const baseDuration = 1000 + Math.random() * 1000;
        const duration = baseDuration * (tier === 'rare' ? 1.5 : 1);

        p.animate([
            { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
            { transform: `translate(${dx}px,${dy}px) rotate(${rot}deg) scale(0)`, opacity: 0 }
        ], { duration, easing: 'cubic-bezier(0.25,0.8,0.25,1)', fill: 'forwards' });

        // Extended cleanup time (4s like reference, up from 2.5s)
        setTimeout(() => { if (p.parentNode) p.remove(); }, 4000);
    }
}

// Load saved theme on startup (including custom themes)
chrome.storage.local.get(['gridTheme', 'activeCustomConfig', 'customThemes'], (r) => {
    if (r.gridTheme) currentTheme = r.gridTheme;
    // If it's a custom theme, load the config
    if (currentTheme === 'custom-live' && r.activeCustomConfig) {
        customConfig = r.activeCustomConfig;
    } else if (currentTheme && currentTheme.startsWith('custom-') && r.customThemes) {
        const found = r.customThemes.find(t => t.id === currentTheme);
        if (found) customConfig = found.config;
    }
});

// Apply custom config data-attributes onto the wrapper
function applyCustomConfig(config) {
    if (!config) return;
    const w = document.getElementById('sfl-grid-wrapper');
    if (!w) return;

    // Set CSS custom properties
    w.style.setProperty('--engine-primary', config.primaryColor || '#00ffff');
    w.style.setProperty('--engine-secondary', config.secondaryColor || '#ff00ff');
    w.style.setProperty('--engine-glow-intensity', config.glowIntensity || 1);

    // Set composable data attributes for CSS to read
    w.dataset.shape = config.tileShape || 'square';
    w.dataset.border = config.borderStyle || 'neon';
    w.dataset.particles = config.particleType || 'shards';
    w.dataset.jackpot = config.jackpotEffect || 'orbital';
    w.dataset.digT2 = config.digT2 || 'bone-shatter';
    w.dataset.digT3 = config.digT3 || 'gold-pop';
    w.dataset.digT4 = config.digT4 || 'snap';
    w.dataset.digT5 = config.digT5 || 'thud';

    console.log(`[Grid] Custom config applied:`, config);
}

// Remove all custom engine data-attributes and CSS vars from wrapper
function cleanupCustomAttributes(w) {
    if (!w) return;
    // Remove custom CSS variables
    w.style.removeProperty('--engine-primary');
    w.style.removeProperty('--engine-secondary');
    w.style.removeProperty('--engine-glow-intensity');
    // Remove composable data attributes
    delete w.dataset.shape;
    delete w.dataset.border;
    delete w.dataset.particles;
    delete w.dataset.jackpot;
    delete w.dataset.digT2;
    delete w.dataset.digT3;
    delete w.dataset.digT4;
    delete w.dataset.digT5;
}
console.log("SFL Grid Script Loaded (v11.3 — Auto-Align + Live Dig + Themes).");

let currentTheme = 'none'; // 'none' = default basic grid, or a theme key
let auraEnabled = false;     // manual toggle from sidepanel
let auraAutoActive = false;  // auto-enabled when grid is active + character is in grid area
let perfTier = 'high';       // ultra | high | medium | potato
let preserveUnderlying = false; // when true, perf tiers skip underlying theme effects
let customConfig = null; // custom theme config object from builder

// Performance tier config — hover/glow ALWAYS enabled, only particle count scales
const PERF_CONFIG = {
    ultra:  { particles: 30, animDuration: 2500 },
    high:   { particles: 20, animDuration: 2500 },
    medium: { particles: 10, animDuration: 2500 },
    potato: { particles: 3,  animDuration: 1500 }
};

// =============================================================================
// INJECT BRIDGE
// =============================================================================
const bridgeScript = document.createElement('script');
bridgeScript.src = chrome.runtime.getURL('bridge.js');
bridgeScript.onload = () => console.log("[Grid] Bridge injected.");
(document.head || document.documentElement).appendChild(bridgeScript);

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

// Mode
let deviceMode = 'mid';
let domIntervalMs = 0;
let lastSeenTS = '0';

// Load saved state
chrome.storage.local.get(['walkSpeed', 'deviceMode', 'domIntervalMs', 'auraEnabled', 'perfTier', 'gridCalibX', 'gridCalibY', 'preserveUnderlying'], (r) => {
    if (r.walkSpeed !== undefined) walkSpeed = r.walkSpeed;
    if (r.deviceMode) deviceMode = r.deviceMode;
    if (r.domIntervalMs !== undefined) domIntervalMs = r.domIntervalMs;
    if (r.auraEnabled !== undefined) auraEnabled = r.auraEnabled;
    if (r.perfTier) perfTier = r.perfTier;
    if (r.gridCalibX !== undefined) gridCalibX = r.gridCalibX;
    if (r.gridCalibY !== undefined) gridCalibY = r.gridCalibY;
    if (r.preserveUnderlying !== undefined) preserveUnderlying = r.preserveUnderlying;
    console.log(`[Grid] Mode=${deviceMode} Speed=${walkSpeed} Aura=${auraEnabled} Perf=${perfTier} Preserve=${preserveUnderlying} Calib=(${gridCalibX},${gridCalibY})`);
});

// =============================================================================
// TRACKING INDICATOR
// =============================================================================
const trackingIndicator = document.createElement('div');
trackingIndicator.id = 'sfl-tracking-indicator';
trackingIndicator.innerHTML = `
    <span class="indicator-dot"></span>
    <span id="sfl-mode-label">TRACKING</span>
    <span class="indicator-hint">Alt+1 re-snap | E stop</span>
`;
document.body.appendChild(trackingIndicator);

function updateIndicatorLabel() {
    const label = document.getElementById('sfl-mode-label');
    if (!label) return;
    const m = { low: 'LOW-END', mid: 'MID-RANGE', high: 'HIGH-END' };
    label.textContent = m[deviceMode] || 'TRACKING';
}

// =============================================================================
// AUTO-ALIGNMENT: Alt+1 reads camera + uses known grid world coords
// No manual calibration, no dragging, no four-corner clicks
// =============================================================================
window.addEventListener('message', (e) => {
    if (!e.data || e.source !== window) return;
    if (e.data.type === 'SFL_GRID_CAMERA_RESULT') handleAutoAlign(e.data.data);

    // Live dig update: bridge.js intercepted updated grid from game API
    if (e.data.type === 'SFL_GRID_AUTO_UPDATE') {
        console.log('[Grid] Auto-update received:', e.data.grid.length, 'dug cells');
        currentGridData = e.data.grid;
        currentPatterns = e.data.patterns || [];
        if (masterGrid) applyLiveGridState(currentGridData, currentPatterns);
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
        return;
    }

    // Use the known grid world position from the SFL source code
    gridWorldX = cam.gridWorldX;  // 160
    gridWorldY = cam.gridWorldY;  // 128
    gridCellSize = cam.gridCellSize || 16;

    console.log(`[Grid] Auto-align: grid at world(${gridWorldX}, ${gridWorldY}), cell=${gridCellSize}px`);

    // Ensure the grid is visible
    if (!masterGrid) createGrid();

    // Snap the overlay to the exact screen position
    snapToScreen(cam);

    // Start tracking
    if (appState !== 'TRACKING') startTracking();
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

    console.log(`[Grid] Snapped: pos(${(gridX + gridCalibX).toFixed(1)}, ${(gridY + gridCalibY).toFixed(1)}), size(${gridPixelW.toFixed(1)}x${gridPixelH.toFixed(1)}), calib(${gridCalibX}, ${gridCalibY})`);
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
    syncGridCoordinates();
    trackingIndicator.style.display = 'flex';
    updateIndicatorLabel();
    window.postMessage({ type: 'SFL_GRID_START_TRACKING', mode: deviceMode, interval: getIntervalForMode() }, '*');
    if (!animationFrameId) gameLoop();
    console.log(`[Grid] Tracking ON [${deviceMode.toUpperCase()}]`);
}

function stopTracking() {
    if (appState !== 'TRACKING') return;
    appState = 'IDLE';
    if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
    keys.w = keys.a = keys.s = keys.d = false;
    trackingIndicator.style.display = 'none';
    window.postMessage({ type: 'SFL_GRID_STOP_TRACKING' }, '*');
    console.log("[Grid] Tracking OFF.");
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
function ensureDebugSvg() {
    if (debugSvg) return debugSvg;
    debugSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    debugSvg.id = 'sfl-silhouette-debug';
    debugSvg.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:999999;pointer-events:none;opacity:1;transition:opacity 0.4s ease;';
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

    // Determine if silhouette should be active
    const gridActive = !!(w && masterGrid && appState === 'TRACKING');
    const shouldShowAura = auraEnabled || gridActive;

    if (!hasPlayer || !shouldShowAura) {
        // CLIP ON WRAPPER: cuts through ALL layers (tiles + edge effects like fire/glow)
        // This ensures character is 100% visible while themes stay at full vibrancy.
        if (w) w.style.clipPath = 'none';
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
    // BUILD UNIFIED CLIP-PATH on WRAPPER
    // Punches holes for: (1) character silhouette, (2) every dug/revealed tile.
    // Uses SVG path with evenodd: outer rect shows everything, inner sub-paths cut holes.
    // Outer rect extends 300px beyond wrapper to preserve edge effect overflow.
    // =========================================================================
    if (w) {
        const wr = w.getBoundingClientRect();
        const EXT = 300;
        const outerPath = `M ${-EXT} ${-EXT} L ${wr.width + EXT} ${-EXT} L ${wr.width + EXT} ${wr.height + EXT} L ${-EXT} ${wr.height + EXT} Z`;

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
                } catch(e) {
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

        // Apply clip-path
        if (charPath) {
            w.style.clipPath = `path(evenodd, "${outerPath}${charPath}")`;
        } else {
            w.style.clipPath = 'none';
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
                // Fade in when on grid, fade out when leaving
                svg.style.opacity = isOnGrid ? '1' : (auraEnabled ? '0.5' : '0');
                svg.innerHTML = `<polygon points="${debugPoints}" fill="none" stroke="rgba(255,215,0,0.6)" stroke-width="2" stroke-linejoin="round"/>`;
                return;
            }
        } catch(e) { /* ignore */ }
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
        else { createGrid(); }
    }
    else if (request.action === 'hideAll') {
        removeGrid(); stopTracking();
    }
    else if (request.action === 'setLockState') { isGridLocked = request.isLocked; updateGridMode(); }
    else if (request.action === 'resetPosition') {
        const w = document.getElementById('sfl-grid-wrapper');
        if (w) { w.style.top='50%'; w.style.left='50%'; w.style.transform='translate(-50%,-50%)'; syncGridCoordinates(); }
    }
    else if (request.action === 'colorGrid') {
        currentGridData = request.apiGridData;
        if (masterGrid) applyGridColors(currentGridData);
    }
    else if (request.action === 'updateSpeed') { walkSpeed = request.speed; chrome.storage.local.set({walkSpeed}); }
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
        console.log(`[Grid] Performance tier: ${perfTier}`);
    }
    else if (request.action === 'setPreserveEffects') {
        const preserve = request.preserve;
        chrome.storage.local.set({ preserveUnderlying: preserve });
        const w = document.getElementById('sfl-grid-wrapper');
        if (w) w.dataset.preserve = preserve ? 'true' : 'false';
        console.log(`[Grid] Preserve underlying effects: ${preserve}`);
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
        console.log(`[Grid] Calibration: (${gridCalibX}, ${gridCalibY})`);
    }
    sendResponse({status:"ok"}); return true;
});

// =============================================================================
// KEYBOARD
// =============================================================================
window.addEventListener('keydown', (e) => {
    // Alt+1: TOGGLE ΓÇö first press opens + aligns, second press hides
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
    if (appState === 'TRACKING' && e.key.toLowerCase() === 'e') { stopTracking(); return; }
    if (appState === 'TRACKING' && masterGrid && deviceMode !== 'high') {
        const k = e.key.toLowerCase();
        if (e.code === 'Space') { keys.w=keys.a=keys.s=keys.d=false; return; }
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
        { name: 'blue',   chance: 0.35 },
        { name: 'yellow', chance: 0.35 },
        { name: 'red',    chance: 0.30 }
    ];
    const defaultTypes = [
        { name: 'empty',  chance: 0.50 },
        { name: 'blue',   chance: 0.25 },
        { name: 'yellow', chance: 0.15 },
        { name: 'red',    chance: 0.10 }
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
    console.log("[Grid] Grid created with theme support.");
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
        w.remove();
    }
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
    if (name.includes('artefact') || name.includes('seasonal artefact') ||
        name.includes('hieroglyph') || name.includes('puzzle') ||
        name.includes('scarab') || name.includes('cow skull') ||
        name.includes('ancient clock') || name.includes('broken pillar') ||
        name.includes('coprolite') || name.includes('moon crystal') ||
        name.includes('ammonite shell') || name.includes('pearl') ||
        name.includes('pirate bounty')) return 'rare';
    // Tier 3 (Misc) — treasure glow
    // Coins, compass, bottles, vases, shells, coral, sea cucumber, starfish, etc.
    return 'misc';
}

// Maps named tiers → CSS tier numbers (tier-1 through tier-5)
// CSS animations use .tier-1, .tier-2 etc. class names
const TIER_TO_NUMBER = { sand: '5', misc: '3', crab: '4', bone: '2', rare: '1' };

const TIER_CONFIG = {
    sand:  { durationMult: 0.4, particleMult: 0.3, velocityMult: 0.5, sizeMult: 0.8 },   // Quick, minimal, melancholic
    misc:  { durationMult: 0.7, particleMult: 0.6, velocityMult: 1.5, sizeMult: 1.2 },   // Treasure glow
    crab:  { durationMult: 0.85, particleMult: 1.0, velocityMult: 1.2, sizeMult: 1.0 },  // Minor hint pulse
    bone:  { durationMult: 1.0, particleMult: 1.5, velocityMult: 2.0, sizeMult: 1.5 },   // Spectral resonance
    rare:  { durationMult: 1.5, particleMult: 2.5, velocityMult: 5.0, sizeMult: 2.5 },   // JACKPOT — EPIC
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

    console.log(`[Grid] Tile (${col},${row}) digging [${tier}/tier-${tierNum}] → revealed: ${item}`);
}

function applyGridColors(data) {
    if (!data || !masterGrid) return;
    // Flatten in case API returns a 2D array
    const flat = Array.isArray(data[0]) ? data.flat() : data;
    const cells = masterGrid.querySelectorAll('.sfl-grid-cell');
    cells.forEach(c => c.className = 'sfl-grid-cell');

    // Priority: sand (highest) > crab > bone > misc (lowest)
    const HINT_PRIORITY = { 'sfl-cell-sand': 4, 'sfl-cell-crab': 3, 'sfl-cell-bone': 2, 'sfl-cell-misc': 1 };
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
        const x=h.x, y=h.y;
        const n = (h.name||(h.items?Object.keys(h.items)[0]:'')).toLowerCase();
        const cls = getHintClass(n);
        [{nx:x,ny:y},{nx:x,ny:y-1},{nx:x,ny:y+1},{nx:x-1,ny:y},{nx:x+1,ny:y}].forEach(c => {
            if (c.nx>=0&&c.nx<10&&c.ny>=0&&c.ny<10) { const cell=cells[c.ny*10+c.nx]; if(cell) setHintIfHigher(cell, cls); }
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

    // Priority: sand (highest) > crab > bone > misc (lowest)
    const HINT_PRIORITY = { 'sfl-cell-sand': 4, 'sfl-cell-crab': 3, 'sfl-cell-bone': 2, 'sfl-cell-misc': 1 };
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

            [{nx:x,ny:y-1},{nx:x,ny:y+1},{nx:x-1,ny:y},{nx:x+1,ny:y}].forEach(c => {
                if (c.nx >= 0 && c.nx < 10 && c.ny >= 0 && c.ny < 10) {
                    const adj = cells[c.ny * 10 + c.nx];
                    if (adj && !adj.classList.contains('sfl-cell-dug')) {
                        setHintIfHigher(adj, cls);
                    }
                }
            });
        });
    }

    console.log(`[Grid] Live state applied: ${flat.length} dug cells (theme: ${currentTheme})`);
}

function makeDraggable(el) {
    let p1=0,p2=0,p3=0,p4=0;
    el.onmousedown = (e) => {
        if (isGridLocked) return; e.preventDefault(); p3=e.clientX; p4=e.clientY;
        document.onmouseup = () => { document.onmouseup=null; document.onmousemove=null; };
        document.onmousemove = (e2) => {
            e2.preventDefault(); p1=p3-e2.clientX; p2=p4-e2.clientY; p3=e2.clientX; p4=e2.clientY;
            el.style.transform='none'; el.style.top=(el.offsetTop-p2)+'px'; el.style.left=(el.offsetLeft-p1)+'px';
            syncGridCoordinates();
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
        p.style.left = `${centerX - size/2}px`;
        p.style.top = `${centerY - size/2}px`;
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
        setTimeout(() => { if(p.parentNode) p.remove(); }, 4000);
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

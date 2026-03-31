console.log("SFL Grid Script Loaded (v11.3 — Auto-Align + Live Dig + Themes).");

let currentTheme = 'none'; // 'none' = default basic grid, or a theme key
let auraEnabled = false;     // manual toggle from sidepanel
let auraAutoActive = false;  // auto-enabled when grid is active + character is in grid area

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
chrome.storage.local.get(['walkSpeed', 'deviceMode', 'domIntervalMs', 'auraEnabled'], (r) => {
    if (r.walkSpeed !== undefined) walkSpeed = r.walkSpeed;
    if (r.deviceMode) deviceMode = r.deviceMode;
    if (r.domIntervalMs !== undefined) domIntervalMs = r.domIntervalMs;
    if (r.auraEnabled !== undefined) auraEnabled = r.auraEnabled;
    console.log(`[Grid] Mode=${deviceMode} Speed=${walkSpeed} Aura=${auraEnabled}`);
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

function snapToScreen(cam) {
    if (!masterGrid || gridWorldX === null) return;
    const w = document.getElementById('sfl-grid-wrapper');
    if (!w) return;
    const sx = cam.canvasDisplayW / cam.canvasInternalW;
    const sy = cam.canvasDisplayH / cam.canvasInternalH;
    gridX = (gridWorldX - cam.scrollX) * cam.zoom * sx + cam.cameraX * sx + cam.canvasLeft;
    gridY = (gridWorldY - cam.scrollY) * cam.zoom * sy + cam.cameraY * sy + cam.canvasTop;
    w.style.left = gridX + 'px';
    w.style.top = gridY + 'px';
    w.style.transform = 'none';
    console.log(`[Grid] Snapped to screen(${gridX.toFixed(1)}, ${gridY.toFixed(1)})`);
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
        w.style.left = gridX + 'px';
        w.style.top = gridY + 'px';
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
    w.style.left = gridX + 'px';
    w.style.top = gridY + 'px';
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
        if (w) w.style.clipPath = 'none';
        hideAuraSvg();
        return;
    }

    const px = parseFloat(camEl.dataset.px);
    const py = parseFloat(camEl.dataset.py);

    // Check if character is near the grid
    let isOnGrid = false;
    if (w) {
        const wr = w.getBoundingClientRect();
        const relX = px - wr.left;
        const relY = py - wr.top;
        isOnGrid = relX > -60 && relX < wr.width + 60 && relY > -60 && relY < wr.height + 60;
    }

    // Clip-path cutout (only when character is on the grid area)
    if (w && isOnGrid) {
        const wr = w.getBoundingClientRect();
        const relX = px - wr.left;
        const relY = py - wr.top;
        const outerPath = `M 0 0 L ${wr.width} 0 L ${wr.width} ${wr.height} L 0 ${wr.height} Z`;

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

                    let polyPath = '';
                    for (let i = 0; i < poly.length; i++) {
                        const p = poly[i];
                        const localX = flip ? (fw - p.x) : p.x;
                        const sx = relX + (localX - fw / 2) * scale;
                        const sy = relY + (p.y - fh / 2) * scale + yOffset * scale;
                        polyPath += (i === 0 ? 'M ' : 'L ') + sx.toFixed(1) + ' ' + sy.toFixed(1) + ' ';
                    }
                    polyPath += 'Z';
                    w.style.clipPath = `path(evenodd, "${outerPath} ${polyPath}")`;
                }
            } catch(e) {
                const r = 45;
                w.style.clipPath = `path(evenodd, "${outerPath} M ${relX} ${relY - r} A ${r} ${r} 0 1 0 ${relX} ${relY + r} A ${r} ${r} 0 1 0 ${relX} ${relY - r} Z")`;
            }
        } else {
            const r = 45;
            w.style.clipPath = `path(evenodd, "${outerPath} M ${relX} ${relY - r} A ${r} ${r} 0 1 0 ${relX} ${relY + r} A ${r} ${r} 0 1 0 ${relX} ${relY - r} Z")`;
        }
    } else if (w) {
        w.style.clipPath = 'none';
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
        w.style.left = gridX + 'px';
        w.style.top = gridY + 'px';
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
            masterGrid.remove(); masterGrid = null;
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

    // Random tile types for visual theming
    const types = [
        { name: 'empty', chance: 0.50 },
        { name: 'blue',  chance: 0.25 },
        { name: 'yellow', chance: 0.15 },
        { name: 'red',   chance: 0.10 }
    ];
    function getRandomType() {
        const rand = Math.random();
        let cum = 0;
        for (let t of types) { cum += t.chance; if (rand <= cum) return t.name; }
        return 'empty';
    }

    for (let i = 0; i < 100; i++) {
        const c = document.createElement('div');
        c.className = 'sfl-grid-cell';
        c.dataset.x = i % 10;
        c.dataset.y = Math.floor(i / 10);
        c.dataset.type = getRandomType();

        // Staggered pop-in animation
        const row = Math.floor(i / 10), col = i % 10;
        c.style.animationDelay = `${(row + col) * 0.03}s`;

        masterGrid.appendChild(c);
    }

    gridWrapper.appendChild(masterGrid);
    updateGridMode(); makeDraggable(gridWrapper);

    // Mouse spotlight tracking
    masterGrid.addEventListener('mousemove', (e) => {
        const rect = masterGrid.getBoundingClientRect();
        masterGrid.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
        masterGrid.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
    });

    // Click-to-dig interaction (theme animations)
    masterGrid.addEventListener('click', (e) => {
        if (currentTheme === 'none') return; // No dig animation in default mode
        const cell = e.target.closest('.sfl-grid-cell');
        if (!cell || cell.classList.contains('digging') || cell.classList.contains('dug')) return;

        cell.classList.add('digging');
        const fx = document.createElement('div');
        fx.className = 'dig-fx-container';
        cell.appendChild(fx);

        // Spawn particles
        spawnThemeParticles(cell, currentTheme);

        // After 2.5s animation, mark as dug
        setTimeout(() => {
            cell.classList.remove('digging');
            cell.classList.add('dug');
            cell.innerHTML = '';
        }, 2500);
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
    if (w) w.remove();
    masterGrid = null;
}

function applyGridColors(data) {
    if (!data || !masterGrid) return;
    // Flatten in case API returns a 2D array
    const flat = Array.isArray(data[0]) ? data.flat() : data;
    const cells = masterGrid.querySelectorAll('.sfl-grid-cell');
    cells.forEach(c => c.className = 'sfl-grid-cell');
    flat.forEach(h => {
        const x=h.x, y=h.y;
        const n = (h.name||(h.items?Object.keys(h.items)[0]:'')).toLowerCase();
        let cls = 'sfl-cell-misc';
        if (n.includes('sand')) cls='sfl-cell-sand';
        else if (n.includes('crab')) cls='sfl-cell-crab';
        else if (n.includes('bone')||n.includes('artefact')||n.includes('hieroglyph')||n.includes('map')) cls='sfl-cell-bone';
        [{nx:x,ny:y},{nx:x,ny:y-1},{nx:x,ny:y+1},{nx:x-1,ny:y},{nx:x+1,ny:y}].forEach(c => {
            if (c.nx>=0&&c.nx<10&&c.ny>=0&&c.ny<10) { const cell=cells[c.ny*10+c.nx]; if(cell) cell.classList.add(cls); }
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

    // Reset all cells first
    cells.forEach(c => {
        c.className = 'sfl-grid-cell';
        c.style.opacity = '';
    });

    if (!gridData || gridData.length === 0) return;

    const flat = Array.isArray(gridData[0]) ? gridData.flat() : gridData;

    flat.forEach(h => {
        const x = h.x, y = h.y;
        const dugCell = cells[y * 10 + x];
        if (!dugCell) return;

        // Get the item name from the dug cell
        const n = (h.name || (h.items ? Object.keys(h.items)[0] : '')).toLowerCase();

        // Determine the color class for this item type
        let cls = 'sfl-cell-misc';
        if (n.includes('sand')) cls = 'sfl-cell-sand';
        else if (n.includes('crab')) cls = 'sfl-cell-crab';
        else if (n.includes('bone') || n.includes('artefact') || n.includes('hieroglyph') || n.includes('map')) cls = 'sfl-cell-bone';

        // Mark the dug cell itself
        dugCell.classList.add('sfl-cell-dug');
        dugCell.classList.add(cls);

        // Color adjacent cells (hints about nearby items)
        [{nx:x,ny:y-1},{nx:x,ny:y+1},{nx:x-1,ny:y},{nx:x+1,ny:y}].forEach(c => {
            if (c.nx >= 0 && c.nx < 10 && c.ny >= 0 && c.ny < 10) {
                const adj = cells[c.ny * 10 + c.nx];
                if (adj && !adj.classList.contains('sfl-cell-dug')) {
                    adj.classList.add(cls);
                }
            }
        });
    });

    console.log(`[Grid] Live state applied: ${flat.length} dug cells, ${patterns.length} patterns remaining`);
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
    if (!wrapper) return;

    if (theme === 'none') {
        wrapper.removeAttribute('data-theme');
    } else {
        wrapper.setAttribute('data-theme', theme);
    }

    // Re-trigger pop-in animation on all cells for a morph effect
    const cells = wrapper.querySelectorAll('.sfl-grid-cell');
    cells.forEach((cell, i) => {
        // Remove digging/dug states on theme switch
        cell.classList.remove('digging', 'dug');
        cell.innerHTML = '';
        cell.style.animation = 'none';
        cell.offsetHeight; // force reflow
        const row = Math.floor(i / 10), col = i % 10;
        cell.style.animationDelay = `${(row + col) * 0.02}s`;
        cell.style.animation = 'popIn 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards';
    });

    console.log(`[Grid] Theme applied: ${theme}`);
}

// =============================================================================
// PARTICLE PHYSICS ENGINE (From user presets)
// =============================================================================
function spawnThemeParticles(tileElement, theme) {
    if (!masterGrid) return;
    const numParticles = 20;
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
    const colors = themeColors[theme] || ['#ffffff', '#cccccc'];

    for (let i = 0; i < numParticles; i++) {
        const p = document.createElement('div');
        p.className = 'dig-particle';
        const size = Math.random() * 8 + 3;
        p.style.width = p.style.height = `${size}px`;
        p.style.backgroundColor = colors[i % 2];
        p.style.boxShadow = `0 0 8px ${colors[i % 2]}`;
        p.style.left = `${centerX - size/2}px`;
        p.style.top = `${centerY - size/2}px`;
        masterGrid.appendChild(p);

        const angle = Math.random() * Math.PI * 2;
        const vel = Math.random() * 80 + 40;
        const dx = Math.cos(angle) * vel, dy = Math.sin(angle) * vel;
        const rot = Math.random() * 720 - 360;

        p.animate([
            { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
            { transform: `translate(${dx}px,${dy}px) rotate(${rot}deg) scale(0)`, opacity: 0 }
        ], { duration: 1000 + Math.random() * 800, easing: 'cubic-bezier(0.25,0.8,0.25,1)', fill: 'forwards' });

        setTimeout(() => { if(p.parentNode) p.remove(); }, 2500);
    }
}

// Load saved theme on startup
chrome.storage.local.get(['gridTheme'], (r) => {
    if (r.gridTheme) currentTheme = r.gridTheme;
});

console.log("SFL Grid Script Loaded (v11 — Auto-Align).");

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
// These are set automatically from the bridge — no manual calibration needed!
let gridWorldX = null, gridWorldY = null;
let gridCellSize = 16;
let currentGridData = null;  // persists API colors across grid toggles

// Mode
let deviceMode = 'mid';
let domIntervalMs = 0;
let lastSeenTS = '0';

// Load saved state
chrome.storage.local.get(['walkSpeed', 'deviceMode', 'domIntervalMs'], (r) => {
    if (r.walkSpeed !== undefined) walkSpeed = r.walkSpeed;
    if (r.deviceMode) deviceMode = r.deviceMode;
    if (r.domIntervalMs !== undefined) domIntervalMs = r.domIntervalMs;
    console.log(`[Grid] Mode=${deviceMode} Speed=${walkSpeed}`);
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
    const sx = cam.canvasDisplayW / cam.canvasInternalW;
    const sy = cam.canvasDisplayH / cam.canvasInternalH;
    gridX = (gridWorldX - cam.scrollX) * cam.zoom * sx + cam.cameraX * sx + cam.canvasLeft;
    gridY = (gridWorldY - cam.scrollY) * cam.zoom * sy + cam.cameraY * sy + cam.canvasTop;
    masterGrid.style.left = gridX + 'px';
    masterGrid.style.top = gridY + 'px';
    masterGrid.style.transform = 'none';
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

    const sx = cam.canvasDisplayW / cam.canvasInternalW;
    const sy = cam.canvasDisplayH / cam.canvasInternalH;
    const correctX = (gridWorldX - cam.scrollX) * cam.zoom * sx + cam.cameraX * sx + cam.canvasLeft;
    const correctY = (gridWorldY - cam.scrollY) * cam.zoom * sy + cam.cameraY * sy + cam.canvasTop;
    const errX = correctX - gridX;
    const errY = correctY - gridY;
    if (Math.abs(errX) > 1 || Math.abs(errY) > 1) {
        gridX = correctX;
        gridY = correctY;
        masterGrid.style.left = gridX + 'px';
        masterGrid.style.top = gridY + 'px';
        masterGrid.style.transform = 'none';
    }
}

function fullDOMSnap() {
    const cam = readCameraFromDOM();
    if (!cam || gridWorldX === null || !masterGrid) return;
    const sx = cam.canvasDisplayW / cam.canvasInternalW;
    const sy = cam.canvasDisplayH / cam.canvasInternalH;
    gridX = (gridWorldX - cam.scrollX) * cam.zoom * sx + cam.cameraX * sx + cam.canvasLeft;
    gridY = (gridWorldY - cam.scrollY) * cam.zoom * sy + cam.cameraY * sy + cam.canvasTop;
    masterGrid.style.left = gridX + 'px';
    masterGrid.style.top = gridY + 'px';
    masterGrid.style.transform = 'none';
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
    if (!masterGrid) return;
    const r = masterGrid.getBoundingClientRect();
    gridX = r.left; gridY = r.top;
}

function gameLoop() {
    if (appState !== 'TRACKING' || !masterGrid) { animationFrameId = null; return; }
    if (deviceMode === 'high') { fullDOMSnap(); }
    else { applyWASD(); correctDriftIfFresh(); }
    animationFrameId = requestAnimationFrame(gameLoop);
}

function applyWASD() {
    let mx = 0, my = 0;
    if (keys.w) my += 1;
    if (keys.s) my -= 1;
    if (keys.a) mx += 1;
    if (keys.d) mx -= 1;
    if (mx !== 0 || my !== 0) {
        const len = Math.sqrt(mx * mx + my * my);
        gridX += (mx / len) * walkSpeed;
        gridY += (my / len) * walkSpeed;
        masterGrid.style.left = gridX + 'px';
        masterGrid.style.top = gridY + 'px';
        masterGrid.style.transform = 'none';
    }
}

// =============================================================================
// SIDEPANEL MESSAGES
// =============================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleGrid') {
        if (masterGrid) { masterGrid.remove(); masterGrid = null; stopTracking(); }
        else { createGrid(); }
    }
    else if (request.action === 'hideAll') {
        if (masterGrid) { masterGrid.remove(); masterGrid = null; } stopTracking();
    }
    else if (request.action === 'setLockState') { isGridLocked = request.isLocked; updateGridMode(); }
    else if (request.action === 'resetPosition') {
        if (masterGrid) { masterGrid.style.top='50%'; masterGrid.style.left='50%'; masterGrid.style.transform='translate(-50%,-50%)'; syncGridCoordinates(); }
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
    sendResponse({status:"ok"}); return true;
});

// =============================================================================
// KEYBOARD
// =============================================================================
window.addEventListener('keydown', (e) => {
    // Alt+1: TOGGLE — first press opens + aligns, second press hides
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
    masterGrid = document.createElement('div');
    masterGrid.id = 'sfl-master-grid';
    for (let i = 0; i < 100; i++) {
        const c = document.createElement('div');
        c.className = 'sfl-grid-cell';
        c.dataset.x = i % 10; c.dataset.y = Math.floor(i / 10);
        masterGrid.appendChild(c);
    }
    document.body.appendChild(masterGrid);
    updateGridMode(); makeDraggable(masterGrid);
    if (currentGridData) applyGridColors(currentGridData);
    console.log("[Grid] Grid created.");
}

function updateGridMode() {
    if (!masterGrid) return;
    masterGrid.classList.toggle('sfl-mode-locked', isGridLocked);
    masterGrid.classList.toggle('sfl-mode-unlocked', !isGridLocked);
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
// =============================================================================
// SFL Digging Assistant - Phaser Bridge (v1.0)
// Auto-alignment + live dig interception
// =============================================================================
(function () {
    'use strict';

    // =========================================================================
    // FETCH INTERCEPTOR — intercepts SFL API responses to extract grid,
    // streak, and inventory data for the overlay and reward detection.
    // =========================================================================
    let lastGridSnapshot = '[]';
    let previousGridLength = -1;

    function getItemName(tile) {
        if (tile.items && typeof tile.items === 'object') {
            const key = Object.keys(tile.items)[0];
            if (key) return key;
        }
        if (tile.name) return tile.name;
        return 'Sand';
    }

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

        // Only intercept actual SFL API calls (check hostname, not full URL,
        // to avoid matching analytics URLs that contain 'sunflower-land' in query params)
        let isSFL = false;
        try {
            const hostname = new URL(url).hostname;
            isSFL = hostname.includes('sunflower-land');
        } catch (e) { }

        if (!isSFL) return originalFetch.apply(this, args);

        // Detect digging reward claim in outgoing request body
        try {
            const body = args[1]?.body;
            if (body && typeof body === 'string' && body.includes('diggingReward.collected')) {
                window.postMessage({ type: 'SFL_REWARD_CLAIM_SENT', ts: Date.now() }, '*');
            }
        } catch(e) {}

        const response = await originalFetch.apply(this, args);
        if (!response.ok) return response;

        try {
            const clone = response.clone();
            const rawText = await clone.text();

            let data;
            try { data = JSON.parse(rawText); } catch (e) { return response; }

            const state = data?.farm || data?.state || data;
            if (!state?.desert?.digging) return response;

            const grid = state.desert.digging.grid;
            const patterns = state.desert.digging.patterns;

            if (!grid || !Array.isArray(grid)) return response;

            // --- Process grid update ---
            const snapshot = JSON.stringify(grid);
            if (snapshot !== lastGridSnapshot) {
                if (previousGridLength === -1) {
                    previousGridLength = grid.length;
                } else if (grid.length > previousGridLength) {
                    const newEntries = grid.slice(previousGridLength);
                    const newTiles = newEntries.flat();
                    newTiles.forEach(tile => {
                        const itemName = getItemName(tile);
                        window.postMessage({
                            type: 'SFL_DIG_RESULT',
                            row: tile.y,
                            col: tile.x,
                            item: itemName
                        }, '*');
                    });
                }
                previousGridLength = grid.length;
                lastGridSnapshot = snapshot;
                window.postMessage({
                    type: 'SFL_GRID_AUTO_UPDATE',
                    grid: grid,
                    patterns: patterns || []
                }, '*');
            }

            // Forward streak + inventory snapshot for digging rewards detection
            // (OUTSIDE the grid-change check — the claim doesn't change the grid,
            //  only streak.totalClaimed and inventory change)
            const streak = state.desert?.digging?.streak;
            const inventory = state.inventory;
            if (streak || inventory) {
                window.postMessage({
                    type: 'SFL_REWARD_SNAPSHOT',
                    streak: streak ? JSON.parse(JSON.stringify(streak)) : null,
                    inventory: inventory ? JSON.parse(JSON.stringify(inventory)) : null,
                    ts: Date.now()
                }, '*');
            }
        } catch (e) { }

        return response;
    };

    // =========================================================================
    // KNOWN GAME CONSTANTS (from sunflower-land source code)
    // BeachScene.ts: gridX=160, gridY=128, cellSize=16
    // desert.ts: DESERT_GRID_WIDTH=10, DESERT_GRID_HEIGHT=10
    // =========================================================================
    const GRID_WORLD_X = 160;
    const GRID_WORLD_Y = 128;
    const GRID_CELL_SIZE = 16;
    const GRID_COLS = 10;
    const GRID_ROWS = 10;

    let game = null;
    let findAttempts = 0;

    function findViaGlobal() {
        try {
            if (window.Phaser && Array.isArray(window.Phaser.GAMES) && window.Phaser.GAMES.length > 0)
                return window.Phaser.GAMES[0];
        } catch (e) { }
        return null;
    }

    function findViaWindowSearch() {
        try {
            for (const key of Object.getOwnPropertyNames(window)) {
                try {
                    const val = window[key];
                    if (val && typeof val === 'object' && !Array.isArray(val) &&
                        val.scene && val.canvas && val.renderer && val.config) return val;
                } catch (e) { }
            }
        } catch (e) { }
        return null;
    }

    function findViaReactFiber() {
        try {
            const canvas = document.querySelector('canvas');
            if (!canvas) return null;
            const parent = canvas.parentElement;
            if (!parent) return null;
            const fiberKey = Object.keys(parent).find(k => k.startsWith('__reactFiber$'));
            if (!fiberKey) return null;
            let fiber = parent[fiberKey];
            for (let i = 0; i < 30 && fiber; i++) {
                if (fiber.memoizedState) {
                    let hook = fiber.memoizedState;
                    while (hook) {
                        const ref = hook.memoizedState;
                        if (ref && typeof ref === 'object') {
                            if (ref.current && ref.current.scene && ref.current.canvas) return ref.current;
                            if (ref.scene && ref.canvas && ref.renderer) return ref;
                        }
                        hook = hook.next;
                    }
                }
                fiber = fiber.return;
            }
        } catch (e) { }
        return null;
    }

    function findPhaserGame() {
        return findViaGlobal() || findViaWindowSearch() || findViaReactFiber();
    }

    // --- Shared DOM element for camera data ---
    const camEl = document.createElement('div');
    camEl.id = 'sfl-camera-data';
    camEl.style.display = 'none';
    camEl.dataset.ts = '0';
    // Store known grid world coords for content.js to read
    camEl.dataset.gx = String(GRID_WORLD_X);
    camEl.dataset.gy = String(GRID_WORLD_Y);
    camEl.dataset.gc = String(GRID_CELL_SIZE);
    camEl.dataset.gcols = String(GRID_COLS);
    camEl.dataset.grows = String(GRID_ROWS);
    document.body.appendChild(camEl);

    let writeCounter = 0;

    let lastFindAt = 0;
    function writeCameraToDOM() {
        // The Phaser game can be destroyed and re-created (leaving the world for the farm and coming back)
        if (game && (!game.canvas || !game.canvas.isConnected)) {
            game = null;
            camEl.dataset.found = '0';
            camEl.dataset.scene = '';
        }
        if (!game) {
            // look for a (new) game at most twice a second — scanning window is not free
            const t = performance.now();
            if (t - lastFindAt < 500) return;
            lastFindAt = t;
            game = findPhaserGame();
            if (game) { camEl.dataset.found = '1'; }
            else { findAttempts++; camEl.dataset.found = '0'; camEl.dataset.scene = ''; return; }
        }
        try {
            const scenes = game.scene.getScenes(true);
            if (!scenes || scenes.length === 0) { camEl.dataset.scene = ''; return; }
            const scene = scenes.find(s => s.cameras && s.cameras.main);
            if (!scene) { camEl.dataset.scene = ''; return; }
            // Canvas hidden (React farm view etc.) → the world is not on screen
            const canvasBox = game.canvas.getBoundingClientRect();
            if (canvasBox.width < 2 || canvasBox.height < 2) { camEl.dataset.scene = ''; return; }
            // Which Phaser scene is on screen ('beach' = the dig site, 'plaza', …).
            // content.js hides the grid + overlays everywhere except the Beach.
            camEl.dataset.scene = (scene.scene && scene.scene.key) || (scene.sys && scene.sys.settings && scene.sys.settings.key) || '';
            const cam = scene.cameras.main;
            const canvas = game.canvas;
            const rect = canvas.getBoundingClientRect();
            camEl.dataset.sx = cam.worldView.x;
            camEl.dataset.sy = cam.worldView.y;
            camEl.dataset.z = cam.zoom;
            camEl.dataset.cx = cam.x;
            camEl.dataset.cy = cam.y;
            camEl.dataset.cl = rect.left;
            camEl.dataset.ct = rect.top;
            camEl.dataset.cdw = rect.width;
            camEl.dataset.cdh = rect.height;
            camEl.dataset.ciw = canvas.width;
            camEl.dataset.cih = canvas.height;
            camEl.dataset.found = '1';
            camEl.dataset.ts = String(++writeCounter);

            // --- Player position + silhouette tracking ---
            try {
                const player = scene.currentPlayer || scene.player;
                if (player && typeof player.x === 'number') {
                    const sx = rect.width / canvas.width;
                    const sy = rect.height / canvas.height;
                    const screenX = (player.x - cam.worldView.x) * cam.zoom * sx + cam.x * sx + rect.left;
                    const screenY = (player.y - cam.worldView.y) * cam.zoom * sy + cam.y * sy + rect.top;
                    camEl.dataset.px = screenX.toFixed(1);
                    camEl.dataset.py = screenY.toFixed(1);
                    camEl.dataset.pf = '1';
                    camEl.dataset.pScale = (cam.zoom * sx).toFixed(4);

                    // Pixel-perfect silhouette
                    const sil = getPlayerSilhouette(player);
                    if (sil && sil.polygon.length > 2) {
                        camEl.dataset.pPoly = JSON.stringify(sil.polygon);
                        camEl.dataset.pFw = sil.frameW;
                        camEl.dataset.pFh = sil.frameH;
                        // Check ALL possible flip methods
                        const isFlipped = sil.flipX || player.scaleX < 0 || (player.sprite && player.sprite.scaleX < 0) || player.direction === 'left' || player.directionFacing === 'left';
                        camEl.dataset.pFlip = isFlipped ? '1' : '0';
                        camEl.dataset.pSil = '1';
                    } else {
                        camEl.dataset.pSil = '0';
                    }
                } else {
                    camEl.dataset.pf = '0';
                    camEl.dataset.pSil = '0';
                }
            } catch (pe) { camEl.dataset.pf = '0'; camEl.dataset.pSil = '0'; }
        } catch (e) {
            camEl.dataset.found = '0';
            camEl.dataset.scene = '';
        }
    }

    // --- Tracking modes ---
    let activeMode = null;
    let rafId = null;
    let intervalId = null;

    function stopAll() {
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        if (intervalId) { clearInterval(intervalId); intervalId = null; }
        activeMode = null;
    }

    function startInterval(intervalMs) {
        stopAll();
        writeCameraToDOM();
        // Always use rAF ΓÇö writeCameraToDOM just reads 2 floats from a live
        // Phaser camera, essentially zero overhead. This ensures content.js
        // gets fresh data every frame for instant wall-collision detection.
        activeMode = 'raf';
        function loop() { if (activeMode !== 'raf') return; writeCameraToDOM(); rafId = requestAnimationFrame(loop); }
        loop();
    }

    function startHigh() {
        stopAll();
        activeMode = 'raf';
        function loop() { if (activeMode !== 'raf') return; writeCameraToDOM(); rafId = requestAnimationFrame(loop); }
        loop();
    }

    // --- Message handlers ---
    window.addEventListener('message', (e) => {
        if (!e.data || e.source !== window) return;

        if (e.data.type === 'SFL_GRID_READ_CAMERA') {
            writeCameraToDOM();
            const d = camEl.dataset;
            window.postMessage({
                type: 'SFL_GRID_CAMERA_RESULT',
                data: d.found === '1' ? {
                    scrollX: parseFloat(d.sx), scrollY: parseFloat(d.sy),
                    zoom: parseFloat(d.z),
                    cameraX: parseFloat(d.cx), cameraY: parseFloat(d.cy),
                    canvasLeft: parseFloat(d.cl), canvasTop: parseFloat(d.ct),
                    canvasDisplayW: parseFloat(d.cdw), canvasDisplayH: parseFloat(d.cdh),
                    canvasInternalW: parseFloat(d.ciw), canvasInternalH: parseFloat(d.cih),
                    found: true,
                    // Include the known grid world position
                    gridWorldX: GRID_WORLD_X,
                    gridWorldY: GRID_WORLD_Y,
                    gridCellSize: GRID_CELL_SIZE,
                    gridCols: GRID_COLS,
                    gridRows: GRID_ROWS
                } : null
            }, '*');
        }

        if (e.data.type === 'SFL_GRID_START_TRACKING') {
            const mode = e.data.mode || 'mid';
            const interval = e.data.interval || 0;
            if (mode === 'high') startHigh();
            else startInterval(interval);
            // (silent)
        }

        if (e.data.type === 'SFL_GRID_STOP_TRACKING') {
            stopAll();
            // (silent)
        }

        // Click forwarding: simulate a click on the game canvas at the specified grid tile
        if (e.data.type === 'SFL_GRID_CLICK_TILE') {
            const { row, col } = e.data;
            if (!game) return;
            try {
                const canvas = game.canvas;
                if (!canvas) return;
                const scenes = game.scene.getScenes(true);
                const scene = scenes?.find(s => s.cameras && s.cameras.main);
                if (!scene) return;
                const cam = scene.cameras.main;

                // World position of the tile center
                const worldX = GRID_WORLD_X + col * GRID_CELL_SIZE + GRID_CELL_SIZE / 2;
                const worldY = GRID_WORLD_Y + row * GRID_CELL_SIZE + GRID_CELL_SIZE / 2;

                // Convert world → canvas pixel coords
                const canvasX = (worldX - cam.worldView.x) * cam.zoom + cam.x;
                const canvasY = (worldY - cam.worldView.y) * cam.zoom + cam.y;

                // Convert canvas → screen coords
                const rect = canvas.getBoundingClientRect();
                const sx = rect.width / canvas.width;
                const sy = rect.height / canvas.height;
                const screenX = canvasX * sx + rect.left;
                const screenY = canvasY * sy + rect.top;

                // Simulate click
                const opts = { bubbles: true, clientX: screenX, clientY: screenY, pointerId: 1, pointerType: 'mouse' };
                canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
                setTimeout(() => {
                    canvas.dispatchEvent(new PointerEvent('pointerup', opts));
                }, 50);
                // (silent)
            } catch (err) {
                // (silent)
            }
        }
    });

    // =========================================================================
    // PIXEL-PERFECT SILHOUETTE ENGINE (Convex Hull)
    // Extracts character outline from sprite alpha, caches per animation frame
    // =========================================================================
    const silhouetteCache = new Map();

    function getPlayerSilhouette(player) {
        if (!player || !player.sprite || !player.sprite.frame) return null;
        const sprite = player.sprite;
        const frame = sprite.frame;
        const cacheKey = `${sprite.texture.key}-${frame.name}`;

        if (silhouetteCache.has(cacheKey)) {
            return { polygon: silhouetteCache.get(cacheKey), frameW: frame.cutWidth, frameH: frame.cutHeight, flipX: sprite.flipX };
        }

        try {
            const srcImage = sprite.texture.source[0]?.image;
            if (!srcImage || !srcImage.width) return null;

            const w = frame.cutWidth, h = frame.cutHeight;
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const ctx = c.getContext('2d');
            ctx.drawImage(srcImage, frame.cutX, frame.cutY, w, h, 0, 0, w, h);

            const imgData = ctx.getImageData(0, 0, w, h);
            const hull = extractSilhouette(imgData.data, w, h);

            silhouetteCache.set(cacheKey, hull);
            // (silent — cached silhouette)
            return { polygon: hull, frameW: w, frameH: h, flipX: sprite.flipX };
        } catch (e) {
            // (silent)
            silhouetteCache.set(cacheKey, []);
            return null;
        }
    }

    // Radial Sweep — casts rays from centroid, finds outermost opaque pixel per angle
    function extractSilhouette(pixels, w, h) {
        const THRESH = 20;
        const PAD = 1;
        const NUM_RAYS = 48; // every 7.5°

        // Skip top 15% (name label) and bottom 20% (shadow)
        const yStart = Math.floor(h * 0.15);
        const yEnd = Math.ceil(h * 0.80);

        // Build binary alpha map + find centroid
        const opaque = new Uint8Array(w * h);
        let cx = 0, cy = 0, count = 0;
        for (let y = yStart; y < yEnd; y++) {
            for (let x = 0; x < w; x++) {
                if (pixels[(y * w + x) * 4 + 3] > THRESH) {
                    opaque[y * w + x] = 1;
                    cx += x; cy += y; count++;
                }
            }
        }
        if (count < 10) return [];
        cx /= count; cy /= count;

        const maxR = Math.max(w, h);
        const points = [];

        for (let i = 0; i < NUM_RAYS; i++) {
            const angle = (i / NUM_RAYS) * Math.PI * 2;
            const dx = Math.cos(angle), dy = Math.sin(angle);
            let bestX = cx, bestY = cy, bestDist = 0;

            // Walk outward from center
            for (let r = 1; r < maxR; r++) {
                const px = Math.round(cx + dx * r);
                const py = Math.round(cy + dy * r);
                if (px < 0 || px >= w || py < yStart || py >= yEnd) break;
                if (opaque[py * w + px]) {
                    bestX = px; bestY = py; bestDist = r;
                }
            }
            if (bestDist > 0) {
                // Add padding outward
                points.push({
                    x: bestX + dx * PAD,
                    y: bestY + dy * PAD
                });
            }
        }

        return points;
    }

    // (silent — bridge loaded)
})();
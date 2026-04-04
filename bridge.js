// =============================================================================
// SFL Digging Helper - Phaser Bridge (v11.2)
// Auto-alignment + live dig interception
// =============================================================================
(function() {
    'use strict';

    // =========================================================================
    // FETCH INTERCEPTOR — Auto-detect grid updates from the game's own API
    // When user digs, SFL sends a request → response has updated grid → we
    // post it to content.js so the overlay updates instantly. Zero extra calls.
    // =========================================================================
    let lastGridSnapshot = '[]';
    let previousGridLength = -1; // -1 = first load (skip dig results for initial state)

    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
            if (url && url.includes('api.sunflower-land.com')) {
                const clone = response.clone();
                const data = await clone.json();

                const state = data?.farm || data?.state || data;
                const grid = state?.desert?.digging?.grid;

                if (grid) {
                    const snapshot = JSON.stringify(grid);
                    if (snapshot !== lastGridSnapshot) {
                        // On first load, set baseline — don't fire dig results for existing tiles
                        if (previousGridLength === -1) {
                            previousGridLength = grid.length;
                            console.log(`[SFL Bridge] Initial grid baseline: ${grid.length} tiles already dug`);
                        } else if (grid.length > previousGridLength) {
                            // Only fire for truly NEW digs (usually 1 at a time)
                            const newTiles = grid.slice(previousGridLength);
                            newTiles.forEach(tile => {
                                const itemName = tile.name || (tile.items ? Object.keys(tile.items)[0] : 'Sand');
                                window.postMessage({
                                    type: 'SFL_DIG_RESULT',
                                    row: tile.y,
                                    col: tile.x,
                                    item: itemName
                                }, '*');
                                console.log(`[SFL Bridge] Dig result: (${tile.x},${tile.y}) = ${itemName}`);
                            });
                        }
                        previousGridLength = grid.length;

                        lastGridSnapshot = snapshot;
                        window.postMessage({
                            type: 'SFL_GRID_AUTO_UPDATE',
                            grid: grid,
                            patterns: state?.desert?.digging?.patterns || []
                        }, '*');
                        console.log('[SFL Bridge] Grid auto-updated:', grid.length, 'dug cells');
                    }
                }
            }
        } catch(e) { /* ignore non-JSON responses */ }
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
        } catch(e) {}
        return null;
    }

    function findViaWindowSearch() {
        try {
            for (const key of Object.getOwnPropertyNames(window)) {
                try {
                    const val = window[key];
                    if (val && typeof val === 'object' && !Array.isArray(val) &&
                        val.scene && val.canvas && val.renderer && val.config) return val;
                } catch(e) {}
            }
        } catch(e) {}
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
        } catch(e) {}
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

    function writeCameraToDOM() {
        if (!game) {
            game = findPhaserGame();
            if (game) { console.log('[SFL Bridge] Phaser game FOUND.'); camEl.dataset.found = '1'; }
            else { findAttempts++; if (findAttempts <= 3) console.warn('[SFL Bridge] Game not found. Attempt ' + findAttempts); camEl.dataset.found = '0'; return; }
        }
        try {
            const scenes = game.scene.getScenes(true);
            if (!scenes || scenes.length === 0) return;
            const scene = scenes.find(s => s.cameras && s.cameras.main);
            if (!scene) return;
            const cam = scene.cameras.main;
            const canvas = game.canvas;
            const rect = canvas.getBoundingClientRect();
            camEl.dataset.sx = cam.worldView.x;
            camEl.dataset.sy = cam.worldView.y;
            camEl.dataset.z  = cam.zoom;
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
            } catch(pe) { camEl.dataset.pf = '0'; camEl.dataset.pSil = '0'; }
        } catch(e) {
            camEl.dataset.found = '0';
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
            console.log(`[SFL Bridge] ${mode.toUpperCase()} mode started.`);
        }

        if (e.data.type === 'SFL_GRID_STOP_TRACKING') {
            stopAll();
            console.log('[SFL Bridge] Stopped.');
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
                console.log(`[SFL Bridge] Clicked tile (${col},${row}) → canvas(${canvasX.toFixed(0)},${canvasY.toFixed(0)})`);
            } catch(err) {
                console.warn('[SFL Bridge] Click forwarding error:', err.message);
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
            console.log(`[SFL Bridge] Silhouette: ${cacheKey} → ${hull.length} hull pts (frame ${w}x${h})`);
            return { polygon: hull, frameW: w, frameH: h, flipX: sprite.flipX };
        } catch(e) {
            console.warn('[SFL Bridge] Silhouette error:', e.message);
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

    console.log('[SFL Bridge] Bridge loaded (v11.3 + Silhouette Engine). Grid at world(' + GRID_WORLD_X + ',' + GRID_WORLD_Y + ')');
})();

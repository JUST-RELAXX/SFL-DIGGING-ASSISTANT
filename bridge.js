// =============================================================================
// SFL Digging Helper - Phaser Bridge (v11)
// Auto-alignment using hardcoded grid constants from SFL's BeachScene.ts
// =============================================================================
(function() {
    'use strict';

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
        // Always use rAF — writeCameraToDOM just reads 2 floats from a live
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
    });

    console.log('[SFL Bridge] Bridge loaded. Grid at world(' + GRID_WORLD_X + ',' + GRID_WORLD_Y + ')');
})();

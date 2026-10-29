// =============================================================================
// SFL Fetch Interceptor — Injected at document_start (before game JS loads)
// This MUST run before the game's React/Phaser bundles capture window.fetch
// =============================================================================
(function() {
    'use strict';

    let lastGridSnapshot = '[]';
    let previousGridLength = -1; // -1 = first load

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
                        // On first load, set baseline
                        if (previousGridLength === -1) {
                            previousGridLength = grid.length;
                            console.log(`[SFL Interceptor] Initial grid baseline: ${grid.length} tiles already dug`);
                        } else if (grid.length > previousGridLength) {
                            const newTiles = grid.slice(previousGridLength);
                            newTiles.forEach(tile => {
                                const itemName = tile.name || (tile.items ? Object.keys(tile.items)[0] : 'Sand');
                                window.postMessage({
                                    type: 'SFL_DIG_RESULT',
                                    row: tile.y,
                                    col: tile.x,
                                    item: itemName
                                }, '*');
                                console.log(`[SFL Interceptor] Dig result: (${tile.x},${tile.y}) = ${itemName}`);
                            });
                        }
                        previousGridLength = grid.length;

                        lastGridSnapshot = snapshot;
                        window.postMessage({
                            type: 'SFL_GRID_AUTO_UPDATE',
                            grid: grid,
                            patterns: state?.desert?.digging?.patterns || [],
                            completedPatterns: state?.desert?.digging?.completedPatterns || [],
                            streak: state?.desert?.digging?.streak || null,
                            extraDigs: state?.desert?.digging?.extraDigs || 0,
                        }, '*');
                        console.log('[SFL Interceptor] Grid auto-updated:', grid.length, 'dug cells');
                    }
                }
            }
        } catch(e) { /* ignore non-JSON responses */ }
        return response;
    };

    console.log('[SFL Interceptor] Fetch interceptor installed BEFORE game JS.');
})();

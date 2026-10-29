// =============================================================================
// SFL Early Injector — runs at document_start to inject fetch interceptor
// into the page world BEFORE the game's JS bundles load.
//
// Strategy: Try inline injection first (synchronous, fastest).
// If CSP blocks inline scripts, fall back to src-based injection.
// =============================================================================

// --- Attempt 1: Inline injection (synchronous, guaranteed before game JS) ---
const inlineScript = document.createElement('script');
inlineScript.textContent = `
(function() {
    'use strict';

    var lastGridSnapshot = '[]';
    var previousGridLength = -1;

    var originalFetch = window.fetch;
    window.fetch = async function() {
        var args = arguments;
        var response = await originalFetch.apply(this, args);
        try {
            var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
            if (url && url.indexOf('api.sunflower-land.com') !== -1) {
                var clone = response.clone();
                var data = await clone.json();

                var state = (data && data.farm) || (data && data.state) || data;
                var grid = state && state.desert && state.desert.digging && state.desert.digging.grid;

                if (grid) {
                    var snapshot = JSON.stringify(grid);
                    if (snapshot !== lastGridSnapshot) {
                        if (previousGridLength === -1) {
                            previousGridLength = grid.length;
                            console.log('[SFL Interceptor] Initial grid baseline: ' + grid.length + ' tiles already dug');
                        } else if (grid.length > previousGridLength) {
                            var newTiles = grid.slice(previousGridLength);
                            for (var i = 0; i < newTiles.length; i++) {
                                var tile = newTiles[i];
                                var itemName = tile.name || (tile.items ? Object.keys(tile.items)[0] : 'Sand');
                                window.postMessage({
                                    type: 'SFL_DIG_RESULT',
                                    row: tile.y,
                                    col: tile.x,
                                    item: itemName
                                }, '*');
                                console.log('[SFL Interceptor] Dig result: (' + tile.x + ',' + tile.y + ') = ' + itemName);
                            }
                        }
                        previousGridLength = grid.length;

                        lastGridSnapshot = snapshot;
                        var patterns = (state.desert && state.desert.digging && state.desert.digging.patterns) || [];
                        var completedPatterns = (state.desert && state.desert.digging && state.desert.digging.completedPatterns) || [];
                        var streak = (state.desert && state.desert.digging && state.desert.digging.streak) || null;
                        var extraDigs = (state.desert && state.desert.digging && state.desert.digging.extraDigs) || 0;
                        window.postMessage({
                            type: 'SFL_GRID_AUTO_UPDATE',
                            grid: grid,
                            patterns: patterns,
                            completedPatterns: completedPatterns,
                            streak: streak,
                            extraDigs: extraDigs
                        }, '*');
                        console.log('[SFL Interceptor] Grid auto-updated: ' + grid.length + ' dug cells');
                    }
                }
            }
        } catch(e) { /* ignore non-JSON responses */ }
        return response;
    };

    window.__sflFetchIntercepted = true;
    console.log('[SFL Interceptor] Fetch interceptor installed (inline) BEFORE game JS.');
})();
`;

// Try to inject inline script
try {
    (document.head || document.documentElement).appendChild(inlineScript);
    inlineScript.remove();
} catch(e) {
    // CSP blocked inline — will fall back below
}

// --- Attempt 2: If inline failed (CSP), fall back to src-based injection ---
// This is async but better than nothing. Also tried from content.js/bridge.js later.
if (!document.documentElement.querySelector('script[data-sfl-interceptor]')) {
    // Check if inline worked by looking for the flag
    // We'll verify via a postMessage roundtrip after a tick
    setTimeout(() => {
        // Inject a tiny probe to check if window.__sflFetchIntercepted exists
        const probe = document.createElement('script');
        probe.textContent = `
            if (!window.__sflFetchIntercepted) {
                // Inline didn't work — inject via src
                var s = document.createElement('script');
                s.src = '${chrome.runtime.getURL('fetch-interceptor.js').replace(/'/g, "\\'")}';
                s.dataset.sflInterceptor = '1';
                document.documentElement.appendChild(s);
                console.log('[SFL Interceptor] Fallback: loading via src (CSP blocked inline).');
            }
        `;
        (document.head || document.documentElement).appendChild(probe);
        probe.remove();
    }, 0);
}

// Ensure side panel opens on icon click — register in multiple lifecycle hooks
// to handle Chrome's lazy service worker startup reliably.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// Fallback: if setPanelBehavior hasn't kicked in, force-open via action click
chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
});

const API_KEY = 'sfl.MTExMDI2MzcxMDQxNTI0OS4x.OCvWvWcOshzlpiY5ri4Y_7ZnZ--kxG2jS9VmwgJiiQs';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    // --- API Fetch ---
    if (request.action === 'fetch_farm_data') {
        const url = `https://api.sunflower-land.com/community/farms/${request.farmId}`;
        console.log(`[SFL BG] Fetching farm ${request.farmId} → ${url}`);

        const doFetch = (attempt = 1) => {
            fetch(url, {
                method: 'GET',
                headers: { 'x-api-key': API_KEY }
            })
            .then(async (res) => {
                if (res.ok) {
                    return res.json();
                }
                // Capture full error details before rejecting
                const bodyText = await res.text().catch(() => '(unreadable)');
                const headerObj = {};
                res.headers.forEach((v, k) => { headerObj[k] = v; });
                console.error(`[SFL BG] API error: HTTP ${res.status} ${res.statusText}`);
                console.error(`[SFL BG] Response headers:`, headerObj);
                console.error(`[SFL BG] Response body:`, bodyText);

                // Retry once on 429 (rate limit) after a delay
                if (res.status === 429 && attempt < 2) {
                    console.warn(`[SFL BG] Rate-limited (429). Retrying in 6s... (attempt ${attempt + 1})`);
                    setTimeout(() => doFetch(attempt + 1), 6000);
                    return; // don't sendResponse yet, the retry will
                }

                return Promise.reject({
                    status: res.status,
                    statusText: res.statusText,
                    body: bodyText
                });
            })
            .then(data => {
                if (data === undefined) return; // retry in progress, skip
                console.log(`[SFL BG] ✅ Farm ${request.farmId} fetched successfully`);
                sendResponse({ success: true, data: data });
            })
            .catch(error => {
                console.error(`[SFL BG] ❌ Fetch failed:`, error);
                const msg = error?.status
                    ? `HTTP ${error.status} ${error.statusText || ''}: ${(error.body || '').substring(0, 200)}`
                    : (error?.message || String(error));
                sendResponse({ success: false, error: msg });
            });
        };

        doFetch();
        return true; // keep message channel open for async sendResponse
    }

    // --- sfl.world P2P Prices Fetch ---
    if (request.action === 'fetch_sfl_prices') {
        const url = 'https://sfl.world/api/v1/prices';
        console.log('[SFL BG] Fetching P2P prices from sfl.world...');

        fetch(url)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(json => {
                const p2p = json?.data?.p2p || {};
                console.log(`[SFL BG] ✅ P2P prices loaded: ${Object.keys(p2p).length} items`);
                sendResponse({ success: true, data: p2p });
            })
            .catch(error => {
                console.warn('[SFL BG] ❌ P2P price fetch failed:', error?.message || error);
                sendResponse({ success: false, error: error?.message || String(error) });
            });

        return true; // async sendResponse
    }

    // --- sfl.world Exchange Rates Fetch ---
    if (request.action === 'fetch_sfl_exchange') {
        const url = 'https://sfl.world/api/v1.1/exchange';
        console.log('[SFL BG] Fetching exchange rates from sfl.world...');

        fetch(url)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(json => {
                const data = json?.data || {};
                console.log('[SFL BG] ✅ Exchange rates loaded');
                sendResponse({ success: true, data: data });
            })
            .catch(error => {
                console.warn('[SFL BG] ❌ Exchange rate fetch failed:', error?.message || error);
                sendResponse({ success: false, error: error?.message || String(error) });
            });

        return true; // async sendResponse
    }
});

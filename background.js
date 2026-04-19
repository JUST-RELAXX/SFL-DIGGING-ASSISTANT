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

const API_KEY = 'sfl.MTExMDI2MzcxMDQxNTI0OQ.Ih1bKhZtMNd30cdXvsoR6ajB1vkOpdDNblFiNUTnqLo';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    // --- API Fetch ---
    if (request.action === 'fetch_farm_data') {
        fetch(`https://api.sunflower-land.com/community/farms/${request.farmId}`, {
            method: 'GET',
            headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
        })
        .then(res => res.ok ? res.json() : Promise.reject(res.status))
        .then(data => sendResponse({ success: true, data: data }))
        .catch(error => sendResponse({ success: false, error: error }));
        return true;
    }
});

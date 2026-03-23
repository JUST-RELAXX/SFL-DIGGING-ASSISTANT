// =============================================================================
// SFL GAME ASSISTANT — Background Service Worker (v12.0)
// =============================================================================

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ tabId: tab.id });
});

// Set side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

console.log("[SFL-GA] Background service worker loaded.");
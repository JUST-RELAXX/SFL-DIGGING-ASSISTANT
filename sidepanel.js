document.addEventListener('DOMContentLoaded', () => {
    const farmInput = document.getElementById('farmIdInput');
    const statusDiv = document.getElementById('status');
    const lockToggle = document.getElementById('lockToggle');
    const speedSlider = document.getElementById('speedSlider');
    const speedDisplay = document.getElementById('speedDisplay');
    const domIntervalSlider = document.getElementById('domIntervalSlider');
    const domIntervalDisplay = document.getElementById('domIntervalDisplay');
    const advancedToggle = document.getElementById('advancedToggle');
    const advancedContent = document.getElementById('advancedContent');
    const highEndInfo = document.getElementById('highEndInfo');
    const modeBtns = document.querySelectorAll('.mode-btn');
    const themeSelector = document.getElementById('themeSelector');
    const auraToggle = document.getElementById('auraToggle');
    const perfTuning = document.getElementById('perfTuning');

    let currentMode = 'mid';

    const DEFAULTS = {
        low:  { speed: 3.3, intervalS: 5 },
        mid:  { speed: 3.3, intervalS: 0 },
        high: { speed: 3.3, intervalS: 0 }
    };

    function logStatus(msg, color = "#4ade80") {
        statusDiv.innerText = msg;
        statusDiv.style.color = color;
    }

    chrome.storage.local.get(['sflFarmId', 'walkSpeed', 'deviceMode', 'domIntervalMs', 'gridTheme', 'auraEnabled', 'perfTier'], (r) => {
        if (r.sflFarmId) farmInput.value = r.sflFarmId;
        if (r.walkSpeed !== undefined) {
            speedSlider.value = r.walkSpeed;
            speedDisplay.textContent = Number(r.walkSpeed).toFixed(3);
        }
        if (r.deviceMode) currentMode = r.deviceMode;
        if (r.domIntervalMs !== undefined) {
            const secs = r.domIntervalMs / 1000;
            domIntervalSlider.value = secs;
            domIntervalDisplay.textContent = secs > 0 ? secs : 'Live';
        }
        if (r.gridTheme) themeSelector.value = r.gridTheme;
        if (r.auraEnabled !== undefined) auraToggle.checked = r.auraEnabled;
        if (r.perfTier) perfTuning.value = r.perfTier;
        updateModeUI(currentMode);
        updateSettingsVisibility();
    });

    // --- Mode buttons ---
    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            currentMode = btn.dataset.mode;
            updateModeUI(currentMode);
            updateSettingsVisibility();

            const def = DEFAULTS[currentMode];
            speedSlider.value = def.speed;
            speedDisplay.textContent = def.speed.toFixed(3);
            domIntervalSlider.value = def.intervalS;
            domIntervalDisplay.textContent = def.intervalS > 0 ? def.intervalS : 'Live';

            const ms = def.intervalS * 1000;
            sendCommand('setMode', { mode: currentMode });
            sendCommand('updateSpeed', { speed: def.speed });
            sendCommand('setDOMInterval', { interval: ms });
            chrome.storage.local.set({ deviceMode: currentMode, walkSpeed: def.speed, domIntervalMs: ms });

            const labels = { low: 'Low-End', mid: 'Mid-Range', high: 'High-End' };
            logStatus(`Mode: ${labels[currentMode]}`, "#a5b4fc");
        });
    });

    function updateModeUI(mode) {
        modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    }

    function updateSettingsVisibility() {
        if (currentMode === 'high') {
            advancedToggle.style.display = 'none';
            advancedContent.classList.remove('visible');
            highEndInfo.style.display = 'block';
        } else {
            advancedToggle.style.display = 'block';
            highEndInfo.style.display = 'none';
        }
    }

    advancedToggle.addEventListener('click', () => {
        advancedToggle.classList.toggle('open');
        advancedContent.classList.toggle('visible');
        advancedToggle.textContent = advancedContent.classList.contains('visible')
            ? 'Hide Advanced Settings' : 'Advanced Settings (Dev-Level)';
    });

    // --- Speed slider ---
    speedSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        speedDisplay.textContent = val.toFixed(3);
        sendCommand('updateSpeed', { speed: val });
    });
    speedSlider.addEventListener('change', (e) => {
        chrome.storage.local.set({ walkSpeed: parseFloat(e.target.value) });
    });

    makeEditable(speedDisplay, (val) => {
        let v = parseFloat(val);
        if (isNaN(v) || v < 0) v = 3.3;
        if (v > 10) v = 10;
        speedDisplay.textContent = v.toFixed(3);
        speedSlider.value = v;
        sendCommand('updateSpeed', { speed: v });
        chrome.storage.local.set({ walkSpeed: v });
    });

    // --- DOM interval slider ---
    domIntervalSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        domIntervalDisplay.textContent = val > 0 ? val : 'Live';
    });
    domIntervalSlider.addEventListener('change', (e) => {
        const ms = parseFloat(e.target.value) * 1000;
        chrome.storage.local.set({ domIntervalMs: ms });
        sendCommand('setDOMInterval', { interval: ms });
    });

    makeEditable(domIntervalDisplay, (val) => {
        let v = parseFloat(val);
        if (isNaN(v) || v < 0) v = 0;
        if (v > 10) v = 10;
        domIntervalDisplay.textContent = v > 0 ? v : 'Live';
        domIntervalSlider.value = v;
        const ms = v * 1000;
        chrome.storage.local.set({ domIntervalMs: ms });
        sendCommand('setDOMInterval', { interval: ms });
    });

    function makeEditable(el, onCommit) {
        el.addEventListener('dblclick', () => {
            el.contentEditable = true;
            el.classList.add('editing');
            el.focus();
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        });
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
        el.addEventListener('blur', () => {
            el.contentEditable = false;
            el.classList.remove('editing');
            onCommit(el.textContent);
        });
    }

    // --- Core buttons ---
    lockToggle.addEventListener('change', (e) => {
        sendCommand('setLockState', { isLocked: e.target.checked });
    });

    document.getElementById('btnHide').addEventListener('click', () => sendCommand('hideAll'));

    // --- Aura Toggle ---
    auraToggle.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        chrome.storage.local.set({ auraEnabled: enabled });
        sendCommand('setAura', { enabled });
        logStatus(enabled ? 'Aura: ON' : 'Aura: OFF', '#a5b4fc');
    });

    // --- Theme Selector ---
    themeSelector.addEventListener('change', (e) => {
        const theme = e.target.value;
        chrome.storage.local.set({ gridTheme: theme });
        sendCommand('setGridTheme', { theme });
        const label = themeSelector.options[themeSelector.selectedIndex].text;
        logStatus(`Theme: ${label}`, '#a5b4fc');
    });

    // --- Performance Tuning ---
    perfTuning.addEventListener('change', (e) => {
        const tier = e.target.value;
        chrome.storage.local.set({ perfTier: tier });
        sendCommand('setPerformance', { tier });
        const label = perfTuning.options[perfTuning.selectedIndex].text;
        logStatus(`FX: ${label}`, '#a5b4fc');
    });

    // --- API Sync ---
    document.getElementById('btnSync').addEventListener('click', () => {
        const farmId = farmInput.value.trim();
        if (!farmId) return logStatus("Farm ID required.", "#ef4444");
        chrome.storage.local.set({ sflFarmId: farmId });
        logStatus("Fetching...", "#facc15");
        chrome.runtime.sendMessage({ action: 'fetch_farm_data', farmId }, (response) => {
            if (response && response.success) {
                const digData = response.data.farm.desert.digging.grid;
                logStatus(`Synced: ${digData.length} dug.`, "#4ade80");
                sendCommand('colorGrid', { apiGridData: digData });
            } else {
                logStatus("API error.", "#ef4444");
            }
        });
    });

    function sendCommand(action, data = {}) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].url.includes("sunflower-land.com")) {
                chrome.tabs.sendMessage(tabs[0].id, { action, ...data })
                    .catch(() => logStatus("Game tab not ready.", "#ef4444"));
            }
        });
    }
});

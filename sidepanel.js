document.addEventListener('DOMContentLoaded', () => {
    const farmInput = document.getElementById('farmIdInput');
    const statusDiv = document.getElementById('status');
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
    const preserveEffects = document.getElementById('preserveEffects');
    const predictionToggle = document.getElementById('predictionToggle');

    // --- Custom Theme Builder elements ---
    const customToggle = document.getElementById('customToggle');
    const customContent = document.getElementById('customContent');
    const customPrimary = document.getElementById('customPrimary');
    const customSecondary = document.getElementById('customSecondary');
    const customGlow = document.getElementById('customGlow');
    const glowVal = document.getElementById('glowVal');
    const customShape = document.getElementById('customShape');
    const customBorder = document.getElementById('customBorder');
    const customParticles = document.getElementById('customParticles');
    const customJackpot = document.getElementById('customJackpot');
    const customDigT2 = document.getElementById('customDigT2');
    const customDigT3 = document.getElementById('customDigT3');
    const customDigT4 = document.getElementById('customDigT4');
    const customDigT5 = document.getElementById('customDigT5');
    const customThemeName = document.getElementById('customThemeName');
    const btnSaveCustom = document.getElementById('btnSaveCustom');
    const btnApplyCustom = document.getElementById('btnApplyCustom');
    const btnDeleteCustom = document.getElementById('btnDeleteCustom');
    const customThemeGroup = document.getElementById('customThemeGroup');
    const customTierTabs = document.getElementById('customTierTabs');

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

    chrome.storage.local.get(['sflFarmId', 'walkSpeed', 'deviceMode', 'domIntervalMs', 'gridTheme', 'auraEnabled', 'perfTier', 'preserveUnderlying', 'predictionEnabled'], (r) => {
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
        if (r.preserveUnderlying !== undefined) preserveEffects.checked = r.preserveUnderlying;
        if (r.predictionEnabled !== undefined) predictionToggle.checked = r.predictionEnabled;
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
    document.getElementById('btnHide').addEventListener('click', () => sendCommand('hideAll'));

    // --- Aura Toggle ---
    auraToggle.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        chrome.storage.local.set({ auraEnabled: enabled });
        sendCommand('setAura', { enabled });
        logStatus(enabled ? 'Aura: ON' : 'Aura: OFF', '#a5b4fc');
    });


    // --- Performance Tuning ---
    perfTuning.addEventListener('change', (e) => {
        const tier = e.target.value;
        chrome.storage.local.set({ perfTier: tier });
        sendCommand('setPerformance', { tier });
        const label = perfTuning.options[perfTuning.selectedIndex].text;
        logStatus(`FX: ${label}`, '#a5b4fc');
    });

    // --- Preserve Underlying Effects ---
    preserveEffects.addEventListener('change', (e) => {
        const preserve = e.target.checked;
        chrome.storage.local.set({ preserveUnderlying: preserve });
        sendCommand('setPreserveEffects', { preserve });
        logStatus(preserve ? 'Underlying FX: Preserved' : 'Underlying FX: Scaled', '#a5b4fc');
    });

    // --- Dig Predictions ---
    predictionToggle.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        chrome.storage.local.set({ predictionEnabled: enabled });
        sendCommand('setPrediction', { enabled });
        logStatus(enabled ? '🔮 Predictions: ON' : '🔮 Predictions: OFF', '#a5b4fc');
    });

    document.getElementById('btnSync').addEventListener('click', () => {
        const farmId = farmInput.value.trim();
        if (!farmId) return logStatus("Farm ID required.", "#ef4444");
        chrome.storage.local.set({ sflFarmId: farmId });
        logStatus("Fetching...", "#facc15");
        chrome.runtime.sendMessage({ action: 'fetch_farm_data', farmId }, (response) => {
            if (chrome.runtime.lastError) {
                logStatus(`Extension error: ${chrome.runtime.lastError.message}`, "#ef4444");
                console.error('[SFL Panel] runtime.lastError:', chrome.runtime.lastError);
                return;
            }
            if (response && response.success) {
                const digData = response.data?.farm?.desert?.digging?.grid;
                if (!digData || !Array.isArray(digData)) {
                    logStatus("Farm has no dig data yet.", "#facc15");
                    console.warn('[SFL Panel] Response shape:', JSON.stringify(Object.keys(response.data || {})));
                    return;
                }
                logStatus(`Synced: ${digData.length} dug.`, "#4ade80");
                sendCommand('colorGrid', { apiGridData: digData });
            } else {
                const errMsg = response?.error || 'Unknown error (no response from background)';
                logStatus(`API error: ${errMsg}`, "#ef4444");
                console.error('[SFL Panel] Sync failed:', errMsg);
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

    // =========================================================================
    // CUSTOM THEME BUILDER
    // =========================================================================

    // Toggle open/close
    customToggle.addEventListener('click', () => {
        customToggle.classList.toggle('open');
        customContent.classList.toggle('visible');
        customToggle.textContent = customContent.classList.contains('visible')
            ? '✦ Hide Custom Builder' : '✦ Custom Theme Builder';
    });

    // Tier tabs
    customTierTabs.querySelectorAll('[data-tier-target]').forEach(tab => {
        tab.addEventListener('click', () => {
            customTierTabs.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.custom-tier-panel').forEach(p => p.style.display = 'none');
            tab.classList.add('active');
            document.getElementById(tab.dataset.tierTarget).style.display = 'block';
        });
    });

    // Glow slider display
    customGlow.addEventListener('input', () => { glowVal.textContent = parseFloat(customGlow.value).toFixed(1); });

    // Get current custom config from UI
    function getCustomConfig() {
        return {
            primaryColor: customPrimary.value,
            secondaryColor: customSecondary.value,
            glowIntensity: parseFloat(customGlow.value),
            tileShape: customShape.value,
            borderStyle: customBorder.value,
            particleType: customParticles.value,
            jackpotEffect: customJackpot.value,
            digT2: customDigT2.value,
            digT3: customDigT3.value,
            digT4: customDigT4.value,
            digT5: customDigT5.value
        };
    }

    // Load config into UI controls
    function loadConfigIntoUI(config) {
        customPrimary.value = config.primaryColor || '#00ffff';
        customSecondary.value = config.secondaryColor || '#ff00ff';
        customGlow.value = config.glowIntensity || 1;
        glowVal.textContent = parseFloat(customGlow.value).toFixed(1);
        customShape.value = config.tileShape || 'square';
        customBorder.value = config.borderStyle || 'neon';
        customParticles.value = config.particleType || 'shards';
        customJackpot.value = config.jackpotEffect || 'orbital';
        customDigT2.value = config.digT2 || 'bone-shatter';
        customDigT3.value = config.digT3 || 'gold-pop';
        customDigT4.value = config.digT4 || 'snap';
        customDigT5.value = config.digT5 || 'thud';
    }

    // Track which saved theme we're editing (null = live/new mode)
    let editingThemeId = null;
    let editingThemeName = null;

    // Apply custom theme live
    function applyCustomLive() {
        const config = getCustomConfig();
        chrome.storage.local.set({ activeCustomConfig: config });
        sendCommand('setCustomTheme', { config });

        if (editingThemeId) {
            // We're editing a saved theme — save edits back
            chrome.storage.local.get(['customThemes'], (r) => {
                const themes = r.customThemes || [];
                const idx = themes.findIndex(t => t.id === editingThemeId);
                if (idx >= 0) {
                    themes[idx].config = config;
                    chrome.storage.local.set({ customThemes: themes, gridTheme: editingThemeId, activeCustomConfig: config }, () => {
                        logStatus(`Saved edits to "${editingThemeName}"`, '#4ade80');
                    });
                }
            });
        } else {
            themeSelector.value = 'custom-live';
            chrome.storage.local.set({ gridTheme: 'custom-live' });
            logStatus('Custom theme applied!', '#ffd700');
        }
    }

    // Update button text based on mode
    function updateApplyButton() {
        if (editingThemeId) {
            btnApplyCustom.textContent = '💾 SAVE ANY EDITS';
            btnApplyCustom.style.borderColor = 'rgba(74, 222, 128, 0.4)';
            btnApplyCustom.style.color = '#4ade80';
        } else {
            btnApplyCustom.textContent = 'Apply Custom Theme Live';
            btnApplyCustom.style.borderColor = '';
            btnApplyCustom.style.color = '';
        }
    }

    btnApplyCustom.addEventListener('click', applyCustomLive);

    // Save custom theme
    btnSaveCustom.addEventListener('click', () => {
        const name = customThemeName.value.trim();
        if (!name) return logStatus('Enter a theme name.', '#ef4444');

        const id = 'custom-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const config = getCustomConfig();

        chrome.storage.local.get(['customThemes'], (r) => {
            const themes = r.customThemes || [];
            // Replace if same name exists
            const idx = themes.findIndex(t => t.id === id);
            const entry = { name, id, config };
            if (idx >= 0) themes[idx] = entry;
            else themes.push(entry);

            chrome.storage.local.set({ customThemes: themes }, () => {
                populateCustomThemes(themes);
                themeSelector.value = id;
                chrome.storage.local.set({ gridTheme: id, activeCustomConfig: config });
                sendCommand('setCustomTheme', { config });
                logStatus(`Saved: "${name}"`, '#4ade80');
                customThemeName.value = '';
                editingThemeId = id;
                editingThemeName = name;
                updateApplyButton();
                btnDeleteCustom.style.display = 'block';
            });
        });
    });

    // Delete selected custom theme
    btnDeleteCustom.addEventListener('click', () => {
        const selected = themeSelector.value;
        if (!selected.startsWith('custom-') || selected === 'custom-live') return;

        chrome.storage.local.get(['customThemes'], (r) => {
            const themes = (r.customThemes || []).filter(t => t.id !== selected);
            chrome.storage.local.set({ customThemes: themes, gridTheme: 'none' }, () => {
                populateCustomThemes(themes);
                themeSelector.value = 'none';
                sendCommand('setGridTheme', { theme: 'none' });
                editingThemeId = null;
                editingThemeName = null;
                updateApplyButton();
                logStatus('Custom theme deleted.', '#ef4444');
            });
        });
    });

    // Populate the Custom(s) optgroup from storage
    function populateCustomThemes(themes) {
        customThemeGroup.innerHTML = '';
        // Always add the "live" option
        const liveOpt = document.createElement('option');
        liveOpt.value = 'custom-live';
        liveOpt.textContent = '⚡ Live Custom (Builder)';
        customThemeGroup.appendChild(liveOpt);

        themes.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = `✦ ${t.name}`;
            customThemeGroup.appendChild(opt);
        });
    }

    // When a saved custom theme is selected from dropdown
    themeSelector.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'custom-live') {
            applyCustomLive();
            editingThemeId = null;
            editingThemeName = null;
            updateApplyButton();
            btnDeleteCustom.style.display = 'none';
            return;
        }
        if (val.startsWith('custom-')) {
            chrome.storage.local.get(['customThemes'], (r) => {
                const found = (r.customThemes || []).find(t => t.id === val);
                if (found) {
                    loadConfigIntoUI(found.config);
                    chrome.storage.local.set({ gridTheme: val, activeCustomConfig: found.config });
                    sendCommand('setCustomTheme', { config: found.config });
                    logStatus(`Theme: ✦ ${found.name}`, '#ffd700');
                    editingThemeId = found.id;
                    editingThemeName = found.name;
                    updateApplyButton();
                    btnDeleteCustom.style.display = 'block';
                }
            });
            return;
        }
        // Built-in theme
        editingThemeId = null;
        editingThemeName = null;
        updateApplyButton();
        btnDeleteCustom.style.display = 'none';
        chrome.storage.local.set({ gridTheme: val });
        sendCommand('setGridTheme', { theme: val });
        const label = themeSelector.options[themeSelector.selectedIndex].text;
        logStatus(`Theme: ${label}`, '#a5b4fc');
    });

    // Load saved custom themes on panel open
    chrome.storage.local.get(['customThemes', 'activeCustomConfig', 'gridTheme'], (r) => {
        const themes = r.customThemes || [];
        populateCustomThemes(themes);
        if (r.activeCustomConfig) loadConfigIntoUI(r.activeCustomConfig);
        // If a saved theme is active, enter edit mode
        if (r.gridTheme && r.gridTheme.startsWith('custom-') && r.gridTheme !== 'custom-live') {
            const found = themes.find(t => t.id === r.gridTheme);
            if (found) {
                editingThemeId = found.id;
                editingThemeName = found.name;
                updateApplyButton();
            }
        }
    });

    // =========================================================================
    // 3D ANIMATION PREVIEW ENGINE
    // =========================================================================

    const previewToggle = document.getElementById('previewToggle');
    const previewContent = document.getElementById('previewContent');
    const previewViewport = document.getElementById('previewViewport');
    const previewScene = document.getElementById('previewScene');
    const previewTile = document.getElementById('previewTile');
    const previewWrapper = document.querySelector('#previewContent #sfl-grid-wrapper');
    const previewTierTabs = document.getElementById('previewTierTabs');
    const btnPlay = document.getElementById('btnPreviewPlay');
    const btnPause = document.getElementById('btnPreviewPause');
    const btnReset = document.getElementById('btnPreviewReset');
    const axisDisplay = document.getElementById('previewAxis');
    const loopDisplay = document.getElementById('previewLoopCounter');
    const themeLabel = document.getElementById('previewThemeLabel');

    // Built-in theme particle color map (matches content.js)
    const THEME_COLORS = {
        hellfire: ['#ff4500','#ff0000'], molten: ['#ff4500','#ff6a00'],
        electric: ['#00ffff','#ffffff'], cyberpunk: ['#00ffff','#ff00ff'],
        toxic: ['#39ff14','#00ff00'], matrix: ['#00ff00','#39ff14'],
        void: ['#8a2be2','#4b0082'], aurora: ['#00ffcc','#ff69b4'],
        blood: ['#ff0000','#8a0303'], holy: ['#ffd700','#ffffff'],
        abyss: ['#00bfff','#001a33'], arcane: ['#b100ff','#ff00ff'],
        synthwave: ['#ff00ff','#00ffff'], mecha: ['#ff6a00','#ffffff'],
        obsidian: ['#4b0082','#000000'], prismatic: ['#ff0000','#00ff00'],
        frost: ['#00ffff','#ffffff'], disco: ['#ff00ff','#ffff00'],
        alien: ['#39ff14','#00ffcc'], hextech: ['#00ffff','#ffd700'],
        gold: ['#ffd700','#ffffff'], nebula: ['#9b59b6','#3498db'],
        arcade: ['#00ff00','#ffffff'], mirage: ['#ff8c00','#ffd700'],
        crystal: ['#00bfff','#ffffff'], steampunk: ['#b87333','#ffd700'],
        necro: ['#8a2be2','#39ff14'], quantum: ['#00ffff','#b100ff'],
        vaporwave: ['#ff71ce','#01cdfe'], spinning: ['#ff4500','#ffd700'],
    };

    let previewTier = '3';
    let orbitX = 0, orbitY = 0;
    let isDragging = false, dragStartX = 0, dragStartY = 0, startOrbitX = 0, startOrbitY = 0;
    let previewPlaying = false;
    let loopCount = 0;
    const MAX_LOOPS = 5;
    let animationTimers = [];
    let isPaused = false;

    // Toggle
    previewToggle.addEventListener('click', () => {
        previewToggle.classList.toggle('open');
        previewContent.classList.toggle('visible');
        previewToggle.textContent = previewContent.classList.contains('visible')
            ? '🎬 Hide Preview Engine' : '🎬 Animation Preview Engine';
    });

    // Tier tabs
    previewTierTabs.querySelectorAll('[data-preview-tier]').forEach(tab => {
        tab.addEventListener('click', () => {
            previewTierTabs.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            tab.classList.add('active');
            previewTier = tab.dataset.previewTier;
            autoPlayPreview();
        });
    });

    // --- 3D ORBIT CAMERA ---
    previewViewport.addEventListener('mousedown', (e) => {
        isDragging = true;
        dragStartX = e.clientX; dragStartY = e.clientY;
        startOrbitX = orbitX; startOrbitY = orbitY;
        previewViewport.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        orbitY = startOrbitY + (e.clientX - dragStartX) * 0.5;
        orbitX = Math.max(-80, Math.min(80, startOrbitX - (e.clientY - dragStartY) * 0.5));
        updateOrbitTransform();
    });
    window.addEventListener('mouseup', () => { isDragging = false; previewViewport.style.cursor = 'grab'; });

    function updateOrbitTransform() {
        previewScene.style.transform = `perspective(800px) rotateX(${orbitX}deg) rotateY(${orbitY}deg)`;
        axisDisplay.textContent = `X: ${Math.round(orbitX)}° Y: ${Math.round(orbitY)}°`;
    }
    btnReset.addEventListener('click', () => { orbitX = 0; orbitY = 0; updateOrbitTransform(); });

    // --- GET CURRENT PREVIEW THEME INFO ---
    function getPreviewThemeInfo() {
        const selected = themeSelector.value;
        const label = themeSelector.options[themeSelector.selectedIndex]?.text || 'No Theme';
        const isCustom = selected === 'custom-live' || selected.startsWith('custom-');
        const isNone = selected === 'none';
        return { selected, label, isCustom, isNone };
    }

    // --- CONFIGURE PREVIEW WRAPPER FOR CURRENT THEME ---
    function configurePreviewWrapper() {
        const { selected, label, isCustom, isNone } = getPreviewThemeInfo();
        const w = previewWrapper;

        // Update theme name label (strip numbering and icons)
        themeLabel.textContent = isNone ? 'No Theme' : label.replace(/^\d+\.\s*/, '').replace(/^[⚡✦]\s*/, '');

        // Clear previous state
        w.removeAttribute('data-theme');
        ['shape','border','particles','jackpot','digT2','digT3','digT4','digT5'].forEach(k => delete w.dataset[k]);
        w.style.removeProperty('--engine-primary');
        w.style.removeProperty('--engine-secondary');
        w.style.removeProperty('--engine-glow-intensity');

        if (isNone) return;

        if (isCustom) {
            const config = getCustomConfig();
            w.setAttribute('data-theme', 'custom');
            w.style.setProperty('--engine-primary', config.primaryColor || '#00ffff');
            w.style.setProperty('--engine-secondary', config.secondaryColor || '#ff00ff');
            w.style.setProperty('--engine-glow-intensity', config.glowIntensity || 1);
            w.dataset.shape = config.tileShape || 'square';
            w.dataset.border = config.borderStyle || 'neon';
            w.dataset.particles = config.particleType || 'shards';
            w.dataset.jackpot = config.jackpotEffect || 'orbital';
            w.dataset.digT2 = config.digT2 || 'bone-shatter';
            w.dataset.digT3 = config.digT3 || 'gold-pop';
            w.dataset.digT4 = config.digT4 || 'snap';
            w.dataset.digT5 = config.digT5 || 'thud';
        } else {
            w.setAttribute('data-theme', selected);
        }
        w.dataset.quality = perfTuning.value;
    }

    // --- GET PARTICLE COLORS ---
    function getPreviewColors() {
        const { selected, isCustom } = getPreviewThemeInfo();
        if (isCustom) {
            const config = getCustomConfig();
            return [config.primaryColor || '#00ffff', config.secondaryColor || '#ff00ff'];
        }
        return THEME_COLORS[selected] || ['#ffffff', '#cccccc'];
    }

    // --- ANIMATION CORE ---
    function resetTile() {
        previewTile.className = 'sfl-grid-cell';
        previewTile.dataset.type = ['blue','yellow','red'][Math.floor(Math.random()*3)];
        previewTile.style.cssText = 'width:100%;height:100%;position:relative;border-radius:6px;transform-style:preserve-3d;';
        previewWrapper.querySelectorAll('.dig-fx-container, .dig-particle, .jackpot-text').forEach(e => e.remove());
        previewWrapper.classList.remove('jackpot-active');
        previewWrapper.style.animationPlayState = '';
    }

    function playOneLoop() {
        if (loopCount >= MAX_LOOPS) { stopPreview(); return; }
        loopCount++;
        loopDisplay.textContent = `Loop: ${loopCount}/${MAX_LOOPS}`;

        configurePreviewWrapper();
        resetTile();
        if (getPreviewThemeInfo().isNone) { stopPreview(); return; }

        previewTile.classList.add('digging', `tier-${previewTier}`);

        const fx = document.createElement('div');
        fx.className = 'dig-fx-container';
        fx.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:10;overflow:visible;';
        previewTile.appendChild(fx);

        if (previewTier === '1') previewWrapper.classList.add('jackpot-active');

        spawnPreviewParticles();

        const duration = previewTier === '1' ? 3500 : 2500;
        const timer = setTimeout(() => {
            resetTile();
            const gapTimer = setTimeout(() => playOneLoop(), 400);
            animationTimers.push(gapTimer);
        }, duration);
        animationTimers.push(timer);
    }

    function spawnPreviewParticles() {
        const colors = getPreviewColors();
        const quality = perfTuning.value;
        let num = 20, velMult = 1, sizeMult = 1;
        if (previewTier === '1') {
            if (quality === 'ultra') { num = 100; velMult = 3; sizeMult = 2; }
            else if (quality === 'high') { num = 60; velMult = 2.5; sizeMult = 1.5; }
            else if (quality === 'medium') { num = 25; velMult = 1.5; }
            else { num = 8; sizeMult = 0.8; }
        } else if (previewTier === '5') { num = 8; velMult = 0.4; sizeMult = 0.7; }

        const tileRect = previewTile.getBoundingClientRect();
        const parentRect = previewWrapper.getBoundingClientRect();
        const cx = (tileRect.left - parentRect.left) + tileRect.width / 2;
        const cy = (tileRect.top - parentRect.top) + tileRect.height / 2;

        for (let i = 0; i < num; i++) {
            const p = document.createElement('div');
            p.className = 'dig-particle';
            let bg = previewTier === '5' ? '#660000' : colors[i % 2];
            let shadow = previewTier === '5' ? '#220000' : bg;

            const size = (Math.random() * 6 + 3) * sizeMult;
            p.style.width = `${size}px`; p.style.height = `${size}px`;
            p.style.backgroundColor = bg;
            if (quality !== 'potato') p.style.boxShadow = `0 0 10px ${shadow}`;
            p.style.left = `${cx - size/2}px`; p.style.top = `${cy - size/2}px`;
            previewWrapper.appendChild(p);

            const angle = Math.random() * Math.PI * 2;
            let vel = (Math.random() * 80 + 30) * velMult;
            if (previewTier === '5') vel *= 0.3;
            const dx = Math.cos(angle) * vel;
            let dy = Math.sin(angle) * vel;
            if (previewTier === '5') dy = Math.abs(dy) + 30;

            p.animate([
                { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
                { transform: `translate(${dx}px,${dy}px) rotate(${Math.random()*720-360}deg) scale(0)`, opacity: 0 }
            ], { duration: (600 + Math.random()*800) * (previewTier==='1'?1.5:1), easing: 'cubic-bezier(0.175,0.885,0.32,1.275)', fill: 'forwards' });
            setTimeout(() => { if(p.parentNode) p.remove(); }, 3000);
        }
    }

    function playPreview() {
        previewPlaying = true; isPaused = false; loopCount = 0;
        btnPlay.style.borderColor = 'rgba(0,255,204,0.5)';
        btnPause.style.borderColor = 'rgba(255,255,255,0.15)';
        playOneLoop();
    }
    function stopPreview() {
        previewPlaying = false;
        animationTimers.forEach(t => clearTimeout(t));
        animationTimers = [];
        btnPlay.style.borderColor = '';
    }
    function pausePreview() {
        previewWrapper.style.animationPlayState = 'paused';
        previewWrapper.querySelectorAll('*').forEach(el => el.style.animationPlayState = 'paused');
        previewWrapper.getAnimations({ subtree: true }).forEach(a => a.pause());
        btnPause.style.borderColor = 'rgba(255,200,0,0.5)';
        btnPlay.style.borderColor = 'rgba(255,255,255,0.15)';
    }
    function resumePreview() {
        previewWrapper.style.animationPlayState = '';
        previewWrapper.querySelectorAll('*').forEach(el => el.style.animationPlayState = '');
        previewWrapper.getAnimations({ subtree: true }).forEach(a => a.play());
        btnPause.style.borderColor = 'rgba(255,255,255,0.15)';
        btnPlay.style.borderColor = 'rgba(0,255,204,0.5)';
    }

    btnPlay.addEventListener('click', () => {
        if (isPaused) { resumePreview(); isPaused = false; return; }
        stopPreview(); playPreview();
    });
    btnPause.addEventListener('click', () => {
        if (!previewPlaying) return;
        if (isPaused) { resumePreview(); isPaused = false; }
        else { pausePreview(); isPaused = true; }
    });

    // --- AUTO-PLAY: restart preview when theme or custom control changes ---
    function autoPlayPreview() {
        if (previewContent.classList.contains('visible')) {
            stopPreview();
            playPreview();
        }
    }

    // Theme selector changes -> auto-play
    themeSelector.addEventListener('change', () => setTimeout(autoPlayPreview, 100));

    // All custom builder controls -> auto-play
    [customPrimary, customSecondary, customGlow, customShape, customBorder,
     customParticles, customJackpot, customDigT2, customDigT3, customDigT4, customDigT5
    ].forEach(el => {
        el.addEventListener('input', () => setTimeout(autoPlayPreview, 50));
        el.addEventListener('change', () => setTimeout(autoPlayPreview, 50));
    });

    // Perf tuning change -> auto-play
    perfTuning.addEventListener('change', () => setTimeout(autoPlayPreview, 50));

    updateOrbitTransform();
});

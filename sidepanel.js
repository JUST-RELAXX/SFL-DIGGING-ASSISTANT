// =============================================================================
// SFL GAME ASSISTANT — Sidepanel Logic (v12.0)
// =============================================================================
console.log("[SFL-GA] Sidepanel loaded.");

// =========================================================================
// STATE
// =========================================================================
let farmId = null;
let farmData = null;
let p2pPrices = null;
let tokenPriceData = null;
let selectedCurrency = 'USD';
let isFirstVisit = true;
let exchangeRates = {};

// Item category maps
const FRUIT_ITEMS = ['Apple','Banana','Orange','Blueberry','Grape','Lemon','Tomato','Duskberry','Lunara','Celestine'];
const CROP_ITEMS = ['Sunflower','Potato','Pumpkin','Carrot','Cabbage','Beetroot','Cauliflower','Parsnip','Radish','Wheat','Kale','Soybean','Corn','Eggplant','Turnip','Barley','Rhubarb','Zucchini','Yam','Broccoli','Onion','Artichoke','Pepper'];
const NPC_COLORS = {
    betty:'#ea580c', blacksmith:'#6b7280', pumpkin_pete:'#f59e0b', raven:'#7c3aed',
    tywin:'#dc2626', bert:'#059669', timmy:'#3b82f6', cornwell:'#ca8a04',
    finn:'#0891b2', miranda:'#db2777', corale:'#06b6d4', tango:'#f97316',
    victoria:'#8b5cf6', grimbly:'#4b5563', grimtooth:'#374151', old_salty:'#64748b',
    gordo:'#16a34a', gambit:'#7c3aed', jester:'#e11d48', peggy:'#ec4899',
    guria:'#0d9488', grubnuk:'#65a30d', pharaoh:'#d97706', finley:'#0284c7',
    default:'#6366f1'
};

// SFL Level XP thresholds (simplified — each level needs more XP)
function calcLevel(xp) {
    // SFL uses a progressive XP curve
    const thresholds = [0,50,250,750,2000,5000,12000,25000,50000,100000,
        200000,400000,700000,1100000,1600000,2200000,3000000,4000000,5500000,7500000,10000000];
    for (let i = thresholds.length - 1; i >= 0; i--) {
        if (xp >= thresholds[i]) return i + 1;
    }
    return 1;
}

// =========================================================================
// INIT
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initFarmInput();
    initBalanceCards();
    initCurrencySelector();
    initTaskSummary();
    initDiggingTab();
    loadSavedFarmId();
});

// =========================================================================
// TAB NAVIGATION
// =========================================================================
function initTabs() {
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
            document.getElementById('page-' + btn.dataset.tab).classList.add('active');
        });
    });
}

// =========================================================================
// FARM INPUT & LOADING
// =========================================================================
function initFarmInput() {
    const btnLoad = document.getElementById('btnLoad');
    const input = document.getElementById('farmInput');
    btnLoad.addEventListener('click', () => loadFarm(input.value.trim()));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') loadFarm(input.value.trim()); });
    document.getElementById('btnRefreshTasks').addEventListener('click', () => { if (farmId) loadFarm(farmId); });
}

function loadSavedFarmId() {
    chrome.storage.local.get(['farmId', 'isFirstVisit'], r => {
        if (r.farmId) {
            farmId = r.farmId;
            document.getElementById('farmInput').value = farmId;
            document.getElementById('digFarmInput').value = farmId;
            loadFarm(farmId);
        }
        if (r.isFirstVisit === false) isFirstVisit = false;
    });
}

async function loadFarm(id) {
    if (!id) { showStatus('Please enter a Farm ID', 'warn'); return; }
    farmId = id;
    chrome.storage.local.set({ farmId, isFirstVisit: false });
    showStatus('Loading farm data...', 'loading');

    try {
        // Fetch all data in parallel
        const [farmResp, pricesResp, tokenResp] = await Promise.all([
            fetchFarmData(id),
            fetchP2PPrices(),
            fetchTokenPrice()
        ]);

        farmData = farmResp;
        p2pPrices = pricesResp;
        tokenPriceData = tokenResp;

        // Render everything
        renderHome();
        renderTasks();
        showStatus('✅ Farm loaded successfully!', 'success');
        setTimeout(() => hideStatus(), 2000);
    } catch (err) {
        console.error('[SFL-GA] Load error:', err);
        showStatus('❌ Error: ' + err.message, 'error');
    }
}

// =========================================================================
// API FETCHING
// =========================================================================
async function fetchFarmData(id) {
    const resp = await fetch(`https://api.sunflower-land.com/community/farms/${id}`);
    if (!resp.ok) throw new Error('Farm not found (HTTP ' + resp.status + ')');
    return resp.json();
}

async function fetchP2PPrices() {
    try {
        const resp = await fetch('https://sfl.world/api/v1/prices');
        if (!resp.ok) return null;
        const data = await resp.json();
        return data.data?.p2p || null;
    } catch { return null; }
}

async function fetchTokenPrice() {
    try {
        const currencies = 'usd,inr,php,pkr,brl';
        const resp = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=sunflower-land&vs_currencies=${currencies}&include_24hr_change=true`);
        if (!resp.ok) return null;
        const data = await resp.json();
        return data['sunflower-land'] || null;
    } catch { return null; }
}

// =========================================================================
// STATUS BAR
// =========================================================================
function showStatus(msg, type) {
    const bar = document.getElementById('statusBar');
    bar.style.display = 'block';
    bar.textContent = msg;
    bar.style.color = type === 'error' ? 'var(--accent-red)' :
                      type === 'success' ? 'var(--accent-green)' :
                      type === 'warn' ? 'var(--accent-gold)' : 'var(--text-secondary)';
}

function hideStatus() { document.getElementById('statusBar').style.display = 'none'; }

// =========================================================================
// RENDER HOME
// =========================================================================
function renderHome() {
    if (!farmData || !farmData.farm) return;
    const farm = farmData.farm;

    document.getElementById('homeEmpty').style.display = 'none';
    document.getElementById('homeContent').style.display = 'block';

    // Welcome
    const name = farm.username || 'Farmer';
    document.getElementById('welcomeLabel').textContent = isFirstVisit ? 'WELCOME' : 'WELCOME BACK';
    document.getElementById('welcomeName').textContent = name.toUpperCase();
    isFirstVisit = false;

    // Token price (for $-conversion later)
    const sflUsd = tokenPriceData?.usd || 0;
    const rate = getExchangeRate();

    // Balances
    // FLOWER — use dailySFL from delivery as an approximation, or just SFL balance
    const sflBalance = parseFloat(farm.balance) || 0;
    const coins = farm.coins || 0;
    const gems = parseFloat(farm.gems?.amount || farm.gems || 0);

    renderBalance('balFlower', 'balFlowerUsd', sflBalance, sflUsd, rate);
    renderBalance('balCoins', 'balCoinsUsd', coins, 0, rate, true);
    renderBalance('balGems', 'balGemsUsd', gems, 0, rate, true);
    renderBalance('balSfl', 'balSflUsd', sflBalance, sflUsd, rate);

    // Farm Valuation
    if (p2pPrices) renderValuation(farm);

    // Profile
    const xp = farm.bumpkin?.experience || 0;
    const level = calcLevel(xp);
    const totalDeliveries = farm.delivery?.fulfilledCount || 0;
    const skills = farm.bumpkin?.skills ? Object.keys(farm.bumpkin.skills).length : 0;

    document.getElementById('profLevel').textContent = level;
    document.getElementById('profDeliveries').textContent = totalDeliveries.toLocaleString();
    document.getElementById('profSkills').textContent = skills;

    // Token Price Widget
    renderTokenPrice();
}

function renderBalance(valId, usdId, amount, priceUsd, rate, isNonToken = false) {
    const el = document.getElementById(valId);
    const usdEl = document.getElementById(usdId);
    el.textContent = Math.floor(amount).toLocaleString();
    el.dataset.fullValue = amount;

    if (isNonToken) {
        usdEl.textContent = '';
    } else {
        const val = amount * priceUsd * rate;
        const sym = getCurrencySymbol();
        usdEl.textContent = `(${sym}${val.toFixed(2)})`;
    }
}

// =========================================================================
// BALANCE CARD EXPAND (click for decimals)
// =========================================================================
function initBalanceCards() {
    document.querySelectorAll('.balance-card').forEach(card => {
        card.addEventListener('click', () => {
            const valEl = card.querySelector('.balance-value');
            card.classList.toggle('expanded');
            if (card.classList.contains('expanded')) {
                valEl.textContent = parseFloat(valEl.dataset.fullValue || 0).toLocaleString(undefined, { maximumFractionDigits: 6 });
            } else {
                valEl.textContent = Math.floor(parseFloat(valEl.dataset.fullValue || 0)).toLocaleString();
            }
        });
    });
}

// =========================================================================
// CURRENCY
// =========================================================================
function initCurrencySelector() {
    document.querySelectorAll('.currency-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.currency-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedCurrency = btn.dataset.currency;
            // Re-render with new currency
            if (farmData) { renderHome(); renderTasks(); }
        });
    });
}

function getExchangeRate() {
    if (!tokenPriceData) return 1;
    const key = selectedCurrency.toLowerCase();
    // CoinGecko returns price in each currency directly
    // We need rate relative to USD: tokenPriceData.inr / tokenPriceData.usd
    const usdPrice = tokenPriceData.usd || 1;
    const localPrice = tokenPriceData[key] || usdPrice;
    return localPrice / usdPrice;
}

function getCurrencySymbol() {
    const symbols = { USD:'$', INR:'₹', PHP:'₱', PKR:'Rs.', BRL:'R$' };
    return symbols[selectedCurrency] || '$';
}

// =========================================================================
// FARM VALUATION
// =========================================================================
function renderValuation(farm) {
    const inv = farm.inventory || {};
    const sflUsd = tokenPriceData?.usd || 0;
    const rate = getExchangeRate();
    const sym = getCurrencySymbol();

    let fruitVal = 0, cropVal = 0, miscVal = 0;

    for (const [item, qty] of Object.entries(inv)) {
        const amount = parseFloat(qty) || 0;
        const price = p2pPrices?.[item] || 0; // price in SFL
        const val = amount * price;

        if (FRUIT_ITEMS.includes(item)) fruitVal += val;
        else if (CROP_ITEMS.includes(item)) cropVal += val;
        else if (price > 0) miscVal += val;
    }

    const total = fruitVal + cropVal + miscVal;

    document.getElementById('valFruits').textContent = fruitVal.toFixed(1) + ' 🌸';
    document.getElementById('valFruitsUsd').textContent = `(${sym}${(fruitVal * sflUsd * rate).toFixed(2)})`;

    document.getElementById('valCrops').textContent = cropVal.toFixed(1) + ' 🌸';
    document.getElementById('valCropsUsd').textContent = `(${sym}${(cropVal * sflUsd * rate).toFixed(2)})`;

    document.getElementById('valMisc').textContent = miscVal.toFixed(1) + ' 🌸';
    document.getElementById('valMiscUsd').textContent = `(${sym}${(miscVal * sflUsd * rate).toFixed(2)})`;

    document.getElementById('valTotal').textContent = `${total.toFixed(1)} 🌸 (${sym}${(total * sflUsd * rate).toFixed(2)})`;
}

// =========================================================================
// TOKEN PRICE WIDGET
// =========================================================================
function renderTokenPrice() {
    if (!tokenPriceData) return;
    const rate = getExchangeRate();
    const sym = getCurrencySymbol();
    const price = (tokenPriceData.usd || 0) * rate;

    document.getElementById('tokenPrice').textContent = `${sym}${price.toFixed(price < 1 ? 6 : 2)}`;

    const change24h = tokenPriceData.usd_24h_change || 0;
    const changeEl = document.getElementById('tokenChange');
    changeEl.textContent = `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%`;
    changeEl.className = 'token-price-change ' + (change24h >= 0 ? 'up' : 'down');

    // Simple mini chart (placeholder — draws a gradient line)
    drawMiniChart();
}

function drawMiniChart() {
    const canvas = document.getElementById('priceChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.offsetWidth * 2;
    const H = canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);
    const w = canvas.offsetWidth, h = canvas.offsetHeight;

    ctx.clearRect(0, 0, w, h);

    // Generate a simple simulated price line
    const change = tokenPriceData?.usd_24h_change || 0;
    const isUp = change >= 0;
    const points = [];
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // Create a wavy line trending in the direction of 24h change
        const noise = Math.sin(t * 12) * 0.15 + Math.sin(t * 7 + 1) * 0.1;
        const trend = t * (isUp ? -0.3 : 0.3);
        const y = 0.5 + noise + trend;
        points.push({ x: t * w, y: y * h });
    }

    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    if (isUp) {
        gradient.addColorStop(0, 'rgba(34, 197, 94, 0.2)');
        gradient.addColorStop(1, 'rgba(34, 197, 94, 0)');
    } else {
        gradient.addColorStop(0, 'rgba(239, 68, 68, 0.2)');
        gradient.addColorStop(1, 'rgba(239, 68, 68, 0)');
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.lineTo(w, h); ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw line
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.strokeStyle = isUp ? '#22c55e' : '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.stroke();
}

// =========================================================================
// RENDER TASKS
// =========================================================================
function renderTasks() {
    if (!farmData || !farmData.farm) return;
    const farm = farmData.farm;
    const orders = farm.delivery?.orders || [];
    const inv = farm.inventory || {};

    document.getElementById('tasksEmpty').style.display = 'none';
    document.getElementById('tasksContent').style.display = 'block';

    // Categorize deliveries
    const flowerOrders = []; // reward.sfl exists
    const chapterOrders = []; // reward is empty {}
    const coinOrders = []; // reward.coins exists

    orders.forEach(order => {
        const reward = order.reward || {};
        if (reward.sfl !== undefined && reward.sfl > 0) flowerOrders.push(order);
        else if (reward.coins !== undefined && reward.coins > 0) coinOrders.push(order);
        else chapterOrders.push(order);
    });

    // Render each section
    renderDeliverySection('flowerDeliveries', flowerOrders, inv, 'flower');
    renderDeliverySection('chapterDeliveries', chapterOrders, inv, 'chapter');
    renderDeliverySection('coinDeliveries', coinOrders, inv, 'coin');

    // Update counts
    document.getElementById('flowerDeliveryCount').textContent = flowerOrders.length;
    document.getElementById('chapterDeliveryCount').textContent = chapterOrders.length;
    document.getElementById('coinDeliveryCount').textContent = coinOrders.length;

    // Summary
    const completed = orders.filter(o => o.completedAt).length;
    const total = orders.length;
    document.getElementById('taskProgress').textContent = `${completed} / ${total}`;

    const fCompleted = flowerOrders.filter(o => o.completedAt).length;
    const cCompleted = chapterOrders.filter(o => o.completedAt).length;
    const coCompleted = coinOrders.filter(o => o.completedAt).length;

    document.getElementById('sumFlower').textContent = `${fCompleted}/${flowerOrders.length}`;
    document.getElementById('sumChapter').textContent = `${cCompleted}/${chapterOrders.length}`;
    document.getElementById('sumCoin').textContent = `${coCompleted}/${coinOrders.length}`;
    document.getElementById('sumLifetime').textContent = (farm.delivery?.fulfilledCount || 0).toLocaleString();

    // Earnings (from completed orders)
    let earnedFlower = 0, earnedCoins = 0, earnedTokens = 0;
    orders.filter(o => o.completedAt).forEach(o => {
        if (o.reward?.sfl) earnedFlower += o.reward.sfl;
        if (o.reward?.coins) earnedCoins += o.reward.coins;
        if (!o.reward?.sfl && !o.reward?.coins) earnedTokens++;
    });

    document.getElementById('earnFlower').textContent = earnedFlower.toFixed(2);
    document.getElementById('earnCoins').textContent = Math.floor(earnedCoins).toLocaleString();
    document.getElementById('earnTokens').textContent = earnedTokens;
}

function renderDeliverySection(containerId, orders, inventory, type) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    if (orders.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:12px;"><div class="empty-text">No deliveries in this category</div></div>';
        return;
    }

    orders.forEach(order => {
        const card = createDeliveryCard(order, inventory, type);
        container.appendChild(card);
    });
}

// =========================================================================
// DELIVERY CARD CREATION
// =========================================================================
function createDeliveryCard(order, inventory, type) {
    const card = document.createElement('div');
    card.className = 'delivery-card';
    const isCompleted = !!order.completedAt;
    if (isCompleted) card.classList.add('completed');

    const npcName = order.from || 'Unknown';
    const npcKey = npcName.toLowerCase().replace(/['\s]/g, '_');
    const npcColor = NPC_COLORS[npcKey] || NPC_COLORS.default;
    const initial = npcName.charAt(0).toUpperCase();

    // Calculate profit/loss
    const { profitClass, profitPct, profitLabel, rewardText, rewardUsd, p2pSellValue, p2pSellUsd } =
        calcProfitLoss(order, type);

    // Check item availability
    const items = order.items || {};
    let hasAllItems = true;
    const itemHtml = Object.entries(items).map(([name, qty]) => {
        // Skip coin items (e.g., "coins" in item list means cost)
        if (name === 'coins') return `<span class="card-item">🪙 ${qty} coins</span>`;
        const owned = parseFloat(inventory[name] || 0);
        const has = owned >= qty;
        if (!has) hasAllItems = false;
        return `<span class="card-item">${name} ×${qty} <span class="item-check ${has ? 'item-has' : 'item-missing'}">${has ? '✅' : '❌'}</span></span>`;
    }).join('');

    // Heart icon for "has everything"
    const heartIcon = hasAllItems && !isCompleted ? '<span title="Ready to deliver!" style="font-size:16px;">❤️</span>' : '';

    card.classList.add(profitClass);

    const sflUsd = tokenPriceData?.usd || 0;
    const rate = getExchangeRate();
    const sym = getCurrencySymbol();

    card.innerHTML = `
        <div class="card-header">
            <div class="npc-avatar" style="background:${npcColor}">${initial}</div>
            <div>
                <div class="npc-name">${npcName} ${heartIcon}</div>
            </div>
            <span class="card-status ${isCompleted ? 'done' : 'not-yet'}">${isCompleted ? 'Completed' : 'Not Yet'}</span>
        </div>
        <div class="card-items">${itemHtml}</div>
        <div class="card-reward">
            <div>
                <div class="reward-amount">${rewardText}</div>
                <div class="reward-label">Reward ${rewardUsd ? `(${sym}${(rewardUsd * rate).toFixed(3)})` : ''}</div>
            </div>
            <span class="profit-badge ${profitPct >= 0 ? 'profit' : 'loss'}">${profitLabel}</span>
        </div>
        <div class="card-details">
            <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${isCompleted ? '✅ Completed' : '⏳ Not Yet'}</span></div>
            <div class="detail-row"><span class="detail-label">Reward Value</span><span class="detail-value">${rewardText} ${rewardUsd ? `(${sym}${(rewardUsd * rate).toFixed(3)})` : ''}</span></div>
            <div class="detail-row"><span class="detail-label">P2P Sell Value</span><span class="detail-value">${p2pSellValue.toFixed(4)} SFL (${sym}${(p2pSellUsd * rate).toFixed(3)})</span></div>
            <div class="detail-row"><span class="detail-label">Profit/Loss</span><span class="detail-value" style="color:${profitPct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(1)}%</span></div>
            <div class="deal-verdict ${profitPct >= 0 ? 'profit' : 'loss'}">${profitPct >= 0 ? '💚 DEAL OF PROFIT' : '💔 DEAL OF LOSS'}</div>
        </div>
    `;

    // Click to expand
    card.addEventListener('click', () => card.classList.toggle('expanded'));

    return card;
}

// =========================================================================
// PROFIT/LOSS CALCULATION
// =========================================================================
function calcProfitLoss(order, type) {
    const reward = order.reward || {};
    const items = order.items || {};
    const sflUsd = tokenPriceData?.usd || 0;

    // Calculate P2P sell value of required items (what you could sell them for instead)
    let p2pSellValue = 0; // in SFL
    for (const [name, qty] of Object.entries(items)) {
        if (name === 'coins') continue; // coins in items list are costs
        const price = p2pPrices?.[name] || 0;
        p2pSellValue += price * qty;
    }
    const p2pSellUsd = p2pSellValue * sflUsd;

    // Calculate reward value in SFL
    let rewardSfl = 0;
    let rewardText = '';
    let rewardUsd = 0;

    if (reward.sfl) {
        rewardSfl = reward.sfl;
        rewardText = `${reward.sfl} 🌸 $FLOWER`;
        rewardUsd = reward.sfl * sflUsd;
    } else if (reward.coins) {
        // Coins don't have a direct SFL value, estimate: ~320 coins per SFL (approximate)
        rewardSfl = reward.coins / 320;
        rewardText = `${reward.coins.toLocaleString()} 🪙 Coins`;
        rewardUsd = rewardSfl * sflUsd;
    } else {
        // Chapter tokens — no direct $ value, treat as neutral
        rewardText = '🎫 Chapter Tokens';
        rewardSfl = 0;
        rewardUsd = 0;
    }

    // Calculate profit percentage
    let profitPct = 0;
    if (p2pSellValue > 0 && rewardSfl > 0) {
        profitPct = ((rewardSfl - p2pSellValue) / p2pSellValue) * 100;
    }

    // Determine color class and label
    let profitClass = 'neutral';
    let profitLabel = '—';

    if (type === 'chapter') {
        // Chapter tokens: can't really compare, mark neutral
        profitClass = 'neutral';
        profitLabel = '🎫 Tokens';
    } else if (profitPct > 100) {
        profitClass = 'profit-high';
        profitLabel = `+${profitPct.toFixed(0)}% 🟢`;
    } else if (profitPct > 50) {
        profitClass = 'profit-high';
        profitLabel = `+${profitPct.toFixed(0)}%`;
    } else if (profitPct > 20) {
        profitClass = 'profit-medium';
        profitLabel = `+${profitPct.toFixed(0)}%`;
    } else if (profitPct > 0) {
        profitClass = 'profit-low';
        profitLabel = `+${profitPct.toFixed(0)}%`;
    } else if (profitPct > -20) {
        profitClass = 'loss-low';
        profitLabel = `${profitPct.toFixed(0)}%`;
    } else if (profitPct > -50) {
        profitClass = 'loss-medium';
        profitLabel = `${profitPct.toFixed(0)}%`;
    } else {
        profitClass = 'loss-high';
        profitLabel = `${profitPct.toFixed(0)}% 🔴`;
    }

    return { profitClass, profitPct, profitLabel, rewardText, rewardUsd, p2pSellValue, p2pSellUsd };
}

// =========================================================================
// TASK SUMMARY TOGGLE
// =========================================================================
function initTaskSummary() {
    const summary = document.getElementById('taskSummary');
    if (summary) {
        summary.addEventListener('click', () => summary.classList.toggle('expanded'));
    }
}

// =========================================================================
// DIGGING TAB
// =========================================================================
function initDiggingTab() {
    // Sync button
    document.getElementById('btnDigSync').addEventListener('click', async () => {
        const id = document.getElementById('digFarmInput').value.trim();
        if (!id) { showDigStatus('Enter a Farm ID', 'warn'); return; }
        showDigStatus('Syncing...', 'loading');
        try {
            const data = await fetchFarmData(id);
            const grid = data?.farm?.desert?.digging?.grid;
            if (!grid) { showDigStatus('No digging data found', 'warn'); return; }
            const flat = Array.isArray(grid[0]) ? grid.flat() : grid;
            // Send to content script
            sendToTab('colorGrid', { apiGridData: flat });
            showDigStatus(`✅ Synced: ${flat.length} dug cells`, 'success');
        } catch (e) {
            showDigStatus('❌ ' + e.message, 'error');
        }
    });

    // Mode buttons
    document.querySelectorAll('#modeGroup .mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#modeGroup .mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            sendToTab('setMode', { mode: btn.dataset.mode });
        });
    });

    // Speed slider
    const slider = document.getElementById('speedSlider');
    const display = document.getElementById('speedDisplay');
    slider.addEventListener('input', () => {
        display.textContent = parseFloat(slider.value).toFixed(1);
        sendToTab('updateSpeed', { speed: parseFloat(slider.value) });
    });

    // Double-click on speed display to edit
    display.addEventListener('dblclick', () => {
        const val = prompt('Enter walk speed:', slider.value);
        if (val && !isNaN(val)) {
            slider.value = val;
            display.textContent = parseFloat(val).toFixed(1);
            sendToTab('updateSpeed', { speed: parseFloat(val) });
        }
    });

    // Lock toggle
    document.getElementById('lockToggle').addEventListener('change', (e) => {
        sendToTab('setLockState', { isLocked: e.target.checked });
    });

    // Hide all
    document.getElementById('btnHideGrid').addEventListener('click', () => {
        sendToTab('hideAll', {});
    });

    // Load saved settings
    chrome.storage.local.get(['walkSpeed', 'deviceMode'], r => {
        if (r.walkSpeed) {
            slider.value = r.walkSpeed;
            display.textContent = parseFloat(r.walkSpeed).toFixed(1);
        }
        if (r.deviceMode) {
            document.querySelectorAll('#modeGroup .mode-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.mode === r.deviceMode);
            });
        }
    });
}

function showDigStatus(msg, type) {
    const bar = document.getElementById('digStatus');
    bar.style.display = 'block';
    bar.textContent = msg;
    bar.style.color = type === 'error' ? 'var(--accent-red)' :
                      type === 'success' ? 'var(--accent-green)' :
                      type === 'warn' ? 'var(--accent-gold)' : 'var(--text-secondary)';
}

// =========================================================================
// MESSAGING
// =========================================================================
function sendToTab(action, data) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action, ...data }, () => {
                if (chrome.runtime.lastError) console.warn('[SFL-GA] Tab msg error:', chrome.runtime.lastError.message);
            });
        }
    });
}
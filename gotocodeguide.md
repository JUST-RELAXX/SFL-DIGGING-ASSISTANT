# gotocodeguide.md — function index

Purpose: find the function responsible for a symptom without re-reading whole files. Line numbers match the files as uploaded this round (`content.js` 2932 lines, `bridge.js` 661, `digging-solver.js` 724, `sidepanel.js` 813, `background.js` 116, `early-inject.js` 108, `fetch-interceptor.js` 63). Re-verify with a quick grep if a line number looks off — files move as fixes land.

Coverage check performed before finalizing: swept every file for `function name(...)`, `const/let name = (...) =>`, object-method shorthand (`name(...) {`), `obj.name = function`, and `name: function`/`name: (...) =>` patterns, plus confirmed no ES6 classes exist anywhere in the codebase (would need separate constructor/method handling if they did). One real gap turned up on that second pass — two object-literal-shorthand methods inside `makeAccumulator()` in `digging-solver.js` — now added below. Everything else already covered was confirmed, not just re-asserted.

## File map — one line each

- **`content.js`** — the content script. Grid overlay, all four data panels (stats/hints/patterns/treasure-stat), the inline solver, hotkeys, theming, animations. The biggest file and where most bugs in this project have actually lived.
- **`bridge.js`** — injected into the page's own JS world (not the isolated content-script world). Its own independent fetch interceptor with rich diagnostics, Phaser camera-finding/tracking, and the character-silhouette engine.
- **`digging-solver.js`** — also page-world. The pure-JS port of the reference solver (base Minesweeper-style deduction + formation/exact-item prediction). No UI, pure computation, exposed for anything that wants to call it from the page world directly.
- **`sidepanel.js`** — the extension's side panel UI: Farm ID input, Sync button, Hide All/Show All, digging themes, performance tuning, the custom theme builder, and a separate 3D animation-preview player.
- **`sidepanel.html`** — markup + inline `<style>` only, no logic. Single `<script src="sidepanel.js">` at the bottom. Element ids referenced by `sidepanel.js` live here (theme selector, howto section, buttons).
- **`background.js`** — the service worker. Three message handlers, no named functions: `fetch_farm_data` (community API), `fetch_sfl_prices` (sfl.world P2P prices), `fetch_sfl_exchange` (sfl.world exchange rates). All three just fetch-then-`sendResponse`.
- **`early-inject.js`** — runs at `document_start`, before the game's own JS. Tries inline script injection first (fast), falls back to injecting `fetch-interceptor.js` by `src` if CSP blocks inline. Its inline copy and `fetch-interceptor.js` are near-duplicates of each other — see landmine note below.
- **`fetch-interceptor.js`** — the fallback version of the same interceptor logic that's inlined in `early-inject.js`. Only actually runs if CSP blocked the inline injection.
- **`manifest.json`**, **`overlay.css`** — no functions; manifest declares the MV3 structure and permissions, overlay.css is the grid/panel styling (see the CSS class reference at the bottom of this document instead of a function list).

---

## content.js

### Camera / positioning (reads what bridge.js writes to the DOM)
- `updateIndicatorLabel()` — 137 — updates the small tracking-status pill's text.
- `checkForFullScreenViews()` — 151 — detects game UI states (menus, dialogs) that should pause tracking.
- `handleAutoAlign(cam)` — 200 — the Alt+1 auto-align logic: snaps the grid onto the dig site using camera coordinates.
- `snapToScreen(cam)` — 227 — converts camera world-coordinates into on-screen pixel placement for the grid wrapper.
- `readCameraFromDOM()` — 255 — reads the camera x/y that `bridge.js`'s `writeCameraToDOM()` writes into a DOM attribute.
- `correctDriftIfFresh()` — 269 — nudges the grid back into alignment if it's drifted since the last snap.
- `fullDOMSnap()` — 292 — a harder resync than the drift correction, full recompute.
- `getIntervalForMode()` — 309 — returns the polling interval for the current performance-tuning setting.
- `startTracking()` / `stopTracking()` — 315 / 328 — start/stop the position-tracking loop (distinct from `startPanelTracking`/`stopPanelTracking`, which is the side-panels' own separate rAF loop, see below).
- `syncGridCoordinates()` — 341 — persists the grid's current position to `chrome.storage`.
- `gameLoop()` — 348 — the main per-frame tracking tick.
- `ensureDebugSvg()` / `hideAuraSvg()` — 363 / 372 — the character-aura SVG overlay (the "Character Aura" sidepanel feature).
- `updateCharacterCutout()` — 376 — applies the silhouette bridge.js computed to the aura overlay.
- `applyWASD()` — 513 — lets WASD nudge the grid position manually.

### Grid creation and coloring
- `createGrid()` — 752 (nested `getRandomType()` at 778) — builds the 10×10 `#sfl-master-grid` DOM.
- `updateGridMode()` — 866 — switches between locked/unlocked (drag) CSS modes.
- `removeGrid()` — 873 — tears down the grid overlay DOM.
- `getItemTier(itemName)` — 888 — maps an item name to an animation-intensity tier (used by the theme particle system).
- `handleDigResult(row, col, item)` — 927 — applies one freshly-dug tile's result to the grid (from the live-tracking postMessage path).
- `applyGridColors(data)` — 994 (nested `getHintClass`/`getCurrentPriority`/`setHintIfHigher` at 1005–1019) — colors already-dug tiles from a full grid dataset (manual Sync path).
- `applyLiveGridState(gridData, patterns)` — 1042 (same three nested helpers at 1057–1071) — same coloring, but for the auto-tracking path; kept as a near-duplicate of `applyGridColors`, not a shared implementation — if a coloring bug only reproduces on one path (Sync vs auto-track) and not the other, this is why.
- `clearPredictionOverlay()` — 1170 — strips solver-prediction classes/icons before a fresh solve.
- `appendSandIcon` / `appendCrabIcon` / `appendMorphIcons` — 1184 / 1201 / 1219 — per-cell icon rendering for the base dug-tile states.
- `applyPredictionOverlay(gridData, patterns)` — 1250 — the big one: runs the solver and paints `sfl-cell-guaranteed`/`prediction-empty`/`prediction-possible`/etc. onto undug cells.

### The inline solver (isolated-world duplicate of digging-solver.js)
- `runContentSolver(gridFlat, patterns)` — 1359 — entry point; returns `{ cells, tally }`. `tally` is what the Alt+2 stats bar's sure-digs/maybes/safe-empty numbers read from directly (see `createTallyStrip` below) — don't recompute those elsewhere, read `lastSolvedBoard.tally`.
  - nested: `nbrs` (1363), `hItem` (1372), `placements` (1494, with inner `search` at 1538), `canHold` (1599, arrow fn)
- `fastForcedInline(cells, instances)` — 1627 (nested `pl` 1629, `getPl`/`addForced` arrow fns at 1649/1651) — the cheap fallback formation-matcher for when the full exact-cover search would be too expensive, mirrors `digging-solver.js`'s `fastForced`.

### Game-formula ports (verified against the official game source in earlier rounds — see project history, not re-derived here)
- `isCollectibleReady(placed)` — 1723 — matches the official `isReady` check (readyAt/coordinates/used).
- `isCollectibleBuilt(name)` — 1732 — checks the merged collectibles map (farm+home+interior, merged upstream in `sidepanel.js`).
- `isWearableEquipped(name)` — 1740 — checks both the main bumpkin and farm-hand bumpkins.
- `getSellPriceWithBoosts(itemName)` — 1755 — applies Treasure Map (+20%) / Camel (+30%) boosts on top of `BASE_TREASURE_PRICES`.
- `getCurrentChapterName()` / `getCurrentArtefactName()` — 1774 / 1784 — resolve the active chapter and its seasonal artefact by date, not hardcoded.
- `getHoleItem(hole)` / `getFlatGrid()` — 1791 / 1801 — normalize a dug-hole record to its item name / return the flat dug-holes array.
- `computeRegularMaxDigs()` — 1812 — base 25 + collectible/wearable boosts (Heart of Davy Jones, Pharaoh Chicken, Bionic Drill, Meerkat).
- `computeRemainingDigs()` — 1825 — `computeRegularMaxDigs()` minus dug count, clamped at 0, plus `extraDigs`. **This is the digs-left number** — if it's ever wrong again, check this function and what's feeding `currentGridData`/`currentExtraDigs`/`currentCollectibles` first.
- `secondsTillDesertStorm()` / `formatTime()` — 1838 / 1845 — countdown to next UTC midnight, formatted.
- `computeTreasuresFound()` — 1851 — Alt+2's "N treasures" count. Correctly excludes Sand/Crab by the game's own definition — **do not "fix" this to include them**, that request belongs to `buildTreasureStatHTML` instead (see below), a different feature with a different, correct exclusion rule for a different purpose.
- `computeArtefactsFound()` — 1859 — count of dug holes matching the current chapter's artefact.
- `hasClaimedReward()` — 1865 — whether today's streak reward is already claimed.

### Stats bar (Alt+2)
- `createStatsBar()` / `buildStatsBarHTML()` / `removeStatsBar()` / `updateStatsBar()` — 1875 / 1927 / 1942 / 1950.
- `iconImg` / `gameIcon` / `rootIcon` — 1898 / 1902 / 1903 — small helpers building `<img>` tags from `ITEMS/` or the extension root.
- `animateIn(el, direction)` / `animateOutAndRemove(el, direction, done)` — 1906 / 1919 — the shared open/close transition helpers used by every panel's create/remove function. If an open/close animation isn't firing for some panel, check whether that panel's `create*`/`remove*` actually calls these rather than a plain `appendChild`/`.remove()`.

### Sure-digs/maybes/safe-empty strip (its own component, separate from the stats bar)
- `createTallyStrip()` / `buildTallyHTML()` / `removeTallyStrip()` / `updateTallyStrip()` — 1959 / 1976 / 1988 / 1993 — reads `lastSolvedBoard.tally`, not a separate computation.

### Hints panel (Alt+3)
- `buildHintsPanelHTML()` — 2001 — the static legend content (this extension's own tile-color scheme, not the reference project's).
- `createHintsPanel()` / `removeHintsPanel()` — 2035 / 2054.

### Formations / patterns panel (Alt+4)
- `humanizeFormationName(key)` — 2062 — turns a raw formation key into a display name.
- `getFormationPlots(patName)` — 2066 — looks up a formation's relative `{x,y,name}` plot list.
- `getIconForFormationItem(itemName)` — 2113 — item name → `ITEMS/` filename. The "Seasonal Artefact" case resolves dynamically via `getCurrentArtefactName()`, not hardcoded to one chapter's item.
- `renderMiniGrid(plots)` — 2136 — builds the real icon-based mini-grid HTML for one formation. This is the function that's actually wired in; **`buildFormationCard` (2183) is legacy/unused** — it builds an older flat-color-block version that nothing currently calls. Don't edit `buildFormationCard` expecting it to affect what renders; if it ever looks like it should be removed entirely to stop confusing future edits, that's a reasonable cleanup, but confirm nothing references it first.
- `createFormationsPanel()` — 2164.
- `buildPatternsPanelHTML()` — 2225 — the actual active renderer. Has the occurrence-counting logic for repeated formation names (both for `completedPatterns` and for solver-predicted completions) — if a duplicate-formation bug ever resurfaces, this function and `countPatternSolverComplete` are where to look first.
- `countPatternSolverComplete(patName)` — 2280 — returns *how many* placements of a formation the solver currently considers complete (not just a boolean). `isPatternSolverComplete` (2312) is a one-line backwards-compatible boolean wrapper around it — prefer the count version for anything duplicate-aware.
- `removeFormationsPanel()` / `updatePatternsPanel()` — 2314 / 2319.

### Treasure Stat panel (Alt+5)
- `createTreasureStatPanel()` — 2329.
- `getItemIconFile(itemName)` / `itemIcon(itemName, size)` — 2354 / 2357.
- `buildTreasureStatHTML()` — 2362 — the exchange-rate section plus the per-item earnings table. Sand and Crab are included here (with real prices in `BASE_TREASURE_PRICES` and boosts applied same as everything else) — this is the correct place for that inclusion; `computeTreasuresFound()` above is not.
- `removeTreasureStatPanel()` / `updateTreasureStatPanel()` — 2467 / 2472.
- `fetchP2PPrices()` / `fetchExchangeRates()` — 2477 / 2493 — message the background script for sfl.world's live prices; results cached in module-level vars this section reads.

### Panel positioning, viewport-fit, and the side-panel tracking loop
- `positionPanelFixed(panel, wrapper, side, slot)` — 2512 — the core placement math (`slot` is `'top'|'bottom'|'full'`; hints/patterns use `'top'`/`'bottom'` when both are open and `'full'` when only one is, which is what produces the expand-to-fill behavior).
- `refitAllPanels()` — 2558 — recomputes every visible panel's position each tick; decides the `'top'/'bottom'` vs `'full'` slot based on which of hints/patterns currently exist.
- `startPanelTracking()` (nested `tick()` at 2602) / `stopPanelTracking()` — 2600 / 2612 — the `requestAnimationFrame` loop that keeps hints/patterns/treasure-stat glued to the grid as the camera moves. **See the landmine note below before adding any new animated property to these panels.**
- `refreshPanels()` — 2619 — re-renders whichever panels are currently visible after new data arrives (called from the `syncFarmData` handler).

### Dragging, theming, particles
- `makeDraggable(el)` — 2628 — generic drag handler, used by the grid wrapper.
- `applyTheme(theme)` — 2645 — applies one of the 30 preset (or custom) digging themes to the grid.
- `spawnThemeParticles(tileElement, theme, numOverride, tier)` — 2786 — the per-dig particle-effect system.
- `applyCustomConfig(config)` / `cleanupCustomAttributes(w)` — 2892 / 2916 — the custom-theme-builder application/cleanup pair.

### Message handling and startup (no wrapper function — top of file / the `chrome.runtime.onMessage` block)
- Lines 79–93 — on script load, reads saved settings including `sflFarmId` from `chrome.storage.local` and, if present, automatically fires `fetch_farm_data` — this is the auto-sync-on-load behavior, not a named function, just an IIFE-style block near the top.
- The big `chrome.runtime.onMessage.addListener(...)` starting at 534 is where every side-panel-originated action is handled inline (`toggleGrid`, `hideAll`, `setLockState`, `resetPosition`, `colorGrid`, `syncFarmData`, `updateSpeed`, `setMode`, `setDOMInterval`, and more below it) — most of these are a few lines each directly in the listener body, not separate functions. `hideAll` specifically is at line 539, with its hide/show snapshot state in a module-level `_hiddenAllSnapshot` variable declared near the top of the file.

---

## bridge.js

- Lines 1–100ish — health-monitor state object (`health`) and three helpers: `detectItemFormat(tile)` (54), `getItemName(tile)` (63), `printHealthReport(grid)` (72) — diagnostic console reporting when the game's API shape changes.
- `window.fetch = async function(...)` — 101–312 — **a second, independent fetch interceptor**, separate from the one in `early-inject.js`/`fetch-interceptor.js`. It also posts `SFL_DIG_RESULT`/`SFL_GRID_AUTO_UPDATE`, plus does the health/diagnostic checks above. See the landmine note below — three files independently wrap `window.fetch`.
- Camera-finding, several fallback strategies in order: `findViaGlobal()` (327), `findViaWindowSearch()` (335), `findViaReactFiber()` (348), `findPhaserGame()` (375) — tries each until one locates the live Phaser game instance.
- `writeCameraToDOM()` — 394 — writes the found camera's x/y into a DOM attribute; this is what `content.js`'s `readCameraFromDOM()` reads.
- `stopAll()` / `startInterval(intervalMs)` / `startHigh()` — 463 / 469 / 480 — different camera-polling strategies (interval-based vs rAF-based), each with their own inner `loop()`.
- A `window.addEventListener('message', ...)` block (~490–566) handles `SFL_GRID_READ_CAMERA`, `SFL_GRID_START_TRACKING`, `SFL_GRID_STOP_TRACKING`, `SFL_GRID_CLICK_TILE` — the page-world side of content.js's tracking control messages.
- `getPlayerSilhouette(player)` / `extractSilhouette(pixels, w, h)` — 573 / 607 — convex-hull pixel silhouette extraction, feeds the Character Aura feature.

---

## digging-solver.js

Page-world pure-JS port of the reference project's `solver.ts` + `formationSolver.ts`. No DOM, no chrome.* calls — safe to reason about as pure functions.

- `neighbours(x, y)` — 229 — the 4 cardinal neighbor coordinates.
- `holeItem(hole)` — 241 — normalizes a dug-hole record to its item name.
- `buildHoleGrid(grid)` — 249 — turns the flat API grid array into a 10×10 lookup structure.
- `solveDiggingGrid(grid)` — 264 — the base Minesweeper-style pass: sand/crab clue deduction, produces `{ cells, tally }`.
- `markPredictions(solved, excludedTreasure)` — 339 (nested `canHoldTreasure` at 346) — the secondary pass predicting whether an undug tile will reveal sand or a crab.
- `placementsOf(cells, f)` — 388 — every valid on-board placement of one formation given current board constraints.
- `makeAccumulator()` — 418 — small helper object for the exact-cover search bookkeeping. Returns an object with two methods, object-literal shorthand syntax so easy to miss on a plain `function`/`const =>` scan: `add(tile)` (422) records a forced tile, marking a coordinate conflicted if two different items get forced onto the same tile; `result()` (433) drops conflicted tiles and returns the final forced-tile list.
- `fastForced(cells, byName)` — 440 (nested `placements` arrow fn at 452) — the cheap fallback used when the full search space would be too large (mirrors `fastForcedInline` in `content.js`).
- `solveFormations(cells, instances)` — 484 — the exact-cover search: enumerates valid full-board formation layouts.
- `applyForcedTiles(solved, forced)` — 625 — merges formation-solver output back into the base solver's board, upgrading `forced` to `guaranteed` with a `predicted` item.
- `resolveFormations(patterns)` — 652 — maps today's raw pattern names to their formation definitions.
- `humanizeFormation(key)` — 673 — raw formation key → display name (the page-world twin of `content.js`'s `humanizeFormationName`).
- `runFullSolver(grid, patterns)` — 685 — the top-level entry point combining both passes.

---

## sidepanel.js

- `logStatus(msg, color)` — 48 — writes to the small status line at the bottom of the panel.
- `updateModeUI(mode)` / `updateSettingsVisibility()` — 98 / 102 — performance-tuning mode switch and conditional settings display.
- `makeEditable(el, onCommit)` — 162 — generic click-to-edit-text helper, used in the custom theme builder.
- `sendCommand(action, data)` — 296 — the shared helper that messages the active tab's content script (every button in this panel routes through this).
- `getCustomConfig()` / `loadConfigIntoUI(config)` — 331 / 348 — read/write the custom-theme-builder's current settings.
- `applyCustomLive()` / `updateApplyButton()` — 368 / 393 — live-preview application of an in-progress custom theme.
- `populateCustomThemes(themes)` — 458 — renders the list of saved custom themes.
- **Animation Preview Engine** (a self-contained 3D theme-preview player, separate from the live grid): `updateOrbitTransform()` (607), `getPreviewThemeInfo()` (614), `configurePreviewWrapper()` (623), `getPreviewColors()` (660), `resetTile()` (670), `playOneLoop()` (679), `spawnPreviewParticles()` (708), `playPreview()` / `stopPreview()` / `pausePreview()` / `resumePreview()` (752 / 758 / 764 / 771), `autoPlayPreview()` (790).

---

## Landmines — things that look like bugs but are actually architecture, and things that actually are recurring bugs

**Three independent `window.fetch` overrides exist**: the inline script in `early-inject.js`, its fallback `fetch-interceptor.js`, and `bridge.js`'s own copy with extra health-diagnostics. Only one of `early-inject.js`'s inline version or the `fetch-interceptor.js` fallback runs (CSP-dependent), but `bridge.js` runs independently of that choice — so at runtime there can genuinely be two active fetch wrappers layered on each other (whichever loaded second wraps whichever loaded first). If dig results or grid updates ever seem to double-fire or arrive with duplicate `postMessage` events, check whether both are active before assuming either one is broken on its own.

**The side-panel tracking loop (`startPanelTracking`'s `tick()`) sets `top`/`left`/`height` on hints/patterns/treasure-stat every animation frame.** In the common case (grid stationary) this doesn't fight CSS transitions on those same properties, since the JS keeps re-asserting the same values and a transition only cares about actual value changes. It can visibly conflict if the grid is being actively dragged at the exact same moment one of these panels is mid-animation. This has already been accounted for in the current animation code; if new animated properties get added to these three panels later, keep this loop in mind before assuming a transition bug is a CSS problem.

**`applyGridColors` and `applyLiveGridState` are separate, near-duplicate implementations** (manual Sync path vs. auto-tracking path), not a shared function — a coloring bug that only reproduces via one of the two sync paths and not the other almost certainly means the fix needs to land in both places, or only got made in one.

**`renderMiniGrid` is the real formation renderer; `buildFormationCard` is dead code that looks like it should be the real one.** This exact shape of bug (a correct implementation sitting unused while an older/cruder one is what's actually wired in) has recurred multiple times in this project already — worth grepping for other orphaned function definitions (defined once, never called) before assuming something needs to be built from scratch.

**Two Sand/Crab exclusions exist and only one of them is a bug.** `computeTreasuresFound()` (content.js, ~1851) correctly excludes Sand/Crab — that's the Alt+2 "treasures found" counter and matches the game's own definition. `buildTreasureStatHTML()`'s per-item table (~2362) used to also exclude them, which was the actual bug, now fixed to include both with real prices. Don't conflate the two if a future request touches "treasures" — confirm which of the two features is actually meant.

**`isPatternSolverComplete` / `countPatternSolverComplete`**: the boolean version is a thin wrapper kept only for backwards compatibility. Anything reasoning about duplicate formation instances should call the count version directly, not the boolean one.

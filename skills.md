# skills.md — SFL Digging Assistant: final feature pass + Chrome Web Store alignment

Source of truth: `github.com/JUST-RELAXX/SFL-DIGGING-ASSISTANT` (cloned today, one commit). Line numbers below are from that clone — re-grep before editing. Game source (public, ground truth): `github.com/sunflower-land/sunflower-land`, paths under `src/features/`.

Confidence tags: **[verified]** read in code · **[observed]** reported by the user, not provable from public code · **[assume]** reasonable guess, check it.

---

## 1. Digging Rewards section (Alt+5 panel, below "Treasures found")

### What the game does
- The reward is claimed from Digby's panel. The Claim button unlocks when 3 chapter artefacts are found (progress bar = artefactsFound/3). Claiming sends the event `diggingReward.collected` to the API (`world/ui/beach/Digby.tsx`). **[verified]**
- Claiming updates `desert.digging.streak = { count, collectedAt, totalClaimed }`. `hasClaimedReward` is simply "collectedAt is today (UTC)". Pirate chests and marketplace purchases never touch this object, so it is the clean, unambiguous claim marker. **[verified]**
- The chest tier is picked by streak: Digby.tsx uses `>= 4` Advanced and `>= 10` Expert, but the comments in `types/chests.ts` say 1–3 / 4–10 / 11+. The game disagrees with itself at the boundary, so never trust the tier alone. **[verified]**
- The user also sees +1 seasonal artefact appear at claim time. **[observed]** Use it only as corroboration, never as a requirement.
- The API picks the prize server-side, so the client never receives "you won X". The prize must be inferred from inventory change.

### Prize tables (from `types/chests.ts` — re-verify against main before shipping)
```js
const DESERT_REWARDS = {
  Basic: [ // streak 1-3
    {i:{'Clam Shell':1},w:20},{i:{Pipi:1},w:20},{i:{'Sand Shovel':10},w:15},{i:{'Sand Drill':2},w:10},
    {i:{'Radish Cake':1},w:15},{i:{'Wheat Cake':1},w:20},{i:{'Treasure Key':1},w:10}],
  Advanced: [ // streak 4+
    {i:{'Clam Shell':2},w:10},{i:{'Treasure Key':1},w:10},{i:{'Pirate Cake':1},w:10},{i:{'Sand Shovel':10},w:15},
    {i:{'Sand Drill':2},w:15},{i:{'Prize Ticket':1},w:1},{i:{Pearl:1},w:5}],
  Expert: [ // streak 10+
    {i:{'Pirate Bounty':1},w:5},{i:{Pearl:1},w:10},{i:{'Prize Ticket':1},w:5},{i:{'Rare Key':1},w:5},
    {i:{'Sand Shovel':15},w:20},{i:{'Sand Drill':3},w:5},{i:{'Pirate Cake':1},w:5},{i:{'Shroom Syrup':1},w:1}],
};
```
The beach **Pirate Chest** table (`PIRATE_CHEST_REWARDS`) overlaps these (Sand Shovel 5/10, Sand Drill 1, Seaweed 3, Sand 20, Hieroglyph 1, Pirate Cake 1, Orange 5, Grub/Earthworm 5, Orange Cake 1). That overlap is exactly the concurrency risk the user raised: a pirate chest opened in the same moment can look like a desert reward. **[verified]**

### Detection design (be conservative — a blank section beats a wrong one)
1. **Page-world hook** (`bridge.js` fetch wrapper, ~101–312): forward a lightweight snapshot for every game API response that contains a farm: `{ts, streak, inventory (only names in the prize universe + the current chapter artefact), gridEntries}`. Inventory values may arrive as strings — coerce with `Number()` **[assume]**. Also flag any outgoing request whose body contains `diggingReward.collected` and tag the matching response as the claim response.
2. **Trigger**: claim response flagged, OR `streak.totalClaimed` increased, OR `streak.collectedAt` moved to today versus the previous snapshot. Dedupe by `totalClaimed`.
3. **Delta**: inventory(claim snapshot) − inventory(last snapshot before the claim request was sent), restricted to the prize universe.
4. **Match**: candidates are table entries whose every item quantity is ≤ the delta. Prefer the expected tier, then try the others. Exactly one exact-equality match = **confirmed**. Several fit, or the delta holds unexplained extras (a concurrent pirate chest, a marketplace buy) = **unconfirmed** — never guess.
5. **Render**: only when a record exists for today. Confirmed rows show icon + name + qty. Unconfirmed shows one muted row, e.g. "Reward claimed — items couldn't be verified". Optionally a "+1 artefact" row if the artefact delta is ≥ 1.
6. **Persist** in `chrome.storage.local` under a versioned key (farm key + UTC date + rewards[]). Reset at the UTC date change, the same moment the desert resets. Survives refresh. A claim made before the extension was running is simply not shown.
7. The panel must update live (the Treasure Stat panel re-renders its innerHTML on refresh, so do not hold state in the DOM).
8. Icons: have `clam_shell.webp, pipi.webp, pearl.webp, pirate_bounty.webp, sand.webp`; root `sand_shovel.png`; `sand_drill.*` is coming from the user. Missing: Radish Cake, Wheat Cake, Treasure Key, Pirate Cake, Prize Ticket, Rare Key, Shroom Syrup. Fall back to text-only and list the missing icon filenames in the final report so the user can drop them in.

---

## 2. Sand Drill is not registered

- `Desert.digging.grid` is `(DugHole | DugHole[])[]`. A shovel dig is one `DugHole`; a drill dig is an **array** of holes. Each hole carries `tool: "Sand Shovel" | "Sand Drill"`. `grid.length` counts dig actions (used for digs-left — keep it). **[verified: types/game.ts]**
- **Root cause**: four places flatten with `Array.isArray(data[0]) ? data.flat() : data` — `content.js` ~1071, 1122, 1334, 1898. That checks only the first entry, so any grid that starts with a shovel dig and later has a drill array is never flattened, and the drill's holes vanish. Fix: one shared `flattenGrid(grid)` that always calls `.flat()`, used everywhere. **[verified]**
- `bridge.js` ~261–265 loops `newTiles.forEach(tile => … tile.x/tile.y …)` without flattening, so a drill entry emits a broken dig result. Flatten `newTiles` first.
- **Tool table**: `content.js` ~2524–2559 hardcodes one "Sand Shovel" row (`shovelFlowerCost * totalDigs`). Generalize to a per-tool loop: count grid entries per tool (use `hole.tool`; fall back to "array ⇒ drill" if missing). Drill uses are assumed to be 1 per entry **[assume]**. Tool-cost P2P comes from the `fetch_sfl_prices` map. If "Sand Drill" is absent from that map, show N/A, never a made-up number.
- `TREASURE_TOOLS` (~1786) lists the drill with only Oil + Crimstone. Official recipe (`types/tools.ts`): 40 coins + Oil 1, Crimstone 1, **Wood 3, Leather 1**. Fix it.
- Treasure and earnings tables already read the flattened holes, so once flattening is fixed, drill finds are counted automatically.
- Icon: `sand_drill.png` beside `sand_shovel.png` (user will add it; look in the repo root, then `ITEMS/`). Add it to `web_accessible_resources`.
- **Do not confuse** this with the wearable "Bionic Drill" (+5 daily digs). That boost is already in the digs-left formula and must not change. The user calls the tool "bionic drill", but the game's tool is "Sand Drill".

---

## 3. Editable coin → flower rate

- Pen icon (inline SVG, not an emoji) beside the "Exchange Rates" title in `buildTreasureStatHTML` section 1 (~2470). Click opens a modal "Coin Rate Settings" — layout and tone from the user's images 6 and 7. Those come from the user's other project (SFL Bank): copy the structure and look, not code.
  - Tabs: **AUTO (MARKET BEST)** and **CUSTOM RATE**.
  - Auto view: "LIVE MARKET RATE", an ACTIVE badge, a big number "N coins / 1 flower", the caption, and a CLOSE button.
  - Custom view: "CUSTOM COIN RATE — Coins / 1 flower" with a number input. "CUSTOM PRESETS" with Manage, a "Use Live Rate (N)" chip, saved preset chips, and "+ Add Preset". Footer: "Reset to Auto" and "SAVE RATE".
- One helper, `getEffectiveCoinRate()`: custom mode + valid value → custom, else the live value (existing `fetch_sfl_exchange`). Every consumer (the exchange row, the flower conversions, profit math, tool-cost→coin conversion) must read it. Grep for every use of the current `coinToFlower`.
- Save → persist in `chrome.storage.local` (`{mode, customRate, presets[]}`) and re-render the stats panel immediately, with no refresh. Validate: finite, > 0, sane upper bound, with an inline error.
- Show a small "custom" tag in the panel when custom mode is active.
- Implementation traps: the panel re-renders via innerHTML, so use **event delegation** for the pen click. Mount the modal on `document.body`, not inside the panel. Make sure the pen and modal receive clicks (check `pointer-events` on the panel).
- Auto source stays the current live fetch. The images show 1,547.99 while the extension currently shows ~1,515; the images use a "market best" calculation from the SFL Bank project. Do not change the Auto source unless the user supplies that logic.

---

## 4. Branding and small UI edits

- Name → **SFL Digging Assistant** in: `manifest.json` name; action `default_title` ("Open SFL Digging Helper" → "Open SFL Digging Assistant"); `sidepanel.html` `<title>` (line 6) and `<h1>` (673); `bridge.js` header (line 2). The h1 already renders uppercase through CSS, so the side panel shows "SFL DIGGING ASSISTANT". Keep the manifest name in title case, because ALL-CAPS names draw store-review friction.
- Version: `manifest.json` `"version": "1.0.0"`. Replace the subtitle (sidepanel.html 674, "v12.0 — 30 Presets + Custom Builder") with `v1.0.0`, populated from `chrome.runtime.getManifest().version` so it can never drift.
- Footer (sidepanel.html ~1147): change only the words to "Made it this far and enjoying the tool? Feel free to help me to reach volcano island (optional):". Keep it one element and one sentence. At the current 10px it wraps to two lines, as the old text did — do not force `nowrap` or shrink the font.
- Wallet address: add `text-align: center` to `.wallet-addr` (CSS ~629). Alignment only, nothing else.
- Character Aura: remove only the **manual** control.
  - Delete the sidepanel.html block (`<!-- CHARACTER AURA -->`, ~1044–1052) and the `sidepanel.js` wiring (line 13 element, the storage keys at 53/66, handler at 203–209).
  - In `content.js` remove the manual path (`auraEnabled` at 4, 80–84, and its use in 451, 543, 571, 579; the `setAura` handler at 686–689) so the conditions depend on `gridActive` / `isOnGrid` only.
  - Run `chrome.storage.local.remove('auraEnabled')` once so a stale `true` from old installs cannot keep the aura on everywhere.
  - Do not touch silhouette extraction (bridge.js), the pixel-perfect character hole, or the automatic in-digging aura.

---

## 5. Chrome Web Store / MV3 alignment (findings from the repo)

1. **API key leaked.** `background.js:14` hardcodes the key and it is committed to this public repo. Treat it as compromised (the user must rotate it in the game's community-docs page). One shared key in a public extension also means shared rate limits (429s). Remove it from source. Replace with a user-supplied key field in the side panel (stored in `chrome.storage.local`, short how-to text), and unify the data flow in one `applyFarmState(farm)` fed by both the live interceptor snapshots (no key needed, already required by §1) and the optional Sync button. Without a key, Sync and auto-sync-on-load should skip quietly, not error.
   - Optional, recommended: `bridge.js` is injected by a script tag at `document_idle` (content.js 23–30), so it can miss the game's first state fetch. Declaring it as a manifest content script with `"world": "MAIN"`, `"run_at": "document_start"` fixes that, removes the script-tag injection, and lets `bridge.js` leave `web_accessible_resources`. Verify camera tracking and the silhouette still work.
2. **Permissions.** Remove `<all_urls>`. Because it currently covers the background fetches, add explicit `https://sfl.world/*` (prices and exchange) and keep `https://api.sunflower-land.com/*`. Test removing `activeTab` and the `https://sunflower-land.com/play/*` host entry. Keep only what is proven needed, and note a one-line justification for each.
3. Add `"minimum_chrome_version": "114"` (side panel API). Rewrite `description` to ≤ 132 characters for the new name.
4. **Icons**: `sand_shovel.png` is 14×14 and is used for 16/48/128. Generate real 16/48/128 PNGs with nearest-neighbour scaling so the pixel art stays crisp.
5. **`web_accessible_resources`**: replace the `ITEMS/*` wildcard with the exact files used, and narrow `matches` to the game URLs.
6. **Dead and heavy files** (verify each, then exclude or delete): `early-inject.js` and `fetch-interceptor.js` are not registered in the manifest and only reference each other — they never run. `digging-solver.js` exposes `window.SFLDigSolver` but nothing found consumes it (content.js has its own inline solver). `anchor.png` has no references. `ITEMS/` is 18 MB, mostly ~20 random-named `.jpg` files (`HR7S8wNWgAUXjFE.jpg` style) and other unreferenced images. Packaging: a whitelist build script that zips only runtime files to `dist/sfl-digging-assistant-1.0.0.zip` (no `.git`, `*.md` dev docs, `scratch_*.ts`).
7. **Asset audit script**: extract every asset path referenced in JS/HTML/CSS and check that it exists. Already suspicious: `content.js` ~1261 and 1300 reference `ITEMS/sand.png` but the folder has `sand.webp`.
8. **Fonts**: `sidepanel.html:7` loads Google Fonts remotely. Bundle Inter locally (woff2, `@font-face`) or fall back to system fonts, so there is no third-party request.
9. **innerHTML**: 14 uses in `content.js`, 1 in `sidepanel.js`. Any value that comes from the game API, storage, or user input (item/pattern names, theme names, preset labels, the rate input) must go through an `escapeHtml` helper or be set with `textContent`. Static templates are fine. No `eval`/`new Function`/remote script was found. **[verified]**
10. **Privacy**: the extension stores the farm ID and settings locally and calls `api.sunflower-land.com` and `sfl.world`. No analytics. Draft `PRIVACY.md` (the store needs a hosted privacy-policy URL) and a short single-purpose statement. The user will host it.
11. Refresh `gotocodeguide.md` at the end (new functions, shifted line numbers).

---

## Working method

- Small targeted edits. After each edit re-read the region ±20 lines for truncation and balanced brackets (this project has been burned by this).
- This repo is the source of truth. Do not rewrite known-good logic: digs-left, sell-price boosts, formation counting, panel clamping.
- Before writing anything new, grep for an existing implementation (this project repeatedly had a correct function sitting unused).

## Final verification checklist

1. A mixed grid (shovel digs then a drill dig) shows all drill holes, and the Tool costs table has a Sand Drill row with its icon.
2. A simulated claim (a fixture snapshot pair) produces the right Digging Rewards row. A pirate-chest-sized extra delta produces "unconfirmed", not a wrong item. The section is absent when there is no claim, and survives a refresh.
3. The pen opens the modal. Saving a rate updates the panel instantly. Reset to Auto works. Invalid input is rejected.
4. Name, version, footer text, centered address are done, and the Aura toggle is gone while the automatic aura in the digging area still works.
5. The manifest has no `<all_urls>`, the key is out of the source, and the asset audit passes. The package builds and loads unpacked with no console errors.
6. Nothing regressed: digs-left, treasure prices, formations, hide/show all, hotkeys.

Report what is solid, what is partial, and what needs the user's input (missing icons, key rotation, the privacy-policy URL). Do not round up.
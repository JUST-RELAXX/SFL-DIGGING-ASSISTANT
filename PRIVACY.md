# Privacy Policy — SFL Digging Assistant

**Last updated:** November 2026

## What this extension does

SFL Digging Assistant is a Chrome extension that provides a digging grid overlay, treasure tracking, and formation solver for the Sunflower Land browser game.

## Data collection

This extension does **not** collect, transmit, or share any personal data. Specifically:

- **No analytics or telemetry** — no tracking scripts, no usage data sent anywhere.
- **No user accounts** — no login, no registration.
- **No data sold or shared** with third parties.

## Data stored locally

The extension stores the following data in your browser's local storage (`chrome.storage.local`):

- Your Farm ID (entered by you for API sync)
- Your API key (entered by you, stored locally only)
- UI preferences (theme, mode, walk speed, etc.)
- Coin rate settings (auto/custom mode, presets)
- Daily digging reward records (reset each UTC day)

This data never leaves your browser except when making API calls to:

- `api.sunflower-land.com` — to fetch your farm data (requires your API key)
- `sfl.world` — to fetch current P2P prices and exchange rates

## Permissions

- **storage** — to save your settings locally
- **sidePanel** — to display the side panel UI
- **activeTab** — to interact with the game tab
- **Host permissions** — limited to `sunflower-land.com`, `api.sunflower-land.com`, and `sfl.world`

## Contact

For questions about this privacy policy, open an issue at:
https://github.com/JUST-RELAXX/SFL-DIGGING-ASSISTANT/issues

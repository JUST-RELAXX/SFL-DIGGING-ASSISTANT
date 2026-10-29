# desiredplan.md — the user's ask, mapped to the actual build

This exists so nothing gets lost in translation between what the user asked for and what gets implemented. Left column is close to their own words, right column is what that resolves to concretely. If you ever have to choose between your own interpretation and this document, this document wins — it was written directly from the user's own message.

## The starting point

The extension currently has exactly one hotkey: **Alt+1**, which toggles the grid overlay on and off. Everything below adds new hotkeys alongside it; Alt+1 itself doesn't change.

## Alt+2 — "the extra info that's shown by sfl overview"

User's words: "displaying the extra info that's shown by 'sfl overview' that is streaks, sure digs etc etc as u can see in the image along with x digs left etc etc in the upper side of the grid just like overview's... however i don't want that 'heat, glow' fx thing to be present in mine one."

Resolves to: the top stat bar from `sunflower-land-overview`'s `DiggingStatsPanel` (digs left, time left, treasures found, artefacts found, streak), positioned above the grid, **plus** the sure-digs/maybes/safe-empty tally that sits at the bottom of that project's board panel — the user is describing both as one bundle of "extra info," so both go under Alt+2. The "Tiles: Flag / Heat / Glow" segmented control visible in the same reference screenshot is explicitly excluded — the user called this out by name as something they don't want ported.

## Alt+3 — "hints just beside the grid"

User's words: "Should be showing hints just beside the grid as u can see in the referenced image and desired image."

Resolves to: the static "How the colours work" legend panel — the reference image shows exactly this content beside the grid, and it's the most literal match for "hints" (a key explaining what each tile color/icon means). The per-tile "tap to see why" dynamic explainer is a plausible secondary read of "hints" and is worth adding if it's cheap, but the static legend is the primary deliverable.

## Alt+4 — "patterns"

User's words: "Should be showing patterns."

Resolves to: the "Today's formations" panel — today's active dig formations with their shapes and completion state.

## Alt+5 — "treasure stat same as sfl world's one, perfectly calibrated according to the farm id"

User's words: "SHOULD BE SHOWING THE tresure stat same as sfl world's one percetly calibarted according to the farm id."

Resolves to: a panel matching sfl.world's Treasure Stat view exactly — today's coins earned, tool cost, profit, total digs, a per-tool cost table, and a per-treasure amount/sum table — calculated against whichever farm is currently synced in this extension, not a generic/static example. "Perfectly calibrated" is the user's own bar for this one; treat it as a real research task, not an approximation (see `skills.md` §5 and `instructions.md` §4 for what's already known and what still needs to be reverse-engineered).

## Alt+E — "everything, each and everything"

User's words: "ALT+E should be showing everything each and everything."

Resolves to: one shortcut that surfaces all four panels above at once.

## Explicit non-goals for this pass

User's words: "DON'T focus on CSS, FX etc stuffs atm... claude's work is only to make the robust logic etc and establishments of everything... perfect designing etc would all be done by gemini... so tell claude to don't focus much in designing so to save tokens and invest more in the full on implementation of the plan itself... we'll later use gemini agents to transform all those UIs into mesmerizing production level impeccable stuffs."

Resolves to: build functional, correctly-wired, correctly-positioned, correctly-databound panels with plain/minimal styling and predictable `sfl-`-prefixed IDs and classes. Do not spend time on animations, theming, polish, or matching the reference screenshots' exact visual design — that is a deliberately separate, later pass by a different agent (Gemini). If a choice comes down to spending more time on logic correctness versus visual finish, logic correctness wins every time in this pass.

## The attached images

The user is also attaching several raw, hand-annotated screenshots for convenience — a screenshot of the `sunflower-land-overview` reference UI with its stats bar, legend, and formations panel; a screenshot of sfl.world's Digging tab with the Treasure Stat panel circled; and two screenshots of the user's own extension running live in-game, hand-marked in red/yellow/green ink roughly indicating where these new panels are expected to sit relative to the grid. These are convenience sketches, not precise specs — read them for general intent and rough placement, not pixel-exact positioning, consistent with the non-goals section above.

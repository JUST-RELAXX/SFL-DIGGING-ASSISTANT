# instructions.md — build order

Read `skills.md` fully first. Work in this order — each step is a checkpoint, confirm one looks right before moving to the next rather than changing all four panels at once and debugging everything simultaneously at the end.

## Step 1 — Anchoring

Before any visual redesign, fix positioning first, because redesigning panels that are about to move to a different anchoring system is wasted work. Hook each of the four panels into the same position system `#sfl-grid-wrapper` already uses (see `skills.md` §1). Verify by dragging the grid overlay to a new spot — the four panels must move with it. Verify by reloading the page — the four panels must reappear in the same relative spot the grid does. Do not proceed to Step 2 until this actually works.

## Step 2 — Formation shapes

Replace the flat colored squares in the Today's Formations panel with real per-formation mini-grids using the actual item icons from `ITEMS/`, positioned at each formation's real relative coordinates (see `skills.md` §3). Check your rendered output against the attached reference screenshots of the old extension's formation panel — the shape and icon placement should visibly match the kind of layout shown there, not just be "some icons in a box."

## Step 3 — Liquid glass treatment

Apply the frosted-glass CSS recipe from `skills.md` §4 to all four panels. Get the base recipe (backdrop-filter + specular inset highlights + rounded corners) looking right and consistent across all four before attempting the optional SVG-displacement stretch goal. Confirm the grid overlay itself is untouched — same appearance as before this pass.

## Step 4 — Dimension and layout match

Compare your result against the attached reference images. Measure proportions and placement from the images themselves rather than picking numbers that seem reasonable — if a reference panel looks roughly as wide as the grid's own overlay, match that ratio; if it sits with a specific gap from the grid edge, match that gap. Where a reference image doesn't make a specific value clear, use your own judgment, but where it does show a clear value, use that one.

## Before you report back

Confirm all four panels: move and lock together with the grid, show real formation shapes with real icons, share one consistent glass visual treatment, and roughly match the placement and proportions shown in the reference images. Confirm the grid overlay's own appearance is unchanged. Confirm no data/logic/hotkey behavior changed — this was a visual-only pass. Report which of these are solid and which need another round, plainly, the same way the previous pass was expected to.

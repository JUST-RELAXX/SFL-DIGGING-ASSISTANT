# Prediction of Digging Items in Sunflower Land Overview

Based on the `sunflower-land-overview` repository, the code handles the prediction of digging items using a highly structured, two-pass deduction system heavily inspired by **Minesweeper**. The logic operates on a 10x10 grid representing the desert dig site and is broken down into two main files: `solver.ts` and `formationSolver.ts`.

Here is a breakdown of how the code predicts digging items:

## 1. The Base Solver (`src/digging/solver.ts`)
This acts as the first pass, reading the "clues" from already dug tiles to determine the status of adjacent undug tiles. 

It applies the following strict rules:
* **Sand Clue**: If a tile reveals Sand, none of its 4 cardinal neighbors contain treasure. They are marked as `empty`.
* **Crab Clue**: If a tile reveals a Crab, at least one of its 4 cardinal neighbors contains treasure. They are marked as `possible`.
* **Guaranteed Treasure Deduction**: If a Crab tile has exactly one remaining undug neighbor (and the others are either dug or proven `empty`), that neighbor is mathematically forced to be the treasure. Its status is updated to `guaranteed`.

**Secondary Prediction (`markPredictions`):**
Once the basic treasures are found, it can predict what *treasure-free* tiles will reveal:
* If a proven treasure-free tile borders a *known* treasure, it **will** reveal a Crab.
* If a proven treasure-free tile has *no possible treasures* surrounding it, it **will** reveal Sand.

## 2. The Formation Solver (`src/digging/formationSolver.ts`)
The base solver can only find where treasures *are*. The formation solver is a secondary pass that predicts **which exact item** is hidden by leveraging the game's mechanics: treasures aren't random; they spawn in specific multi-tile geometries ("Formations"). 

It works by enumerating the entire board:
* **Exact Cover Search**: It generates all valid layouts of the day's formations across the board. A layout is valid if its footprints cover the revealed treasures and don't overlap with any tiles proven to be `empty` (Sand).
* **Global Agreement**: If the search succeeds, it inspects all valid solutions. If *every single valid layout* places the exact same item on an undug tile, that tile's contents are proven (`forced`). 
* **Treasure Exclusion**: If *no valid layout* covers a specific undug tile, it is proven to be treasure-free. This information feeds back into `markPredictions` to deduce more Crabs and Sand.
* **Fast Fallback**: If the board has too few clues and the search space blows up (> 1,000,000 steps), it bails out to a cheap "Fast Forced" rule to prevent freezing:
    1. If a formation only has exactly one valid valid spot it can fit on the board, its tiles are predicted.
    2. If a unique revealed treasure uniquely belongs to one formation, and that formation has only one placement covering it, it is predicted.

## 3. Application (`applyForcedTiles`)
Finally, the predictions from the Formation Solver are overlaid onto the Base Solver's board. Any tile that was `forced` has its status upgraded to `guaranteed`, and is enriched with a `predicted` object containing the exact `InventoryItemName` (e.g., `"Old Bottle"`, `"Camel Bone"`) and the name of the formation it completes.

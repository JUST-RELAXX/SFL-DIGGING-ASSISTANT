// =============================================================================
// SFL Digging Prediction Solver (v1.0)
// Pure JS port of sunflower-land-overview solver.ts + formationSolver.ts
// Minesweeper-style deduction for the desert dig site
// =============================================================================
(function() {
    'use strict';

    const DIG_GRID = 10;

    // =========================================================================
    // DIGGING FORMATIONS — from sunflower-land/src/features/game/types/desert.ts
    // Complete formation table: each formation is an array of {x, y, name} plots
    // "Seasonal Artefact" is resolved at runtime to the current chapter artefact
    // =========================================================================
    const DIGGING_FORMATIONS = {
        MONDAY_ARTEFACT_FORMATION: [
            { x: 0, y: -1, name: "Camel Bone" },
            { x: 1, y: -1, name: "Seasonal Artefact" },
        ],
        TUESDAY_ARTEFACT_FORMATION: [
            { x: 1, y: 0, name: "Seasonal Artefact" },
            { x: 1, y: 2, name: "Camel Bone" },
        ],
        WEDNESDAY_ARTEFACT_FORMATION: [
            { x: 0, y: 0, name: "Camel Bone" },
            { x: 1, y: 0, name: "Seasonal Artefact" },
        ],
        THURSDAY_ARTEFACT_FORMATION: [
            { x: 0, y: 0, name: "Camel Bone" },
            { x: 1, y: -1, name: "Seasonal Artefact" },
        ],
        FRIDAY_ARTEFACT_FORMATION: [
            { x: 2, y: 0, name: "Camel Bone" },
            { x: 3, y: 0, name: "Seasonal Artefact" },
        ],
        SATURDAY_ARTEFACT_FORMATION: [
            { x: 1, y: 0, name: "Seasonal Artefact" },
            { x: 1, y: -1, name: "Camel Bone" },
        ],
        SUNDAY_ARTEFACT_FORMATION: [{ x: 0, y: -2, name: "Seasonal Artefact" }],

        ARTEFACT_ONE: [
            { x: 0, y: 0, name: "Seasonal Artefact" },
            { x: 0, y: 1, name: "Camel Bone" },
            { x: 0, y: 2, name: "Camel Bone" },
        ],
        ARTEFACT_TWO: [
            { x: 0, y: 0, name: "Seasonal Artefact" },
            { x: 1, y: 0, name: "Camel Bone" },
            { x: 0, y: 2, name: "Camel Bone" },
        ],
        ARTEFACT_THREE: [{ x: 0, y: 0, name: "Seasonal Artefact" }],
        ARTEFACT_FOUR: [
            { x: 0, y: 0, name: "Seasonal Artefact" },
            { x: 0, y: 1, name: "Camel Bone" },
            { x: 0, y: 2, name: "Camel Bone" },
            { x: 0, y: 3, name: "Camel Bone" },
        ],
        ARTEFACT_FIVE: [
            { x: 0, y: 0, name: "Seasonal Artefact" },
            { x: -1, y: 0, name: "Camel Bone" },
            { x: -2, y: 0, name: "Camel Bone" },
        ],
        ARTEFACT_SIX: [
            { x: 0, y: 0, name: "Seasonal Artefact" },
            { x: -1, y: 0, name: "Camel Bone" },
            { x: -2, y: -1, name: "Camel Bone" },
        ],
        ARTEFACT_SEVEN: [
            { x: 0, y: 0, name: "Seasonal Artefact" },
            { x: 1, y: 1, name: "Camel Bone" },
        ],
        ARTEFACT_EIGHT: [
            { x: 0, y: 0, name: "Seasonal Artefact" },
            { x: 1, y: 0, name: "Camel Bone" },
            { x: 0, y: 2, name: "Camel Bone" },
        ],
        ARTEFACT_NINE: [
            { x: 0, y: 0, name: "Seasonal Artefact" },
            { x: 0, y: 1, name: "Camel Bone" },
            { x: 0, y: -1, name: "Camel Bone" },
            { x: -1, y: -1, name: "Camel Bone" },
        ],
        ARTEFACT_TEN: [
            { x: 0, y: 0, name: "Seasonal Artefact" },
            { x: 0, y: 1, name: "Camel Bone" },
            { x: -1, y: 0, name: "Camel Bone" },
            { x: -1, y: 1, name: "Camel Bone" },
        ],
        ARTEFACT_ELEVEN: [
            { x: 0, y: 0, name: "Seasonal Artefact" },
            { x: 0, y: 1, name: "Camel Bone" },
            { x: 1, y: 1, name: "Camel Bone" },
        ],
        ARTEFACT_TWELVE: [
            { x: 0, y: 0, name: "Seasonal Artefact" },
            { x: 0, y: 1, name: "Camel Bone" },
            { x: -1, y: 1, name: "Camel Bone" },
            { x: 1, y: 1, name: "Camel Bone" },
        ],
        ARTEFACT_THIRTEEN: [
            { x: 0, y: 0, name: "Seasonal Artefact" },
            { x: 2, y: 0, name: "Camel Bone" },
        ],
        ARTEFACT_FOURTEEN: [
            { x: 0, y: 0, name: "Seasonal Artefact" },
            { x: 0, y: 2, name: "Camel Bone" },
        ],
        ARTEFACT_FIFTEEN: [
            { x: 0, y: 0, name: "Camel Bone" },
            { x: 1, y: 0, name: "Seasonal Artefact" },
            { x: 2, y: 0, name: "Camel Bone" },
        ],
        ARTEFACT_SIXTEEN: [
            { x: 0, y: 0, name: "Seasonal Artefact" },
            { x: 1, y: 0, name: "Camel Bone" },
            { x: 1, y: 1, name: "Camel Bone" },
        ],
        ARTEFACT_SEVENTEEN: [
            { x: 0, y: 0, name: "Camel Bone" },
            { x: 1, y: 0, name: "Camel Bone" },
            { x: 1, y: 1, name: "Seasonal Artefact" },
        ],
        ARTEFACT_EIGHTEEN: [
            { x: 0, y: 0, name: "Seasonal Artefact" },
            { x: 1, y: 0, name: "Camel Bone" },
            { x: 0, y: 1, name: "Camel Bone" },
            { x: 1, y: 1, name: "Camel Bone" },
        ],
        ARTEFACT_NINETEEN: [
            { x: 0, y: 0, name: "Camel Bone" },
            { x: 1, y: 0, name: "Camel Bone" },
            { x: 2, y: 0, name: "Camel Bone" },
            { x: 1, y: 1, name: "Seasonal Artefact" },
        ],
        ARTEFACT_TWENTY: [
            { x: 0, y: 0, name: "Camel Bone" },
            { x: 1, y: 0, name: "Camel Bone" },
            { x: 0, y: 1, name: "Seasonal Artefact" },
            { x: 1, y: 1, name: "Camel Bone" },
        ],
        ARTEFACT_TWENTY_ONE: [
            { x: 0, y: 0, name: "Seasonal Artefact" },
            { x: 1, y: 0, name: "Camel Bone" },
            { x: 2, y: 0, name: "Camel Bone" },
            { x: 0, y: 1, name: "Camel Bone" },
            { x: 1, y: 1, name: "Camel Bone" },
        ],
        ARTEFACT_TWENTY_TWO: [
            { x: 0, y: 0, name: "Camel Bone" },
            { x: 1, y: 0, name: "Camel Bone" },
            { x: 2, y: 0, name: "Camel Bone" },
            { x: 0, y: 1, name: "Camel Bone" },
            { x: 1, y: 1, name: "Seasonal Artefact" },
        ],
        ARTEFACT_TWENTY_THREE: [
            { x: 0, y: 0, name: "Camel Bone" },
            { x: 1, y: 0, name: "Camel Bone" },
            { x: 2, y: 0, name: "Camel Bone" },
            { x: 1, y: 1, name: "Camel Bone" },
            { x: 2, y: 1, name: "Seasonal Artefact" },
        ],
        ARTEFACT_TWENTY_FOUR: [
            { x: 0, y: 0, name: "Camel Bone" },
            { x: 1, y: 0, name: "Seasonal Artefact" },
            { x: 2, y: 0, name: "Camel Bone" },
            { x: 0, y: 1, name: "Camel Bone" },
            { x: 2, y: 1, name: "Camel Bone" },
        ],
        HIEROGLYPH: [
            { x: 0, y: 0, name: "Vase" },
            { x: 1, y: 0, name: "Vase" },
            { x: 0, y: 1, name: "Hieroglyph" },
        ],
        OLD_BOTTLE: [
            { x: 0, y: 0, name: "Old Bottle" },
            { x: 1, y: 0, name: "Old Bottle" },
            { x: 0, y: 1, name: "Old Bottle" },
            { x: 1, y: 1, name: "Old Bottle" },
        ],
        COCKLE: [
            { x: 0, y: 0, name: "Cockle Shell" },
            { x: 1, y: 1, name: "Cockle Shell" },
            { x: 2, y: 2, name: "Cockle Shell" },
        ],
        WOODEN_COMPASS: [
            { x: 0, y: 0, name: "Wood" },
            { x: 1, y: 0, name: "Wooden Compass" },
            { x: 2, y: 0, name: "Wood" },
        ],
        SEA_CUCUMBERS: [
            { x: 0, y: 0, name: "Sea Cucumber" },
            { x: 1, y: 0, name: "Sea Cucumber" },
            { x: 2, y: 0, name: "Sea Cucumber" },
            { x: 3, y: 0, name: "Pipi" },
        ],
        SEAWEED: [
            { x: 0, y: 0, name: "Seaweed" },
            { x: 1, y: 0, name: "Seaweed" },
            { x: 2, y: 0, name: "Seaweed" },
            { x: 2, y: 1, name: "Starfish" },
        ],
        CLAM_SHELLS: [
            { x: 0, y: 0, name: "Clam Shell" },
            { x: 1, y: 0, name: "Clam Shell" },
            { x: 0, y: -1, name: "Clam Shell" },
            { x: 1, y: -1, name: "Clam Shell" },
        ],
        CORAL: [
            { x: 0, y: 1, name: "Stone" },
            { x: 0, y: 0, name: "Coral" },
            { x: 0, y: -1, name: "Stone" },
        ],
        PEARL: [
            { x: 0, y: 1, name: "Stone" },
            { x: 0, y: 0, name: "Pearl" },
            { x: 0, y: -1, name: "Stone" },
        ],
        PIRATE_BOUNTY: [{ x: 0, y: 0, name: "Pirate Bounty" }],
    };

    // Current chapter artefact — update each season
    const CURRENT_ARTEFACT = "Otter Pebble";

    // 4 cardinal directions
    const DIRECTIONS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

    function neighbours(x, y) {
        const out = [];
        for (const [dx, dy] of DIRECTIONS) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < DIG_GRID && ny >= 0 && ny < DIG_GRID) {
                out.push([nx, ny]);
            }
        }
        return out;
    }

    function holeItem(hole) {
        if (!hole) return null;
        return Object.keys(hole.items)[0] || null;
    }

    // =========================================================================
    // BASE SOLVER — Sand/Crab deduction
    // =========================================================================
    function buildHoleGrid(grid) {
        const board = Array.from({ length: DIG_GRID }, () =>
            Array(DIG_GRID).fill(undefined)
        );
        for (const entry of grid) {
            const holes = Array.isArray(entry) ? entry : [entry];
            for (const hole of holes) {
                if (hole.y >= 0 && hole.y < DIG_GRID && hole.x >= 0 && hole.x < DIG_GRID) {
                    board[hole.y][hole.x] = hole;
                }
            }
        }
        return board;
    }

    function solveDiggingGrid(grid) {
        const holes = buildHoleGrid(grid);
        const cells = [];

        // Base pass: classify every tile
        for (let y = 0; y < DIG_GRID; y++) {
            cells[y] = [];
            for (let x = 0; x < DIG_GRID; x++) {
                const item = holeItem(holes[y][x]);
                const dug = item !== null;
                let kind = null;
                if (item === "Sand") kind = "sand";
                else if (item === "Crab") kind = "crab";
                else if (dug) kind = "treasure";
                cells[y][x] = { x, y, item, dug, kind, status: "unknown" };
            }
        }

        // Status pass: dug tiles get their clue; undug tiles check neighbours
        for (let y = 0; y < DIG_GRID; y++) {
            for (let x = 0; x < DIG_GRID; x++) {
                const cell = cells[y][x];
                if (cell.dug) {
                    cell.status = cell.kind === "treasure" ? "treasure"
                        : cell.kind === "sand" ? "clue-sand" : "clue-crab";
                    continue;
                }
                let hasSand = false, hasCrab = false;
                for (const [nx, ny] of neighbours(x, y)) {
                    const k = cells[ny][nx].kind;
                    if (k === "sand") hasSand = true;
                    if (k === "crab") hasCrab = true;
                }
                cell.status = hasSand ? "empty" : hasCrab ? "possible" : "unknown";
            }
        }

        // Propagation: unsatisfied crab with 1 non-empty undug neighbour → guaranteed
        for (let y = 0; y < DIG_GRID; y++) {
            for (let x = 0; x < DIG_GRID; x++) {
                const crab = cells[y][x];
                if (crab.kind !== "crab") continue;
                const ns = neighbours(x, y).map(([nx, ny]) => cells[ny][nx]);
                const satisfied = ns.some(n => n.kind === "treasure");
                if (satisfied) continue;
                const candidates = ns.filter(n => !n.dug && n.status !== "empty");
                if (candidates.length === 1 && candidates[0].status !== "guaranteed") {
                    candidates[0].status = "guaranteed";
                }
            }
        }

        // Tally
        const tally = {
            guaranteed: 0, possible: 0, empty: 0, dug: 0,
            crabs: 0, sand: 0, crabPredicted: 0, sandPredicted: 0
        };
        for (let y = 0; y < DIG_GRID; y++) {
            for (let x = 0; x < DIG_GRID; x++) {
                const c = cells[y][x];
                if (c.dug) tally.dug++;
                if (c.kind === "crab") tally.crabs++;
                if (c.kind === "sand") tally.sand++;
                if (c.status === "guaranteed") tally.guaranteed++;
                else if (c.status === "possible") tally.possible++;
                else if (c.status === "empty") tally.empty++;
            }
        }

        return { cells, tally };
    }

    // =========================================================================
    // MARK PREDICTIONS — predict Sand/Crab for treasure-free tiles
    // =========================================================================
    function markPredictions(solved, excludedTreasure) {
        excludedTreasure = excludedTreasure || new Set();
        const cells = solved.cells.map(row => row.slice());
        const treasureFree = solved.cells.map(row =>
            row.map(c => c.status === "empty" || excludedTreasure.has(c.y * DIG_GRID + c.x))
        );

        const canHoldTreasure = (n) => {
            if (n.dug) return n.kind === "treasure";
            if (n.status === "guaranteed") return true;
            return !treasureFree[n.y][n.x];
        };

        let changed = false;
        for (let y = 0; y < DIG_GRID; y++) {
            for (let x = 0; x < DIG_GRID; x++) {
                const cell = cells[y][x];
                if (cell.dug || cell.status === "guaranteed") continue;
                if (!treasureFree[y][x]) continue;
                const ns = neighbours(x, y).map(([nx, ny]) => solved.cells[ny][nx]);
                if (ns.some(n => n.kind === "treasure" || n.status === "guaranteed")) {
                    cells[y][x] = { ...cell, status: "crab" };
                    changed = true;
                } else if (ns.every(n => !canHoldTreasure(n))) {
                    cells[y][x] = { ...cell, status: "sand" };
                    changed = true;
                }
            }
        }
        if (!changed) return solved;

        const tally = { ...solved.tally, possible: 0, empty: 0, crabPredicted: 0, sandPredicted: 0 };
        for (let y = 0; y < DIG_GRID; y++) {
            for (let x = 0; x < DIG_GRID; x++) {
                const s = cells[y][x].status;
                if (s === "possible") tally.possible++;
                else if (s === "empty") tally.empty++;
                else if (s === "crab") tally.crabPredicted++;
                else if (s === "sand") tally.sandPredicted++;
            }
        }
        return { cells, tally };
    }

    // =========================================================================
    // FORMATION SOLVER — exact-cover enumeration
    // =========================================================================
    const key = (x, y) => y * DIG_GRID + x;

    function placementsOf(cells, f) {
        const xs = f.plots.map(p => p.dx);
        const ys = f.plots.map(p => p.dy);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);

        const out = [];
        for (let dx = -minX; dx <= DIG_GRID - 1 - maxX; dx++) {
            for (let dy = -minY; dy <= DIG_GRID - 1 - maxY; dy++) {
                const all = [], dug = [], undug = [];
                let ok = true;
                for (const p of f.plots) {
                    const x = p.dx + dx, y = p.dy + dy;
                    const cell = cells[y][x];
                    const k = key(x, y);
                    all.push(k);
                    if (cell.dug) {
                        if (cell.item !== p.item) { ok = false; break; }
                        dug.push(k);
                    } else {
                        if (cell.status === "empty") { ok = false; break; }
                        undug.push({ x, y, item: p.item, formation: f.name });
                    }
                }
                if (ok) out.push({ name: f.name, cells: all, dug, undug });
            }
        }
        return out;
    }

    function makeAccumulator() {
        const forced = new Map();
        const conflicts = new Set();
        return {
            add(tile) {
                const k = `${tile.x}-${tile.y}`;
                const existing = forced.get(k);
                if (existing && existing.item !== tile.item) {
                    conflicts.add(k);
                    return;
                }
                if (!existing || (!existing.formation && tile.formation)) {
                    forced.set(k, tile);
                }
            },
            result() {
                for (const k of conflicts) forced.delete(k);
                return [...forced.values()];
            }
        };
    }

    function fastForced(cells, byName) {
        const acc = makeAccumulator();
        const itemNames = new Map();
        for (const f of byName.values()) {
            for (const p of f.plots) {
                let set = itemNames.get(p.item);
                if (!set) { set = new Set(); itemNames.set(p.item, set); }
                set.add(f.name);
            }
        }

        const placementCache = new Map();
        const placements = (f) => {
            let pls = placementCache.get(f.name);
            if (!pls) { pls = placementsOf(cells, f); placementCache.set(f.name, pls); }
            return pls;
        };

        // Rule 1: formation with exactly 1 valid placement
        for (const f of byName.values()) {
            const pls = placements(f);
            if (pls.length === 1) for (const u of pls[0].undug) acc.add(u);
        }

        // Rule 2: unique revealed treasure → single covering placement
        for (let y = 0; y < DIG_GRID; y++) {
            for (let x = 0; x < DIG_GRID; x++) {
                const cell = cells[y][x];
                if (cell.kind !== "treasure" || cell.item === null) continue;
                const names = itemNames.get(cell.item);
                if (!names || names.size !== 1) continue;
                const f = byName.get([...names][0]);
                if (!f) continue;
                const covering = placements(f).filter(p => p.dug.includes(key(x, y)));
                if (covering.length === 1) for (const u of covering[0].undug) acc.add(u);
            }
        }

        return acc.result();
    }

    const MAX_SOLUTIONS = 4000;
    const MAX_STEPS = 1000000;

    function solveFormations(cells, instances) {
        const noExclusion = (forced) => ({ forced, excludedTreasure: new Set() });
        if (instances.length === 0) return noExclusion([]);

        const byName = new Map();
        for (const f of instances) if (!byName.has(f.name)) byName.set(f.name, f);

        // Revealed treasures every layout must cover
        const need = [];
        for (let y = 0; y < DIG_GRID; y++) {
            for (let x = 0; x < DIG_GRID; x++) {
                if (cells[y][x].kind === "treasure") need.push(key(x, y));
            }
        }

        const perInstance = instances.map(f => placementsOf(cells, f));
        if (perInstance.some(p => p.length === 0))
            return noExclusion(fastForced(cells, byName));

        // Most-constrained first
        const order = perInstance.map((_, i) => i)
            .sort((a, b) => perInstance[a].length - perInstance[b].length);
        const ordered = order.map(i => perInstance[i]);

        // Coverage pruning deadlines
        const lastCoverer = new Map();
        ordered.forEach((pls, depth) => {
            for (const pl of pls)
                for (const c of pl.dug)
                    lastCoverer.set(c, Math.max(lastCoverer.get(c) ?? -1, depth));
        });
        for (const c of need)
            if (!lastCoverer.has(c)) return noExclusion(fastForced(cells, byName));

        const deadlineAt = ordered.map(() => []);
        for (const c of need) deadlineAt[lastCoverer.get(c)].push(c);

        const occupied = new Set();
        const covered = new Set();
        const chosen = [];
        const solutions = [];
        let steps = 0;
        let bailed = false;

        const search = (depth) => {
            if (bailed) return;
            if (++steps > MAX_STEPS) { bailed = true; return; }
            if (depth === ordered.length) {
                for (const c of need) if (!covered.has(c)) return;
                solutions.push(chosen.slice());
                if (solutions.length > MAX_SOLUTIONS) bailed = true;
                return;
            }
            for (const pl of ordered[depth]) {
                let clash = false;
                for (const c of pl.cells) {
                    if (occupied.has(c)) { clash = true; break; }
                }
                if (clash) continue;

                const addedCover = [];
                for (const c of pl.cells) occupied.add(c);
                for (const c of pl.dug) {
                    if (!covered.has(c)) { covered.add(c); addedCover.push(c); }
                }

                let dead = false;
                for (const c of deadlineAt[depth]) {
                    if (!covered.has(c)) { dead = true; break; }
                }
                if (!dead) {
                    chosen.push(pl);
                    search(depth + 1);
                    chosen.pop();
                }

                for (const c of pl.cells) occupied.delete(c);
                for (const c of addedCover) covered.delete(c);
                if (bailed) return;
            }
        };
        search(0);

        if (bailed) return noExclusion(fastForced(cells, byName));

        // Forced = undug cells covered in EVERY solution with one agreed item
        const items = new Map();
        const names = new Map();
        const coverCount = new Map();
        for (const sol of solutions) {
            const seen = new Set();
            for (const pl of sol) {
                for (const u of pl.undug) {
                    const k = key(u.x, u.y);
                    let is = items.get(k);
                    if (!is) items.set(k, is = new Set());
                    is.add(u.item);
                    let ns = names.get(k);
                    if (!ns) names.set(k, ns = new Set());
                    ns.add(u.formation);
                    if (!seen.has(k)) {
                        seen.add(k);
                        coverCount.set(k, (coverCount.get(k) ?? 0) + 1);
                    }
                }
            }
        }

        const acc = makeAccumulator();
        for (const [k, is] of items) {
            if (is.size !== 1 || coverCount.get(k) !== solutions.length) continue;
            const ns = names.get(k);
            acc.add({
                x: k % DIG_GRID,
                y: Math.floor(k / DIG_GRID),
                item: [...is][0],
                formation: ns.size === 1 ? [...ns][0] : ""
            });
        }

        // Excluded = undug cells in NO solution's footprint
        const excludedTreasure = new Set();
        if (solutions.length > 0) {
            const possibleTreasure = new Set();
            for (const sol of solutions)
                for (const pl of sol) for (const c of pl.cells) possibleTreasure.add(c);
            for (let y = 0; y < DIG_GRID; y++) {
                for (let x = 0; x < DIG_GRID; x++) {
                    const k = key(x, y);
                    if (!cells[y][x].dug && !possibleTreasure.has(k))
                        excludedTreasure.add(k);
                }
            }
        }

        return { forced: acc.result(), excludedTreasure };
    }

    // =========================================================================
    // APPLY FORCED TILES — overlay formation deductions onto solved board
    // =========================================================================
    function applyForcedTiles(solved, forced) {
        if (forced.length === 0) return solved;
        const cells = solved.cells.map(row => row.slice());
        for (const tile of forced) {
            const cell = cells[tile.y][tile.x];
            if (cell.dug) continue;
            cells[tile.y][tile.x] = {
                ...cell,
                status: "guaranteed",
                predicted: { item: tile.item, formation: tile.formation }
            };
        }
        const tally = { ...solved.tally, guaranteed: 0, possible: 0, empty: 0 };
        for (let y = 0; y < DIG_GRID; y++) {
            for (let x = 0; x < DIG_GRID; x++) {
                const status = cells[y][x].status;
                if (status === "guaranteed") tally.guaranteed++;
                else if (status === "possible") tally.possible++;
                else if (status === "empty") tally.empty++;
            }
        }
        return { cells, tally };
    }

    // =========================================================================
    // RESOLVE FORMATIONS — map pattern names to placement instances
    // =========================================================================
    function resolveFormations(patterns) {
        return patterns.map(name => {
            const formation = DIGGING_FORMATIONS[name];
            if (!formation) {
                console.warn(`[Solver] Unknown formation: ${name}`);
                return null;
            }
            return {
                name,
                plots: formation.map(plot => ({
                    dx: plot.x,
                    dy: plot.y,
                    item: plot.name === "Seasonal Artefact" ? CURRENT_ARTEFACT : plot.name
                }))
            };
        }).filter(Boolean);
    }

    // =========================================================================
    // HUMANIZE FORMATION NAME — "ARTEFACT_ONE" → "Artefact One"
    // =========================================================================
    function humanizeFormation(key) {
        return key.toLowerCase()
            .replace(/_/g, " ")
            .replace(/\bformation\b/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    // =========================================================================
    // FULL SOLVER — convenience wrapper: runs all passes in order
    // =========================================================================
    function runFullSolver(grid, patterns) {
        const t0 = performance.now();

        // Pass 1: Base sand/crab deduction
        let solved = solveDiggingGrid(grid);

        // Pass 2: Formation enumeration (if patterns available)
        const instances = resolveFormations(patterns || []);
        const deduction = solveFormations(solved.cells, instances);

        // Pass 3: Overlay forced tiles
        solved = applyForcedTiles(solved, deduction.forced);

        // Pass 4: Predict crab/sand for treasure-free tiles
        solved = markPredictions(solved, deduction.excludedTreasure);

        const elapsed = (performance.now() - t0).toFixed(1);
        console.log(`[Solver] Completed in ${elapsed}ms — ${solved.tally.guaranteed} guaranteed, ${solved.tally.possible} possible, ${solved.tally.crabPredicted} predicted-crab, ${solved.tally.sandPredicted} predicted-sand`);

        return solved;
    }

    // =========================================================================
    // EXPORT to window for content.js to use
    // =========================================================================
    window.SFLDigSolver = {
        DIG_GRID,
        DIGGING_FORMATIONS,
        CURRENT_ARTEFACT,
        solveDiggingGrid,
        markPredictions,
        solveFormations,
        applyForcedTiles,
        resolveFormations,
        humanizeFormation,
        runFullSolver
    };

    console.log("[SFL Solver] Digging prediction engine loaded.");
})();

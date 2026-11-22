// Sweep the Planet: shared simulation (CONFIG, economy, storm, Keeper, bot, telemetry, selfTest).
// Copied 1:1 from the <script> of sweep-the-planet.html (2D greybox, 2026-11-20) so the 3D variant gets identical GB1-GB4 results.
// Only addition: optional pay-zone flow for gates (CONFIG.ui.payZoneSec, used when S.payFlow = true; bots keep the instant 2D rule).
// shortcut: two copies of the sim (2D inline + this file); if the 2D sim changes, re-copy, or move the 2D page onto this file.
'use strict';
// Sweep the Planet greybox. Concept: 03_konsep-gd/sweep-the-planet-2026-11-19.md §13.
// X = Stone Grass (sweep reveals the surface, canister, trips, upgrades). Unique = Clean = Power:
// a 100% clean tile is Lit and pays $/s while it stays clean; Dust Storms re-dust Lit tiles; Keeper Drones re-clean them.
// ===== CONFIG: every tunable lives here (concept §13.2; values changed by greybox tuning are marked "tuned") =====
const CONFIG = {
  grid: { cols: 48, rows: 72, tilePx: 16, sectors: 6, sectorGateCost: [0, 50, 250, 800, 1700, 5000] }, // tuned (2026-11-22 tool ladder: 2000/6000 -> 1700/5000, launch 26-29 min) (concept 300/1500/6000/20000: bot idled 10+ min waiting for gates) // cols/rows/sectors fixed in this greybox (gate pads are hand-placed)
  player: { speed: 5.4 /* tiles per second; 4.0 tile greybox, 4.8 fine dust mask, 5.4 with buildings and rocks to walk around */ },
  // pricePerKg: concept 1.0, 4.0 in the tile greybox, 4.5 with the fine dust mask, 5.0 with collision. sub = mask cells per tile side; a tile is Lit at
  // >= litCleanFrac clean cells; brushDepth = brush size along the facing; brushPad = brush a bit wider than `width` so strokes overlap.
  dust: { kgPerTile: 0.25, pricePerKg: 5.0, sub: 6, litCleanFrac: 0.95, brushDepth: 0.5, brushPad: 0.1 },
  lit: { powerPerTile: 0.0015 /* $ per second; tuned (concept 0.01 = Lit beat sales in minute 1, Launch at 9 min) */, gridLinkMult: 2, linkRecalcSec: 1 },
  // Tool ladder (owner 2026-11-22): 8 tiers, each with its own head (brush) and feel. turnRate = momentum (rad/s the facing can turn,
  // speed drops while turning); ride = the astronaut rides the machine (3D seat height); autoDumpSec = the canister empties to the Depot
  // on its own; rocksPassable = rocks do not block (robot strides over them, hover floats over them). Launch is paced at about tier 5
  // (bot: tier 5 at ~22:30, launch 27-28 min); costs tuned 2026-11-22.
  tools: [
    { id: 'Toothbrush', reach: 0.8, width: 1, passes: 3, capKg: 10, speedMult: 1.0, cost: 0 },
    { id: 'Mop', reach: 1.0, brush: 'round', width: 2, passes: 2, capKg: 15, speedMult: 1.0, cost: 45, shineMult: 1.25, shineSec: 60 },
    { id: 'Wide Mop', reach: 1.1, width: 3, passes: 1.5, capKg: 22, speedMult: 1.0, cost: 300 },
    { id: 'Push Broom', reach: 1.3, width: 4, passes: 1, capKg: 30, speedMult: 1.0, cost: 800 },
    { id: 'Floor Scrubber', reach: 1.25, width: 5, passes: 1, capKg: 50, speedMult: 1.0, cost: 1400, turnRate: 3.5 },
    { id: 'Ride-on Sweeper', reach: 1.5, width: 7, passes: 1, capKg: 80, speedMult: 1.05, cost: 5000, turnRate: 2.6, ride: 0.62, autoDumpSec: 30 },
    { id: 'Sweeper Robot', reach: 1.8, width: 9, passes: 1, capKg: 120, speedMult: 1.0, cost: 12000, ride: 1.3, rocksPassable: true },
    { id: 'Hover Sweeper', reach: 1.5, width: 11, passes: 1, capKg: 160, speedMult: 1.25, cost: 30000, ride: 0.55, rocksPassable: true },
  ],
  upgrades: {
    growth: 1.15,
    capacity: { base: 60, step: 0.2 /* +20% capacity per level */ }, // bases tuned x4 with pricePerKg
    width: { base: 800, step: 1, max: 2 },
    speed: { base: 100, step: 0.08 },
    payout: { base: 160, step: 0.15 },
    panelBoost: { base: 240, step: 0.15 },
  },
  storm: { intervalSec: 90, warningSec: 8, litFraction: 0.10, dirtAfter: 0.5, firstStormAtSec: 130, firstStormTiles: 6, bandRows: 16, frontSec: 4, samples: 4 },
  keeper: { cost: [0, 150, 600, 2000, 6000, 15000], max: 6, secPerPass: 0.5, speed: 3.0, passPower: 0.5 }, // secPerPass tuned (concept 1.5: 3 Keepers held only 85%)
  hauler: { cost: [500, 3000, 12000], radius: 3 }, // G9 optional: not built in this greybox
  refinery: { defaultFuelShare: 0.3, tankKg: 150, launchMinLit: 0.7 },
  launch: { stardustPerLitPct: 0.1 },
  offline: { capMin: 120, noKeeperUptime: 0.4, keeperTravelFactor: 0.5 },
  ads: { firstAdMinSec: 240 }, // no ads in greybox; kept for reference
  ui: { payZoneSec: 1.5 /* 3D: standing on a gate pad pays its cost over this many seconds (cash flows out) */ },
  feel: { popSec: 0.22, popScale: 0.08, toneWindowSec: 1, toneMax: 8, milestonePct: 10, introSec: 3.2, zoomOutSec: 2.4 },
  seed: 1,
};

// ===== helpers =====
const W = 390, H = 844, HUD_H = 64, BAR_Y = 722, VIEW_CY = (HUD_H + BAR_Y) / 2;
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
function hexLerp(a, b, k) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp(pa >> 16, pb >> 16, k)), g = Math.round(lerp(pa >> 8 & 255, pb >> 8 & 255, k)), bl = Math.round(lerp(pa & 255, pb & 255, k));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
}
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : n >= 100 ? Math.floor(n).toString() : n >= 10 ? n.toFixed(1) : n.toFixed(2);
const mmss = s => s == null ? '–' : Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const clone = o => JSON.parse(JSON.stringify(o));
function deepMerge(a, b) { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k]) deepMerge(a[k], b[k]); else a[k] = b[k]; } return a; }

// ===== map geometry (48 x 72 tiles, 6 sectors of 24 x 24: 0/1 bottom, 2/3 middle, 4/5 top) =====
const C = 48, R = 72, N = C * R;
// World layout (tile coords). Every rect below is a clean foundation: no dust, not sweepable, not in Moon %, skipped by storms
// (KIND != 0: 1 = Depot plate, the Grid Link source; 2 = pads, building plates, gate pads; 3 = rock). SOLIDS and ROCKS block the
// player, the Keepers and the tool head (circle vs box). The 3D layer places every mesh from these numbers.
const DEPOT = { c: 9, r: 62, w: 4, h: 4 }; // Depot plate; the building fills it except a 0.45 rim, walking up to it sells
const DEPOT_C = { x: DEPOT.c + 2, y: DEPOT.r + 2 };
const SELL = { c: DEPOT.c - 0.45, r: DEPOT.r - 0.45, w: DEPOT.w + 0.9, h: DEPOT.h + 0.9 }; // touching the building's wall sells (walk steps stop up to 0.3 short of it)
const PADZ = { // stand-on pads (3D: panel or pay zone)
  terminal: { c: 3, r: 62, w: 3, h: 3 }, tool: { c: 3, r: 67, w: 3, h: 3 }, crew: { c: 3, r: 57, w: 3, h: 3 },
  refinery: { c: 14, r: 64, w: 2, h: 2 }, launch: { c: 14, r: 61, w: 2, h: 2 },
};
const BLDG = { // building plates; the building is solid inside its plate (inset 0.15)
  terminal: { c: 3, r: 61, w: 3, h: 1 }, rack: { c: 3, r: 70, w: 3, h: 1 }, hangar: { c: 3, r: 55, w: 3, h: 2 },
  refinery: { c: 16, r: 64, w: 2, h: 2 }, launch: { c: 16, r: 61, w: 2, h: 2 },
  hub: { c: 0, r: 63, w: 2, h: 3 }, // Moon Station airlock: the dome sits off-map to the west, its tube opens onto the deck here
};
// gate pads straddle the border of the sector they open (half on each side; the player stands on the open half)
const PADS = [null, { c: 23, r: 57, w: 2, h: 2 }, { c: 10, r: 47, w: 2, h: 2 }, { c: 23, r: 34, w: 2, h: 2 }, { c: 10, r: 23, w: 2, h: 2 }, { c: 23, r: 10, w: 2, h: 2 }];
const sectorOf = (c, r) => (2 - Math.floor(r / 24)) * 2 + (c >= 24 ? 1 : 0);
const SEC = new Uint8Array(N), KIND = new Uint8Array(N);
function hsh(i) { let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; }
const ROCKS = []; // 18 rocks, deterministic; kept off sector borders (gate pads) and the base area
for (let t = 0; ROCKS.length < 18 && t < 4000; t++) {
  const h = hsh(t + 4242), c = 1 + h % (C - 2), r = 1 + (h >>> 8) % (R - 2);
  if (c % 24 < 2 || c % 24 > 21 || r % 24 < 2 || r % 24 > 21 || (c < 21 && r > 50) || ROCKS.some(k => Math.abs(k.c - c) + Math.abs(k.r - r) < 7)) continue;
  ROCKS.push({ c, r, x: c + 0.5, y: r + 0.5, rad: 0.36 + ((h >>> 20) & 7) * 0.012 });
}
const inset = (b, m) => ({ x0: b.c + m, y0: b.r + m, x1: b.c + b.w - m, y1: b.r + b.h - m });
const SOLIDS = [inset(DEPOT, 0.45), ...Object.values(BLDG).map(b => inset(b, 0.15))];
for (let i = 0; i < N; i++) { const c = i % C, r = (i / C) | 0; SEC[i] = sectorOf(c, r); }
const markRect = (b, k) => { for (let r = b.r; r < b.r + b.h; r++) for (let c = b.c; c < b.c + b.w; c++) KIND[r * C + c] = k; };
[...Object.values(PADZ), ...Object.values(BLDG), ...PADS.slice(1)].forEach(b => markRect(b, 2)); markRect(DEPOT, 1);
for (const k of ROCKS) KIND[k.r * C + k.c] = 3;
const SWEEPABLE = KIND.reduce((n, k) => n + (k ? 0 : 1), 0);
// circle (radius rad) vs SOLIDS boxes and ROCKS circles
function blocked(x, y, rad, noRocks) {
  for (const s of SOLIDS) if (x > s.x0 - rad && x < s.x1 + rad && y > s.y0 - rad && y < s.y1 + rad) return true;
  if (!noRocks) for (const k of ROCKS) if ((x - k.x) * (x - k.x) + (y - k.y) * (y - k.y) < (k.rad + rad) * (k.rad + rad)) return true;
  return false;
}
function pushOut(o, rad) { // move a circle out of any solid (Keepers); returns true if it was inside
  let hit = false;
  for (const s of SOLIDS) {
    const x0 = s.x0 - rad, x1 = s.x1 + rad, y0 = s.y0 - rad, y1 = s.y1 + rad;
    if (o.x > x0 && o.x < x1 && o.y > y0 && o.y < y1) { hit = true; const m = [o.x - x0, x1 - o.x, o.y - y0, y1 - o.y], k = m.indexOf(Math.min(...m)); if (k === 0) o.x = x0; else if (k === 1) o.x = x1; else if (k === 2) o.y = y0; else o.y = y1; }
  }
  for (const k of ROCKS) { const dx = o.x - k.x, dy = o.y - k.y, d = Math.hypot(dx, dy), m = k.rad + rad; if (d < m && d > 1e-6) { hit = true; o.x = k.x + dx / d * m; o.y = k.y + dy / d * m; } }
  return hit;
}
const inRectT = (x, y, r) => x >= r.c && x < r.c + r.w && y >= r.r && y < r.r + r.h;

// ===== economy =====
const UPS = ['capacity', 'width', 'speed', 'payout', 'panelBoost'];
const toolDef = S => S.cfg.tools[S.tool];
const capKg = S => toolDef(S).capKg * (1 + S.cfg.upgrades.capacity.step * S.up.capacity);
const toolWidth = S => toolDef(S).width + S.cfg.upgrades.width.step * S.up.width;
const playerSpeed = S => S.cfg.player.speed * toolDef(S).speedMult * (1 + S.cfg.upgrades.speed.step * S.up.speed);
const payoutMult = S => 1 + S.cfg.upgrades.payout.step * S.up.payout;
const panelMult = S => 1 + S.cfg.upgrades.panelBoost.step * S.up.panelBoost;
const nextGate = S => S.unlocked.indexOf(false);
const gateCost = (S, k) => S.cfg.grid.sectorGateCost[k];
const canLaunch = S => S.fuel >= S.cfg.refinery.tankKg - 1e-9 && S.litCount >= S.cfg.refinery.launchMinLit * SWEEPABLE;
function costOf(S, id) {
  const U = S.cfg.upgrades;
  if (UPS.includes(id)) { if (id === 'width' && S.up.width >= U.width.max) return null; return U[id].base * Math.pow(U.growth, S.up[id]); }
  if (id === 'tool') { const t = S.cfg.tools[S.tool + 1]; return t ? t.cost : null; }
  if (id === 'keeper') return S.crewOpen && S.keepers.length < S.cfg.keeper.max ? S.cfg.keeper.cost[S.keepers.length] : null;
  return null;
}
const canBuy = (S, id) => { const c = costOf(S, id); return c != null && S.cash >= c; };
function buy(S, id) {
  if (!canBuy(S, id)) return false;
  S.cash -= costOf(S, id); S.spent++;
  if (S.tele.firstUpgrade == null) S.tele.firstUpgrade = S.t;
  if (UPS.includes(id)) S.up[id]++;
  else if (id === 'tool') { S.tool++; S.tele.tierAt[S.tool] = S.t; fxConfetti(S); sfx(S, 'tool'); }
  else if (id === 'keeper') { S.keepers.push({ x: DEPOT_C.x, y: DEPOT.r - 0.6, target: -1, work: 0, sector: -1, id: S.keepers.length }); S.tele.keeperAt[S.keepers.length] = S.t; sfx(S, 'keeper'); }
  return true;
}
function unlockGate(S, k) {
  if (k <= 0 || S.cash < gateCost(S, k)) return false;
  S.cash -= gateCost(S, k); S.unlocked[k] = true; S.tele.gateAt[k] = S.t; sfx(S, 'gate');
  addText(S, PADS[k].c + 1, PADS[k].r, 'Sector ' + (k + 1) + ' open!', '#FFD45E');
  return true;
}
function sell(S) {
  if (S.can <= 0) return;
  const kg = S.can, room = Math.max(0, S.cfg.refinery.tankKg - S.fuel), fuelKg = Math.min(kg * S.fuelShare, room);
  S.can = 0; S.fuel += fuelKg;
  const cash = (kg - fuelKg) * S.cfg.dust.pricePerKg * payoutMult(S);
  S.cash += cash; S.earned += cash; bin(S).sell += cash;
  if (S.tele.firstSell == null) S.tele.firstSell = S.t;
  addText(S, DEPOT_C.x, DEPOT.r - 0.5, '+$' + fmt(cash) + (fuelKg > 0 ? '  +' + fuelKg.toFixed(1) + ' Fuel' : ''), '#FFD45E');
  sfx(S, 'sell');
}
function launch(S) {
  const litPct = 100 * S.litCount / SWEEPABLE, sd = Math.floor(litPct * S.cfg.launch.stardustPerLitPct);
  S.stardust += sd; S.launches++; if (S.tele.launchAt == null) S.tele.launchAt = S.t;
  return { stardust: sd, litPct, t: S.t };
}
function skipOffline(S, minutes) {
  const cfg = S.cfg, m = Math.min(minutes, cfg.offline.capMin);
  const stormPerMin = cfg.storm.litFraction * S.litCount * 60 / cfg.storm.intervalSec;
  const keeperPerMin = S.keepers.length * 60 / cfg.keeper.secPerPass * cfg.offline.keeperTravelFactor;
  const up = S.keepers.length ? Math.min(1, stormPerMin > 0 ? keeperPerMin / stormPerMin : 1) : cfg.offline.noKeeperUptime;
  S.popup = { kind: 'offline', cash: S.rate * 60 * m * up, up, m };
}

// ===== state =====
function newGame(cfg, keep = {}) {
  const S = {
    cfg, t: 0, rng: mulberry32((keep.seed ?? cfg.seed) * 9973 + 1), headless: !!keep.headless,
    cash: 0, earned: 0, spent: 0, can: 0, fuel: 0, fuelShare: cfg.refinery.defaultFuelShare, stardust: keep.stardust || 0, launches: keep.launches || 0,
    tool: keep.tool || 0, up: { capacity: 0, width: 0, speed: 0, payout: 0, panelBoost: 0 },
    dirt: new Float32Array(N), ever: new Uint8Array(N), foot: new Int32Array(N), footId: 1, popAt: new Float32Array(N).fill(-9), shineUntil: new Float32Array(N), stormAt: new Float32Array(N).fill(-9),
    linked: new Uint8Array(N), dist: new Int16Array(N), par: new Int32Array(N).fill(-1), q: new Int32Array(N),
    unlocked: [true, false, false, false, false, false], payFlow: false, gatePaid: 0, litCount: 0, everCount: 0, stormed: 0, linkedCount: 0, rate: 0, linkT: 0,
    player: { x: DEPOT.c - 1.5, y: DEPOT.r + 2, tc: -1, tr: -1, face: -Math.PI / 2, moving: false },
    keepers: [], crewOpen: false, storm: { phase: 'idle', next: cfg.storm.firstStormAtSec, count: 0, targets: [], ti: 0, front: 0, dir: 1, r0: 0 },
    chain: 0, lastLitT: -9, lastTone: -9, blocked: -9, milestone: 0, zoomAt: -99, fx: [], popup: null, sfxFn: null,
    tele: { firstUpgrade: null, firstLit: null, firstSell: null, tierAt: {}, keeperAt: {}, gateAt: {}, launchAt: null, min: [], upK3: [0, 0], upK0: [0, 0], storms: 0 },
    ftue: { done: {}, shownAt: {} },
  };
  for (let i = 0; i < N; i++) S.dirt[i] = KIND[i] ? 0 : 1;
  const SUB = S.SUB = cfg.dust.sub; S.MW = C * SUB; S.MH = R * SUB; S.sub = new Uint8Array(S.MW * S.MH); S.subStamp = new Int32Array(S.MW * S.MH); S.stampId = 1; S.lastHead = null;
  for (let i = 0; i < N; i++) if (!KIND[i]) fillTile(S, i, 255);
  S.maskDirty = { x0: 0, y0: 0, x1: S.MW, y1: S.MH };
  S.player.tc = Math.floor(S.player.x); S.player.tr = Math.floor(S.player.y);
  return S;
}
function bin(S) {
  const m = Math.floor(S.t / 60), L = S.tele.min;
  while (L.length <= m) {
    if (L.length) Object.assign(L[L.length - 1], snap(S));
    L.push({ lit: 0, sell: 0, up: 0, w: 0 });
  }
  return L[m];
}
const snap = S => ({ litTiles: S.litCount, moon: +(100 * S.everCount / SWEEPABLE).toFixed(1), keepers: S.keepers.length, tool: S.tool, cash: Math.round(S.cash), rate: +S.rate.toFixed(2) });

// ===== simulation =====
const addText = (S, x, y, text, col) => { if (!S.headless) S.fx.push({ type: 'text', x, y, text, col, life: 1.3 }); };
function fxConfetti(S) { if (S.headless) return; for (let i = 0; i < 24; i++) { const a = S.rng() * Math.PI * 2, v = 2 + S.rng() * 4; S.fx.push({ type: 'dot', x: S.player.x, y: S.player.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.9, col: ['#3EE6FF', '#FFD45E', '#FF9F43', '#fff'][i % 4] }); } }
const sfx = (S, kind, n) => { if (S.sfxFn) S.sfxFn(kind, n); };

function onLit(S, i, byKeeper) {
  if (!S.ever[i]) { S.ever[i] = 1; S.everCount++; } else S.stormed--;
  S.litCount++; S.popAt[i] = S.t;
  const td = toolDef(S); if (td.shineSec && !byKeeper) S.shineUntil[i] = S.t + td.shineSec;
  S.chain = S.t - S.lastLitT < S.cfg.feel.toneWindowSec ? Math.min(S.chain + 1, S.cfg.feel.toneMax - 1) : 0; S.lastLitT = S.t;
  if (S.tele.firstLit == null) S.tele.firstLit = S.t;
  if (!S.headless) {
    if (S.t - S.lastTone > 0.06) { S.lastTone = S.t; sfx(S, 'lit', S.chain); }
    if (S.litCount <= 10 || S.litCount % 40 === 0) addText(S, i % C + 0.5, ((i / C) | 0), '+$' + (S.cfg.lit.powerPerTile * S.cfg.lit.gridLinkMult * panelMult(S)).toFixed(2) + '/s', '#3EE6FF');
    const ms = Math.floor(100 * S.everCount / SWEEPABLE / S.cfg.feel.milestonePct);
    if (ms > S.milestone) { S.milestone = ms; S.zoomAt = S.t; }
  }
}
// Fine dust mask: S.sub holds a dust level 0..255 per cell (S.SUB x S.SUB cells per tile, image layout MW x MH, row 0 = map top).
// Economy stays per tile: S.dirt[i] = mean level of the tile's cells; the tile is Lit once >= dust.litCleanFrac of its cells are clean
// (the last few cells are wiped then). kg are collected per cell, so a tile still yields dust.kgPerTile in total.
function markMask(S, x0, y0, x1, y1) { if (S.headless) return; const m = S.maskDirty; if (!m) S.maskDirty = { x0, y0, x1, y1 }; else { m.x0 = Math.min(m.x0, x0); m.y0 = Math.min(m.y0, y0); m.x1 = Math.max(m.x1, x1); m.y1 = Math.max(m.y1, y1); } }
function addKg(S, levels) { const kg = levels / 255 * S.cfg.dust.kgPerTile / (S.SUB * S.SUB); S.can = Math.min(capKg(S), S.can + kg); }
function fillTile(S, i, level) { const SUB = S.SUB, c = i % C, r = (i / C) | 0; for (let y = 0; y < SUB; y++) S.sub.fill(level, (r * SUB + y) * S.MW + c * SUB, (r * SUB + y) * S.MW + c * SUB + SUB); markMask(S, c * SUB, r * SUB, c * SUB + SUB, r * SUB + SUB); }
function refreshTile(S, i, collect) {
  if (S.dirt[i] === 0) return;
  const SUB = S.SUB, n = SUB * SUB, c = i % C, r = (i / C) | 0; let sum = 0, clean = 0;
  for (let y = 0; y < SUB; y++) { const o = (r * SUB + y) * S.MW + c * SUB; for (let x = 0; x < SUB; x++) { const v = S.sub[o + x]; sum += v; if (v === 0) clean++; } }
  if (clean >= S.cfg.dust.litCleanFrac * n) { if (collect) addKg(S, sum); fillTile(S, i, 0); S.dirt[i] = 0; onLit(S, i, !collect); }
  else S.dirt[i] = sum / (255 * n);
}
function passTile(S, i, amt, collect) { // one pass over the whole tile (Keepers, tests)
  if (KIND[i] || S.dirt[i] <= 0 || !S.unlocked[SEC[i]]) return 0;
  if (collect && capKg(S) - S.can <= 1e-9) { S.blocked = S.t; return 0; }
  const SUB = S.SUB, c = i % C, r = (i / C) | 0, lv = Math.round(255 * amt), before = S.dirt[i]; let got = 0;
  for (let y = 0; y < SUB; y++) { const o = (r * SUB + y) * S.MW + c * SUB; for (let x = 0; x < SUB; x++) { const v = S.sub[o + x], d = Math.min(v, lv); S.sub[o + x] = v - d; got += d; } }
  if (collect) addKg(S, got);
  markMask(S, c * SUB, r * SUB, c * SUB + SUB, r * SUB + SUB); refreshTile(S, i, collect);
  return before - S.dirt[i];
}
// A pass is applied to every tile that ENTERS the tool footprint (w x w square, + suction ring for the Vacuum Pack).
// The tool head sweeps, not the feet: head = player + reach (handle length per tier) along the facing. The brush is a rectangle
// `width` across the facing and dust.brushDepth deep (round tools: a disc of diameter width + 2 x suctionRadius), stamped on the fine
// mask along the head's path every step (sub-stamps every 0.2 tile so fast moves leave no gaps). A cell gets a pass when it enters
// the brush; cells already under the brush in the previous stamp do not (so standing or pushing slowly is not free scrubbing).
function headPos(S) { // the head stops in front of a building or rock (d = actual handle reach, for the 3D tool)
  const p = S.player, rc = toolDef(S).reach || 0.9, fx = Math.cos(p.face), fy = Math.sin(p.face); let d = rc;
  for (let k = 1; k * 0.1 <= rc + 1e-9; k++) if (blocked(p.x + fx * k * 0.1, p.y + fy * k * 0.1, 0, toolDef(S).rocksPassable)) { d = (k - 1) * 0.1; break; }
  return { x: p.x + fx * d, y: p.y + fy * d, d };
}
function brushStamp(S, ax, ay, bx, by) {
  const td = toolDef(S), w = toolWidth(S), SUB = S.SUB, MW = S.MW, f = S.player.face, fx = Math.cos(f), fy = Math.sin(f);
  if (capKg(S) - S.can <= 1e-9) { S.blocked = S.t; return; }
  const round = td.brush === 'round', rad = (w + 2 * (td.suctionRadius || 0)) / 2 + (S.cfg.dust.brushPad || 0), hw = w / 2 + (S.cfg.dust.brushPad || 0), hd = S.cfg.dust.brushDepth / 2, ext = round ? rad : Math.hypot(hw, hd);
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.2)), id = ++S.stampId, lv = Math.round(255 / td.passes), fid = ++S.footId;
  const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - ext) * SUB)), x1 = Math.min(MW, Math.ceil((Math.max(ax, bx) + ext) * SUB));
  const y0 = Math.max(0, Math.floor((Math.min(ay, by) - ext) * SUB)), y1 = Math.min(S.MH, Math.ceil((Math.max(ay, by) + ext) * SUB));
  const touched = new Set(); let got = 0;
  for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
    const px = (sx + 0.5) / SUB, py = (sy + 0.5) / SUB; let inside = false;
    for (let k = 0; k <= steps && !inside; k++) {
      const hx = ax + (bx - ax) * k / steps, hy = ay + (by - ay) * k / steps, dx = px - hx, dy = py - hy;
      inside = round ? dx * dx + dy * dy <= rad * rad : Math.abs(-fy * dx + fx * dy) <= hw && Math.abs(fx * dx + fy * dy) <= hd;
    }
    if (!inside) continue;
    const idx = sy * MW + sx, prev = S.subStamp[idx], i = ((sy / SUB) | 0) * C + ((sx / SUB) | 0);
    S.subStamp[idx] = id; S.foot[i] = fid;
    if (prev === id - 1 || KIND[i] || !S.unlocked[SEC[i]] || S.dirt[i] === 0) continue;
    const v = S.sub[idx]; if (!v) continue;
    const d = Math.min(v, lv); S.sub[idx] = v - d; got += d; touched.add(i);
  }
  if (!got) return;
  addKg(S, got); markMask(S, x0, y0, x1, y1);
  for (const i of touched) refreshTile(S, i, true);
}
function walkable(S, x, y) {
  if (x < 0.25 || y < 0.25 || x > C - 0.25 || y > R - 0.25) return false;
  return S.unlocked[SEC[Math.floor(y) * C + Math.floor(x)]] && !blocked(x, y, 0.3, toolDef(S).rocksPassable);
}
function movePlayer(S, ix, iy, dt) {
  const p = S.player, len = Math.hypot(ix, iy); p.moving = len > 0.01;
  if (!p.moving) return;
  if (len > 1) { ix /= len; iy /= len; }
  const td = toolDef(S);
  if (td.turnRate) { // machines: the facing turns at most turnRate rad/s and the machine slows while turning (wide turns)
    const m = Math.min(1, len), da = Math.atan2(Math.sin(Math.atan2(iy, ix) - p.face), Math.cos(Math.atan2(iy, ix) - p.face)), f = p.face + clamp(da, -td.turnRate * dt, td.turnRate * dt), k = Math.max(0.25, Math.cos(da));
    ix = Math.cos(f) * m * k; iy = Math.sin(f) * m * k;
  }
  const sp = playerSpeed(S) * dt;
  if (walkable(S, p.x + ix * sp, p.y)) p.x += ix * sp;
  if (walkable(S, p.x, p.y + iy * sp)) p.y += iy * sp;
  p.face = Math.atan2(iy, ix);
  p.tc = Math.floor(p.x); p.tr = Math.floor(p.y);
  const h = headPos(S), l = S.lastHead, cont = l && Math.hypot(h.x - l.x, h.y - l.y) < 1.5; // a teleport (test, cheat) starts a new stroke
  brushStamp(S, cont ? l.x : h.x, cont ? l.y : h.y, h.x, h.y); S.lastHead = h;
}
function recalcLinks(S) {
  const L = S.linked, q = S.q; L.fill(0); let h = 0, t = 0;
  for (let i = 0; i < N; i++) if (KIND[i] === 1) { L[i] = 1; S.dist[i] = 0; S.par[i] = -1; q[t++] = i; }
  while (h < t) {
    const i = q[h++], c = i % C;
    for (let k = 0; k < 4; k++) {
      const j = k === 0 ? (c > 0 ? i - 1 : -1) : k === 1 ? (c < C - 1 ? i + 1 : -1) : k === 2 ? i - C : i + C;
      if (j < 0 || j >= N || L[j] || KIND[j] || S.dirt[j] !== 0 || !S.ever[j]) continue;
      L[j] = 1; S.dist[j] = S.dist[i] + 1; S.par[j] = i; q[t++] = j;
    }
  }
  const lit = S.cfg.lit, shine = (S.cfg.tools.find(t => t.shineMult) || {}).shineMult || 1;
  let sum = 0, linkedN = 0;
  for (let i = 0; i < N; i++) if (!KIND[i] && S.dirt[i] === 0 && S.ever[i]) {
    const m = (L[i] ? lit.gridLinkMult : 1) * (S.shineUntil[i] > S.t ? shine : 1); sum += m; if (L[i]) linkedN++;
  }
  S.linkedCount = linkedN; S.rate = sum * lit.powerPerTile * panelMult(S);
}
function stepStorm(S, dt) {
  const st = S.storm, cfg = S.cfg.storm;
  if (st.phase === 'idle' && S.t >= st.next - cfg.warningSec) {
    if (S.litCount < 4) { st.next += 10; return; }
    const lits = []; for (let i = 0; i < N; i++) if (!KIND[i] && S.dirt[i] === 0 && S.ever[i]) lits.push(i);
    let row = -1, far = -1; // band centred on the farthest of `samples` random Lit tiles: storms hit where the player is not
    for (let k = 0; k < Math.max(1, cfg.samples || 1); k++) { const i = lits[Math.floor(S.rng() * lits.length)], d = Math.abs(((i / C) | 0) - S.player.y); if (d > far) { far = d; row = (i / C) | 0; } }
    st.r0 = clamp(row - (cfg.bandRows >> 1), 0, R - cfg.bandRows); st.dir = S.rng() < 0.5 ? 1 : -1; st.phase = 'warn'; st.blowAt = st.next;
    sfx(S, 'warn');
  }
  if (st.phase === 'warn' && S.t >= st.blowAt) {
    const band = []; for (let r = st.r0; r < st.r0 + cfg.bandRows; r++) for (let c = 0; c < C; c++) { const i = r * C + c; if (!KIND[i] && S.dirt[i] === 0 && S.ever[i]) band.push(i); }
    for (let k = band.length - 1; k > 0; k--) { const j = Math.floor(S.rng() * (k + 1)); [band[k], band[j]] = [band[j], band[k]]; }
    const n = st.count === 0 ? cfg.firstStormTiles : Math.round(cfg.litFraction * S.litCount);
    st.targets = band.slice(0, n).sort((a, b) => st.dir * (a % C - b % C)); st.ti = 0;
    st.front = st.dir > 0 ? -2 : C + 2; st.phase = 'blow';
  }
  if (st.phase === 'blow') {
    st.front += st.dir * (C + 4) / cfg.frontSec * dt;
    while (st.ti < st.targets.length && (st.dir > 0 ? st.targets[st.ti] % C <= st.front : st.targets[st.ti] % C >= st.front)) {
      const i = st.targets[st.ti++];
      if (S.dirt[i] === 0 && S.ever[i]) { S.dirt[i] = cfg.dirtAfter; fillTile(S, i, Math.round(255 * cfg.dirtAfter)); S.litCount--; S.stormed++; S.stormAt[i] = S.t; }
    }
    if (st.dir > 0 ? st.front > C + 2 : st.front < -2) {
      st.phase = 'idle'; st.count++; S.tele.storms++; st.next = st.blowAt + cfg.intervalSec; S.crewOpen = true;
    }
  }
}
function pickKeeperTarget(S, k) {
  const claimed = new Set(S.keepers.filter(o => o !== k && o.target >= 0).map(o => o.target)), per = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) if (S.ever[i] && S.dirt[i] > 0 && !claimed.has(i)) per[SEC[i]]++;
  let sec = -1, best = 0; for (let s = 0; s < 6; s++) if (per[s] > best) { best = per[s]; sec = s; }
  if (k.sector >= 0 && per[k.sector] > 0) sec = k.sector; // stay on the assigned sector until it is clean (no cross-map flights)
  k.sector = sec; if (sec < 0) return -1;
  let bi = -1, bd = 1e9;
  for (let i = 0; i < N; i++) if (SEC[i] === sec && S.ever[i] && S.dirt[i] > 0 && !claimed.has(i)) { const d = Math.abs(i % C + 0.5 - k.x) + Math.abs(((i / C) | 0) + 0.5 - k.y); if (d < bd) { bd = d; bi = i; } }
  return bi;
}
function stepKeepers(S, dt) {
  const kc = S.cfg.keeper;
  for (const k of S.keepers) {
    if (k.target >= 0 && S.dirt[k.target] <= 0) { k.target = -1; k.retry = 0; } // done: pick the next one now
    if (k.target < 0) { k.work = 0; k.retry = (k.retry || 0) - dt; if (k.retry <= 0) { k.target = pickKeeperTarget(S, k); k.retry = k.target < 0 ? 0.5 : 0; } }
    const tx = k.target >= 0 ? k.target % C + 0.5 : DEPOT_C.x + Math.cos(S.t * 0.7 + k.id * 1.05) * 3, ty = k.target >= 0 ? ((k.target / C) | 0) + 0.5 : DEPOT.r - 1.5 + Math.sin(S.t * 0.7 + k.id * 1.05) * 1.2;
    const dx = tx - k.x, dy = ty - k.y, d = Math.hypot(dx, dy), s = kc.speed * dt;
    if (d > s) {
      const ox = k.x, oy = k.y; k.x += dx / d * s; k.y += dy / d * s; k.working = false;
      if (pushOut(k, 0.35) && Math.hypot(k.x - ox, k.y - oy) < s * 0.3) { const sg = k.id % 2 ? 1 : -1; k.x = ox - dy / d * s * sg; k.y = oy + dx / d * s * sg; pushOut(k, 0.35); } // head-on into a wall: slide sideways
    }
    else { k.x = tx; k.y = ty; if (k.target >= 0) { k.working = true; k.work += dt; if (k.work >= kc.secPerPass) { k.work = 0; passTile(S, k.target, kc.passPower, false); } } }
  }
}
function step(S, dt, input) {
  S.t += dt;
  if (input) movePlayer(S, input.x, input.y, dt); else S.player.moving = false;
  const p = S.player;
  if (inRectT(p.x, p.y, SELL)) sell(S);
  const ad = toolDef(S).autoDumpSec; // Ride-on: the canister empties to the Depot on its own
  if (ad && (S.dumpT = (S.dumpT ?? ad) - dt) <= 0) { S.dumpT = ad; if (S.can > 0) { sell(S); S.tele.autoDumps = (S.tele.autoDumps || 0) + 1; } }
  const g = nextGate(S);
  if (g > 0 && inRectT(p.x, p.y, PADS[g])) {
    if (!S.payFlow) unlockGate(S, g);
    else { // pay zone: cash flows into the gate while you stand on it; partial payment is kept
      const cost = gateCost(S, g), pay = Math.min(S.cash, cost * dt / (S.cfg.ui ? S.cfg.ui.payZoneSec : 1.5), cost - S.gatePaid);
      S.cash -= pay; S.gatePaid += pay;
      if (S.gatePaid >= cost - 1e-6) { S.cash += cost; S.gatePaid = 0; unlockGate(S, g); }
    }
  }
  const b = bin(S), inc = S.rate * dt; S.cash += inc; S.earned += inc; b.lit += inc;
  if ((S.linkT -= dt) <= 0) { S.linkT = S.cfg.lit.linkRecalcSec; recalcLinks(S); }
  stepStorm(S, dt); stepKeepers(S, dt);
  if (S.everCount > 0) {
    const up = S.litCount / S.everCount; b.up += up * dt; b.w += dt;
    if (S.storm.count > 0) { const u = S.keepers.length >= 3 ? S.tele.upK3 : S.keepers.length === 0 ? S.tele.upK0 : null; if (u) { u[0] += up * dt; u[1] += dt; } }
  }
  if (!S.headless) {
    for (const f of S.fx) { f.life -= dt; if (f.type === 'dot') { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.94; f.vy *= 0.94; } else f.y -= 1.2 * dt; }
    S.fx = S.fx.filter(f => f.life > 0);
  }
}

// ===== bot (headless) =====
// reclean: bot also targets storm-dusted tiles. keepers: how many Keepers it will hire. idleAfter: minutes after which the bot stops playing (passive test).
function nearestDirty(S, reclean, ban) {
  const p = S.player, hp = headPos(S), here = Math.floor(hp.y) * C + Math.floor(hp.x); let bi = -1, bd = 1e9;
  for (let i = 0; i < N; i++) {
    if (KIND[i] || S.dirt[i] <= 0 || !S.unlocked[SEC[i]] || S.foot[i] === S.footId || i === here || (!reclean && S.ever[i]) || (ban && ban[i] > S.t)) continue;
    const c = i % C, r = (i / C) | 0, near = Math.abs(c + 0.5 - p.x) + Math.abs(r + 0.5 - p.y);
    if (reclean === 'near' && S.ever[i] && near > 6) continue; // human model: re-sweeps storm tiles only when they are close
    const d = near + 0.15 * (Math.abs(c - DEPOT_C.x) + Math.abs(r - DEPOT_C.y));
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}
function unlockedClean(S) { let n = 0, e = 0; for (let i = 0; i < N; i++) if (!KIND[i] && S.unlocked[SEC[i]]) { n++; if (S.ever[i]) e++; } return e / Math.max(1, n); }
// bot only: slide around buildings and rocks (direct way first, then turns of 45/90/135 degrees to the current side);
// a bot that has not moved for 2 s flips its side, and after two stalls gives up on the target tile for 20 s
function steer(S, B, mv) {
  const p = S.player;
  if ((B.stallT = (B.stallT || 0) + 0.05) >= 2) {
    const moved = Math.hypot(p.x - (B.sx ?? p.x), p.y - (B.sy ?? p.y)); B.stallT = 0; B.sx = p.x; B.sy = p.y;
    if (mv && moved < 0.3) { B.side = -(B.side || 1); if (++B.stalls >= 2 && B.tile >= 0) { (B.ban ??= {})[B.tile] = S.t + 20; B.tile = -1; B.stalls = 0; } } else B.stalls = 0;
  }
  if (!mv) return mv;
  const a = Math.atan2(mv.y, mv.x), m = Math.hypot(mv.x, mv.y), side = B.side || 1;
  for (const da of [0, 0.785, 1.571, 2.356]) { const b = a + da * side; if (walkable(S, p.x + Math.cos(b) * 0.35, p.y + Math.sin(b) * 0.35)) return { x: Math.cos(b) * m, y: Math.sin(b) * m }; }
  return mv;
}
function botMove(S, B) { B.stalls ??= 0; return steer(S, B, botMove0(S, B)); }
function botMove0(S, B) {
  const p = S.player;
  if (S.can >= capKg(S) - 1e-6 || S.t - S.blocked < 0.3) { B.tile = -1; return toward(p, DEPOT_C.x, DEPOT_C.y); }
  const g = nextGate(S);
  if (g > 0 && S.cash >= gateCost(S, g) && (B.cleanFrac >= 0.85 || B.noDirty)) return toward(p, PADS[g].c + 1, PADS[g].r + 1);
  // human-like strokes: walk onto the target tile's row beside it, then sweep back and forth along the row so the tool head
  // crosses the whole tile each leg (head = body + reach, so a leg runs from reach before the tile to reach past it)
  if (B.tile < 0 || S.dirt[B.tile] <= 0 || B.legs > 12) {
    B.tile = nearestDirty(S, B.reclean, B.ban); if (B.tile < 0 && B.reclean === 'near') B.tile = nearestDirty(S, true, B.ban);
    B.noDirty = B.tile < 0; B.dir = 0; B.legs = 0; B.appT = 0;
    if (B.tile >= 0) { // lawnmower span: up to 4 tiles of the row, toward the dirtier side, inside the sector
      const tc = B.tile % C, row = B.tile - tc, s0 = Math.floor(tc / 24) * 24, sum = k => (k >= s0 && k < s0 + 24 ? S.dirt[row + k] : 0);
      const R3 = sum(tc + 1) + sum(tc + 2) + sum(tc + 3), L3 = sum(tc - 1) + sum(tc - 2) + sum(tc - 3);
      B.a = R3 >= L3 ? tc : Math.max(s0, tc - (B.span || 0)); B.b = R3 >= L3 ? Math.min(s0 + 23, tc + (B.span || 0)) : tc;
    }
  }
  if (B.tile < 0) return null;
  const tc = B.tile % C, ty = ((B.tile / C) | 0) + 0.5, reach = toolDef(S).reach || 0.9, lo = Math.max(0.3, B.a - reach - 0.15), hi = Math.min(C - 0.3, B.b + 1 + reach + 0.15);
  if (!B.dir) {
    const side = Math.abs(p.x - lo) < Math.abs(p.x - hi) ? lo : hi;
    if ((B.appT = (B.appT || 0) + 0.05) < 4 && (Math.abs(p.y - ty) > 0.2 || Math.abs(p.x - side) > 0.3)) return toward(p, side, ty); // blocked approach (wall): start the stroke anyway
    B.dir = side === lo ? 1 : -1;
  }
  if ((B.dir > 0 && (p.x >= hi || !walkable(S, p.x + 0.3, p.y))) || (B.dir < 0 && (p.x <= lo || !walkable(S, p.x - 0.3, p.y)))) { B.dir = -B.dir; B.legs++; }
  return { x: B.dir, y: clamp((ty - p.y) * 3, -0.4, 0.4) };
}
function toward(p, x, y) { const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy); return d < 0.05 ? null : { x: dx / d, y: dy / d }; }
function botBuy(S, B) {
  B.cleanFrac = unlockedClean(S);
  if (canLaunch(S)) return 'launch';
  for (let guard = 0; guard < 30; guard++) {
    if (S.keepers.length < B.keepers && canBuy(S, 'keeper') && costOf(S, 'keeper') <= S.cash * 0.6) { buy(S, 'keeper'); continue; }
    if (canBuy(S, 'tool')) { buy(S, 'tool'); continue; }
    const g = nextGate(S), save = Math.min(costOf(S, 'tool') ?? 1e12, g > 0 && B.cleanFrac >= 0.6 ? gateCost(S, g) : 1e12);
    const ups = UPS.filter(id => canBuy(S, id)).sort((a, b) => costOf(S, a) - costOf(S, b));
    if (!ups.length) break;
    const c = costOf(S, ups[0]);
    if (save < 1e12 && S.cash - c < save && c > save * B.upgradeShare) break;
    if (c > S.cash * 0.5) break;
    buy(S, ups[0]);
  }
  return null;
}
function runBot({ minutes = 45, seed = 1, keepers = 3, reclean = 'near', idleAfter = null, upgradeShare = 0.2, eff = 0.75, overrides = {}, dt = 0.05, stopAtLaunch = true } = {}) {
  const cfg = deepMerge(clone(CONFIG), overrides); cfg.seed = seed;
  const S = newGame(cfg, { headless: true, seed });
  const B = { tile: -1, keepers, reclean, upgradeShare, cleanFrac: 0, noDirty: false, think: 0 };
  let launchInfo = null, idleUp = [0, 0];
  while (S.t < minutes * 60) {
    const idle = idleAfter != null && S.t >= idleAfter * 60;
    const mv = idle ? null : botMove(S, B); // eff < 1: human model (imperfect paths, overlap, thumb not at full tilt)
    step(S, dt, mv && { x: mv.x * eff, y: mv.y * eff });
    if (idle && S.everCount) { idleUp[0] += S.litCount / S.everCount * dt; idleUp[1] += dt; }
    if ((B.think -= dt) <= 0 && !idle) { B.think = 1; if (botBuy(S, B) === 'launch') { launchInfo = launch(S); if (stopAtLaunch) break; } }
  }
  bin(S); return Object.assign(teleSummary(S), { seed, eff, keepersMax: keepers, reclean, idleAfter, idleUptime: idleUp[1] ? +(100 * idleUp[0] / idleUp[1]).toFixed(1) : null, launch: launchInfo });
}
function teleSummary(S) {
  const T = S.tele, mins = T.min.map((m, i) => Object.assign({ m: i + 1, lit: Math.round(m.lit), sell: Math.round(m.sell), up: m.w ? Math.round(100 * m.up / m.w) : null }, i < T.min.length - 1 ? {} : snap(S), m.litTiles != null ? { litTiles: m.litTiles, moon: m.moon, keepers: m.keepers, tool: m.tool, rate: m.rate } : {}));
  const full = mins.filter((m, i) => i < mins.length - 1);
  // GB2: first minute where Lit income beats dust sales on a 3-minute rolling window (smooths Depot trip timing), and keeps beating it the next minute
  const roll = (i, k) => full.slice(Math.max(0, i - 1), i + 2).reduce((a, m) => a + m[k], 0), beats = i => i >= full.length || roll(i, 'lit') > roll(i, 'sell');
  let cross = null; for (let i = 0; i < full.length; i++) if (beats(i) && beats(i + 1)) { cross = full[i].m; break; }
  return {
    t: Math.round(S.t), firstLit: T.firstLit, firstUpgrade: T.firstUpgrade, keeper1: T.keeperAt[1], keeper3: T.keeperAt[3], tier2: T.tierAt[1], tier3: T.tierAt[2], tier4: T.tierAt[3], tier5: T.tierAt[4], tier6: T.tierAt[5], tierAtLaunch: S.tool + 1,
    gates: Object.assign({}, T.gateAt), launchAt: T.launchAt, litBeatsSellMin: cross, storms: T.storms,
    uptimeK3: T.upK3[1] ? +(100 * T.upK3[0] / T.upK3[1]).toFixed(1) : null, uptimeK0: T.upK0[1] ? +(100 * T.upK0[0] / T.upK0[1]).toFixed(1) : null,
    up: Object.assign({}, S.up), moon: +(100 * S.everCount / SWEEPABLE).toFixed(1), lit: +(100 * S.litCount / SWEEPABLE).toFixed(1), fuel: Math.round(S.fuel), cash: Math.round(S.cash), minutes: mins,
  };
}
// GB1-GB4 in one call. active = plays normally, hires up to 6 Keepers; noKeeper = same player, never hires;
// passive = active until minute 12, then idle for 15 minutes (with vs without Keepers).
function botReport(seeds = [1, 2, 3], overrides = {}) {
  const act = seeds.map(seed => runBot({ seed, overrides })), nok = seeds.map(seed => runBot({ seed, keepers: 0, overrides }));
  const pasK = seeds.map(seed => runBot({ seed, idleAfter: 12, minutes: 27, keepers: 3, overrides, stopAtLaunch: false })), pas0 = seeds.map(seed => runBot({ seed, idleAfter: 12, minutes: 27, keepers: 0, overrides, stopAtLaunch: false }));
  const avg = a => a.filter(v => v != null).length ? +(a.filter(v => v != null).reduce((x, y) => x + y, 0) / a.filter(v => v != null).length).toFixed(1) : null;
  return {
    GB1_firstUpgradeSec: act.map(r => r.firstUpgrade && +r.firstUpgrade.toFixed(1)),
    GB2_litBeatsSellMin: act.map(r => r.litBeatsSellMin),
    GB3_launchMin: act.map(r => r.launchAt && +(r.launchAt / 60).toFixed(1)),
    GB4_uptime3Keepers: act.map(r => r.uptimeK3), GB4_uptimeNoKeeper: nok.map(r => r.uptimeK0),
    passiveIdleUptime3K: pasK.map(r => r.idleUptime), passiveIdleUptime0K: pas0.map(r => r.idleUptime),
    noKeeperLaunchMin: nok.map(r => r.launchAt && +(r.launchAt / 60).toFixed(1)),
    milestones: act.map(r => ({ keeper1: mmss(r.keeper1), tier2: mmss(r.tier2), tier3: mmss(r.tier3), tier4: mmss(r.tier4), tier5: mmss(r.tier5), tier6: mmss(r.tier6), tierAtLaunch: r.tierAtLaunch, gates: Object.fromEntries(Object.entries(r.gates).map(([k, v]) => [k, mmss(v)])) })),
    avg: { launchMin: avg(act.map(r => r.launchAt && r.launchAt / 60)), uptimeK3: avg(act.map(r => r.uptimeK3)), uptimeK0: avg(nok.map(r => r.uptimeK0)) },
    runs: { act, nok },
  };
}
function selfTest() {
  const out = {};
  const a = runBot({ minutes: 5, seed: 4 }), b = runBot({ minutes: 5, seed: 4 });
  out.deterministic = a.cash === b.cash && a.moon === b.moon;
  // accounting + rules during an 8-minute bot run, checked every second
  const cfg = clone(CONFIG), S = newGame(cfg, { headless: true, seed: 2 }), B = { tile: -1, keepers: 6, reclean: 'near', upgradeShare: 0.2, cleanFrac: 0, think: 0 };
  let ok = { counts: true, canister: true, locked: true, cash: true };
  for (let i = 0; i < 9600; i++) {
    step(S, 0.05, botMove(S, B)); if ((B.think -= 0.05) <= 0) { B.think = 1; botBuy(S, B); }
    if (i % 20 === 0) {
      let lit = 0, ever = 0, st = 0; for (let j = 0; j < N; j++) if (!KIND[j]) { if (S.ever[j]) { ever++; if (S.dirt[j] === 0) lit++; else st++; } }
      if (lit !== S.litCount || ever !== S.everCount || st !== S.stormed) ok.counts = false;
      if (S.can > capKg(S) + 1e-6) ok.canister = false;
      if (!S.unlocked[SEC[Math.floor(S.player.y) * C + Math.floor(S.player.x)]]) ok.locked = false;
      if (!(S.cash >= 0) || !isFinite(S.cash)) ok.cash = false;
    }
  }
  Object.assign(out, ok);
  out.stormHappened = S.tele.storms >= 2;
  // tool ladder: each tier's brush cleans a band at least its width across (straight stroke up through free floor, row 51)
  out.toolTiers = CONFIG.tools.length === 8 && CONFIG.tools.every((td, k) => {
    const Z = newGame(clone(CONFIG), { headless: true, tool: k }); Z.player.x = 14; Z.player.y = 54.6; Z.player.face = -Math.PI / 2;
    for (let n = 0; n < 16; n++) step(Z, 0.05, { x: 0, y: -1 });
    let band = 0; for (let c = 0; c < 24; c++) if (Z.dirt[51 * C + c] < 1) band++;
    return band >= td.width;
  });
  // layout: every footprint cell (plates, pads, gate pads, rocks) is clean at start and after the storms above; rects never overlap
  const fpClean = X => { for (let i = 0; i < N; i++) if (KIND[i]) { if (X.dirt[i] !== 0) return false; const c = i % C, r = (i / C) | 0; for (let y = 0; y < X.SUB; y++) for (let x = 0; x < X.SUB; x++) if (X.sub[(r * X.SUB + y) * X.MW + c * X.SUB + x]) return false; } return true; };
  out.footprintClean = fpClean(newGame(clone(CONFIG), { headless: true })) && fpClean(S);
  const rects = [DEPOT, ...Object.values(PADZ), ...Object.values(BLDG), ...PADS.slice(1)];
  out.layoutNoOverlap = rects.every((a, i) => rects.every((b, j) => j <= i || a.c >= b.c + b.w || b.c >= a.c + a.w || a.r >= b.r + b.h || b.r >= a.r + a.h))
    && ROCKS.every(k => rects.every(b => !inRectT(k.x, k.y, b)));
  out.gatesOnBorders = PADS.slice(1).every((p, k) => { const v = (p.c + 1) % 24 === 0, a = SEC[p.r * C + p.c], b = SEC[(p.r + (v ? 0 : 1)) * C + p.c + (v ? 1 : 0)]; return (v || (p.r + 1) % 24 === 0) && a !== b && (a === k + 1 || b === k + 1); });
  // collision: walking into the Depot stops at its wall (still inside the sell rim); the tool head stops at a rock
  const Q = newGame(clone(CONFIG), { headless: true }); Q.player.x = 7.5; Q.player.y = 64; for (let k = 0; k < 40; k++) step(Q, 0.05, { x: 1, y: 0 });
  const rk = ROCKS[0]; Q.player.x = rk.x - 1; Q.player.y = rk.y; Q.player.face = 0;
  out.solidsBlock = Q.player.x > rk.x - 1.01 && headPos(Q).x <= rk.x - rk.rad + 1e-9 && (() => { const Z = newGame(clone(CONFIG), { headless: true }); Z.player.x = 7.5; Z.player.y = 64; for (let k = 0; k < 40; k++) step(Z, 0.05, { x: 1, y: 0 }); return Z.player.x > SELL.c && Z.player.x < DEPOT.c + 0.45 && Z.tele.firstSell !== null; })(); // stopped at the wall and sold there
  // station hub airlock: clean foundation, solid; walking down column 1 from the north stops at its wall
  const Hb = BLDG.hub, Hw = newGame(clone(CONFIG), { headless: true }); Hw.player.x = 1; Hw.player.y = Hb.r - 1.5; for (let k = 0; k < 40; k++) step(Hw, 0.05, { x: 0, y: 1 });
  out.hubSolid = KIND[(Hb.r + 1) * C + Hb.c] === 2 && blocked(Hb.c + 1, Hb.r + 1.5, 0.3) && Hw.player.y < Hb.r + 0.15 && Hw.player.y > Hb.r - 1;
  // a toothbrush tile needs exactly 3 passes; a storm tile drops to dirtAfter; a Keeper re-lights it
  const T = newGame(clone(CONFIG), { headless: true }); const i0 = 60 * C + 5;
  passTile(T, i0, 1 / 3, true); passTile(T, i0, 1 / 3, true); const before = T.dirt[i0] > 0; passTile(T, i0, 1 / 3, true);
  out.threePasses = before && T.dirt[i0] === 0 && T.litCount === 1;
  T.dirt[i0] = CONFIG.storm.dirtAfter; T.litCount--; T.stormed++; T.crewOpen = true; buy(T, 'keeper');
  for (let k = 0; k < 400 && T.dirt[i0] > 0; k++) step(T, 0.05, null);
  out.keeperRelights = T.dirt[i0] === 0 && T.stormed === 0;
  out.lockedSectorUnsweepable = passTile(T, 10 * C + 5, 1, true) === 0;
  // the tool head sweeps (ahead of the player), across the facing, `width` tiles wide
  const H = newGame(clone(CONFIG), { headless: true }); H.player.x = 5.5; H.player.y = 60.5; H.player.face = 0; step(H, 0.05, { x: 1, y: 0 });
  out.headSweeps = H.dirt[60 * C + 6] < 1 && H.dirt[60 * C + 5] === 1;
  H.tool = 3; H.player.x = 10.5; H.player.y = 55.5; H.player.face = -Math.PI / 2; 
  step(H, 0.05, { x: 0, y: -1 }); // Push Broom stroke upward: head ~ row 54, four columns wide (8.5-12.5)
  const hit = c => H.dirt[53 * C + c] < 1 || H.dirt[54 * C + c] < 1;
  const edge = c => Math.min(H.dirt[53 * C + c], H.dirt[54 * C + c]) > 0.9; // brushPad only grazes the neighbours
  out.widthAcross = [8, 9, 10, 11, 12].every(hit) && edge(7) && edge(13);
  // a tile is Lit once 95% of its fine cells are clean, and a storm re-dusts its cells
  const F = newGame(clone(CONFIG), { headless: true }), j = 60 * C + 5, SB = F.SUB;
  for (let y = 0; y < SB; y++) for (let x = 0; x < SB; x++) if (y || x) F.sub[(60 * SB + y) * F.MW + 5 * SB + x] = 0;
  refreshTile(F, j, true); out.fineLit = F.dirt[j] === 0 && F.litCount === 1 && F.sub[60 * SB * F.MW + 5 * SB] === 0;
  // launch resets planet but keeps tool + stardust
  T.tool = 3; T.fuel = CONFIG.refinery.tankKg; const r = launch(T); const U = newGame(clone(CONFIG), { tool: T.tool, stardust: T.stardust, headless: true });
  out.launchKeepsTool = U.tool === 3 && U.cash === 0 && U.litCount === 0 && U.stardust === r.stardust;
  for (const [k, v] of Object.entries(out)) console.assert(v, 'selfTest failed: ' + k);
  out.pass = Object.values(out).every(v => v === true);
  return out;
}
globalThis.SP = { SELL, headPos, blocked, PADZ, BLDG, ROCKS, SOLIDS, KIND, SWEEPABLE, CONFIG, newGame, step, buy, runBot, botReport, selfTest, teleSummary, skipOffline, launch };


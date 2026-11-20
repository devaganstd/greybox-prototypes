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
  grid: { cols: 48, rows: 72, tilePx: 16, sectors: 6, sectorGateCost: [0, 50, 250, 800, 2000, 6000] }, // tuned (concept 300/1500/6000/20000: bot idled 10+ min waiting for gates) // cols/rows/sectors fixed in this greybox (gate pads are hand-placed)
  player: { speed: 4.0 /* tiles per second */ },
  dust: { kgPerTile: 0.25, pricePerKg: 4.0 }, // tuned (concept 1.0)
  lit: { powerPerTile: 0.0015 /* $ per second; tuned (concept 0.01 = Lit beat sales in minute 1, Launch at 9 min) */, gridLinkMult: 2, linkRecalcSec: 1 },
  tools: [
    { id: 'Toothbrush', width: 1, passes: 3, capKg: 10, speedMult: 1.0, cost: 0 },
    { id: 'Scrub Brush', width: 1, passes: 2, capKg: 15, speedMult: 1.0, cost: 80 },
    { id: 'Mop', width: 2, passes: 2, capKg: 20, speedMult: 1.0, cost: 400, shineMult: 1.25, shineSec: 60 },
    { id: 'Push Broom', width: 3, passes: 1, capKg: 30, speedMult: 1.0, cost: 1200 }, // cost tuned (concept 2000)
    { id: 'Vacuum Pack', width: 3, passes: 1, capKg: 60, speedMult: 1.0, cost: 5000, suctionRadius: 1 }, // cost tuned (concept 9000)
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
const DEPOT = { c: 9, r: 62, w: 6, h: 4 }; // left 4 = Depot, right 2 = Refinery + Launch Pad
const DEPOT_C = { x: DEPOT.c + 2, y: DEPOT.r + 2 };
const PADS = [null, { c: 21, r: 57, w: 2, h: 2 }, { c: 10, r: 48, w: 2, h: 2 }, { c: 21, r: 34, w: 2, h: 2 }, { c: 10, r: 24, w: 2, h: 2 }, { c: 21, r: 10, w: 2, h: 2 }];
const sectorOf = (c, r) => (2 - Math.floor(r / 24)) * 2 + (c >= 24 ? 1 : 0);
const SEC = new Uint8Array(N), KIND = new Uint8Array(N), DOTS = new Float32Array(N * 12);
function hsh(i) { let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; }
for (let i = 0; i < N; i++) {
  const c = i % C, r = (i / C) | 0; SEC[i] = sectorOf(c, r);
  KIND[i] = c >= DEPOT.c && c < DEPOT.c + DEPOT.w && r >= DEPOT.r && r < DEPOT.r + DEPOT.h ? 1 : 0;
  const h1 = hsh(i), h2 = hsh(i + 7777);
  for (let k = 0; k < 6; k++) { DOTS[i * 12 + k * 2] = 0.1 + ((h1 >>> (k * 5)) & 31) / 32 * 0.8; DOTS[i * 12 + k * 2 + 1] = 0.1 + ((h2 >>> (k * 5)) & 31) / 32 * 0.8; }
}
const SWEEPABLE = N - DEPOT.w * DEPOT.h;
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
  else if (id === 'keeper') { S.keepers.push({ x: DEPOT_C.x, y: DEPOT_C.y - 1, target: -1, work: 0, sector: -1, id: S.keepers.length }); S.tele.keeperAt[S.keepers.length] = S.t; sfx(S, 'keeper'); }
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
function passTile(S, i, amt, collect) {
  if (KIND[i] || S.dirt[i] <= 0 || !S.unlocked[SEC[i]]) return 0;
  let d = Math.min(S.dirt[i], amt);
  if (collect) {
    const room = capKg(S) - S.can;
    if (room <= 1e-9) { S.blocked = S.t; return 0; }
    d = Math.min(d, room / S.cfg.dust.kgPerTile); S.can += d * S.cfg.dust.kgPerTile;
  }
  S.dirt[i] -= d;
  if (S.dirt[i] <= 1e-6) { S.dirt[i] = 0; onLit(S, i, !collect); }
  return d;
}
// A pass is applied to every tile that ENTERS the tool footprint (w x w square, + suction ring for the Vacuum Pack).
function sweepAt(S, c, r) {
  const td = toolDef(S), w = toolWidth(S), sr = td.suctionRadius || 0, o = -Math.floor((w - 1) / 2), id = ++S.footId, amt = 1 / td.passes;
  for (let dy = o - sr; dy < o + w + sr; dy++) for (let dx = o - sr; dx < o + w + sr; dx++) {
    const cc = c + dx, rr = r + dy; if (cc < 0 || rr < 0 || cc >= C || rr >= R) continue;
    const i = rr * C + cc, ring = dy < o || dy >= o + w || dx < o || dx >= o + w;
    if (S.foot[i] !== id - 1) passTile(S, i, ring ? (S.ever[i] ? 1 : amt * 0.5) : amt, true);
    S.foot[i] = id;
  }
}
function walkable(S, x, y) {
  if (x < 0.25 || y < 0.25 || x > C - 0.25 || y > R - 0.25) return false;
  return S.unlocked[SEC[Math.floor(y) * C + Math.floor(x)]];
}
function movePlayer(S, ix, iy, dt) {
  const p = S.player, len = Math.hypot(ix, iy); p.moving = len > 0.01;
  if (!p.moving) return;
  if (len > 1) { ix /= len; iy /= len; }
  const sp = playerSpeed(S) * dt;
  if (walkable(S, p.x + ix * sp, p.y)) p.x += ix * sp;
  if (walkable(S, p.x, p.y + iy * sp)) p.y += iy * sp;
  p.face = Math.atan2(iy, ix);
  const tc = Math.floor(p.x), tr = Math.floor(p.y);
  if (tc !== p.tc || tr !== p.tr) { p.tc = tc; p.tr = tr; sweepAt(S, tc, tr); }
}
function recalcLinks(S) {
  const L = S.linked, q = S.q; L.fill(0); let h = 0, t = 0;
  for (let i = 0; i < N; i++) if (KIND[i]) { L[i] = 1; S.dist[i] = 0; S.par[i] = -1; q[t++] = i; }
  while (h < t) {
    const i = q[h++], c = i % C;
    for (let k = 0; k < 4; k++) {
      const j = k === 0 ? (c > 0 ? i - 1 : -1) : k === 1 ? (c < C - 1 ? i + 1 : -1) : k === 2 ? i - C : i + C;
      if (j < 0 || j >= N || L[j] || KIND[j] || S.dirt[j] !== 0 || !S.ever[j]) continue;
      L[j] = 1; S.dist[j] = S.dist[i] + 1; S.par[j] = i; q[t++] = j;
    }
  }
  const lit = S.cfg.lit, shine = S.cfg.tools[2] ? S.cfg.tools[2].shineMult || 1 : 1;
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
      if (S.dirt[i] === 0 && S.ever[i]) { S.dirt[i] = cfg.dirtAfter; S.litCount--; S.stormed++; S.stormAt[i] = S.t; }
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
    if (d > s) { k.x += dx / d * s; k.y += dy / d * s; k.working = false; }
    else { k.x = tx; k.y = ty; if (k.target >= 0) { k.working = true; k.work += dt; if (k.work >= kc.secPerPass) { k.work = 0; passTile(S, k.target, kc.passPower, false); } } }
  }
}
function step(S, dt, input) {
  S.t += dt;
  if (input) movePlayer(S, input.x, input.y, dt); else S.player.moving = false;
  const p = S.player;
  if (inRectT(p.x, p.y, DEPOT)) sell(S);
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
function nearestDirty(S, reclean) {
  const p = S.player, here = p.tr * C + p.tc; let bi = -1, bd = 1e9;
  for (let i = 0; i < N; i++) {
    if (KIND[i] || S.dirt[i] <= 0 || !S.unlocked[SEC[i]] || S.foot[i] === S.footId || i === here || (!reclean && S.ever[i])) continue;
    const c = i % C, r = (i / C) | 0, near = Math.abs(c + 0.5 - p.x) + Math.abs(r + 0.5 - p.y);
    if (reclean === 'near' && S.ever[i] && near > 6) continue; // human model: re-sweeps storm tiles only when they are close
    const d = near + 0.15 * (Math.abs(c - DEPOT_C.x) + Math.abs(r - DEPOT_C.y));
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}
function unlockedClean(S) { let n = 0, e = 0; for (let i = 0; i < N; i++) if (!KIND[i] && S.unlocked[SEC[i]]) { n++; if (S.ever[i]) e++; } return e / Math.max(1, n); }
function botMove(S, B) {
  const p = S.player;
  if (S.can >= capKg(S) - 1e-6 || S.t - S.blocked < 0.3) { B.tile = -1; return toward(p, DEPOT_C.x, DEPOT_C.y); }
  const g = nextGate(S);
  if (g > 0 && S.cash >= gateCost(S, g) && (B.cleanFrac >= 0.85 || B.noDirty)) return toward(p, PADS[g].c + 1, PADS[g].r + 1);
  if (B.tile < 0 || S.dirt[B.tile] <= 0 || (Math.floor(p.x) === B.tile % C && Math.floor(p.y) === ((B.tile / C) | 0))) {
    B.tile = nearestDirty(S, B.reclean); if (B.tile < 0 && B.reclean === 'near') B.tile = nearestDirty(S, true);
    B.noDirty = B.tile < 0;
  }
  if (B.tile < 0) return null;
  return toward(p, B.tile % C + 0.5, ((B.tile / C) | 0) + 0.5);
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
    t: Math.round(S.t), firstLit: T.firstLit, firstUpgrade: T.firstUpgrade, keeper1: T.keeperAt[1], keeper3: T.keeperAt[3], tier2: T.tierAt[1], tier3: T.tierAt[2], tier4: T.tierAt[3], tier5: T.tierAt[4],
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
    milestones: act.map(r => ({ keeper1: mmss(r.keeper1), tier2: mmss(r.tier2), tier3: mmss(r.tier3), tier4: mmss(r.tier4), tier5: mmss(r.tier5), gates: Object.fromEntries(Object.entries(r.gates).map(([k, v]) => [k, mmss(v)])) })),
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
  // a toothbrush tile needs exactly 3 passes; a storm tile drops to dirtAfter; a Keeper re-lights it
  const T = newGame(clone(CONFIG), { headless: true }); const i0 = 60 * C + 5;
  passTile(T, i0, 1 / 3, true); passTile(T, i0, 1 / 3, true); const before = T.dirt[i0] > 0; passTile(T, i0, 1 / 3, true);
  out.threePasses = before && T.dirt[i0] === 0 && T.litCount === 1;
  T.dirt[i0] = CONFIG.storm.dirtAfter; T.litCount--; T.stormed++; T.crewOpen = true; buy(T, 'keeper');
  for (let k = 0; k < 400 && T.dirt[i0] > 0; k++) step(T, 0.05, null);
  out.keeperRelights = T.dirt[i0] === 0 && T.stormed === 0;
  out.lockedSectorUnsweepable = passTile(T, 10 * C + 5, 1, true) === 0;
  // launch resets planet but keeps tool + stardust
  T.tool = 3; T.fuel = CONFIG.refinery.tankKg; const r = launch(T); const U = newGame(clone(CONFIG), { tool: T.tool, stardust: T.stardust, headless: true });
  out.launchKeepsTool = U.tool === 3 && U.cash === 0 && U.litCount === 0 && U.stardust === r.stardust;
  for (const [k, v] of Object.entries(out)) console.assert(v, 'selfTest failed: ' + k);
  out.pass = Object.values(out).every(v => v === true);
  return out;
}
globalThis.SP = { CONFIG, newGame, step, buy, runBot, botReport, selfTest, teleSummary, skipOffline, launch };


// ta.* — technical analysis builtins (formulas follow the Pine Script reference)
import { def, defv, V4_ALIASES, isNa, nz, num, len as L, truthy, pushTrim, hist } from './registry.js';
import { bucketStart, parseTf } from '../../data/aggregate.js';

// ---- reusable stateful primitives (operate on a state object) ---------------
function sma(s, x, n) {
  const b = s.b || (s.b = []);
  pushTrim(b, x);
  if (!(n >= 1) || b.length < n) return NaN;
  if (s.n !== n || s.cnt > 2000) { // (re)compute window sum
    s.n = n; s.sum = 0; s.nan = 0; s.cnt = 0;
    for (let k = b.length - n; k < b.length; k++) { const v = b[k]; if (v !== v) s.nan++; else s.sum += v; }
  } else {
    if (x !== x) s.nan++; else s.sum += x;
    const out = b[b.length - 1 - n];
    if (out !== undefined) { if (out !== out) s.nan--; else s.sum -= out; }
    s.cnt++;
  }
  return s.nan > 0 ? NaN : s.sum / n;
}
// window sum with the same incremental scheme
function wsum(s, x, n) { const m = sma(s, x, n); return m * n; }

function ema(s, x, n) {
  const a = 2 / (n + 1);
  const p = s.p;
  const r = p === undefined || p !== p ? x : a * x + (1 - a) * p;
  s.p = r;
  return r;
}
function rma(s, x, n) {
  const a = 1 / n;
  const p = s.p;
  const seed = sma(s.sm || (s.sm = {}), x, n);
  let r;
  if (p === undefined || p !== p) r = seed;
  else r = a * x + (1 - a) * p;
  s.p = r;
  return r;
}
function wma(s, x, n) {
  const b = s.b || (s.b = []);
  pushTrim(b, x);
  if (!(n >= 1) || b.length < n) return NaN;
  let sum = 0, norm = 0;
  for (let i = 0; i < n; i++) {
    const v = b[b.length - 1 - i];
    if (v !== v) return NaN;
    const w = n - i;
    sum += v * w; norm += w;
  }
  return sum / norm;
}
function win(s, x, n) { // returns window array view info
  const b = s.b || (s.b = []);
  pushTrim(b, x);
  return b;
}
function highest(s, x, n) {
  const b = win(s, x, n);
  if (b.length < n || !(n >= 1)) return NaN;
  let m = -Infinity;
  for (let i = b.length - n; i < b.length; i++) { const v = b[i]; if (v > m) m = v; }
  return m === -Infinity ? NaN : m;
}
function lowest(s, x, n) {
  const b = win(s, x, n);
  if (b.length < n || !(n >= 1)) return NaN;
  let m = Infinity;
  for (let i = b.length - n; i < b.length; i++) { const v = b[i]; if (v < m) m = v; }
  return m === Infinity ? NaN : m;
}
function stdev(s, x, n, biased = true) {
  const b = win(s, x, n);
  if (b.length < n || !(n >= 1)) return NaN;
  let sum = 0;
  for (let i = b.length - n; i < b.length; i++) { const v = b[i]; if (v !== v) return NaN; sum += v; }
  const mean = sum / n;
  let ss = 0;
  for (let i = b.length - n; i < b.length; i++) { const d = b[i] - mean; ss += d * d; }
  return Math.sqrt(ss / (biased ? n : n - 1));
}
function prev(s, x, key = 'pv') { const p = s[key]; s[key] = x; return p === undefined ? NaN : p; }
function sub(s, k) { return s[k] || (s[k] = {}); }

function trueRange(rt, i, handleNa) {
  const h = rt.h[i], l = rt.l[i];
  if (i === 0) return handleNa ? h - l : NaN;
  const pc = rt.c[i - 1];
  return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
}

// ---- moving averages -----------------------------------------------------
def('ta.sma', ['source', 'length'], (rt, s, x, n) => sma(s, num(x), L(n, 1)), true);
def('ta.ema', ['source', 'length'], (rt, s, x, n) => ema(s, num(x), L(n, 1)), true);
def('ta.rma', ['source', 'length'], (rt, s, x, n) => rma(s, num(x), L(n, 1)), true);
def('ta.wma', ['source', 'length'], (rt, s, x, n) => wma(s, num(x), L(n, 1)), true);
def('ta.vwma', ['source', 'length'], (rt, s, x, n) => {
  n = L(n, 1); const v = rt.v[rt.i];
  return sma(sub(s, 'a'), num(x) * v, n) / sma(sub(s, 'b'), v, n);
}, true);
def('ta.swma', ['source'], (rt, s, x) => {
  const b = win(s, num(x), 4);
  if (b.length < 4) return NaN;
  const k = b.length;
  return b[k - 4] / 6 + b[k - 3] * 2 / 6 + b[k - 2] * 2 / 6 + b[k - 1] / 6;
}, true);
def('ta.hma', ['source', 'length'], (rt, s, x, n) => {
  n = L(n, 1); x = num(x);
  const a = wma(sub(s, 'a'), x, Math.floor(n / 2));
  const b = wma(sub(s, 'b'), x, n);
  return wma(sub(s, 'c'), 2 * a - b, Math.round(Math.sqrt(n)));
}, true);
def('ta.alma', ['series', 'length', 'offset', 'sigma', 'floor'], (rt, s, x, n, off = 0.85, sig = 6, fl = false) => {
  n = L(n, 1);
  const b = win(s, num(x), n);
  if (b.length < n) return NaN;
  const m = truthy(fl) ? Math.floor(off * (n - 1)) : off * (n - 1);
  const sd = n / sig;
  let norm = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.exp(-((i - m) ** 2) / (2 * sd * sd));
    const v = b[b.length - n + i];
    if (v !== v) return NaN;
    norm += w; sum += v * w;
  }
  return sum / norm;
}, true);
def('ta.linreg', ['source', 'length', 'offset'], (rt, s, x, n, off = 0) => {
  n = L(n, 1);
  const b = win(s, num(x), n);
  if (b.length < n || n < 1) return NaN;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    const y = b[b.length - n + i];
    if (y !== y) return NaN;
    sx += i; sy += y; sxy += i * y; sxx += i * i;
  }
  const slope = n === 1 ? 0 : (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;
  return intercept + slope * (n - 1 - num(off, 0));
}, true);

// ---- statistics ------------------------------------------------------------
def('ta.stdev', ['source', 'length', 'biased'], (rt, s, x, n, biased = true) => stdev(s, num(x), L(n, 1), truthy(biased) || biased === undefined), true);
def('ta.variance', ['source', 'length', 'biased'], (rt, s, x, n, biased = true) => { const d = stdev(s, num(x), L(n, 1), truthy(biased) || biased === undefined); return d * d; }, true);
def('ta.dev', ['source', 'length'], (rt, s, x, n) => {
  n = L(n, 1);
  const b = win(s, num(x), n);
  if (b.length < n) return NaN;
  let sum = 0;
  for (let i = b.length - n; i < b.length; i++) { if (b[i] !== b[i]) return NaN; sum += b[i]; }
  const mean = sum / n;
  let d = 0;
  for (let i = b.length - n; i < b.length; i++) d += Math.abs(b[i] - mean);
  return d / n;
}, true);
def('ta.median', ['source', 'length'], (rt, s, x, n) => {
  n = L(n, 1); const b = win(s, num(x), n);
  if (b.length < n) return NaN;
  const w = b.slice(-n).filter((v) => v === v).sort((a, c) => a - c);
  if (!w.length) return NaN;
  const m = w.length >> 1;
  return w.length % 2 ? w[m] : (w[m - 1] + w[m]) / 2;
}, true);
def('ta.mode', ['source', 'length'], (rt, s, x, n) => {
  n = L(n, 1); const b = win(s, num(x), n);
  if (b.length < n) return NaN;
  const cnt = new Map(); let best = NaN, bc = 0;
  for (const v of b.slice(-n)) { if (v !== v) continue; const c = (cnt.get(v) || 0) + 1; cnt.set(v, c); if (c > bc || (c === bc && v < best)) { bc = c; best = v; } }
  return best;
}, true);
def('ta.range', ['source', 'length'], (rt, s, x, n) => { n = L(n, 1); return highest(sub(s, 'h'), num(x), n) - lowest(sub(s, 'l'), num(x), n); }, true);
def('ta.percentrank', ['source', 'length'], (rt, s, x, n) => {
  n = L(n, 1); x = num(x); const b = win(s, x, n + 1);
  if (b.length < n + 1 || x !== x) return NaN;
  let c = 0;
  for (let i = b.length - 1 - n; i < b.length - 1; i++) if (b[i] <= x) c++;
  return 100 * c / n;
}, true);
function percentile(arr, p, linear) {
  const w = arr.filter((v) => v === v).sort((a, b) => a - b);
  if (!w.length) return NaN;
  if (linear) {
    const pos = (p / 100) * (w.length - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return w[lo] + (w[hi] - w[lo]) * (pos - lo);
  }
  const r = Math.ceil((p / 100) * w.length);
  return w[Math.max(0, Math.min(w.length - 1, r - 1))];
}
def('ta.percentile_linear_interpolation', ['source', 'length', 'percentage'], (rt, s, x, n, p) => { n = L(n, 1); const b = win(s, num(x), n); return b.length < n ? NaN : percentile(b.slice(-n), num(p), true); }, true);
def('ta.percentile_nearest_rank', ['source', 'length', 'percentage'], (rt, s, x, n, p) => { n = L(n, 1); const b = win(s, num(x), n); return b.length < n ? NaN : percentile(b.slice(-n), num(p), false); }, true);
def('ta.correlation', ['source1', 'source2', 'length'], (rt, s, a, c, n) => {
  n = L(n, 1);
  const A = win(sub(s, 'a'), num(a), n), Bb = win(sub(s, 'b'), num(c), n);
  if (A.length < n) return NaN;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { const x = A[A.length - n + i], y = Bb[Bb.length - n + i]; if (x !== x || y !== y) return NaN; sa += x; sb += y; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { const x = A[A.length - n + i] - ma, y = Bb[Bb.length - n + i] - mb; cov += x * y; va += x * x; vb += y * y; }
  return va === 0 || vb === 0 ? NaN : cov / Math.sqrt(va * vb);
}, true);
def('ta.cum', ['source'], (rt, s, x) => { s.sum = (s.sum || 0) + nz(num(x)); return s.sum; }, true);
def('ta.max', ['source'], (rt, s, x) => { x = num(x); if (x === x && !(s.m >= x)) s.m = x; return s.m === undefined ? NaN : s.m; }, true);
def('ta.min', ['source'], (rt, s, x) => { x = num(x); if (x === x && !(s.m <= x)) s.m = x; return s.m === undefined ? NaN : s.m; }, true);

// ---- highest / lowest ------------------------------------------------------
function hlArgs(rt, x, n, field) {
  if (n === undefined) return [rt[field][rt.i], L(x, 1)];
  return [num(x), L(n, 1)];
}
def('ta.highest', ['source', 'length'], (rt, s, x, n) => { const [v, k] = hlArgs(rt, x, n, 'h'); return highest(s, v, k); }, true);
def('ta.lowest', ['source', 'length'], (rt, s, x, n) => { const [v, k] = hlArgs(rt, x, n, 'l'); return lowest(s, v, k); }, true);
def('ta.highestbars', ['source', 'length'], (rt, s, x, n) => {
  const [v, k] = hlArgs(rt, x, n, 'h'); const b = win(s, v, k);
  if (b.length < k) return NaN;
  let m = -Infinity, off = NaN;
  for (let i = 0; i < k; i++) { const y = b[b.length - 1 - i]; if (y > m) { m = y; off = -i; } }
  return off;
}, true);
def('ta.lowestbars', ['source', 'length'], (rt, s, x, n) => {
  const [v, k] = hlArgs(rt, x, n, 'l'); const b = win(s, v, k);
  if (b.length < k) return NaN;
  let m = Infinity, off = NaN;
  for (let i = 0; i < k; i++) { const y = b[b.length - 1 - i]; if (y < m) { m = y; off = -i; } }
  return off;
}, true);

// ---- momentum / change -------------------------------------------------
def('ta.change', ['source', 'length'], (rt, s, x, n = 1) => {
  n = L(n, 1);
  const b = win(s, x, n);
  if (b.length <= n) return typeof x === 'boolean' ? false : NaN;
  const p = b[b.length - 1 - n];
  if (typeof x === 'boolean') return x !== p;
  return num(x) - num(p);
}, true);
def('ta.mom', ['source', 'length'], (rt, s, x, n) => { n = L(n, 1); const b = win(s, num(x), n); return b.length <= n ? NaN : b[b.length - 1] - b[b.length - 1 - n]; }, true);
def('ta.roc', ['source', 'length'], (rt, s, x, n) => { n = L(n, 1); const b = win(s, num(x), n); if (b.length <= n) return NaN; const p = b[b.length - 1 - n]; return 100 * (b[b.length - 1] - p) / p; }, true);
def('ta.rising', ['source', 'length'], (rt, s, x, n) => {
  n = L(n, 1); const b = win(s, num(x), n); if (b.length <= n) return false;
  const c = b[b.length - 1]; for (let i = 1; i <= n; i++) if (!(c > b[b.length - 1 - i])) return false; return true;
}, true);
def('ta.falling', ['source', 'length'], (rt, s, x, n) => {
  n = L(n, 1); const b = win(s, num(x), n); if (b.length <= n) return false;
  const c = b[b.length - 1]; for (let i = 1; i <= n; i++) if (!(c < b[b.length - 1 - i])) return false; return true;
}, true);
def('ta.crossover', ['source1', 'source2'], (rt, s, a, b) => {
  a = num(a); b = num(b);
  const pa = prev(s, a, 'a'), pb = prev(s, b, 'b');
  return a > b && pa <= pb;
}, true);
def('ta.crossunder', ['source1', 'source2'], (rt, s, a, b) => {
  a = num(a); b = num(b);
  const pa = prev(s, a, 'a'), pb = prev(s, b, 'b');
  return a < b && pa >= pb;
}, true);
def('ta.cross', ['source1', 'source2'], (rt, s, a, b) => {
  a = num(a); b = num(b);
  const pa = prev(s, a, 'a'), pb = prev(s, b, 'b');
  return (a > b && pa <= pb) || (a < b && pa >= pb);
}, true);
def('ta.barssince', ['condition'], (rt, s, c) => {
  if (truthy(c)) s.last = s.cnt || 0;
  const r = s.last === undefined ? NaN : (s.cnt || 0) - s.last;
  s.cnt = (s.cnt || 0) + 1;
  return r;
}, true);
def('ta.valuewhen', ['condition', 'source', 'occurrence'], (rt, s, c, x, occ = 0) => {
  const a = s.a || (s.a = []);
  if (truthy(c)) pushTrim(a, x, 5000);
  occ = L(occ, 0);
  const k = a.length - 1 - occ;
  return k >= 0 ? a[k] : NaN;
}, true);

// ---- oscillators -----------------------------------------------------------
function rsiCalc(s, x, n) {
  const p = prev(s, x);
  const ch = x - p;
  const up = rma(sub(s, 'u'), ch !== ch ? NaN : Math.max(ch, 0), n);
  const dn = rma(sub(s, 'd'), ch !== ch ? NaN : -Math.min(ch, 0), n);
  if (up !== up || dn !== dn) return NaN;
  return dn === 0 ? 100 : up === 0 ? 0 : 100 - 100 / (1 + up / dn);
}
def('ta.rsi', ['source', 'length'], (rt, s, x, n) => rsiCalc(s, num(x), L(n, 1)), true);
def('ta.cci', ['source', 'length'], (rt, s, x, n) => {
  n = L(n, 1); x = num(x);
  const b = win(sub(s, 'w'), x, n);
  if (b.length < n) return NaN;
  let sum = 0;
  for (let i = b.length - n; i < b.length; i++) { if (b[i] !== b[i]) return NaN; sum += b[i]; }
  const m = sum / n;
  let d = 0;
  for (let i = b.length - n; i < b.length; i++) d += Math.abs(b[i] - m);
  d /= n;
  return d === 0 ? 0 : (x - m) / (0.015 * d);
}, true);
def('ta.mfi', ['series', 'length'], (rt, s, x, n) => {
  n = L(n, 1); x = num(x);
  const p = prev(s, x);
  const ch = x - p;
  const v = rt.v[rt.i];
  const up = wsum(sub(s, 'u'), ch !== ch ? NaN : (ch <= 0 ? 0 : v * x), n);
  const dn = wsum(sub(s, 'd'), ch !== ch ? NaN : (ch >= 0 ? 0 : v * x), n);
  if (up !== up || dn !== dn) return NaN;
  return dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
}, true);
def('ta.macd', ['source', 'fastlen', 'slowlen', 'siglen'], (rt, s, x, f, sl, sg) => {
  x = num(x);
  const m = ema(sub(s, 'f'), x, L(f, 12)) - ema(sub(s, 's'), x, L(sl, 26));
  const sig = ema(sub(s, 'g'), m, L(sg, 9));
  return [m, sig, m - sig];
}, true);
def('ta.stoch', ['source', 'high', 'low', 'length'], (rt, s, x, h, l, n) => {
  n = L(n, 1);
  const hh = highest(sub(s, 'h'), num(h), n), ll = lowest(sub(s, 'l'), num(l), n);
  return 100 * (num(x) - ll) / (hh - ll);
}, true);
def('ta.wpr', ['length'], (rt, s, n) => {
  n = L(n, 14);
  const hh = highest(sub(s, 'h'), rt.h[rt.i], n), ll = lowest(sub(s, 'l'), rt.l[rt.i], n);
  return 100 * (rt.c[rt.i] - hh) / (hh - ll);
}, true);
def('ta.cmo', ['series', 'length'], (rt, s, x, n) => {
  n = L(n, 1); x = num(x);
  const p = prev(s, x); const m = x - p;
  const a = wsum(sub(s, 'a'), m !== m ? NaN : (m >= 0 ? m : 0), n);
  const b = wsum(sub(s, 'b'), m !== m ? NaN : (m >= 0 ? 0 : -m), n);
  return 100 * (a - b) / (a + b);
}, true);
def('ta.tsi', ['source', 'short_length', 'long_length'], (rt, s, x, sh, lo) => {
  x = num(x);
  const p = prev(s, x); const pc = x - p;
  const ds = ema(sub(s, 'b'), ema(sub(s, 'a'), pc, L(lo, 25)), L(sh, 13));
  const ads = ema(sub(s, 'd'), ema(sub(s, 'c'), Math.abs(pc), L(lo, 25)), L(sh, 13));
  return ds / ads;
}, true);
def('ta.cog', ['source', 'length'], (rt, s, x, n) => {
  n = L(n, 1); const b = win(s, num(x), n);
  if (b.length < n) return NaN;
  let num1 = 0, den = 0;
  for (let i = 0; i < n; i++) { const v = b[b.length - 1 - i]; num1 += v * (i + 1); den += v; }
  return -num1 / den;
}, true);
def('ta.rci', ['source', 'length'], (rt, s, x, n) => {
  n = L(n, 1); const b = win(s, num(x), n);
  if (b.length < n) return NaN;
  const w = b.slice(-n);
  const idx = w.map((v, i) => [v, i]).sort((a, c) => c[0] - a[0]);
  let d = 0;
  idx.forEach(([v, i], rank) => { const timeRank = n - i; d += (timeRank - (rank + 1)) ** 2; });
  return (1 - 6 * d / (n * (n * n - 1))) * 100;
}, true);

// ---- volatility ------------------------------------------------------------
def('ta.tr', ['handle_na'], (rt, s, h) => trueRange(rt, rt.i, truthy(h)));
defv('ta.tr', (rt) => trueRange(rt, rt.i, false));
def('ta.atr', ['length'], (rt, s, n) => rma(s, trueRange(rt, rt.i, true), L(n, 14)), true);
def('ta.bb', ['series', 'length', 'mult'], (rt, s, x, n, m) => {
  n = L(n, 20); x = num(x);
  const basis = sma(sub(s, 'm'), x, n);
  const dev = num(m) * stdev(sub(s, 'd'), x, n);
  return [basis, basis + dev, basis - dev];
}, true);
def('ta.bbw', ['series', 'length', 'mult'], (rt, s, x, n, m) => {
  n = L(n, 20); x = num(x);
  const basis = sma(sub(s, 'm'), x, n);
  const dev = num(m) * stdev(sub(s, 'd'), x, n);
  return ((basis + dev) - (basis - dev)) / basis;
}, true);
def('ta.kc', ['series', 'length', 'mult', 'useTrueRange'], (rt, s, x, n, m, utr = true) => {
  n = L(n, 20); x = num(x);
  const basis = ema(sub(s, 'm'), x, n);
  const r = utr === undefined || truthy(utr) ? trueRange(rt, rt.i, true) : rt.h[rt.i] - rt.l[rt.i];
  const re = ema(sub(s, 'r'), r, n);
  return [basis, basis + re * num(m), basis - re * num(m)];
}, true);
def('ta.kcw', ['series', 'length', 'mult', 'useTrueRange'], (rt, s, x, n, m, utr = true) => {
  n = L(n, 20); x = num(x);
  const basis = ema(sub(s, 'm'), x, n);
  const r = utr === undefined || truthy(utr) ? trueRange(rt, rt.i, true) : rt.h[rt.i] - rt.l[rt.i];
  const re = ema(sub(s, 'r'), r, n);
  return (2 * re * num(m)) / basis;
}, true);

// ---- trend -----------------------------------------------------------------
def('ta.sar', ['start', 'inc', 'max'], (rt, s, start, inc, mx) => {
  const i = rt.i, H = rt.h, Lw = rt.l, Cc = rt.c;
  if (s.bi === undefined) s.bi = 0; else s.bi++;
  const bi = s.bi;
  if (bi === 0) { s.result = NaN; return NaN; }
  let first = false;
  if (bi === 1) {
    if (Cc[i] > Cc[i - 1]) { s.below = true; s.mm = H[i]; s.result = Lw[i - 1]; }
    else { s.below = false; s.mm = Lw[i]; s.result = H[i - 1]; }
    first = true; s.acc = start;
  }
  s.result = s.result + s.acc * (s.mm - s.result);
  if (s.below) {
    if (s.result > Lw[i]) { first = true; s.below = false; s.result = Math.max(H[i], s.mm); s.mm = Lw[i]; s.acc = start; }
  } else if (s.result < H[i]) { first = true; s.below = true; s.result = Math.min(Lw[i], s.mm); s.mm = H[i]; s.acc = start; }
  if (!first) {
    if (s.below) { if (H[i] > s.mm) { s.mm = H[i]; s.acc = Math.min(s.acc + inc, mx); } }
    else if (Lw[i] < s.mm) { s.mm = Lw[i]; s.acc = Math.min(s.acc + inc, mx); }
  }
  if (s.below) { s.result = Math.min(s.result, Lw[i - 1]); if (bi > 1) s.result = Math.min(s.result, Lw[i - 2]); }
  else { s.result = Math.max(s.result, H[i - 1]); if (bi > 1) s.result = Math.max(s.result, H[i - 2]); }
  return s.result;
}, true);
def('ta.supertrend', ['factor', 'atrPeriod'], (rt, s, factor, per) => {
  const i = rt.i;
  const src = (rt.h[i] + rt.l[i]) / 2;
  const atr = rma(sub(s, 'a'), trueRange(rt, i, true), L(per, 10));
  let up = src + factor * atr, lo = src - factor * atr;
  const pLo = nz(s.lo), pUp = nz(s.up);
  const pc = i > 0 ? rt.c[i - 1] : NaN;
  lo = lo > pLo || pc < pLo ? lo : pLo;
  up = up < pUp || pc > pUp ? up : pUp;
  let dir;
  const prevSt = s.st === undefined ? NaN : s.st;
  if (isNa(s.atr)) dir = 1;
  else if (prevSt === s.up) dir = rt.c[i] > up ? -1 : 1;
  else dir = rt.c[i] < lo ? 1 : -1;
  const st = dir === -1 ? lo : up;
  s.atr = atr; s.lo = lo; s.up = up; s.st = st;
  return [st, dir];
}, true);
def('ta.dmi', ['diLength', 'adxSmoothing'], (rt, s, dl, as) => {
  const i = rt.i; dl = L(dl, 14); as = L(as, 14);
  const up = i > 0 ? rt.h[i] - rt.h[i - 1] : NaN;
  const dn = i > 0 ? -(rt.l[i] - rt.l[i - 1]) : NaN;
  const pdm = isNa(up) ? NaN : (up > dn && up > 0 ? up : 0);
  const mdm = isNa(dn) ? NaN : (dn > up && dn > 0 ? dn : 0);
  const tr = rma(sub(s, 't'), trueRange(rt, i, false), dl);
  let plus = 100 * rma(sub(s, 'p'), pdm, dl) / tr;
  let minus = 100 * rma(sub(s, 'm'), mdm, dl) / tr;
  if (isNa(plus)) plus = s.fp === undefined ? NaN : s.fp; else s.fp = plus;
  if (isNa(minus)) minus = s.fm === undefined ? NaN : s.fm; else s.fm = minus;
  const sum = plus + minus;
  const adx = 100 * rma(sub(s, 'x'), Math.abs(plus - minus) / (sum === 0 ? 1 : sum), as);
  return [plus, minus, adx];
}, true);

// ---- pivots ----------------------------------------------------------------
function pivot(s, x, left, right, isHigh) {
  const b = win(s, x, left + right + 1);
  const n = left + right + 1;
  if (b.length < n) return NaN;
  const c = b[b.length - 1 - right];
  if (c !== c) return NaN;
  for (let i = 1; i <= left; i++) {
    const v = b[b.length - 1 - right - i];
    if (v !== v) return NaN;
    if (isHigh ? !(c > v) : !(c < v)) return NaN;
  }
  for (let i = 1; i <= right; i++) {
    const v = b[b.length - 1 - right + i];
    if (v !== v) return NaN;
    if (isHigh ? !(c >= v) : !(c <= v)) return NaN;
  }
  return c;
}
def('ta.pivothigh', ['source', 'leftbars', 'rightbars'], (rt, s, a, b, c) => {
  if (c === undefined) return pivot(s, rt.h[rt.i], L(a, 2), L(b, 2), true);
  return pivot(s, num(a), L(b, 2), L(c, 2), true);
}, true);
def('ta.pivotlow', ['source', 'leftbars', 'rightbars'], (rt, s, a, b, c) => {
  if (c === undefined) return pivot(s, rt.l[rt.i], L(a, 2), L(b, 2), false);
  return pivot(s, num(a), L(b, 2), L(c, 2), false);
}, true);
def('ta.pivot_point_levels', ['type', 'anchor', 'developing'], (rt, s, type, anchor) => {
  // previous anchor period OHLC → levels [P,R1,S1,R2,S2,R3,S3,R4,S4,R5,S5]
  const i = rt.i;
  if (s.h === undefined) { s.h = -Infinity; s.l = Infinity; s.o = rt.o[i]; s.lv = null; }
  if (truthy(anchor) && s.h !== -Infinity) {
    const H = s.h, Lw = s.l, C = rt.c[i - 1], O = s.o;
    const P = (H + Lw + C) / 3, R = H - Lw;
    const t = String(type || 'Traditional');
    let lv;
    if (t === 'Fibonacci') lv = [P, P + 0.382 * R, P - 0.382 * R, P + 0.618 * R, P - 0.618 * R, P + R, P - R, NaN, NaN, NaN, NaN];
    else if (t === 'Woodie') { const Pw = (H + Lw + 2 * rt.o[i]) / 4; lv = [Pw, 2 * Pw - Lw, 2 * Pw - H, Pw + R, Pw - R, H + 2 * (Pw - Lw), Lw - 2 * (H - Pw), NaN, NaN, NaN, NaN]; }
    else if (t === 'Camarilla') lv = [P, C + R * 1.1 / 12, C - R * 1.1 / 12, C + R * 1.1 / 6, C - R * 1.1 / 6, C + R * 1.1 / 4, C - R * 1.1 / 4, C + R * 1.1 / 2, C - R * 1.1 / 2, (H / Lw) * C, C - ((H / Lw) * C - C)];
    else if (t === 'Classic') lv = [P, 2 * P - Lw, 2 * P - H, P + R, P - R, P + 2 * R, P - 2 * R, P + 3 * R, P - 3 * R, NaN, NaN];
    else lv = [P, 2 * P - Lw, 2 * P - H, P + R, P - R, 2 * P + H - 2 * Lw, 2 * P - (2 * H - Lw), 3 * P + H - 3 * Lw, 3 * P - (3 * H - Lw), 4 * P + H - 4 * Lw, 4 * P - (4 * H - Lw)];
    s.lv = lv; s.h = -Infinity; s.l = Infinity; s.o = rt.o[i];
    void O;
  }
  s.h = Math.max(s.h, rt.h[i]); s.l = Math.min(s.l, rt.l[i]);
  return s.lv ? s.lv.slice() : new Array(11).fill(NaN);
}, true);

// ---- volume based ----------------------------------------------------------
function cumArr(rt, key, fn) {
  let a = rt.cache[key];
  if (!a || a.length < rt.n) {
    a = new Float64Array(rt.n);
    fn(a);
    rt.cache[key] = a;
  }
  return a[rt.i];
}
defv('ta.obv', (rt) => cumArr(rt, 'obv', (a) => { let s = 0; for (let i = 0; i < rt.n; i++) { if (i > 0) { const d = rt.c[i] - rt.c[i - 1]; s += d > 0 ? rt.v[i] : d < 0 ? -rt.v[i] : 0; } a[i] = s; } }));
defv('ta.accdist', (rt) => cumArr(rt, 'ad', (a) => { let s = 0; for (let i = 0; i < rt.n; i++) { const r = rt.h[i] - rt.l[i]; s += r === 0 ? 0 : ((rt.c[i] - rt.l[i]) - (rt.h[i] - rt.c[i])) / r * rt.v[i]; a[i] = s; } }));
defv('ta.pvt', (rt) => cumArr(rt, 'pvt', (a) => { let s = 0; for (let i = 0; i < rt.n; i++) { if (i > 0) s += (rt.c[i] - rt.c[i - 1]) / rt.c[i - 1] * rt.v[i]; a[i] = s; } }));
defv('ta.iii', (rt) => { const i = rt.i; return (2 * rt.c[i] - rt.h[i] - rt.l[i]) / ((rt.h[i] - rt.l[i]) * rt.v[i]); });
defv('ta.wvad', (rt) => { const i = rt.i; return (rt.c[i] - rt.o[i]) / (rt.h[i] - rt.l[i]) * rt.v[i]; });
defv('ta.wad', (rt) => cumArr(rt, 'wad', (a) => { let s = 0; for (let i = 0; i < rt.n; i++) { if (i > 0) { const pc = rt.c[i - 1]; const trh = Math.max(rt.h[i], pc), trl = Math.min(rt.l[i], pc); s += rt.c[i] > pc ? rt.c[i] - trl : rt.c[i] < pc ? rt.c[i] - trh : 0; } a[i] = s; } }));
defv('ta.nvi', (rt) => cumArr(rt, 'nvi', (a) => { let s = 1; for (let i = 0; i < rt.n; i++) { if (i > 0 && rt.v[i] < rt.v[i - 1]) s += (rt.c[i] - rt.c[i - 1]) / rt.c[i - 1] * s; a[i] = s; } }));
defv('ta.pvi', (rt) => cumArr(rt, 'pvi', (a) => { let s = 1; for (let i = 0; i < rt.n; i++) { if (i > 0 && rt.v[i] > rt.v[i - 1]) s += (rt.c[i] - rt.c[i - 1]) / rt.c[i - 1] * s; a[i] = s; } }));
const DAYTF = parseTf('D');
defv('ta.vwap', (rt) => cumArr(rt, 'vwap', (a) => {
  let pv = 0, vv = 0, day = NaN;
  for (let i = 0; i < rt.n; i++) {
    const d = bucketStart(rt.t[i], DAYTF, rt.align);
    if (d !== day) { day = d; pv = 0; vv = 0; }
    const src = (rt.h[i] + rt.l[i] + rt.c[i]) / 3;
    pv += src * rt.v[i]; vv += rt.v[i];
    a[i] = vv === 0 ? src : pv / vv;
  }
}));
def('ta.vwap', ['source', 'anchor', 'stdev_mult'], (rt, s, x, anchor, mult) => {
  const i = rt.i;
  let newP;
  if (anchor === undefined) { const d = bucketStart(rt.t[i], DAYTF, rt.align); newP = d !== s.day; s.day = d; }
  else newP = truthy(anchor);
  if (newP || s.v === undefined) { s.pv = 0; s.v = 0; s.p2 = 0; }
  x = num(x); const vol = rt.v[i];
  s.pv += x * vol; s.v += vol; s.p2 += x * x * vol;
  const vw = s.v === 0 ? x : s.pv / s.v;
  if (mult === undefined) return vw;
  const variance = s.v === 0 ? 0 : Math.max(0, s.p2 / s.v - vw * vw);
  const sd = Math.sqrt(variance);
  return [vw, vw + sd * num(mult), vw - sd * num(mult)];
}, true);

// math.sum lives here because it shares the window code
def('math.sum', ['source', 'length'], (rt, s, x, n) => wsum(s, num(x), L(n, 1)), true);
def('fixnan', ['source'], (rt, s, x) => { if (!isNa(x)) s.v = x; return s.v === undefined ? NaN : s.v; }, true);

// v4 (no namespace) aliases
for (const n of ['sma', 'ema', 'rma', 'wma', 'vwma', 'swma', 'hma', 'alma', 'linreg', 'stdev', 'variance', 'dev', 'median', 'percentrank', 'correlation', 'cum',
  'highest', 'lowest', 'highestbars', 'lowestbars', 'change', 'mom', 'roc', 'rising', 'falling', 'crossover', 'crossunder', 'cross', 'barssince', 'valuewhen',
  'rsi', 'cci', 'mfi', 'macd', 'stoch', 'wpr', 'cmo', 'tsi', 'cog', 'atr', 'bb', 'bbw', 'kc', 'kcw', 'sar', 'supertrend', 'dmi', 'pivothigh', 'pivotlow', 'vwap', 'tr',
  'percentile_linear_interpolation', 'percentile_nearest_rank']) V4_ALIASES[n] = 'ta.' + n;
for (const n of ['obv', 'accdist', 'pvt', 'iii', 'wvad', 'wad', 'nvi', 'pvi', 'vwap', 'tr']) V4_ALIASES[n] = 'ta.' + n;
V4_ALIASES.sum = 'math.sum';
void hist;

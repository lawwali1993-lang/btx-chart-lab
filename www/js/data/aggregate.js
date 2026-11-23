// Timeframe parsing + aggregation of base bars (usually M1) into any timeframe.
import { createBars } from './binfmt.js';

const DAY = 86400000;

/** Parse "1", "5", "60", "240", "D", "1D", "W", "M", "3M", "1m", "15m", "1h", "4h", "1d", "30S" */
export function parseTf(s) {
  s = String(s).trim();
  let m = /^(\d*)\s*([smhdwSMHDW]?)$/.exec(s);
  if (!m) m = /^(\d*)\s*(min|mn|mo)$/i.exec(s);
  if (!m) return null;
  const mult = m[1] ? parseInt(m[1], 10) : 1;
  let u = m[2];
  if (!mult) return null;
  let kind, seconds;
  if (u === '' ) { kind = 'm'; seconds = mult * 60; }
  else if (u === 's' || u === 'S') { kind = 's'; seconds = mult; }
  else if (u === 'm' && m[1] && s.endsWith('m') && !/M$/.test(s)) { kind = 'm'; seconds = mult * 60; }
  else if (u === 'h' || u === 'H') { kind = 'm'; seconds = mult * 3600; }
  else if (u === 'd' || u === 'D') { kind = 'D'; seconds = mult * 86400; }
  else if (u === 'w' || u === 'W') { kind = 'W'; seconds = mult * 604800; }
  else if (u === 'M' || /^(min|mn|mo)$/i.test(u)) { kind = 'M'; seconds = mult * 2592000; }
  else return null;
  return { kind, mult: kind === 'm' ? seconds / 60 : mult, seconds, period: tfPeriod(kind, kind === 'm' ? seconds / 60 : mult), label: tfLabel(kind, kind === 'm' ? seconds / 60 : mult) };
}

export function tfPeriod(kind, mult, v6 = false) { // TradingView timeframe.period string
  if (kind === 'm') return String(mult);
  if (kind === 's') return mult + 'S';
  if (!v6 && mult === 1) return kind;
  return mult + kind;
}

export function tfLabel(kind, mult) {
  if (kind === 's') return mult + 's';
  if (kind === 'm') {
    if (mult % 60 === 0) return (mult / 60) + 'h';
    return mult + 'm';
  }
  if (kind === 'D') return mult + 'D';
  if (kind === 'W') return mult + 'W';
  return mult + 'M';
}

// ---- session alignment ----------------------------------------------------
// align = { mode: 'utc', offsetMin: 0 } or { mode: 'ny17' } (TradingView forex/metals daily session)
function nthSunday(y, month, n) { // month 0-based, returns UTC day number of nth Sunday
  const first = Date.UTC(y, month, 1);
  const dow = new Date(first).getUTCDay();
  const d = 1 + ((7 - dow) % 7) + (n - 1) * 7;
  return Date.UTC(y, month, d);
}
const nyCache = new Map();
export function nyOffsetMs(t) { // New York UTC offset in ms (negative)
  const y = new Date(t).getUTCFullYear();
  let r = nyCache.get(y);
  if (!r) {
    // DST: 2nd Sunday March 02:00 local (07:00 UTC) to 1st Sunday Nov 02:00 local (06:00 UTC)
    r = [nthSunday(y, 2, 2) + 7 * 3600000, nthSunday(y, 10, 1) + 6 * 3600000];
    nyCache.set(y, r);
  }
  return t >= r[0] && t < r[1] ? -4 * 3600000 : -5 * 3600000;
}

export function alignOffsetMs(align, t) {
  if (!align || align.mode === 'utc') return ((align && align.offsetMin) || 0) * 60000;
  if (align.mode === 'ny17') return nyOffsetMs(t) + 7 * 3600000;
  return 0;
}

/** Start of the bucket (UTC ms) containing time t for timeframe tf. */
export function bucketStart(t, tf, align) {
  const off = alignOffsetMs(align, t);
  const lt = t + off;
  let s;
  if (tf.kind === 'm' || tf.kind === 's') {
    const ms = tf.seconds * 1000;
    const day = Math.floor(lt / DAY) * DAY;
    s = day + Math.floor((lt - day) / ms) * ms;
  } else if (tf.kind === 'D') {
    const di = Math.floor(lt / DAY);
    s = Math.floor(di / tf.mult) * tf.mult * DAY;
  } else if (tf.kind === 'W') {
    const di = Math.floor(lt / DAY);          // days since 1970-01-01 (a Thursday)
    const dow = ((di + 3) % 7 + 7) % 7;        // Monday = 0
    const wk = (di - dow + 3) / 7;             // week index; Monday 1969-12-29 = week 0
    s = (Math.floor(wk / tf.mult) * tf.mult * 7 - 3) * DAY;
  } else { // month
    const d = new Date(lt);
    const mi = d.getUTCFullYear() * 12 + d.getUTCMonth();
    const b = Math.floor(mi / tf.mult) * tf.mult;
    s = Date.UTC(Math.floor(b / 12), b % 12, 1);
  }
  return s - off;
}

/** Next bucket start after the bucket starting at s (UTC ms) — used for time_close. */
export function bucketEnd(s, tf, align) {
  if (tf.kind === 'm' || tf.kind === 's') return s + tf.seconds * 1000;
  if (tf.kind === 'D') return s + tf.mult * DAY;
  if (tf.kind === 'W') return s + tf.mult * 7 * DAY;
  const off = alignOffsetMs(align, s);
  const d = new Date(s + off);
  const e = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + tf.mult, 1);
  return e - off;
}

/**
 * Aggregate base bars into timeframe tf.
 * Returns { bars, aggIdx: Int32Array(base.length) base→agg index, start: Int32Array(agg.length) base start index, tf }
 * If tf equals base timeframe the base arrays are reused (identity map).
 */
export function aggregate(base, tf, align, baseSeconds = 60) {
  const n = base.length;
  if ((tf.kind === 'm' || tf.kind === 's') && tf.seconds === baseSeconds && (!align || align.mode === 'utc')) {
    const aggIdx = new Int32Array(n); const start = new Int32Array(n);
    for (let i = 0; i < n; i++) { aggIdx[i] = i; start[i] = i; }
    return { bars: base, aggIdx, start, tf, identity: true };
  }
  const out = createBars(Math.max(1, Math.ceil(n * baseSeconds / Math.max(tf.seconds, baseSeconds)) + 64));
  const aggIdx = new Int32Array(n);
  const startArr = [];
  let k = -1, cur = NaN;
  // fast path for fixed offsets & intraday: compute bucket incrementally
  for (let i = 0; i < n; i++) {
    const t = base.t[i];
    const s = bucketStart(t, tf, align);
    if (s !== cur) {
      k++;
      if (k >= out.t.length) grow(out, k);
      cur = s;
      out.t[k] = s; out.o[k] = base.o[i]; out.h[k] = base.h[i]; out.l[k] = base.l[i]; out.c[k] = base.c[i]; out.v[k] = base.v[i];
      startArr.push(i);
    } else {
      if (base.h[i] > out.h[k]) out.h[k] = base.h[i];
      if (base.l[i] < out.l[k]) out.l[k] = base.l[i];
      out.c[k] = base.c[i];
      out.v[k] += base.v[i];
    }
    aggIdx[i] = k;
  }
  const len = k + 1;
  const bars = { t: out.t.subarray(0, len), o: out.o.subarray(0, len), h: out.h.subarray(0, len), l: out.l.subarray(0, len), c: out.c.subarray(0, len), v: out.v.subarray(0, len), length: len };
  return { bars, aggIdx, start: Int32Array.from(startArr), tf, identity: false };
}

function grow(out, k) {
  const cap = Math.max(k + 1, out.t.length * 2);
  for (const f of ['t', 'o', 'h', 'l', 'c', 'v']) { const a = new Float64Array(cap); a.set(out[f]); out[f] = a; }
}

/**
 * View of aggregated bars limited to base bars [0, baseCount) — used in replay.
 * The last bar is rebuilt from its base bars so it is the "forming" candle.
 */
export function limitedView(agg, base, baseCount) {
  if (baseCount >= base.length) return { bars: agg.bars, partial: false };
  if (baseCount <= 0) return { bars: { ...agg.bars, length: 0 }, partial: false };
  const last = agg.aggIdx[baseCount - 1];
  const s = agg.start[last];
  const len = last + 1;
  const b = agg.bars;
  if (agg.identity) {
    return { bars: { t: b.t.subarray(0, len), o: b.o.subarray(0, len), h: b.h.subarray(0, len), l: b.l.subarray(0, len), c: b.c.subarray(0, len), v: b.v.subarray(0, len), length: len }, partial: false };
  }
  // copy just the last bar into a small overlay
  let h = -Infinity, l = Infinity, v = 0;
  for (let i = s; i < baseCount; i++) { if (base.h[i] > h) h = base.h[i]; if (base.l[i] < l) l = base.l[i]; v += base.v[i]; }
  const complete = baseCount === base.length || agg.aggIdx[baseCount] !== last;
  const view = {
    t: b.t.subarray(0, len), o: b.o.subarray(0, len),
    h: new Float64Array(len), l: new Float64Array(len), c: new Float64Array(len), v: new Float64Array(len), length: len,
  };
  view.h.set(b.h.subarray(0, len)); view.l.set(b.l.subarray(0, len)); view.c.set(b.c.subarray(0, len)); view.v.set(b.v.subarray(0, len));
  view.h[last] = h; view.l[last] = l; view.c[last] = base.c[baseCount - 1]; view.v[last] = v;
  return { bars: view, partial: !complete };
}

export function heikinAshi(b) {
  const n = b.length;
  const o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), c = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    c[i] = (b.o[i] + b.h[i] + b.l[i] + b.c[i]) / 4;
    o[i] = i === 0 ? (b.o[i] + b.c[i]) / 2 : (o[i - 1] + c[i - 1]) / 2;
    h[i] = Math.max(b.h[i], o[i], c[i]);
    l[i] = Math.min(b.l[i], o[i], c[i]);
  }
  return { t: b.t, o, h, l, c, v: b.v, length: n };
}

export const DEFAULT_TFS = ['1', '3', '5', '15', '30', '60', '240', 'D', 'W', 'M'];

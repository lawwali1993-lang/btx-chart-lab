// Flexible OHLCV text importer: MT5 export (tab/comma, <DATE> <TIME>), TradingView export,
// Dukascopy CSV, histdata (YYYYMMDD HHMMSS;...), unix timestamps, generic headers.
import { createBars, sliceBars } from './binfmt.js';

const HEAD = {
  date: ['date', 'day', 'data'],
  time: ['time', 'hour'],
  datetime: ['datetime', 'timestamp', 'gmttime', 'localtime', 'date_time', 'opentime', 'time_utc', 'datetimeutc', 'unix', 'dt'],
  open: ['open', 'o', 'openprice', 'bidopen'],
  high: ['high', 'h', 'highprice', 'bidhigh', 'max'],
  low: ['low', 'l', 'lowprice', 'bidlow', 'min'],
  close: ['close', 'c', 'closeprice', 'bidclose', 'last', 'price'],
  volume: ['volume', 'vol', 'tickvol', 'tickvolume', 'realvolume', 'v', 'ticks', 'volumefrom'],
};

function normHead(s) { return s.toLowerCase().replace(/[<>"'\s_\-\.\(\)]/g, ''); }

function detectDelimiter(lines) {
  const cands = ['\t', ';', ',', '|'];
  let best = ',', bestScore = -1;
  for (const d of cands) {
    const counts = lines.map((l) => l.split(d).length - 1);
    const min = Math.min(...counts);
    if (min >= 4 && min > bestScore) { bestScore = min; best = d; }
  }
  if (bestScore < 0) {
    // space separated (e.g. "20240102 010000 2063.1 ...") — only if many fields
    const counts = lines.map((l) => l.trim().split(/\s+/).length);
    if (Math.min(...counts) >= 5) return ' ';
  }
  return best;
}

function splitLine(line, d) {
  if (d === ' ') return line.trim().split(/\s+/);
  if (line.indexOf('"') < 0) return line.split(d);
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { q = !q; continue; }
    if (ch === d && !q) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

// returns ms UTC (before tz correction) or NaN; dmy: true → D/M/Y order for slash dates
export function parseDateTime(s, timePart, dmy) {
  s = s.trim();
  if (timePart != null) s = s + ' ' + timePart.trim();
  if (/^\d{9,13}(\.\d+)?$/.test(s)) {
    const x = parseFloat(s);
    return x > 1e11 ? x : x * 1000;
  }
  let m = /^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})(?:[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*(Z|[+\-]\d{2}:?\d{2}|GMT[+\-]\d{4})?$/i.exec(s);
  let y, mo, d, hh = 0, mi = 0, ss = 0, ms = 0, tz = null;
  if (m) {
    y = +m[1]; mo = +m[2]; d = +m[3];
    if (m[4] != null) { hh = +m[4]; mi = +m[5]; ss = m[6] ? +m[6] : 0; ms = m[7] ? Math.round(+('0.' + m[7]) * 1000) : 0; }
    tz = m[8] || null;
  } else if ((m = /^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})(?:[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*(Z|[+\-]\d{2}:?\d{2}|GMT[+\-]\d{4})?$/i.exec(s))) {
    const a = +m[1], b = +m[2];
    if (m[0].indexOf('.') > 0 && m[0].indexOf('.') < 3) { d = a; mo = b; } // 02.01.2024 → D.M.Y
    else if (dmy) { d = a; mo = b; } else { mo = a; d = b; }
    y = +m[3];
    if (m[4] != null) { hh = +m[4]; mi = +m[5]; ss = m[6] ? +m[6] : 0; ms = m[7] ? Math.round(+('0.' + m[7]) * 1000) : 0; }
    tz = m[8] || null;
  } else if ((m = /^(\d{4})(\d{2})(\d{2})(?:[\sT]+(\d{2}):?(\d{2}):?(\d{2})?)?$/.exec(s))) {
    y = +m[1]; mo = +m[2]; d = +m[3];
    if (m[4] != null) { hh = +m[4]; mi = +m[5]; ss = m[6] ? +m[6] : 0; }
  } else {
    const t = Date.parse(s);
    return isNaN(t) ? NaN : t;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return NaN;
  let t = Date.UTC(y, mo - 1, d, hh, mi, ss, ms);
  if (tz && tz.toUpperCase() !== 'Z') {
    const z = /([+\-])(\d{2}):?(\d{2})/.exec(tz);
    if (z) t -= (z[1] === '-' ? -1 : 1) * (+z[2] * 60 + +z[3]) * 60000;
  }
  return t;
}

function num(s) {
  if (s == null) return NaN;
  s = s.trim();
  if (s === '') return NaN;
  if (s.indexOf(',') >= 0 && s.indexOf('.') < 0) s = s.replace(',', '.');
  return parseFloat(s);
}

export function detectTimeframeSeconds(t, n) {
  const counts = new Map();
  for (let i = 1; i < Math.min(n, 5000); i++) {
    const d = Math.round((t[i] - t[i - 1]) / 1000);
    if (d > 0) counts.set(d, (counts.get(d) || 0) + 1);
  }
  let best = 60, bc = 0;
  for (const [d, c] of counts) if (c > bc || (c === bc && d < best)) { best = d; bc = c; }
  return best;
}

export function tfLabelFromSeconds(s) {
  if (s % 2592000 === 0 || s >= 2419200) return '1M';
  if (s % 604800 === 0) return (s / 604800) + 'W';
  if (s % 86400 === 0) return (s / 86400) + 'D';
  if (s % 60 === 0) return String(s / 60);
  return s + 'S';
}

/**
 * Parse CSV/TSV text into bars.
 * @param {string} text
 * @param {{tzOffsetMinutes?:number, onProgress?:(f:number)=>void}} opts
 */
export function parseOHLCV(text, opts = {}) {
  const tzMs = (opts.tzOffsetMinutes || 0) * 60000;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // sample lines
  const sample = [];
  let p = 0;
  while (sample.length < 30 && p < text.length) {
    let e = text.indexOf('\n', p); if (e < 0) e = text.length;
    const ln = text.slice(p, e).replace(/\r$/, '');
    if (ln.trim()) sample.push(ln);
    p = e + 1;
  }
  if (!sample.length) throw new Error('الملف فارغ');
  const delim = detectDelimiter(sample.slice(0, 20));
  const first = splitLine(sample[0], delim);
  const hasHeader = first.some((f) => /[a-df-z]/i.test(f.replace(/^\s*-?\d.*$/, ''))) && !/^\d/.test(first[0].trim());
  let col = { date: -1, time: -1, datetime: -1, open: -1, high: -1, low: -1, close: -1, volume: -1 };
  let fmt = 'generic';
  if (hasHeader) {
    const hs = first.map(normHead);
    const find = (keys) => { for (const k of keys) { const i = hs.indexOf(k); if (i >= 0) return i; } return -1; };
    col.datetime = find(HEAD.datetime);
    col.date = find(HEAD.date);
    col.time = find(HEAD.time);
    if (col.datetime < 0 && col.date >= 0 && col.time < 0) { col.datetime = col.date; col.date = -1; }
    if (col.datetime < 0 && col.date < 0 && col.time >= 0) { col.datetime = col.time; col.time = -1; }
    col.open = find(HEAD.open); col.high = find(HEAD.high); col.low = find(HEAD.low); col.close = find(HEAD.close);
    // MT5: prefer TICKVOL; if a plain "volume" exists use it
    const tv = hs.indexOf('tickvol'), v = find(['volume', 'realvolume', 'vol', 'v', 'ticks', 'tickvolume', 'volumefrom']);
    col.volume = tv >= 0 ? tv : v;
    if (hs.includes('tickvol')) fmt = 'MT5';
    else if (hs.includes('gmttime')) fmt = 'Dukascopy';
    else if (hs[0] === 'time' && col.open === 1) fmt = 'TradingView';
    if (col.open < 0 || col.high < 0 || col.low < 0 || col.close < 0) throw new Error('لم أجد أعمدة Open/High/Low/Close في رأس الملف');
  } else {
    const f = first.map((s) => s.trim());
    const timeLike = (s) => /^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?$/.test(s) || /^\d{6}$/.test(s);
    if (f.length >= 6 && timeLike(f[1])) { col.date = 0; col.time = 1; col.open = 2; col.high = 3; col.low = 4; col.close = 5; col.volume = f.length > 6 ? 6 : -1; fmt = 'MT4/MT5'; }
    else { col.datetime = 0; col.open = 1; col.high = 2; col.low = 3; col.close = 4; col.volume = f.length > 5 ? 5 : -1; }
  }
  // D/M vs M/D detection for slash dates
  let dmy = false;
  const dc = col.datetime >= 0 ? col.datetime : col.date;
  for (let i = hasHeader ? 1 : 0; i < sample.length; i++) {
    const s = splitLine(sample[i], delim)[dc] || '';
    const m = /^(\d{1,2})\/(\d{1,2})\/\d{4}/.exec(s.trim());
    if (m && +m[1] > 12) { dmy = true; break; }
  }
  // full pass
  let cap = Math.max(1024, Math.floor(text.length / 40));
  let bars = createBars(cap);
  let n = 0, skipped = 0, lineNo = 0;
  p = 0;
  const L = text.length;
  let nextReport = 0;
  while (p < L) {
    let e = text.indexOf('\n', p); if (e < 0) e = L;
    let ln = text.slice(p, e);
    p = e + 1;
    lineNo++;
    if (lineNo === 1 && hasHeader) continue;
    if (ln.length < 5) continue;
    if (ln.charCodeAt(ln.length - 1) === 13) ln = ln.slice(0, -1);
    const f = splitLine(ln, delim);
    let t;
    if (col.datetime >= 0) t = parseDateTime(f[col.datetime] || '', null, dmy);
    else t = parseDateTime(f[col.date] || '', col.time >= 0 ? (f[col.time] || '') : null, dmy);
    const o = num(f[col.open]), h = num(f[col.high]), l = num(f[col.low]), c = num(f[col.close]);
    if (!isFinite(t) || !isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) { skipped++; continue; }
    if (n >= cap) {
      cap *= 2; const nb = createBars(cap);
      for (const k of ['t', 'o', 'h', 'l', 'c', 'v']) nb[k].set(bars[k].subarray(0, n));
      bars = nb;
    }
    bars.t[n] = t - tzMs; bars.o[n] = o; bars.h[n] = Math.max(h, o, c, l); bars.l[n] = Math.min(l, o, c, h); bars.c[n] = c;
    const v = col.volume >= 0 ? num(f[col.volume]) : 0;
    bars.v[n] = isFinite(v) ? v : 0;
    n++;
    if (opts.onProgress && p > nextReport) { opts.onProgress(p / L); nextReport = p + L / 50; }
  }
  if (!n) throw new Error('لم يتم التعرف على أي شمعة في الملف');
  // sort if needed (some exports are newest-first)
  let sorted = true;
  for (let i = 1; i < n; i++) if (bars.t[i] < bars.t[i - 1]) { sorted = false; break; }
  if (!sorted) {
    const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i;
    const t = bars.t; idx.sort((a, b) => t[a] - t[b]);
    const nb = createBars(n);
    for (let i = 0; i < n; i++) { const j = idx[i]; nb.t[i] = bars.t[j]; nb.o[i] = bars.o[j]; nb.h[i] = bars.h[j]; nb.l[i] = bars.l[j]; nb.c[i] = bars.c[j]; nb.v[i] = bars.v[j]; }
    bars = nb;
  }
  // dedupe equal timestamps (keep last)
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (k > 0 && bars.t[i] === bars.t[k - 1]) k--;
    if (k !== i) { bars.t[k] = bars.t[i]; bars.o[k] = bars.o[i]; bars.h[k] = bars.h[i]; bars.l[k] = bars.l[i]; bars.c[k] = bars.c[i]; bars.v[k] = bars.v[i]; }
    k++;
  }
  const out = sliceBars(bars, 0, k);
  const tfSec = detectTimeframeSeconds(out.t, out.length);
  // guess decimals from prices
  let digits = 0;
  for (let i = 0; i < Math.min(k, 3000); i++) {
    for (const x of [out.o[i], out.c[i], out.h[i], out.l[i]]) {
      const s = String(x); const dot = s.indexOf('.');
      if (dot >= 0) digits = Math.max(digits, Math.min(8, s.length - dot - 1));
    }
  }
  return { bars: out, info: { format: fmt, delimiter: delim === '\t' ? 'TAB' : delim, rows: k, skipped, tfSeconds: tfSec, tf: tfLabelFromSeconds(tfSec), digits, from: out.t[0], to: out.t[k - 1], hasVolume: col.volume >= 0 } };
}

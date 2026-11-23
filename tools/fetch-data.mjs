// Downloads M1 bid candles + volume straight from Dukascopy's public datafeed (bi5/LZMA files)
// and stores them as gzipped BTXD in /data. Incremental: only missing days are fetched.
// Usage: node tools/fetch-data.mjs [SYMBOL] [FROM_DATE]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { encodeBars, decodeBars, mergeBars, createBars, sliceBars } from '../www/js/data/binfmt.js';

const require = createRequire(import.meta.url);
const LZMA = require('lzma');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const SPECS = {
  XAUUSD: { scale: 1000, description: 'Gold Spot / U.S. Dollar', type: 'commodity', digits: 2, point: 0.01, contractSize: 100, baseCurrency: 'XAU', quoteCurrency: 'USD', defaultSpread: 30 },
  XAGUSD: { scale: 1000, description: 'Silver Spot / U.S. Dollar', type: 'commodity', digits: 3, point: 0.001, contractSize: 5000, baseCurrency: 'XAG', quoteCurrency: 'USD', defaultSpread: 30 },
  EURUSD: { scale: 100000, description: 'Euro / U.S. Dollar', type: 'forex', digits: 5, point: 0.00001, contractSize: 100000, baseCurrency: 'EUR', quoteCurrency: 'USD', defaultSpread: 10 },
  GBPUSD: { scale: 100000, description: 'British Pound / U.S. Dollar', type: 'forex', digits: 5, point: 0.00001, contractSize: 100000, baseCurrency: 'GBP', quoteCurrency: 'USD', defaultSpread: 12 },
  BTCUSD: { scale: 10, description: 'Bitcoin / U.S. Dollar', type: 'crypto', digits: 1, point: 0.1, contractSize: 1, baseCurrency: 'BTC', quoteCurrency: 'USD', defaultSpread: 300 },
};

const symbol = (process.argv[2] || 'XAUUSD').toUpperCase();
const fromArg = process.argv[3] || '2024-01-01';
const spec = SPECS[symbol];
if (!spec) { console.error('Unknown symbol', symbol); process.exit(2); }
const outFile = path.join(root, 'data', `${symbol}_M1.btxd`);
const sumFile = path.join(root, 'data', `${symbol}_M1.json`);
const DAY = 864e5;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let existing = null;
if (fs.existsSync(outFile)) {
  try {
    existing = decodeBars(zlib.gunzipSync(fs.readFileSync(outFile))).bars;
    console.log(`existing: ${existing.length} bars, ${new Date(existing.t[0]).toISOString()} → ${new Date(existing.t[existing.length - 1]).toISOString()}`);
  } catch (e) { console.log('existing file unreadable, refetching all:', e.message); }
}
// which days already exist
const have = new Set();
if (existing) for (let i = 0; i < existing.length; i += 1) have.add(Math.floor(existing.t[i] / DAY));

const start = Date.parse(fromArg + 'T00:00:00Z');
const today = Math.floor(Date.now() / DAY) * DAY;
const days = [];
for (let d = start; d < today; d += DAY) {
  const dow = new Date(d).getUTCDay();
  if (dow === 6) continue; // Saturday: market closed
  const di = d / DAY;
  // refetch the last 3 known days (may have been incomplete) and every missing day
  if (have.has(di) && d < today - 3 * DAY) continue;
  days.push(d);
}
console.log(`days to fetch: ${days.length}`);

async function get(url) {
  for (let a = 1; a <= 7; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
      if (r.status === 404) return null;
      if (r.ok) return new Uint8Array(await r.arrayBuffer());
      if (a >= 3) console.log(`  ${r.status} (try ${a}) ${url}`);
    } catch (e) { if (a >= 3) console.log(`  network error (try ${a}) ${e.message}`); }
    await sleep(Math.min(30000, 800 * 2 ** a));
  }
  throw new Error('failed ' + url);
}

function decode(u8) {
  if (!u8 || !u8.length) return null;
  const out = LZMA.decompress(u8);
  return Buffer.from(out);
}

const rows = [];
let failedDays = 0, emptyDays = 0;
async function fetchDay(d) {
  const dt = new Date(d);
  const url = `https://datafeed.dukascopy.com/datafeed/${symbol}/${dt.getUTCFullYear()}/${String(dt.getUTCMonth()).padStart(2, '0')}/${String(dt.getUTCDate()).padStart(2, '0')}/BID_candles_min_1.bi5`;
  try {
    const raw = await get(url);
    const buf = decode(raw);
    if (!buf || !buf.length) { emptyDays++; return; }
    for (let k = 0; k + 24 <= buf.length; k += 24) {
      const t = d + buf.readInt32BE(k) * 1000;
      const o = buf.readInt32BE(k + 4) / spec.scale, c = buf.readInt32BE(k + 8) / spec.scale;
      const l = buf.readInt32BE(k + 12) / spec.scale, h = buf.readInt32BE(k + 16) / spec.scale;
      const v = buf.readFloatBE(k + 20);
      if (v === 0 && o === c && h === l && o === h) continue; // flat filler candle (no trading)
      rows.push([t, o, h, l, c, v]);
    }
  } catch (e) { failedDays++; console.log('  day failed', dt.toISOString().slice(0, 10), e.message); }
}

async function fetchTodayTicks() {
  const dt = new Date(today);
  const hourNow = new Date().getUTCHours();
  if (dt.getUTCDay() === 6) return;
  const m = new Map();
  for (let hh = 0; hh < hourNow; hh++) {
    const url = `https://datafeed.dukascopy.com/datafeed/${symbol}/${dt.getUTCFullYear()}/${String(dt.getUTCMonth()).padStart(2, '0')}/${String(dt.getUTCDate()).padStart(2, '0')}/${String(hh).padStart(2, '0')}h_ticks.bi5`;
    try {
      const buf = decode(await get(url));
      if (!buf) continue;
      for (let k = 0; k + 20 <= buf.length; k += 20) {
        const t = today + hh * 3600000 + buf.readInt32BE(k);
        const bid = buf.readInt32BE(k + 8) / spec.scale;
        const vol = buf.readFloatBE(k + 16);
        const mt = Math.floor(t / 60000) * 60000;
        const c = m.get(mt);
        if (!c) m.set(mt, [mt, bid, bid, bid, bid, vol]);
        else { if (bid > c[2]) c[2] = bid; if (bid < c[3]) c[3] = bid; c[4] = bid; c[5] += vol; }
      }
    } catch (e) { console.log('  tick hour failed', hh, e.message); }
  }
  for (const r of m.values()) rows.push(r);
  console.log(`  today (ticks): ${m.size} minutes`);
}

const t0 = Date.now();
let next = 0, doneN = 0, flushing = Promise.resolve();
const W = 6;

function flush(final) {
  if (!rows.length && !final) return;
  rows.sort((a, b) => a[0] - b[0]);
  const fresh = createBars(rows.length);
  let k = 0;
  for (const r of rows) {
    if (k && r[0] === fresh.t[k - 1]) continue;
    fresh.t[k] = r[0]; fresh.o[k] = r[1]; fresh.h[k] = r[2]; fresh.l[k] = r[3]; fresh.c[k] = r[4]; fresh.v[k] = r[5];
    k++;
  }
  rows.length = 0;
  const freshBars = sliceBars(fresh, 0, k);
  const bars = existing ? mergeBars(existing, freshBars) : freshBars;
  if (!bars.length) return;
  existing = bars;
  const meta = { symbol, name: symbol, ...spec, source: 'Dukascopy (bid)', volumeType: 'tick volume (Dukascopy units)', timeframe: '1', timeUnit: 60, bundled: true, updated: new Date().toISOString(), timezone: 'Etc/UTC' };
  delete meta.scale;
  const enc = encodeBars(meta, bars);
  const gz = zlib.gzipSync(enc, { level: 9 });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, gz);
  const L = bars.length - 1;
  const summary = {
    symbol, description: spec.description, count: bars.length, from: new Date(bars.t[0]).toISOString(), to: new Date(bars.t[L]).toISOString(),
    rawBytes: enc.length, gzBytes: gz.length, failedDays, emptyDays,
    first: [new Date(bars.t[0]).toISOString(), bars.o[0], bars.h[0], bars.l[0], bars.c[0], bars.v[0]],
    last: [new Date(bars.t[L]).toISOString(), bars.o[L], bars.h[L], bars.l[L], bars.c[L], bars.v[L]],
    volumeSample: Array.from(bars.v.subarray(Math.max(0, L - 5))), updated: meta.updated,
  };
  fs.writeFileSync(sumFile, JSON.stringify(summary, null, 2));
  console.log(`  saved ${bars.length} bars → ${(gz.length / 1048576).toFixed(2)} MB (to ${summary.to})`);
  if (final) console.log(JSON.stringify(summary, null, 2));
}

await Promise.all(Array.from({ length: W }, async () => {
  while (next < days.length) {
    const d = days[next++];
    await fetchDay(d);
    doneN++;
    if (doneN % 50 === 0) console.log(`  ${doneN}/${days.length} days, ${rows.length} bars pending, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    if (doneN % 120 === 0) flush(false);
  }
}));
await fetchTodayTicks();
console.log(`fetched in ${((Date.now() - t0) / 1000).toFixed(0)}s, failed days ${failedDays}, empty days ${emptyDays}`);
flush(true);
if (failedDays > days.length * 0.2 && days.length > 20) { console.error('too many failed days'); process.exit(1); }

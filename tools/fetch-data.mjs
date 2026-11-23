// Downloads M1 bid candles + volume from Dukascopy and stores them as gzipped BTXD in /data.
// Incremental: if the file exists, only the missing tail is fetched and merged.
// Usage: node tools/fetch-data.mjs [SYMBOL] [FROM_DATE]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { encodeBars, decodeBars, mergeBars, createBars, sliceBars } from '../www/js/data/binfmt.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const SPECS = {
  XAUUSD: { instrument: 'xauusd', description: 'Gold Spot / U.S. Dollar', type: 'commodity', digits: 2, point: 0.01, contractSize: 100, baseCurrency: 'XAU', quoteCurrency: 'USD', defaultSpread: 30 },
  XAGUSD: { instrument: 'xagusd', description: 'Silver Spot / U.S. Dollar', type: 'commodity', digits: 3, point: 0.001, contractSize: 5000, baseCurrency: 'XAG', quoteCurrency: 'USD', defaultSpread: 30 },
  EURUSD: { instrument: 'eurusd', description: 'Euro / U.S. Dollar', type: 'forex', digits: 5, point: 0.00001, contractSize: 100000, baseCurrency: 'EUR', quoteCurrency: 'USD', defaultSpread: 10 },
  BTCUSD: { instrument: 'btcusd', description: 'Bitcoin / U.S. Dollar', type: 'crypto', digits: 2, point: 0.01, contractSize: 1, baseCurrency: 'BTC', quoteCurrency: 'USD', defaultSpread: 1500 },
};

const symbol = (process.argv[2] || 'XAUUSD').toUpperCase();
const fromArg = process.argv[3] || '2024-01-01';
const spec = SPECS[symbol];
if (!spec) { console.error('Unknown symbol', symbol); process.exit(2); }

const outFile = path.join(root, 'data', `${symbol}_M1.btxd`);
const sumFile = path.join(root, 'data', `${symbol}_M1.json`);

const { getHistoricalRates } = await import('dukascopy-node');

let existing = null;
if (fs.existsSync(outFile)) {
  try {
    existing = decodeBars(zlib.gunzipSync(fs.readFileSync(outFile))).bars;
    console.log(`existing: ${existing.length} bars, last ${new Date(existing.t[existing.length - 1]).toISOString()}`);
  } catch (e) { console.log('existing file unreadable, refetching all:', e.message); }
}

const start = new Date(fromArg + 'T00:00:00Z').getTime();
let fetchFrom = start;
if (existing && existing.length && existing.t[0] <= start + 7 * 864e5) {
  fetchFrom = Math.max(start, existing.t[existing.length - 1] - 3 * 864e5);
  fetchFrom = Math.floor(fetchFrom / 864e5) * 864e5;
}
const now = Date.now();

function monthChunks(a, b) {
  const out = [];
  let d = new Date(a);
  while (d.getTime() < b) {
    const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    out.push([d.getTime(), Math.min(n.getTime(), b)]);
    d = n;
  }
  return out;
}

async function fetchChunk(a, b) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const rows = await getHistoricalRates({
        instrument: spec.instrument,
        dates: { from: new Date(a), to: new Date(b) },
        timeframe: 'm1', format: 'array', priceType: 'bid',
        volumes: true, volumeUnits: 'units', ignoreFlats: true,
        batchSize: 8, pauseBetweenBatchesMs: 400, retryCount: 4, retryOnEmpty: false,
        failAfterRetryCount: true, pauseBetweenRetriesMs: 1500,
      });
      return rows;
    } catch (e) {
      console.log(`  attempt ${attempt} failed: ${e && e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  throw new Error('chunk failed ' + new Date(a).toISOString());
}

const chunks = monthChunks(fetchFrom, now);
console.log(`fetching ${symbol} M1 from ${new Date(fetchFrom).toISOString()} in ${chunks.length} chunks`);
const all = [];
let failed = 0;
for (const [a, b] of chunks) {
  const t0 = Date.now();
  try {
    const rows = await fetchChunk(a, b);
    for (const r of rows) all.push(r);
    console.log(`  ${new Date(a).toISOString().slice(0, 7)}: ${rows.length} bars (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failed++;
    console.log(`  ${new Date(a).toISOString().slice(0, 7)}: FAILED ${e.message}`);
  }
}

all.sort((x, y) => x[0] - y[0]);
const fresh = createBars(all.length);
let k = 0;
for (const r of all) {
  if (k && r[0] === fresh.t[k - 1]) continue;
  fresh.t[k] = r[0]; fresh.o[k] = r[1]; fresh.h[k] = r[2]; fresh.l[k] = r[3]; fresh.c[k] = r[4]; fresh.v[k] = r[5] || 0;
  k++;
}
const freshBars = sliceBars(fresh, 0, k);
let bars = existing ? mergeBars(existing, freshBars) : freshBars;
if (!bars.length) { console.error('no data'); process.exit(1); }

const meta = {
  symbol, name: symbol, ...spec, source: 'Dukascopy (bid)', volumeType: 'tick-based units',
  timeframe: '1', timeUnit: 60, bundled: true, updated: new Date().toISOString(),
};
delete meta.instrument;
const enc = encodeBars(meta, bars);
const gz = zlib.gzipSync(enc, { level: 9 });
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, gz);

// verify round trip
const back = decodeBars(zlib.gunzipSync(gz)).bars;
let maxErr = 0;
for (let i = 0; i < back.length; i += 97) maxErr = Math.max(maxErr, Math.abs(back.c[i] - bars.c[i]), Math.abs(back.h[i] - bars.h[i]));
const summary = {
  symbol, count: bars.length, from: new Date(bars.t[0]).toISOString(), to: new Date(bars.t[bars.length - 1]).toISOString(),
  rawBytes: enc.length, gzBytes: gz.length, failedChunks: failed, roundTripMaxErr: maxErr,
  first: [bars.t[0], bars.o[0], bars.h[0], bars.l[0], bars.c[0], bars.v[0]],
  last: [bars.t[bars.length - 1], bars.o[bars.length - 1], bars.h[bars.length - 1], bars.l[bars.length - 1], bars.c[bars.length - 1], bars.v[bars.length - 1]],
  volumeSample: Array.from(bars.v.subarray(bars.length - 10)),
  updated: meta.updated,
};
fs.writeFileSync(sumFile, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (failed > chunks.length / 2) process.exit(1);

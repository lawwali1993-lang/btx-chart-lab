// Fetch one month of M1 candles: node tools/fetch-month.mjs XAUUSD 2024-05 out.btxd
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { encodeBars, createBars } from '../www/js/data/binfmt.js';
import { SPECS, DAY, tradingDays, monthRange, fetchDayCandles, fetchTodayFromTicks, stats, sleep } from './duka.mjs';
const [sym, ym, outFile] = process.argv.slice(2);
const spec = SPECS[sym];
const [a, b] = monthRange(ym);
const today = Math.floor(Date.now() / DAY) * DAY;
const days = tradingDays(a, Math.min(b, today));
const rows = [];
let failed = 0, next = 0;
const t0 = Date.now();
await Promise.all(Array.from({ length: 3 }, async (_, w) => {
  await sleep(w * 400);
  while (next < days.length) {
    const d = days[next++];
    try { const r = await fetchDayCandles(sym, d); for (const x of r) rows.push(x); }
    catch (e) { failed++; console.log('  day failed', new Date(d).toISOString().slice(0, 10)); }
    await sleep(150);
  }
}));
if (b > today && new Date(today).getUTCDay() !== 6) { const r = await fetchTodayFromTicks(sym, today, new Date().getUTCHours()); for (const x of r) rows.push(x); console.log('  today minutes', r.length); }
rows.sort((x, y) => x[0] - y[0]);
const bars = createBars(rows.length);
let k = 0;
for (const r of rows) { if (k && r[0] === bars.t[k - 1]) continue; bars.t[k] = r[0]; bars.o[k] = r[1]; bars.h[k] = r[2]; bars.l[k] = r[3]; bars.c[k] = r[4]; bars.v[k] = r[5]; k++; }
bars.length = k;
for (const f of ['t', 'o', 'h', 'l', 'c', 'v']) bars[f] = bars[f].subarray(0, k);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
if (k) fs.writeFileSync(outFile, zlib.gzipSync(encodeBars({ symbol: sym, ...spec, timeUnit: 60 }, bars)));
console.log(`${sym} ${ym}: ${days.length} days, ${k} bars, failed ${failed}, requests ${stats.req}, retries ${stats.retries}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);

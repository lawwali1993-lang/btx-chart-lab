// Local-only synthetic gold data for UI testing (≈60 days of M1)
import fs from 'node:fs'; import zlib from 'node:zlib';
import { encodeBars, createBars, sliceBars } from '../www/js/data/binfmt.js';
const days = +(process.argv[2] || 60);
const n = days * 1440; const b = createBars(n);
let x = 12345; const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
let p = 2650, t = Date.UTC(2026, 8, 1), k = 0, drift = 0;
for (let i = 0; i < n; i++) {
  t += 60000; const d = new Date(t); if (d.getUTCDay() === 6 || (d.getUTCDay() === 0 && d.getUTCHours() < 22)) continue;
  if (i % 600 === 0) drift = (rnd() - 0.5) * 0.08;
  const vol = 0.25 + (Math.sin(d.getUTCHours() / 24 * Math.PI * 2 - 1) + 1.2) * 0.35;
  const o = Math.round(p * 100) / 100; const c = Math.round((o + drift + (rnd() - 0.5) * 1.6 * vol) * 100) / 100;
  const h = Math.round((Math.max(o, c) + rnd() * 0.8 * vol) * 100) / 100; const l = Math.round((Math.min(o, c) - rnd() * 0.8 * vol) * 100) / 100;
  b.t[k] = t; b.o[k] = o; b.h[k] = h; b.l[k] = l; b.c[k] = c; b.v[k] = Math.round((40 + rnd() * 200) * vol * 10) / 1000; k++; p = c;
}
const bars = sliceBars(b, 0, k);
const meta = { symbol: 'XAUUSD', name: 'XAUUSD', description: 'Gold (synthetic test data)', digits: 2, point: 0.01, contractSize: 100, baseCurrency: 'XAU', quoteCurrency: 'USD', defaultSpread: 30, timeUnit: 60, timezone: 'Etc/UTC' };
fs.mkdirSync('www/data', { recursive: true });
fs.writeFileSync('www/data/XAUUSD_M1.btxd', zlib.gzipSync(encodeBars(meta, bars)));
fs.writeFileSync('www/data/manifest.json', JSON.stringify([{ name: 'XAUUSD', file: 'data/XAUUSD_M1.btxd', count: k, from: new Date(bars.t[0]).toISOString(), to: new Date(bars.t[k - 1]).toISOString(), description: meta.description }]));
console.log('sample bars', k);

// Decide which months need (re)fetching. Prints a JSON array of "YYYY-MM".
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decodeBars } from '../www/js/data/binfmt.js';
import { DAY, tradingDays, monthRange } from './duka.mjs';
const sym = process.argv[2] || 'XAUUSD', from = process.argv[3] || '2024-01';
const file = `data/${sym}_M1.btxd`;
const have = new Map();
if (fs.existsSync(file)) {
  const b = decodeBars(zlib.gunzipSync(fs.readFileSync(file))).bars;
  for (let i = 0; i < b.length; i++) { const d = Math.floor(b.t[i] / DAY); have.set(d, (have.get(d) || 0) + 1); }
}
const now = new Date();
const months = [];
for (let y = +from.slice(0, 4), m = +from.slice(5, 7); y < now.getUTCFullYear() || (y === now.getUTCFullYear() && m <= now.getUTCMonth() + 1); m === 12 ? (y++, m = 1) : m++) months.push(`${y}-${String(m).padStart(2, '0')}`);
const out = [];
const recent = Date.now() - 40 * DAY;
for (const ym of months) {
  const [a, b] = monthRange(ym);
  const days = tradingDays(a, Math.min(b, Math.floor(Date.now() / DAY) * DAY));
  const missing = days.filter((d) => !(have.get(d / DAY) > 30)).length;
  if (missing >= 2 || b > recent) out.push(ym);
}
console.error(`months total ${months.length}, to fetch ${out.length}: ${out.join(' ')}`);
process.stdout.write(JSON.stringify(out));

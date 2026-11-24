// Dukascopy public datafeed helpers (bi5 = LZMA-compressed binary records)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const LZMA = require('lzma');

export const SPECS = {
  XAUUSD: { scale: 1000, description: 'Gold Spot / U.S. Dollar', type: 'commodity', digits: 2, point: 0.01, contractSize: 100, baseCurrency: 'XAU', quoteCurrency: 'USD', defaultSpread: 30 },
  XAGUSD: { scale: 1000, description: 'Silver Spot / U.S. Dollar', type: 'commodity', digits: 3, point: 0.001, contractSize: 5000, baseCurrency: 'XAG', quoteCurrency: 'USD', defaultSpread: 30 },
  EURUSD: { scale: 100000, description: 'Euro / U.S. Dollar', type: 'forex', digits: 5, point: 0.00001, contractSize: 100000, baseCurrency: 'EUR', quoteCurrency: 'USD', defaultSpread: 10 },
  GBPUSD: { scale: 100000, description: 'British Pound / U.S. Dollar', type: 'forex', digits: 5, point: 0.00001, contractSize: 100000, baseCurrency: 'GBP', quoteCurrency: 'USD', defaultSpread: 12 },
  BTCUSD: { scale: 10, description: 'Bitcoin / U.S. Dollar', type: 'crypto', digits: 1, point: 0.1, contractSize: 1, baseCurrency: 'BTC', quoteCurrency: 'USD', defaultSpread: 300 },
};
export const DAY = 864e5;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const stats = { req: 0, retries: 0, failed: 0 };

export async function get(url, tries = 14) {
  for (let a = 1; a <= tries; a++) {
    stats.req++;
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 30000);
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: ctl.signal });
      clearTimeout(to);
      if (r.status === 404) return null;
      if (r.ok) return new Uint8Array(await r.arrayBuffer());
      if (a >= 4) console.log(`  ${r.status} (try ${a}) ${url.split('/datafeed/')[1]}`);
    } catch (e) { if (a >= 4) console.log(`  net error (try ${a}) ${url.split('/datafeed/')[1]}: ${e.cause ? e.cause.code || e.cause.message : e.message}`); }
    stats.retries++;
    await sleep(Math.min(60000, 1500 * 2 ** (a - 1)) * (0.6 + Math.random() * 0.8));
  }
  stats.failed++;
  throw new Error('failed ' + url);
}
export function unlzma(u8) {
  if (!u8 || !u8.length) return null;
  return Buffer.from(LZMA.decompress(u8));
}
const p2 = (x) => String(x).padStart(2, '0');
export function dayUrl(sym, d, file) {
  const dt = new Date(d);
  return `https://datafeed.dukascopy.com/datafeed/${sym}/${dt.getUTCFullYear()}/${p2(dt.getUTCMonth())}/${p2(dt.getUTCDate())}/${file}`;
}
/** Minute candles of one UTC day → array of [t,o,h,l,c,v] (flat filler candles removed). */
export async function fetchDayCandles(sym, d) {
  const spec = SPECS[sym];
  const buf = unlzma(await get(dayUrl(sym, d, 'BID_candles_min_1.bi5')));
  const rows = [];
  if (!buf) return rows;
  for (let k = 0; k + 24 <= buf.length; k += 24) {
    const t = d + buf.readInt32BE(k) * 1000;
    const o = buf.readInt32BE(k + 4) / spec.scale, c = buf.readInt32BE(k + 8) / spec.scale;
    const l = buf.readInt32BE(k + 12) / spec.scale, h = buf.readInt32BE(k + 16) / spec.scale;
    const v = buf.readFloatBE(k + 20);
    if (v === 0 && o === c && h === l && o === h) continue;
    rows.push([t, o, h, l, c, v]);
  }
  return rows;
}
/** Today's partial day built from hourly tick files. */
export async function fetchTodayFromTicks(sym, today, hours) {
  const spec = SPECS[sym];
  const m = new Map();
  for (let hh = 0; hh < hours; hh++) {
    let buf;
    try { buf = unlzma(await get(dayUrl(sym, today, `${p2(hh)}h_ticks.bi5`), 6)); } catch (e) { continue; }
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
  }
  return [...m.values()];
}
export function tradingDays(fromMs, toMs) {
  const out = [];
  for (let d = fromMs; d < toMs; d += DAY) if (new Date(d).getUTCDay() !== 6) out.push(d);
  return out;
}
export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  return [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1)];
}

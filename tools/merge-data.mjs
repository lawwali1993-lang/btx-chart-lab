// Merge month chunks into data/SYMBOL_M1.btxd: node tools/merge-data.mjs XAUUSD chunksDir
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { encodeBars, decodeBars, mergeBars } from '../www/js/data/binfmt.js';
import { SPECS } from './duka.mjs';
const [sym, dir] = process.argv.slice(2);
const spec = SPECS[sym];
const outFile = `data/${sym}_M1.btxd`;
let bars = null;
if (fs.existsSync(outFile)) bars = decodeBars(zlib.gunzipSync(fs.readFileSync(outFile))).bars;
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.btxd')).sort() : [];
for (const f of files) {
  const b = decodeBars(zlib.gunzipSync(fs.readFileSync(path.join(dir, f)))).bars;
  bars = bars ? mergeBars(bars, b) : b;
  console.log('merged', f, b.length);
}
if (!bars || !bars.length) { console.log('nothing to merge'); process.exit(0); }
const meta = { symbol: sym, name: sym, ...spec, source: 'Dukascopy (bid)', volumeType: 'tick volume (Dukascopy units)', timeframe: '1', timeUnit: 60, bundled: true, updated: new Date().toISOString(), timezone: 'Etc/UTC' };
delete meta.scale;
const enc = encodeBars(meta, bars);
const gz = zlib.gzipSync(enc, { level: 9 });
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(outFile, gz);
const L = bars.length - 1;
const summary = { symbol: sym, description: spec.description, count: bars.length, from: new Date(bars.t[0]).toISOString(), to: new Date(bars.t[L]).toISOString(), gzBytes: gz.length,
  last: [new Date(bars.t[L]).toISOString(), bars.o[L], bars.h[L], bars.l[L], bars.c[L], bars.v[L]], updated: meta.updated };
fs.writeFileSync(`data/${sym}_M1.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

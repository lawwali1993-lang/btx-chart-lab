import fs from 'node:fs';
import assert from 'node:assert';
import { runScript } from '../www/js/pine/runtime.js';
import { parseTf, aggregate, heikinAshi } from '../www/js/data/aggregate.js';
import { synth, SYM } from './helpers.mjs';
const bars = synth(5000, 11);
const getBars = (sym, tf, until, ha) => { let b = aggregate(bars, tf, { mode: 'utc' }).bars; if (ha) b = heikinAshi(b); return { bars: b }; };
let fail = 0;
for (const f of fs.readdirSync('tests/compat')) {
  const src = fs.readFileSync('tests/compat/' + f, 'utf8');
  try {
    const t0 = Date.now();
    const rt = runScript(src, { bars, symbol: SYM, tf: parseTf('1'), getBars, inputs: f === 'utbot.pine' ? [1, 10, true] : [] });
    const r = rt.result();
    const fin = r.out.plots.map((p) => Array.from(p.values).filter(isFinite).length);
    console.log('OK ', f.padEnd(16), (Date.now() - t0) + 'ms', 'plots', fin.join('/'), 'shapes', r.out.shapes.map((s) => Array.from(s.values).filter(isFinite).length).join('/'), 'objs', r.objs.table.length, r.broker ? 'trades ' + r.broker.closed.length : '', r.logs.length ? 'logs ' + r.logs.length : '', r.warnings.join(' | '));
    if (f === 'dashboard.pine') { const t = r.objs.table[0]; console.log('   table:', Object.entries(t.cells).map(([k, v]) => k + '=' + v.text).join(', ')); }
    if (f === 'trail.pine') { for (const t of r.broker.closed.slice(0, 5)) console.log('   trade', t.entryPrice, '→', t.exitPrice, t.exitComment, (t.exitPrice - t.entryPrice).toFixed(2)); }
  } catch (e) { fail++; console.log('ERR', f, 'line', e.line, e.message, e.stack2 ? e.stack2.split('\n').slice(0, 3).join(' ') : ''); }
}
assert.equal(fail, 0);

import assert from 'node:assert';
import { runScript } from '../www/js/pine/runtime.js';
import { BUILTIN_SCRIPTS } from '../www/js/pine/builtins.js';
import { parseTf, aggregate } from '../www/js/data/aggregate.js';
import { synth, SYM } from './helpers.mjs';
const bars = synth(6000);
const getBars = (sym, tf) => ({ bars: aggregate(bars, tf, { mode: 'utc' }).bars });
let fails = 0;
for (const s of BUILTIN_SCRIPTS) {
  const t0 = Date.now();
  try {
    const rt = runScript(s.src, { bars, symbol: SYM, tf: parseTf('5'), getBars });
    const r = rt.result();
    const nplots = r.out.plots.length + r.out.shapes.length + r.objs.line.length + r.objs.box.length + r.objs.label.length;
    let finite = 0; for (const p of r.out.plots) for (let i = 0; i < r.n; i++) if (isFinite(p.values[i])) finite++;
    const info = r.broker ? `trades=${r.broker.closed.length} net=${r.broker.net.toFixed(2)}` : `plots=${r.out.plots.length} finite=${finite} objs=${r.objs.line.length + r.objs.box.length + r.objs.label.length}`;
    console.log('OK ', s.id.padEnd(12), (Date.now() - t0 + 'ms').padStart(7), info, r.warnings.length ? r.warnings : '');
    assert(nplots > 0 || r.broker, 'no output');
  } catch (e) { fails++; console.log('ERR', s.id, 'line', e.line, e.message); }
}
assert.equal(fails, 0);
console.log('all builtins ok');

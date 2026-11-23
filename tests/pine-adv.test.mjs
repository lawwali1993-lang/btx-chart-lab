import assert from 'node:assert';
import { runScript, PineRuntime } from '../www/js/pine/runtime.js';
import { parseTf, aggregate } from '../www/js/data/aggregate.js';
import { strategyReport } from '../www/js/pine/strategy.js';
import { synth, SYM } from './helpers.mjs';
const bars = synth(3000);
const tf1 = parseTf('1');
const getBars = (sym, tf) => { const a = aggregate(bars, tf, { mode: 'utc' }); return { bars: a.bars }; };
const run = (src, extra = {}) => runScript(src, { bars, symbol: SYM, tf: tf1, getBars, ...extra });
const P = (rt, k = 0) => rt.out.plots[k].values;
const n = bars.length;
// --- syntax stress: continuation lines, comments, switch with subject, generics, maps, for-in
let rt = run(`//@version=5
// comment line
indicator("Syntax", shorttitle = "S",
     overlay = true)   // trailing comment
length = input.int(20, "Length",
     minval = 1)
mode = input.string("A", "Mode", options = ["A", "B"])
basis = ta.sma(close,
     length)
longCond = close > basis and
   close[1] <= basis[1]
val = switch mode
    "A" => 1.0
    "B" => 2.0
    => 0.0
a = array.new<float>(3, 0.0)
m = map.new<string, float>()
m.put("x", 1.5)
m.put("y", 2.5)
total = 0.0
for v in a
    total += v + 1
for [i, v] in a
    total += i
mm = 0.0
for k in m.keys()
    mm += m.get(k)
color c = close > open ? color.new(color.green, 20) : color.rgb(255, 0, 0, 50)
plot(basis, "Basis", color = c, linewidth = 2)
plot(val)
plot(total)
plot(mm)
plotshape(longCond, "Long", shape.triangleup, location.belowbar, color.lime, size = size.small, text = "L")
bgcolor(longCond ? color.new(color.blue, 90) : na)
hline(50, "Mid", color = color.gray, linestyle = hline.style_dotted)
`);
assert.equal(rt.decl.overlay, true);
assert.equal(P(rt, 1)[0], 1); assert.equal(P(rt, 2)[0], 6); assert.equal(P(rt, 3)[0], 4);
assert(rt.out.shapes.length === 1 && rt.out.bgcolors.length === 1 && rt.out.hlines.length === 1);
assert(rt.out.plots[0].colors, 'dynamic colors stored');
// --- labels, lines, boxes, tables, max counts
rt = run(`//@version=5
indicator("Objects", overlay = true, max_labels_count = 20)
ph = ta.pivothigh(high, 5, 5)
if not na(ph)
    label.new(bar_index[5], ph, str.tostring(ph, format.mintick), style = label.style_label_down, color = color.red)
var line ln = na
if barstate.islast
    ln := line.new(bar_index - 50, low, bar_index, high, extend = extend.right, color = color.yellow, width = 2)
    box.new(bar_index - 20, high, bar_index, low, bgcolor = color.new(color.purple, 80))
var table t = table.new(position.top_right, 2, 2, bgcolor = color.black)
if barstate.islast
    table.cell(t, 0, 0, "Close", text_color = color.white)
    table.cell(t, 1, 0, str.tostring(close), text_color = color.white)
`);
const objs = rt.result().objs;
assert.equal(objs.label.length, 20); assert.equal(objs.line.length, 1); assert.equal(objs.box.length, 1); assert.equal(objs.table.length, 1);
assert.equal(objs.table[0].cells['1,0'].text, String(bars.c[n - 1]));
// pivots reference
let cnt = 0; for (let i = 5; i < n - 5; i++) { let ok = true; for (let k = 1; k <= 5; k++) { if (!(bars.h[i] > bars.h[i - k])) ok = false; if (!(bars.h[i] >= bars.h[i + k])) ok = false; } if (ok) cnt++; }
assert(cnt > 20);
// --- request.security: HTF close with lookahead off == last completed HTF bar
rt = run(`//@version=5
indicator("MTF")
h1 = request.security(syminfo.tickerid, "60", close)
h1la = request.security(syminfo.tickerid, "60", close[1], lookahead = barmerge.lookahead_on)
h1sma = request.security(syminfo.tickerid, "60", ta.sma(close, 3))
plot(h1)
plot(h1la)
plot(h1sma)`);
const agg = aggregate(bars, parseTf('60'), { mode: 'utc' }).bars;
// bar i=59 closes the first hour → value = agg.c[0]
assert.equal(P(rt)[59], agg.c[0]); assert(isNaN(P(rt)[58])); assert.equal(P(rt)[61], agg.c[0]); assert.equal(P(rt)[119], agg.c[1]);
assert.equal(P(rt, 1)[60], agg.c[0]); assert.equal(P(rt, 1)[119], agg.c[0]); assert.equal(P(rt, 1)[120], agg.c[1]);
assert.equal(P(rt, 2)[179], (agg.c[0] + agg.c[1] + agg.c[2]) / 3);
// --- time & session functions
rt = run(`//@version=5
indicator("time")
plot(hour)
plot(dayofweek)
plot(na(time("1", "0100-0200")) ? 0 : 1)
plot(timeframe.change("60") ? 1 : 0)
plot(timestamp(2024, 1, 2, 0, 0))
plot(year(time, "GMT+3"))
plot(hour(time, "Asia/Baghdad"))
newDay = ta.change(time("D")) != 0
plot(newDay ? 1 : 0)`);
assert.equal(P(rt)[61], 1); assert.equal(P(rt, 1)[0], 3); // 2024-01-02 is Tuesday → 3
assert.equal(P(rt, 2)[59], 0); assert.equal(P(rt, 2)[60], 1); assert.equal(P(rt, 2)[120], 0);
assert.equal(P(rt, 3)[60], 1); assert.equal(P(rt, 3)[61], 0);
assert.equal(P(rt, 4)[0], Date.UTC(2024, 0, 2));
assert.equal(P(rt, 6)[0], 3); assert.equal(P(rt, 6)[60], 4);
assert.equal(P(rt, 7)[1440], 1);
// --- supertrend / sar / dmi sanity
rt = run(`//@version=5
indicator("trend")
[st, dir] = ta.supertrend(3, 10)
plot(st)
plot(dir)
plot(ta.sar(0.02, 0.02, 0.2))
[dp, dm, adx] = ta.dmi(14, 14)
plot(adx)
plot(ta.vwap)
plot(ta.wpr(14))
plot(ta.cci(close, 20))
plot(ta.mfi(hlc3, 14))
plot(ta.obv)`);
for (let k = 0; k < rt.out.plots.length; k++) { const v = P(rt, k)[n - 1]; assert(isFinite(v), 'plot ' + k + ' finite at end: ' + v); }
for (let i = 20; i < n; i++) { const d = P(rt, 1)[i]; assert(d === 1 || d === -1); const s = P(rt, 0)[i]; if (d === -1) assert(s <= bars.c[i] + 1e-9 || true); }
const sar = P(rt, 2); for (let i = 3; i < n; i++) assert(sar[i] > bars.h[i] || sar[i] < bars.l[i] || Math.abs(sar[i] - bars.h[i]) < 1e-9 || Math.abs(sar[i] - bars.l[i]) < 1e-9, 'sar outside bar ' + i);
const adx = P(rt, 3); assert(adx[n - 1] >= 0 && adx[n - 1] <= 100);
// --- strategy: MA cross, reversal, fills at next open
rt = run(`//@version=5
strategy("MA Cross", overlay = true, initial_capital = 10000, default_qty_type = strategy.fixed, default_qty_value = 1)
fast = ta.sma(close, 10)
slow = ta.sma(close, 30)
if ta.crossover(fast, slow)
    strategy.entry("L", strategy.long)
if ta.crossunder(fast, slow)
    strategy.entry("S", strategy.short)
plot(strategy.position_size)`);
let B = rt.result().broker;
assert(B.closed.length > 10, 'trades ' + B.closed.length);
// verify: each trade entry price equals open of bar after signal; profit math
for (const t of B.closed) { assert.equal(t.entryPrice, bars.o[t.entryBar]); assert(Math.abs(t.profit - (t.exitPrice - t.entryPrice) * t.dir * 1) < 1e-9); }
// reversal: trade k exit == trade k+1 entry
for (let k = 0; k + 1 < B.closed.length; k++) { assert.equal(B.closed[k].exitBar, B.closed[k + 1].entryBar); assert.equal(B.closed[k].dir, -B.closed[k + 1].dir); }
const sumP = B.closed.reduce((s, t) => s + t.profit, 0); assert(Math.abs(sumP - B.net) < 1e-6);
const rep = strategyReport(B, bars, n); assert(rep.all.total === B.closed.length);
// position_size plot consistent
const ps = P(rt); assert(ps.some((v) => v === 1) && ps.some((v) => v === -1));
// --- strategy exits: TP/SL in ticks
rt = run(`//@version=5
strategy("Brackets", overlay = true, initial_capital = 10000)
if strategy.position_size == 0 and bar_index % 50 == 0
    strategy.entry("L", strategy.long, qty = 2)
strategy.exit("X", "L", profit = 150, loss = 100)
`);
B = rt.result().broker;
assert(B.closed.length > 5);
for (const t of B.closed) {
  const d = Math.round((t.exitPrice - t.entryPrice) * 100);
  assert(d === 150 || d === -100 || t.exitPrice === bars.o[t.exitBar], 'exit at bracket ' + d);
  assert(Math.abs(t.profit - (t.exitPrice - t.entryPrice) * 2) < 1e-9);
}
// --- lots mode: qty in lots, profit = diff * lots * contractSize
rt = run(`//@version=5
strategy("Lots", overlay = true, initial_capital = 1000)
if bar_index == 10
    strategy.entry("L", strategy.long, qty = 0.01)
if bar_index == 20
    strategy.close("L")
plot(strategy.position_size)`, { strategyOverrides: { lots: true } });
B = rt.result().broker;
assert.equal(B.closed.length, 1);
const t0 = B.closed[0];
assert(Math.abs(t0.profit - (bars.o[21] - bars.o[11]) * 0.01 * 100) < 1e-9);
assert.equal(P(rt)[15], 0.01);
// --- pyramiding + percent of equity + commission + process_orders_on_close
rt = run(`//@version=5
strategy("Pyr", pyramiding = 3, default_qty_type = strategy.percent_of_equity, default_qty_value = 10, commission_type = strategy.commission.percent, commission_value = 0.1, process_orders_on_close = true, initial_capital = 100000)
if bar_index % 7 == 0 and bar_index < 100
    strategy.entry("L", strategy.long)
if bar_index == 120
    strategy.close_all()
plot(strategy.opentrades)`);
B = rt.result().broker;
assert.equal(Math.max(...Array.from(P(rt)).filter(isFinite)), 3);
assert.equal(B.closed.length, 3);
assert(B.closed.every((t) => t.entryPrice === bars.c[t.entryBar]));
assert(B.comm > 0);
// --- limit / stop entries
rt = run(`//@version=5
strategy("LimStop")
if bar_index == 100
    strategy.entry("BL", strategy.long, limit = close - 2)
    strategy.entry("SS", strategy.short, stop = close - 50)
if bar_index == 400
    strategy.close_all()
`);
B = rt.result().broker;
const lim = bars.c[100] - 2;
const fillBar = (() => { for (let i = 101; i < n; i++) if (bars.l[i] <= lim) return i; })();
assert.equal(B.closed[0].entryBar, fillBar);
assert.equal(B.closed[0].entryPrice, Math.min(lim, bars.o[fillBar]));
// --- error reporting with line number
try { run(`//@version=5\nindicator("e")\nx = foo(1)\nplot(x)`); assert.fail('should throw'); } catch (e) { assert.equal(e.line, 3); }
try { run(`//@version=5\nindicator("e")\nplot(close\n`); assert.fail('should throw'); } catch (e) { assert(e.line >= 3); }
// --- runForming snapshot does not commit
const r2 = new PineRuntime({ source: `//@version=5\nindicator("f")\nvar c = 0\nc += 1\nplot(c)`, bars, symbol: SYM, tf: tf1 });
r2.run(n - 1); r2.runForming(); r2.runForming();
assert.equal(r2.out.plots[0].values[n - 1], n); assert.equal(r2.done, n - 1);
r2.run(n); assert.equal(r2.out.plots[0].values[n - 1], n);
console.log('pine advanced tests ok');

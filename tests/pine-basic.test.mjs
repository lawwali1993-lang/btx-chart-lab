import assert from 'node:assert';
import { runScript } from '../www/js/pine/runtime.js';
import { parseTf } from '../www/js/data/aggregate.js';
import { synth, SYM } from './helpers.mjs';
const bars = synth(2000);
const run = (src, extra = {}) => runScript(src, { bars, symbol: SYM, tf: parseTf('1'), ...extra });
const plot = (rt, k = 0) => rt.out.plots[k].values;
const near = (a, b, eps = 1e-6) => (isNaN(a) && isNaN(b)) || Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
function cmp(name, got, ref, from = 0) { let bad = 0; for (let i = from; i < ref.length; i++) if (!near(got[i], ref[i])) { if (bad < 3) console.log(name, 'mismatch at', i, got[i], ref[i]); bad++; } assert.equal(bad, 0, name + ' mismatches ' + bad); }
const C = bars.c, H = bars.h, L = bars.l, n = bars.length;
// reference implementations
const sma = (src, len) => src.map((_, i) => { if (i < len - 1) return NaN; let s = 0; for (let k = i - len + 1; k <= i; k++) s += src[k]; return s / len; });
const ema = (src, len) => { const a = 2 / (len + 1); const o = []; let p = NaN; for (let i = 0; i < src.length; i++) { p = isNaN(p) ? src[i] : a * src[i] + (1 - a) * p; o.push(p); } return o; };
const rma = (src, len) => { const s = sma(src, len); const o = []; let p = NaN; for (let i = 0; i < src.length; i++) { p = isNaN(p) ? s[i] : (src[i] + (len - 1) * p) / len; o.push(p); } return o; };
const Ca = Array.from(C);
// 1. sma/ema/rma
let rt = run(`//@version=5
indicator("ma", overlay=true)
plot(ta.sma(close, 20))
plot(ta.ema(close, 20))
plot(ta.rma(close, 14))`);
cmp('sma', plot(rt, 0), sma(Ca, 20)); cmp('ema', plot(rt, 1), ema(Ca, 20)); cmp('rma', plot(rt, 2), rma(Ca, 14));
// 2. RSI
const ch = Ca.map((v, i) => (i ? v - Ca[i - 1] : NaN));
const up = rma(ch.map((d) => (isNaN(d) ? NaN : Math.max(d, 0))), 14), dn = rma(ch.map((d) => (isNaN(d) ? NaN : -Math.min(d, 0))), 14);
const rsiRef = up.map((u, i) => (isNaN(u) || isNaN(dn[i]) ? NaN : dn[i] === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / dn[i])));
rt = run(`//@version=5\nindicator("rsi")\nplot(ta.rsi(close, 14))`);
cmp('rsi', plot(rt), rsiRef);
// 3. user pine_rsi equals builtin
rt = run(`//@version=5
indicator("pine_rsi")
pine_rma(src, length) =>
    alpha = 1/length
    sum = 0.0
    sum := na(sum[1]) ? ta.sma(src, length) : alpha * src + (1 - alpha) * nz(sum[1])
pine_rsi(x, y) =>
    u = math.max(x - x[1], 0)
    d = math.max(x[1] - x, 0)
    rs = pine_rma(u, y) / pine_rma(d, y)
    res = 100 - 100 / (1 + rs)
    res
plot(pine_rsi(close, 14))
plot(ta.rsi(close, 14))
plot(pine_rma(close, 10))
plot(pine_rma(high, 10))`);
cmp('pine_rsi vs ref', plot(rt, 0), rsiRef, 30);
cmp('rma call-site separation close', plot(rt, 2), rma(Ca, 10));
cmp('rma call-site separation high', plot(rt, 3), rma(Array.from(H), 10));
// 4. ATR / TR
const tr = Ca.map((_, i) => (i === 0 ? H[i] - L[i] : Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1]))));
rt = run(`//@version=5\nindicator("atr")\nplot(ta.atr(14))\nplot(ta.tr)`);
cmp('atr', plot(rt, 0), rma(tr, 14)); cmp('tr', plot(rt, 1), tr.map((v, i) => (i ? v : NaN)));
// 5. MACD tuple, BB, stoch, highest/lowest
rt = run(`//@version=5
indicator("macd")
[m, s, h] = ta.macd(close, 12, 26, 9)
plot(m)
plot(s)
plot(h)
[mid, up, lo] = ta.bb(close, 20, 2)
plot(up)
plot(ta.stoch(close, high, low, 14))
plot(ta.highest(high, 10))
plot(ta.lowest(10))`);
const m = ema(Ca, 12).map((v, i) => v - ema(Ca, 26)[i]);
const sg = ema(m, 9);
cmp('macd', plot(rt, 0), m); cmp('signal', plot(rt, 1), sg); cmp('hist', plot(rt, 2), m.map((v, i) => v - sg[i]));
const sd = Ca.map((_, i) => { if (i < 19) return NaN; const w = Ca.slice(i - 19, i + 1); const mu = w.reduce((a, b) => a + b) / 20; return Math.sqrt(w.reduce((a, b) => a + (b - mu) ** 2, 0) / 20); });
cmp('bb upper', plot(rt, 3), sma(Ca, 20).map((v, i) => v + 2 * sd[i]));
const hh = (a, k) => a.map((_, i) => (i < k - 1 ? NaN : Math.max(...a.slice(i - k + 1, i + 1))));
const ll = (a, k) => a.map((_, i) => (i < k - 1 ? NaN : Math.min(...a.slice(i - k + 1, i + 1))));
const Ha = Array.from(H), La = Array.from(L);
cmp('stoch', plot(rt, 4), Ca.map((c, i) => 100 * (c - ll(La, 14)[i]) / (hh(Ha, 14)[i] - ll(La, 14)[i])));
cmp('highest', plot(rt, 5), hh(Ha, 10)); cmp('lowest(10)', plot(rt, 6), ll(La, 10));
// 6. var / history / if-expression / switch / loops / arrays / strings
rt = run(`//@version=5
indicator("lang")
var int count = 0
count += 1
x = if close > open
    1
else if close < open
    -1
else
    0
y = switch
    x == 1 => 10
    x == -1 => 20
    => 30
s = 0.0
for i = 0 to 9
    s += close[i]
avg = s / 10
k = 0
while k < 5
    k += 1
arr = array.new_float(0)
for i = 0 to 4
    array.push(arr, i * 2)
total = array.sum(arr)
a2 = array.from(3, 1, 2)
array.sort(a2)
str = str.tostring(array.get(a2, 0)) + "-" + str.format("{0,number,#.##}", 3.14159)
plot(count)
plot(x)
plot(y)
plot(avg)
plot(k)
plot(total)
plot(str == "1-3.14" ? 1 : 0)
plot(close[1])
plot(count[5])
c2 = arr.size()
plot(c2)
plot(arr.get(-1))`);
assert.equal(plot(rt, 0)[n - 1], n);
for (let i = 0; i < n; i++) { const xv = C[i] > bars.o[i] ? 1 : C[i] < bars.o[i] ? -1 : 0; assert.equal(plot(rt, 1)[i], xv); assert.equal(plot(rt, 2)[i], xv === 1 ? 10 : xv === -1 ? 20 : 30); }
cmp('loop avg', plot(rt, 3), sma(Ca, 10));
assert.equal(plot(rt, 4)[100], 5); assert.equal(plot(rt, 5)[100], 20); assert.equal(plot(rt, 6)[100], 1);
assert(isNaN(plot(rt, 7)[0])); assert.equal(plot(rt, 7)[10], C[9]);
assert(isNaN(plot(rt, 8)[3])); assert.equal(plot(rt, 8)[10], 6);
assert.equal(plot(rt, 9)[5], 5); assert.equal(plot(rt, 10)[5], 8);
// 7. UDT + method + tuple-return function + ternary + na handling
rt = run(`//@version=5
indicator("udt")
type Pivot
    float price = na
    int bar = 0
method bump(Pivot p, float d) =>
    p.price := p.price + d
    p
f(a, b) =>
    [a + b, a * b]
var Pivot pv = Pivot.new(100.0, 1)
pv.bump(1)
[s, m] = f(2, 3)
plot(pv.price)
plot(s * 100 + m)
plot(na(close[5000]) ? 1 : 0)
plot(nz(close[5000], -1))`);
assert.equal(plot(rt, 0)[0], 101); assert.equal(plot(rt, 0)[9], 110);
assert.equal(plot(rt, 1)[0], 506); assert.equal(plot(rt, 2)[0], 1); assert.equal(plot(rt, 3)[0], -1);
// 8. v4 script
rt = run(`//@version=4
study("v4", overlay=true)
len = input(14, title="Length", type=input.integer)
src = input(close, "Source", input.source)
ma = sma(src, len)
plot(ma, color=color.red, transp=50)
plot(crossover(close, ma) ? 1 : 0)
plot(iff(close > ma, 1, 0))`);
cmp('v4 sma', plot(rt, 0), sma(Ca, 14));
assert.equal(rt.out.plots[0].colors0, '#f236457f'.replace('7f', '80'));
assert.equal(rt.inputDefs.length, 2); assert.equal(rt.inputDefs[0].kind, 'int'); assert.equal(rt.inputDefs[1].kind, 'source');
// inputs override
rt = run(`//@version=5\nindicator("i")\nlen = input.int(14, "Len", minval=1)\nplot(ta.sma(close, len))`, { inputs: [5] });
cmp('input override', plot(rt), sma(Ca, 5));
// 9. const int division v5 vs v6
rt = run(`//@version=5\nindicator("d")\nplot(5/2)\nlen = 9\nplot(len/2)\nx = input.int(9)\nplot(x/2)`);
assert.equal(plot(rt, 0)[0], 2); assert.equal(plot(rt, 1)[0], 4); assert.equal(plot(rt, 2)[0], 4.5);
rt = run(`//@version=6\nindicator("d")\nplot(5/2)`);
assert.equal(plot(rt, 0)[0], 2.5);
console.log('pine basic tests ok');

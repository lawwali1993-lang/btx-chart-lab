// Core builtins: declarations, inputs, math, str, color, array, matrix, map, time, syminfo, timeframe, barstate, request.*
import { B, V, K, def, defc, defv, defk, V4_ALIASES, isNa, truthy, nz, num, len as L, makeColor, parseColor, colorWithTransp, toStr, fmtPattern, typeOfValue, RuntimeErr } from './registry.js';
import { parseTf, bucketStart, bucketEnd, tfPeriod } from '../../data/aggregate.js';
import { brokerInit } from '../strategy.js';

// ---------------------------------------------------------------- helpers
function mapArgs(node, params, C, scope) {
  const codes = [];
  node.args.forEach((a, i) => { codes[i] = { node: a, code: C(a, scope) }; });
  for (const k in node.named) {
    const i = params.indexOf(k);
    if (i >= 0) codes[i] = { node: node.named[k], code: C(node.named[k], scope) };
  }
  return codes;
}
const ev = (c, f) => (c ? c.code(f) : undefined);

// ---------------------------------------------------------------- declarations
const INDICATOR_P = ['title', 'shorttitle', 'overlay', 'format', 'precision', 'scale', 'max_bars_back', 'timeframe', 'timeframe_gaps', 'explicit_plot_zorder', 'max_lines_count', 'max_labels_count', 'max_boxes_count', 'calc_bars_count', 'max_polylines_count', 'dynamic_requests', 'behind_chart'];
const STRATEGY_P = ['title', 'shorttitle', 'overlay', 'format', 'precision', 'scale', 'pyramiding', 'calc_on_order_fills', 'calc_on_every_tick', 'max_bars_back', 'backtest_fill_limits_assumption', 'default_qty_type', 'default_qty_value', 'initial_capital', 'currency', 'slippage', 'commission_type', 'commission_value', 'process_orders_on_close', 'close_entries_rule', 'margin_long', 'margin_short', 'explicit_plot_zorder', 'max_lines_count', 'max_labels_count', 'max_boxes_count', 'calc_bars_count', 'risk_free_rate', 'use_bar_magnifier', 'fill_orders_on_standard_ohlc', 'max_polylines_count', 'dynamic_requests', 'behind_chart'];
function declFn(kind, params) {
  return (rt, s, ...args) => {
    if (rt.declDone) return NaN;
    rt.declDone = true;
    const a = {};
    params.forEach((p, i) => { if (args[i] !== undefined) a[p] = args[i]; });
    rt.decl = { kind, title: a.title ?? 'Script', shorttitle: a.shorttitle, overlay: truthy(a.overlay), args: a, precision: a.precision, format: a.format, scale: a.scale };
    if (kind === 'strategy' && !rt.isSub) rt.S.broker = brokerInit(rt, a);
    return NaN;
  };
}
def('indicator', INDICATOR_P, declFn('indicator', INDICATOR_P));
def('study', INDICATOR_P, declFn('indicator', INDICATOR_P));
def('strategy', STRATEGY_P, declFn('strategy', STRATEGY_P));
def('library', ['title', 'overlay'], declFn('indicator', ['title', 'overlay']));

// ---------------------------------------------------------------- inputs
const SRC_NAMES = new Set(['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'hlcc4']);
const INPUT_P = {
  int: ['defval', 'title', 'minval', 'maxval', 'step', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active', 'options'],
  float: ['defval', 'title', 'minval', 'maxval', 'step', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active', 'options'],
  bool: ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
  string: ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
  color: ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
  source: ['defval', 'title', 'tooltip', 'inline', 'group', 'display', 'active'],
  timeframe: ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
  session: ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
  symbol: ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
  price: ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
  time: ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
  text_area: ['defval', 'title', 'tooltip', 'group', 'confirm', 'display', 'active'],
  enum: ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
  generic: ['defval', 'title', 'type', 'minval', 'maxval', 'confirm', 'step', 'options', 'tooltip', 'inline', 'group'],
};
function inputCompile(kind) {
  const params = INPUT_P[kind];
  return (rt, node, scope, C) => {
    const idx = rt.inputCount++;
    const codes = mapArgs(node, params, C, scope);
    // v5 generic input(): (defval, title, tooltip, inline, group)
    const defNode = codes[0] && codes[0].node;
    let srcName = null;
    if (defNode && defNode.type === 'Ident' && SRC_NAMES.has(defNode.name)) srcName = defNode.name;
    const isIntLit = defNode && ((defNode.type === 'Num' && defNode.isInt) || (defNode.type === 'Unary' && defNode.arg.type === 'Num' && defNode.arg.isInt));
    return (f) => {
      let d = rt.inputDefs[idx];
      if (!d) {
        const vals = {};
        params.forEach((p, i) => { if (codes[i]) vals[p] = codes[i].code(f); });
        let k = kind;
        if (kind === 'generic') {
          const ty = vals.type;
          if (rt.version >= 5 && typeof ty === 'string' && !['int', 'float', 'bool', 'string', 'source', 'timeframe', 'session', 'symbol', 'color', 'time', 'price'].includes(ty)) { vals.tooltip = ty; vals.type = undefined; }
          if (vals.type) k = vals.type;
          else if (srcName) k = 'source';
          else if (typeof vals.defval === 'boolean') k = 'bool';
          else if (typeof vals.defval === 'number') k = isIntLit ? 'int' : 'float';
          else if (typeof vals.defval === 'string' && /^#[0-9a-f]{8}$/.test(vals.defval)) k = 'color';
          else k = 'string';
        }
        if ((kind === 'int' || kind === 'float') && Array.isArray(vals.minval)) { vals.options = vals.minval; vals.minval = undefined; }
        let defval = vals.defval;
        if (k === 'source') defval = srcName || 'close';
        if (k === 'enum' && typeof defval === 'string') {
          const en = defval.split('::')[0];
          const e = rt.enums[en];
          if (e) vals.options = e.fields.map((fd) => en + '::' + fd.name), vals.optionTitles = e.fields.map((fd) => fd.title);
        }
        d = { idx, kind: k, title: vals.title ?? (k === 'source' ? 'Source' : 'Input ' + (idx + 1)), defval, minval: vals.minval, maxval: vals.maxval, step: vals.step, options: vals.options, optionTitles: vals.optionTitles, tooltip: vals.tooltip, inline: vals.inline, group: vals.group, confirm: vals.confirm, line: node.line };
        rt.inputDefs[idx] = d;
      }
      let v = rt.inputValues[idx];
      if (v === undefined || v === null || (typeof v === 'number' && isNaN(v) && d.kind !== 'float')) v = d.defval;
      if (d.kind === 'int' && typeof v === 'number') v = Math.trunc(v);
      if (d.kind === 'source') return rt.srcVal(v);
      if (d.kind === 'time' && typeof v === 'string') v = Date.parse(v);
      return v;
    };
  };
}
for (const k of Object.keys(INPUT_P)) if (k !== 'generic') defc('input.' + k, INPUT_P[k], inputCompile(k));
defc('input', INPUT_P.generic, inputCompile('generic'));
// v4 input type constants
Object.assign(K, { 'input.integer': 'int', 'input.float': 'float', 'input.bool': 'bool', 'input.string': 'string', 'input.source': 'source', 'input.resolution': 'timeframe', 'input.session': 'session', 'input.symbol': 'symbol', 'input.color': 'color', 'input.time': 'time', 'input.price': 'price' });

// ---------------------------------------------------------------- generic
def('na', ['x'], (rt, s, x) => isNa(x));
def('nz', ['source', 'replacement'], (rt, s, x, y) => (isNa(x) ? (y === undefined ? 0 : y) : x));
def('int', ['x'], (rt, s, x) => (typeof x === 'number' ? (isNaN(x) ? NaN : Math.trunc(x)) : x === true ? 1 : x === false ? 0 : NaN));
def('float', ['x'], (rt, s, x) => (typeof x === 'boolean' ? +x : x));
def('bool', ['x'], (rt, s, x) => truthy(x));
def('string', ['x'], (rt, s, x) => x);
def('color', ['x'], (rt, s, x) => x);
for (const t of ['label', 'line', 'box', 'table', 'linefill', 'polyline']) def(t, ['x'], (rt, s, x) => x);
def('iff', ['condition', 'then', 'else'], (rt, s, c, a, b) => (truthy(c) ? a : b));
def('max_bars_back', ['var', 'num'], () => NaN);
def('offset', ['source', 'offset'], (rt, s, x, n) => { const b = s.b || (s.b = []); b.push(x); const k = b.length - 1 - L(n, 0); return k >= 0 ? b[k] : NaN; }, true);
def('alertcondition', ['condition', 'title', 'message'], (rt, s, c, title, msg) => { if (!rt.isSub && truthy(c) && rt.i === rt.n - 1) rt.alerts.push({ bar: rt.i, time: rt.t[rt.i], message: msg || title || 'alert' }); return NaN; });
def('alert', ['message', 'freq'], (rt, s, msg) => { if (!rt.isSub) { rt.alerts.push({ bar: rt.i, time: rt.t[rt.i], message: String(msg) }); if (rt.alerts.length > 2000) rt.alerts.shift(); } return NaN; });
def('runtime.error', ['message'], (rt, s, msg) => { throw new RuntimeErr(String(msg)); });
for (const lvl of ['info', 'warning', 'error']) {
  def('log.' + lvl, ['formatString'], (rt, s, fmt, ...args) => {
    if (rt.isSub) return NaN;
    const msg = args.length ? strFormat(rt, fmt, args) : toStr(rt, fmt);
    rt.logs.push({ bar: rt.i, time: rt.t[rt.i], level: lvl, msg });
    if (rt.logs.length > 5000) rt.logs.shift();
    return NaN;
  });
  B['log.' + lvl].p = ['formatString', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'];
}

// ---------------------------------------------------------------- math
const mathFns = {
  abs: Math.abs, acos: Math.acos, asin: Math.asin, atan: Math.atan, ceil: Math.ceil, cos: Math.cos, exp: Math.exp, floor: Math.floor,
  log: Math.log, log10: Math.log10, sin: Math.sin, sqrt: Math.sqrt, tan: Math.tan, sign: Math.sign,
  todegrees: (x) => x * 180 / Math.PI, toradians: (x) => x * Math.PI / 180,
};
for (const k in mathFns) { const fn = mathFns[k]; def('math.' + k, ['number'], (rt, s, x) => fn(num(x))); V4_ALIASES[k] = 'math.' + k; }
def('math.pow', ['base', 'exponent'], (rt, s, a, b) => Math.pow(num(a), num(b)));
V4_ALIASES.pow = 'math.pow';
function roundHalfAway(x) { return x < 0 ? -Math.round(-x) : Math.round(x); }
def('math.round', ['number', 'precision'], (rt, s, x, p) => {
  x = num(x);
  if (isNaN(x)) return NaN;
  if (p === undefined || isNa(p)) return roundHalfAway(x);
  const m = Math.pow(10, p);
  return roundHalfAway(x * m) / m;
});
V4_ALIASES.round = 'math.round';
def('math.round_to_mintick', ['number'], (rt, s, x) => { const t = rt.sym.point || 0.01; return roundHalfAway(num(x) / t) * t; });
def('math.max', ['number0', 'number1'], (rt, s, ...a) => { let m = -Infinity; for (const x of a) { const v = num(x); if (v !== v) return NaN; if (v > m) m = v; } return m; });
def('math.min', ['number0', 'number1'], (rt, s, ...a) => { let m = Infinity; for (const x of a) { const v = num(x); if (v !== v) return NaN; if (v < m) m = v; } return m; });
def('math.avg', ['number0', 'number1'], (rt, s, ...a) => { let m = 0; for (const x of a) m += num(x); return m / a.length; });
B['math.max'].p = B['math.min'].p = B['math.avg'].p = ['number0', 'number1', 'number2', 'number3', 'number4', 'number5', 'number6', 'number7', 'number8', 'number9'];
V4_ALIASES.max = 'math.max'; V4_ALIASES.min = 'math.min'; V4_ALIASES.avg = 'math.avg';
def('math.random', ['min', 'max', 'seed'], (rt, s, a = 0, b = 1, seed) => {
  if (seed !== undefined && !isNa(seed)) {
    if (s.x === undefined) s.x = (num(seed) * 2654435761) % 4294967296 || 1;
    s.x ^= s.x << 13; s.x ^= s.x >>> 17; s.x ^= s.x << 5; s.x >>>= 0;
    return a + (s.x / 4294967296) * (b - a);
  }
  return a + Math.random() * (b - a);
}, true);
Object.assign(K, { 'math.pi': Math.PI, 'math.e': Math.E, 'math.phi': 1.618033988749895, 'math.rphi': 0.6180339887498948 });

// ---------------------------------------------------------------- strings
function strFormat(rt, fmt, args) {
  return String(fmt).replace(/\{(\d+)(?:,\s*(number|date|time)(?:,\s*([^}]*))?)?\}/g, (m, i, type, pat) => {
    const v = args[+i];
    if (v === undefined) return m;
    if (type === 'number') {
      if (!pat) return toStr(rt, v, '#,##0.###');
      if (pat === 'integer') return toStr(rt, Math.round(num(v)), '#,##0');
      if (pat === 'percent') return toStr(rt, num(v), '#,##0%');
      if (pat === 'currency') return '$' + toStr(rt, num(v), '#,##0.00');
      return fmtPattern(num(v), pat.trim());
    }
    if (type === 'date' || type === 'time') return formatTime(rt, num(v), pat ? pat.trim() : 'yyyy-MM-dd HH:mm', undefined);
    return toStr(rt, v);
  }).replace(/''/g, "'");
}
def('str.tostring', ['value', 'format'], (rt, s, x, f) => toStr(rt, x, f));
V4_ALIASES.tostring = 'str.tostring';
def('str.tonumber', ['string'], (rt, s, x) => { if (typeof x === 'number') return x; const v = parseFloat(String(x)); return isNaN(v) || !/^\s*[+\-]?(\d+\.?\d*|\.\d+)([eE][+\-]?\d+)?\s*$/.test(String(x)) ? NaN : v; });
V4_ALIASES.tonumber = 'str.tonumber';
def('str.format', ['formatString', 'arg0'], (rt, s, fmt, ...args) => strFormat(rt, fmt, args));
B['str.format'].p = ['formatString', 'arg0', 'arg1', 'arg2', 'arg3', 'arg4', 'arg5', 'arg6', 'arg7', 'arg8', 'arg9', 'arg10', 'arg11'];
def('str.length', ['string'], (rt, s, x) => (isNa(x) ? NaN : String(x).length));
def('str.contains', ['source', 'str'], (rt, s, a, b) => String(a).includes(String(b)));
def('str.startswith', ['source', 'str'], (rt, s, a, b) => String(a).startsWith(String(b)));
def('str.endswith', ['source', 'str'], (rt, s, a, b) => String(a).endsWith(String(b)));
def('str.pos', ['source', 'str'], (rt, s, a, b) => { const i = String(a).indexOf(String(b)); return i < 0 ? NaN : i; });
def('str.substring', ['source', 'begin_pos', 'end_pos'], (rt, s, a, b, e) => String(a).substring(num(b), e === undefined ? undefined : num(e)));
def('str.replace', ['source', 'target', 'replacement', 'occurrence'], (rt, s, a, t, r, occ = 0) => {
  a = String(a); t = String(t); let idx = -1, from = 0;
  for (let k = 0; k <= occ; k++) { idx = a.indexOf(t, from); if (idx < 0) return a; from = idx + t.length; }
  return a.slice(0, idx) + String(r) + a.slice(idx + t.length);
});
def('str.replace_all', ['source', 'target', 'replacement'], (rt, s, a, t, r) => String(a).split(String(t)).join(String(r)));
def('str.split', ['string', 'separator'], (rt, s, a, sep) => (String(sep) === '' ? [...String(a)] : String(a).split(String(sep))));
def('str.upper', ['source'], (rt, s, a) => String(a).toUpperCase());
def('str.lower', ['source'], (rt, s, a) => String(a).toLowerCase());
def('str.trim', ['source'], (rt, s, a) => String(a).trim());
def('str.repeat', ['source', 'repeat', 'separator'], (rt, s, a, n, sep = '') => new Array(Math.max(0, L(n, 0))).fill(String(a)).join(String(sep)));
def('str.match', ['source', 'regex'], (rt, s, a, re) => { try { const m = new RegExp(String(re)).exec(String(a)); return m ? m[0] : ''; } catch (e) { return ''; } });
def('str.format_time', ['time', 'format', 'timezone'], (rt, s, t, fmt = "yyyy-MM-dd'T'HH:mm:ssZ", tz) => formatTime(rt, num(t), fmt, tz));

// ---------------------------------------------------------------- colors
const COLORS = {
  aqua: '#00bcd4', black: '#363a45', blue: '#2962ff', fuchsia: '#e040fb', gray: '#787b86', green: '#4caf50', lime: '#00e676', maroon: '#880e4f',
  navy: '#311b92', olive: '#808000', orange: '#ff9800', purple: '#9c27b0', red: '#f23645', silver: '#b2b5be', teal: '#089981', white: '#ffffff', yellow: '#fdd835',
};
for (const k in COLORS) { K['color.' + k] = COLORS[k] + 'ff'; K[k] = COLORS[k] + 'ff'; }
def('color.new', ['color', 'transp'], (rt, s, c, t) => (isNa(c) ? NaN : colorWithTransp(c, num(t, 0))));
def('color.rgb', ['red', 'green', 'blue', 'transp'], (rt, s, r, g, b, t = 0) => (isNa(r) || isNa(g) || isNa(b) ? NaN : makeColor(r, g, b, (1 - num(t, 0) / 100) * 255)));
def('color.r', ['color'], (rt, s, c) => { const p = parseColor(c); return p ? p[0] : NaN; });
def('color.g', ['color'], (rt, s, c) => { const p = parseColor(c); return p ? p[1] : NaN; });
def('color.b', ['color'], (rt, s, c) => { const p = parseColor(c); return p ? p[2] : NaN; });
def('color.t', ['color'], (rt, s, c) => { const p = parseColor(c); return p ? Math.round((1 - p[3] / 255) * 100) : NaN; });
def('color.from_gradient', ['value', 'bottom_value', 'top_value', 'bottom_color', 'top_color'], (rt, s, v, lo, hi, cl, ch) => {
  if (isNa(v) || isNa(lo) || isNa(hi)) return NaN;
  const a = parseColor(cl), b = parseColor(ch);
  if (!a || !b) return NaN;
  let p = hi === lo ? 1 : (v - lo) / (hi - lo);
  p = Math.max(0, Math.min(1, p));
  return makeColor(a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p, a[3] + (b[3] - a[3]) * p);
});

// ---------------------------------------------------------------- arrays
function idx(a, i) {
  i = Math.trunc(num(i));
  if (i < 0) i += a.length;
  if (!(i >= 0 && i < a.length)) throw new RuntimeErr(`فهرس المصفوفة ${i} خارج الحدود (الحجم ${a.length})`);
  return i;
}
function arr(a, name) {
  if (!Array.isArray(a)) throw new RuntimeErr(`${name}: المصفوفة na`);
  return a;
}
const newArray = (size = 0, init = NaN) => new Array(Math.max(0, L(size, 0))).fill(init === undefined ? NaN : init);
def('array.new', ['size', 'initial_value'], (rt, s, n, v) => newArray(n, v));
for (const t of ['float', 'int', 'bool', 'string', 'color', 'line', 'label', 'box', 'table', 'linefill']) def('array.new_' + t, ['size', 'initial_value'], (rt, s, n, v) => newArray(n, v === undefined ? (t === 'bool' ? false : NaN) : v));
def('array.from', ['arg0'], (rt, s, ...a) => a);
B['array.from'].p = Array.from({ length: 40 }, (_, i) => 'arg' + i);
def('array.copy', ['id'], (rt, s, a) => arr(a, 'array.copy').slice());
def('array.size', ['id'], (rt, s, a) => (Array.isArray(a) ? a.length : NaN));
def('array.get', ['id', 'index'], (rt, s, a, i) => { arr(a, 'array.get'); return a[idx(a, i)]; });
def('array.set', ['id', 'index', 'value'], (rt, s, a, i, v) => { arr(a, 'array.set'); a[idx(a, i)] = v; return NaN; });
def('array.push', ['id', 'value'], (rt, s, a, v) => { arr(a, 'array.push').push(v); if (a.length > 100000) throw new RuntimeErr('المصفوفة تجاوزت 100000 عنصر'); return NaN; });
def('array.pop', ['id'], (rt, s, a) => { arr(a, 'array.pop'); if (!a.length) throw new RuntimeErr('array.pop على مصفوفة فارغة'); return a.pop(); });
def('array.shift', ['id'], (rt, s, a) => { arr(a, 'array.shift'); if (!a.length) throw new RuntimeErr('array.shift على مصفوفة فارغة'); return a.shift(); });
def('array.unshift', ['id', 'value'], (rt, s, a, v) => { arr(a, 'array.unshift').unshift(v); return NaN; });
def('array.insert', ['id', 'index', 'value'], (rt, s, a, i, v) => { arr(a, 'array.insert'); let k = Math.trunc(num(i)); if (k < 0) k += a.length; if (k < 0 || k > a.length) throw new RuntimeErr('array.insert فهرس خارج الحدود'); a.splice(k, 0, v); return NaN; });
def('array.remove', ['id', 'index'], (rt, s, a, i) => { arr(a, 'array.remove'); return a.splice(idx(a, i), 1)[0]; });
def('array.clear', ['id'], (rt, s, a) => { if (Array.isArray(a)) a.length = 0; return NaN; });
def('array.concat', ['id1', 'id2'], (rt, s, a, b) => { arr(a, 'array.concat').push(...arr(b, 'array.concat')); return a; });
def('array.slice', ['id', 'index_from', 'index_to'], (rt, s, a, f, t) => arr(a, 'array.slice').slice(num(f), t === undefined ? undefined : num(t)));
def('array.reverse', ['id'], (rt, s, a) => { arr(a, 'array.reverse').reverse(); return NaN; });
const cmpAsc = (x, y) => (typeof x === 'string' ? (x < y ? -1 : x > y ? 1 : 0) : (isNaN(x) ? 1 : isNaN(y) ? -1 : x - y));
def('array.sort', ['id', 'order'], (rt, s, a, o = 'ascending') => { arr(a, 'array.sort').sort(cmpAsc); if (o === 'descending') a.reverse(); return NaN; });
def('array.sort_indices', ['id', 'order'], (rt, s, a, o = 'ascending') => { const ix = arr(a, 'array.sort_indices').map((_, i) => i).sort((i, j) => cmpAsc(a[i], a[j])); if (o === 'descending') ix.reverse(); return ix; });
def('array.includes', ['id', 'value'], (rt, s, a, v) => arr(a, 'array.includes').some((x) => x === v || (x !== x && v !== v)));
def('array.indexof', ['id', 'value'], (rt, s, a, v) => arr(a, 'array.indexof').indexOf(v));
def('array.lastindexof', ['id', 'value'], (rt, s, a, v) => arr(a, 'array.lastindexof').lastIndexOf(v));
const nums = (a) => a.filter((x) => typeof x === 'number' && x === x);
def('array.max', ['id', 'nth'], (rt, s, a, n = 0) => { const w = nums(arr(a, 'array.max')).sort((x, y) => y - x); return w.length > n ? w[n] : NaN; });
def('array.min', ['id', 'nth'], (rt, s, a, n = 0) => { const w = nums(arr(a, 'array.min')).sort((x, y) => x - y); return w.length > n ? w[n] : NaN; });
def('array.sum', ['id'], (rt, s, a) => { const w = nums(arr(a, 'array.sum')); return w.length ? w.reduce((x, y) => x + y, 0) : NaN; });
def('array.avg', ['id'], (rt, s, a) => { const w = nums(arr(a, 'array.avg')); return w.length ? w.reduce((x, y) => x + y, 0) / w.length : NaN; });
def('array.median', ['id'], (rt, s, a) => { const w = nums(arr(a, 'array.median')).sort((x, y) => x - y); if (!w.length) return NaN; const m = w.length >> 1; return w.length % 2 ? w[m] : (w[m - 1] + w[m]) / 2; });
def('array.mode', ['id'], (rt, s, a) => { const c = new Map(); let b = NaN, bc = 0; for (const x of nums(arr(a, 'array.mode'))) { const k = (c.get(x) || 0) + 1; c.set(x, k); if (k > bc || (k === bc && x < b)) { bc = k; b = x; } } return b; });
function variance(w, biased) { if (!w.length) return NaN; const m = w.reduce((x, y) => x + y, 0) / w.length; return w.reduce((x, y) => x + (y - m) ** 2, 0) / (biased ? w.length : w.length - 1); }
def('array.variance', ['id', 'biased'], (rt, s, a, b = true) => variance(nums(arr(a, 'array.variance')), truthy(b)));
def('array.stdev', ['id', 'biased'], (rt, s, a, b = true) => Math.sqrt(variance(nums(arr(a, 'array.stdev')), truthy(b))));
def('array.range', ['id'], (rt, s, a) => { const w = nums(arr(a, 'array.range')); return w.length ? Math.max(...w) - Math.min(...w) : NaN; });
def('array.abs', ['id'], (rt, s, a) => arr(a, 'array.abs').map((x) => Math.abs(x)));
def('array.fill', ['id', 'value', 'index_from', 'index_to'], (rt, s, a, v, f = 0, t) => { arr(a, 'array.fill').fill(v, num(f), t === undefined ? a.length : num(t)); return NaN; });
def('array.first', ['id'], (rt, s, a) => { arr(a, 'array.first'); if (!a.length) throw new RuntimeErr('array.first على مصفوفة فارغة'); return a[0]; });
def('array.last', ['id'], (rt, s, a) => { arr(a, 'array.last'); if (!a.length) throw new RuntimeErr('array.last على مصفوفة فارغة'); return a[a.length - 1]; });
def('array.join', ['id', 'separator'], (rt, s, a, sep = '') => arr(a, 'array.join').map((x) => toStr(rt, x)).join(String(sep)));
def('array.every', ['id'], (rt, s, a) => arr(a, 'array.every').every(truthy));
def('array.some', ['id'], (rt, s, a) => arr(a, 'array.some').some(truthy));
function bsearch(a, v, mode) {
  let lo = 0, hi = a.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m] === v) { if (mode === 0) return m; if (mode < 0) hi = m - 1; else lo = m + 1; } else if (a[m] < v) lo = m + 1; else hi = m - 1; }
  if (mode === 0) return -1;
  return mode < 0 ? lo : hi;
}
def('array.binary_search', ['id', 'val'], (rt, s, a, v) => bsearch(arr(a, 'array.binary_search'), v, 0));
def('array.binary_search_leftmost', ['id', 'val'], (rt, s, a, v) => { a = arr(a, 'x'); let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return a[lo] === v ? lo : lo - 1; });
def('array.binary_search_rightmost', ['id', 'val'], (rt, s, a, v) => { a = arr(a, 'x'); let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= v) lo = m + 1; else hi = m; } return a[lo - 1] === v ? lo - 1 : lo; });
def('array.percentrank', ['id', 'index'], (rt, s, a, i) => { a = arr(a, 'x'); const v = a[idx(a, i)]; return 100 * a.filter((x) => x <= v).length / a.length; });
def('array.percentile_linear_interpolation', ['id', 'percentage'], (rt, s, a, p) => { const w = nums(arr(a, 'x')).sort((x, y) => x - y); if (!w.length) return NaN; const pos = (p / 100) * (w.length - 1); const lo = Math.floor(pos), hi = Math.ceil(pos); return w[lo] + (w[hi] - w[lo]) * (pos - lo); });
def('array.percentile_nearest_rank', ['id', 'percentage'], (rt, s, a, p) => { const w = nums(arr(a, 'x')).sort((x, y) => x - y); if (!w.length) return NaN; return w[Math.max(0, Math.min(w.length - 1, Math.ceil(p / 100 * w.length) - 1))]; });
def('array.covariance', ['id1', 'id2', 'biased'], (rt, s, a, b, bi = true) => { const n = a.length; if (!n) return NaN; const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let c = 0; for (let i = 0; i < n; i++) c += (a[i] - ma) * (b[i] - mb); return c / (truthy(bi) ? n : n - 1); });
def('array.standardize', ['id'], (rt, s, a) => { const w = arr(a, 'x'); const m = w.reduce((x, y) => x + y, 0) / w.length; const sd = Math.sqrt(variance(w, true)); return w.map((x) => (x - m) / sd); });

// ---------------------------------------------------------------- matrix (row-major)
const mx = (r, c, v = NaN) => ({ __k: 'matrix', r, c, d: new Array(r * c).fill(v) });
function M(m) { if (!m || m.__k !== 'matrix') throw new RuntimeErr('matrix na'); return m; }
def('matrix.new', ['rows', 'columns', 'initial_value'], (rt, s, r = 0, c = 0, v) => mx(L(r, 0), L(c, 0), v === undefined ? NaN : v));
def('matrix.get', ['id', 'row', 'column'], (rt, s, m, r, c) => { M(m); if (r < 0 || r >= m.r || c < 0 || c >= m.c) throw new RuntimeErr('matrix.get خارج الحدود'); return m.d[r * m.c + c]; });
def('matrix.set', ['id', 'row', 'column', 'value'], (rt, s, m, r, c, v) => { M(m); if (r < 0 || r >= m.r || c < 0 || c >= m.c) throw new RuntimeErr('matrix.set خارج الحدود'); m.d[r * m.c + c] = v; return NaN; });
def('matrix.rows', ['id'], (rt, s, m) => M(m).r);
def('matrix.columns', ['id'], (rt, s, m) => M(m).c);
def('matrix.elements_count', ['id'], (rt, s, m) => M(m).r * m.c);
def('matrix.row', ['id', 'row'], (rt, s, m, r) => M(m).d.slice(r * m.c, (r + 1) * m.c));
def('matrix.col', ['id', 'column'], (rt, s, m, c) => { M(m); const o = []; for (let r = 0; r < m.r; r++) o.push(m.d[r * m.c + c]); return o; });
def('matrix.add_row', ['id', 'row', 'array_id'], (rt, s, m, r, a) => { M(m); if (r === undefined) r = m.r; const row = a ? a.slice(0, Math.max(m.c, a.length)) : new Array(m.c).fill(NaN); if (m.r === 0 && m.c === 0) m.c = row.length; m.d.splice(r * m.c, 0, ...row.slice(0, m.c)); m.r++; return NaN; });
def('matrix.add_col', ['id', 'column', 'array_id'], (rt, s, m, c, a) => { M(m); if (c === undefined) c = m.c; if (m.r === 0 && m.c === 0 && a) { m.r = a.length; } const nd = []; for (let r = 0; r < m.r; r++) { for (let k = 0; k <= m.c; k++) { if (k === c) nd.push(a ? a[r] : NaN); if (k < m.c) nd.push(m.d[r * m.c + k]); } } m.c++; m.d = nd; return NaN; });
def('matrix.remove_row', ['id', 'row'], (rt, s, m, r) => { M(m); if (r === undefined) r = m.r - 1; const out = m.d.splice(r * m.c, m.c); m.r--; return out; });
def('matrix.remove_col', ['id', 'column'], (rt, s, m, c) => { M(m); if (c === undefined) c = m.c - 1; const out = []; const nd = []; for (let r = 0; r < m.r; r++) for (let k = 0; k < m.c; k++) { if (k === c) out.push(m.d[r * m.c + k]); else nd.push(m.d[r * m.c + k]); } m.d = nd; m.c--; return out; });
def('matrix.fill', ['id', 'value'], (rt, s, m, v) => { M(m).d.fill(v); return NaN; });
def('matrix.copy', ['id'], (rt, s, m) => ({ ...M(m), d: m.d.slice() }));
def('matrix.transpose', ['id'], (rt, s, m) => { M(m); const o = mx(m.c, m.r); for (let r = 0; r < m.r; r++) for (let c = 0; c < m.c; c++) o.d[c * m.r + r] = m.d[r * m.c + c]; return o; });
def('matrix.sum', ['id1', 'id2'], (rt, s, a, b) => { M(a); const o = { ...a, d: a.d.slice() }; o.d = o.d.map((x, i) => x + (typeof b === 'number' ? b : b.d[i])); return o; });
def('matrix.diff', ['id1', 'id2'], (rt, s, a, b) => { M(a); const o = { ...a, d: a.d.slice() }; o.d = o.d.map((x, i) => x - (typeof b === 'number' ? b : b.d[i])); return o; });
def('matrix.mult', ['id1', 'id2'], (rt, s, a, b) => {
  M(a);
  if (typeof b === 'number') return { ...a, d: a.d.map((x) => x * b) };
  if (Array.isArray(b)) { const o = []; for (let r = 0; r < a.r; r++) { let t = 0; for (let k = 0; k < a.c; k++) t += a.d[r * a.c + k] * b[k]; o.push(t); } return o; }
  M(b); const o = mx(a.r, b.c, 0);
  for (let r = 0; r < a.r; r++) for (let c = 0; c < b.c; c++) { let t = 0; for (let k = 0; k < a.c; k++) t += a.d[r * a.c + k] * b.d[k * b.c + c]; o.d[r * b.c + c] = t; }
  return o;
});
def('matrix.avg', ['id'], (rt, s, m) => { const w = nums(M(m).d); return w.length ? w.reduce((x, y) => x + y, 0) / w.length : NaN; });
def('matrix.max', ['id'], (rt, s, m) => Math.max(...nums(M(m).d)));
def('matrix.min', ['id'], (rt, s, m) => Math.min(...nums(M(m).d)));
def('matrix.trace', ['id'], (rt, s, m) => { M(m); let t = 0; for (let i = 0; i < Math.min(m.r, m.c); i++) t += m.d[i * m.c + i]; return t; });
def('matrix.is_square', ['id'], (rt, s, m) => M(m).r === m.c);
def('matrix.reshape', ['id', 'rows', 'columns'], (rt, s, m, r, c) => { M(m).r = r; m.c = c; return NaN; });
def('matrix.swap_rows', ['id', 'row1', 'row2'], (rt, s, m, a, b) => { M(m); for (let c = 0; c < m.c; c++) { const t = m.d[a * m.c + c]; m.d[a * m.c + c] = m.d[b * m.c + c]; m.d[b * m.c + c] = t; } return NaN; });
def('matrix.det', ['id'], (rt, s, m) => { M(m); const n = m.r; const a = m.d.slice(); let det = 1; for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(a[r * n + i]) > Math.abs(a[p * n + i])) p = r; if (a[p * n + i] === 0) return 0; if (p !== i) { for (let c = 0; c < n; c++) { const t = a[i * n + c]; a[i * n + c] = a[p * n + c]; a[p * n + c] = t; } det = -det; } det *= a[i * n + i]; for (let r = i + 1; r < n; r++) { const fct = a[r * n + i] / a[i * n + i]; for (let c = i; c < n; c++) a[r * n + c] -= fct * a[i * n + c]; } } return det; });
def('matrix.inv', ['id'], (rt, s, m) => { M(m); const n = m.r; const a = m.d.slice(); const inv = mx(n, n, 0); for (let i = 0; i < n; i++) inv.d[i * n + i] = 1; for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(a[r * n + i]) > Math.abs(a[p * n + i])) p = r; if (a[p * n + i] === 0) return NaN; for (let c = 0; c < n; c++) { let t = a[i * n + c]; a[i * n + c] = a[p * n + c]; a[p * n + c] = t; t = inv.d[i * n + c]; inv.d[i * n + c] = inv.d[p * n + c]; inv.d[p * n + c] = t; } const d = a[i * n + i]; for (let c = 0; c < n; c++) { a[i * n + c] /= d; inv.d[i * n + c] /= d; } for (let r = 0; r < n; r++) if (r !== i) { const fct = a[r * n + i]; for (let c = 0; c < n; c++) { a[r * n + c] -= fct * a[i * n + c]; inv.d[r * n + c] -= fct * inv.d[i * n + c]; } } } return inv; });

// ---------------------------------------------------------------- maps
def('map.new', [], () => new Map());
const MP = (m) => { if (!(m instanceof Map)) throw new RuntimeErr('map na'); return m; };
def('map.put', ['id', 'key', 'value'], (rt, s, m, k, v) => { const p = MP(m).get(k); m.set(k, v); return p === undefined ? NaN : p; });
def('map.get', ['id', 'key'], (rt, s, m, k) => { const v = MP(m).get(k); return v === undefined ? NaN : v; });
def('map.contains', ['id', 'key'], (rt, s, m, k) => MP(m).has(k));
def('map.remove', ['id', 'key'], (rt, s, m, k) => { const v = MP(m).get(k); m.delete(k); return v === undefined ? NaN : v; });
def('map.keys', ['id'], (rt, s, m) => [...MP(m).keys()]);
def('map.values', ['id'], (rt, s, m) => [...MP(m).values()]);
def('map.size', ['id'], (rt, s, m) => MP(m).size);
def('map.clear', ['id'], (rt, s, m) => { MP(m).clear(); return NaN; });
def('map.copy', ['id'], (rt, s, m) => new Map(MP(m)));
def('map.put_all', ['id', 'id2'], (rt, s, m, b) => { for (const [k, v] of MP(b)) MP(m).set(k, v); return NaN; });

// ---------------------------------------------------------------- time
const fmtCache = new Map();
const offCache = new Map();
export function tzOffsetMs(rt, tz, t) {
  if (tz === undefined || tz === null || (typeof tz === 'number' && isNaN(tz)) || tz === '') tz = (rt && rt.sym && rt.sym.timezone) || 'Etc/UTC';
  tz = String(tz);
  const m = /^(?:UTC|GMT)\s*([+\-])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(tz);
  if (m) return (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + (m[3] ? +m[3] : 0)) * 60000;
  if (/^(UTC|GMT|Etc\/UTC|Etc\/GMT|Z)$/i.test(tz)) return 0;
  const hourKey = tz + '|' + Math.floor(t / 3600000);
  let o = offCache.get(hourKey);
  if (o !== undefined) return o;
  let fmt = fmtCache.get(tz);
  try {
    if (!fmt) { fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); fmtCache.set(tz, fmt); }
    const p = {};
    for (const x of fmt.formatToParts(new Date(t))) p[x.type] = x.value;
    const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    o = local - Math.floor(t / 1000) * 1000;
  } catch (e) { o = 0; }
  if (offCache.size > 20000) offCache.clear();
  offCache.set(hourKey, o);
  return o;
}
function local(rt, t, tz) { return new Date(t + tzOffsetMs(rt, tz, t)); }
function isoWeek(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x - y0) / 86400000 + 1) / 7);
}
const timeParts = {
  year: (d) => d.getUTCFullYear(), month: (d) => d.getUTCMonth() + 1, dayofmonth: (d) => d.getUTCDate(), dayofweek: (d) => d.getUTCDay() + 1,
  hour: (d) => d.getUTCHours(), minute: (d) => d.getUTCMinutes(), second: (d) => d.getUTCSeconds(), weekofyear: (d) => isoWeek(d),
};
for (const k in timeParts) {
  const g = timeParts[k];
  defv(k, (rt) => g(local(rt, rt.t[rt.i])));
  def(k, ['time', 'timezone'], (rt, s, t, tz) => (isNa(t) ? NaN : g(local(rt, num(t), tz))));
}
Object.assign(K, { 'dayofweek.sunday': 1, 'dayofweek.monday': 2, 'dayofweek.tuesday': 3, 'dayofweek.wednesday': 4, 'dayofweek.thursday': 5, 'dayofweek.friday': 6, 'dayofweek.saturday': 7 });

export function formatTime(rt, t, fmt, tz) {
  if (isNa(t)) return 'NaN';
  const d = local(rt, t, tz);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const p2 = (x) => (x < 10 ? '0' : '') + x;
  const off = tzOffsetMs(rt, tz, t) / 60000;
  return String(fmt).replace(/'([^']*)'|yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE|HH|H|hh|h|mm|m|ss|s|SSS|a|Z/g, (tok, lit) => {
    if (lit !== undefined) return lit;
    switch (tok) {
      case 'yyyy': return String(d.getUTCFullYear());
      case 'yy': return p2(d.getUTCFullYear() % 100);
      case 'MMMM': case 'MMM': return MON[d.getUTCMonth()];
      case 'MM': return p2(d.getUTCMonth() + 1);
      case 'M': return String(d.getUTCMonth() + 1);
      case 'dd': return p2(d.getUTCDate());
      case 'd': return String(d.getUTCDate());
      case 'EEEE': case 'EEE': return DAY[d.getUTCDay()];
      case 'HH': return p2(d.getUTCHours());
      case 'H': return String(d.getUTCHours());
      case 'hh': return p2(((d.getUTCHours() + 11) % 12) + 1);
      case 'h': return String(((d.getUTCHours() + 11) % 12) + 1);
      case 'mm': return p2(d.getUTCMinutes());
      case 'm': return String(d.getUTCMinutes());
      case 'ss': return p2(d.getUTCSeconds());
      case 's': return String(d.getUTCSeconds());
      case 'SSS': return String(d.getUTCMilliseconds()).padStart(3, '0');
      case 'a': return d.getUTCHours() < 12 ? 'AM' : 'PM';
      case 'Z': { const sg = off < 0 ? '-' : '+'; const a = Math.abs(off); return sg + p2(Math.floor(a / 60)) + p2(a % 60); }
    }
    return tok;
  });
}

function parseSession(sess) {
  // "0930-1600:23456,1800-2000" → [{s, e, days:Set}]
  const out = [];
  for (const part of String(sess).split(',')) {
    const m = /^\s*(\d{2})(\d{2})-(\d{2})(\d{2})(?::(\d+))?\s*$/.exec(part);
    if (!m) continue;
    const days = new Set((m[5] || '1234567').split('').map(Number));
    out.push({ s: +m[1] * 60 + +m[2], e: +m[3] * 60 + +m[4], days });
  }
  return out;
}
const sessCache = new Map();
export function inSession(rt, t, sess, tz) {
  let ss = sessCache.get(sess);
  if (!ss) { ss = parseSession(sess); sessCache.set(sess, ss); }
  if (!ss.length) return true;
  const d = local(rt, t, tz);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  const dow = d.getUTCDay() + 1;
  for (const x of ss) {
    if (x.s === x.e) { if (x.days.has(dow)) return true; continue; }
    if (x.s < x.e) { if (mins >= x.s && mins < x.e && x.days.has(dow)) return true; }
    else {
      if (mins >= x.s && x.days.has(dow)) return true;
      const pd = dow === 1 ? 7 : dow - 1;
      if (mins < x.e && x.days.has(pd)) return true;
    }
  }
  return false;
}

function tfOf(rt, tfs) { if (tfs === undefined || tfs === '' || isNa(tfs)) return rt.tf; return parseTf(tfs) || rt.tf; }
defv('time', (rt) => rt.t[rt.i]);
defv('time_close', (rt) => rt.barClose(rt.i));
defv('time_tradingday', (rt) => bucketStart(rt.t[rt.i], parseTf('D'), rt.align));
defv('timenow', (rt) => rt.opts.now || Date.now());
def('time', ['timeframe', 'session', 'timezone', 'bars_back'], (rt, s, tfs, sess, tz) => {
  const t = rt.t[rt.i];
  if (typeof sess === 'number') sess = undefined;
  if (sess && !inSession(rt, t, sess, tz)) return NaN;
  const tf = tfOf(rt, tfs);
  return tf === rt.tf ? t : bucketStart(t, tf, rt.align);
});
def('time_close', ['timeframe', 'session', 'timezone', 'bars_back'], (rt, s, tfs, sess, tz) => {
  const t = rt.t[rt.i];
  if (typeof sess === 'number') sess = undefined;
  if (sess && !inSession(rt, t, sess, tz)) return NaN;
  const tf = tfOf(rt, tfs);
  return bucketEnd(bucketStart(t, tf, rt.align), tf, rt.align);
});
def('timestamp', ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'], (rt, s, ...a) => {
  if (a.length === 1 && typeof a[0] === 'string') {
    let str = a[0].trim();
    let t = Date.parse(str);
    if (isNaN(t)) t = Date.parse(str.replace(/ ([+\-]\d{4})$/, ' GMT$1'));
    if (!isNaN(t) && !/[zZ]|[+\-]\d{2}:?\d{2}$|GMT|UTC/.test(str) && /\d{4}-\d{2}-\d{2}T?\d{0,2}/.test(str) && str.length <= 10) t = Date.UTC(...str.split('-').map((x, i) => (i === 1 ? +x - 1 : +x)));
    return t;
  }
  let tz;
  if (typeof a[0] === 'string') tz = a.shift();
  const [y, mo, d = 1, h = 0, mi = 0, sec = 0] = a.map((x) => num(x, 0));
  if (isNa(y) || isNa(mo)) return NaN;
  const utc = Date.UTC(y, mo - 1, d, h, mi, sec);
  return utc - tzOffsetMs(rt, tz, utc);
});

// ---------------------------------------------------------------- timeframe
defv('timeframe.period', (rt) => tfPeriod(rt.tf.kind, rt.tf.mult, rt.version >= 6));
defv('timeframe.main_period', (rt) => tfPeriod(rt.tf.kind, rt.tf.mult, rt.version >= 6));
defv('timeframe.multiplier', (rt) => rt.tf.mult);
defv('timeframe.isintraday', (rt) => rt.tf.kind === 'm' || rt.tf.kind === 's');
defv('timeframe.isminutes', (rt) => rt.tf.kind === 'm');
defv('timeframe.isseconds', (rt) => rt.tf.kind === 's');
defv('timeframe.isticks', () => false);
defv('timeframe.isdaily', (rt) => rt.tf.kind === 'D');
defv('timeframe.isweekly', (rt) => rt.tf.kind === 'W');
defv('timeframe.ismonthly', (rt) => rt.tf.kind === 'M');
defv('timeframe.isdwm', (rt) => rt.tf.kind === 'D' || rt.tf.kind === 'W' || rt.tf.kind === 'M');
V4_ALIASES.period = 'timeframe.period'; V4_ALIASES.interval = 'timeframe.multiplier'; V4_ALIASES.isintraday = 'timeframe.isintraday'; V4_ALIASES.isdaily = 'timeframe.isdaily'; V4_ALIASES.isweekly = 'timeframe.isweekly'; V4_ALIASES.ismonthly = 'timeframe.ismonthly'; V4_ALIASES.isdwm = 'timeframe.isdwm';
def('timeframe.in_seconds', ['timeframe'], (rt, s, tfs) => { const tf = tfOf(rt, tfs); return tf.kind === 'M' ? tf.mult * 2628003 : tf.seconds; });
def('timeframe.from_seconds', ['seconds'], (rt, s, sec) => {
  sec = num(sec);
  if (sec < 60) return Math.max(1, Math.round(sec)) + 'S';
  if (sec < 86400) return String(Math.round(sec / 60));
  if (sec < 604800) return Math.round(sec / 86400) + 'D';
  if (sec < 2628003) return Math.round(sec / 604800) + 'W';
  return Math.round(sec / 2628003) + 'M';
});
def('timeframe.change', ['timeframe'], (rt, s, tfs) => {
  const tf = tfOf(rt, tfs);
  const b = bucketStart(rt.t[rt.i], tf, rt.align);
  const ch = s.b !== undefined && b !== s.b;
  s.b = b;
  return ch;
}, true);

// ---------------------------------------------------------------- syminfo / barstate / chart / session
defv('syminfo.ticker', (rt) => rt.sym.name);
defv('syminfo.tickerid', (rt) => rt.tickerid());
defv('syminfo.main_tickerid', (rt) => rt.tickerid());
defv('syminfo.prefix', (rt) => rt.sym.prefix || 'BTX');
defv('syminfo.root', (rt) => rt.sym.name);
defv('syminfo.description', (rt) => rt.sym.description || rt.sym.name);
defv('syminfo.type', (rt) => rt.sym.type || 'cfd');
defv('syminfo.mintick', (rt) => rt.sym.point || 0.01);
defv('syminfo.pointvalue', (rt) => rt.sym.pointValue || 1);
defv('syminfo.pricescale', (rt) => Math.round(1 / (rt.sym.point || 0.01)));
defv('syminfo.minmove', () => 1);
defv('syminfo.currency', (rt) => rt.sym.quoteCurrency || 'USD');
defv('syminfo.basecurrency', (rt) => rt.sym.baseCurrency || '');
defv('syminfo.timezone', (rt) => rt.sym.timezone || 'Etc/UTC');
defv('syminfo.session', () => 'regular');
defv('syminfo.volumetype', () => 'tick');
defv('syminfo.mincontract', () => 0.01);
for (const k of ['country', 'sector', 'industry', 'isin', 'expiration_date', 'shares_outstanding_float', 'shares_outstanding_total', 'target_price_average', 'recommendations_total', 'employees']) defv('syminfo.' + k, () => NaN);
def('syminfo.prefix', ['symbol'], (rt, s, x) => (String(x).includes(':') ? String(x).split(':')[0] : 'BTX'));
def('syminfo.ticker', ['symbol'], (rt, s, x) => (String(x).includes(':') ? String(x).split(':')[1] : String(x)));
V4_ALIASES.tickerid = 'syminfo.tickerid'; V4_ALIASES.ticker = 'syminfo.ticker';

defv('bar_index', (rt) => rt.i);
defv('last_bar_index', (rt) => rt.n - 1);
defv('last_bar_time', (rt) => rt.t[rt.n - 1]);
defv('na', () => NaN);
defv('open', (rt) => rt.o[rt.i]);
defv('high', (rt) => rt.h[rt.i]);
defv('low', (rt) => rt.l[rt.i]);
defv('close', (rt) => rt.c[rt.i]);
defv('volume', (rt) => rt.v[rt.i]);
defv('hl2', (rt) => (rt.h[rt.i] + rt.l[rt.i]) / 2);
defv('hlc3', (rt) => (rt.h[rt.i] + rt.l[rt.i] + rt.c[rt.i]) / 3);
defv('ohlc4', (rt) => (rt.o[rt.i] + rt.h[rt.i] + rt.l[rt.i] + rt.c[rt.i]) / 4);
defv('hlcc4', (rt) => (rt.h[rt.i] + rt.l[rt.i] + 2 * rt.c[rt.i]) / 4);
defv('barstate.isfirst', (rt) => rt.i === 0);
defv('barstate.islast', (rt) => rt.i === rt.n - 1);
defv('barstate.ishistory', (rt) => !(rt.opts.partialLast && rt.i === rt.n - 1));
defv('barstate.isrealtime', (rt) => !!(rt.opts.partialLast && rt.i === rt.n - 1));
defv('barstate.isnew', () => true);
defv('barstate.isconfirmed', (rt) => !(rt.opts.partialLast && rt.i === rt.n - 1));
defv('barstate.islastconfirmedhistory', (rt) => rt.i === (rt.opts.partialLast ? rt.n - 2 : rt.n - 1));
defv('chart.bg_color', (rt) => (rt.opts.theme && rt.opts.theme.bg) || '#131722ff');
defv('chart.fg_color', (rt) => (rt.opts.theme && rt.opts.theme.fg) || '#d1d4dcff');
defv('chart.is_standard', (rt) => !rt.opts.heikinAshi);
defv('chart.is_heikinashi', (rt) => !!rt.opts.heikinAshi);
for (const k of ['is_renko', 'is_linebreak', 'is_kagi', 'is_pnf', 'is_range']) defv('chart.' + k, () => false);
defv('chart.left_visible_bar_time', (rt) => (rt.opts.visible ? rt.opts.visible[0] : rt.t[0]));
defv('chart.right_visible_bar_time', (rt) => (rt.opts.visible ? rt.opts.visible[1] : rt.t[rt.n - 1]));
const DTF = parseTf('D');
defv('session.ismarket', () => true);
defv('session.ispremarket', () => false);
defv('session.ispostmarket', () => false);
defv('session.isfirstbar', (rt) => rt.i === 0 || bucketStart(rt.t[rt.i], DTF, rt.align) !== bucketStart(rt.t[rt.i - 1], DTF, rt.align));
defv('session.isfirstbar_regular', V['session.isfirstbar']);
defv('session.islastbar', (rt) => rt.i < rt.n - 1 && bucketStart(rt.t[rt.i], DTF, rt.align) !== bucketStart(rt.t[rt.i + 1], DTF, rt.align));
defv('session.islastbar_regular', V['session.islastbar']);
Object.assign(K, { 'session.regular': 'regular', 'session.extended': 'extended', 'adjustment.none': 'none', 'adjustment.splits': 'splits', 'adjustment.dividends': 'dividends' });

// ---------------------------------------------------------------- tickers & requests
def('ticker.new', ['prefix', 'ticker', 'session', 'adjustment'], (rt, s, p, t) => p + ':' + t);
def('ticker.standard', ['symbol'], (rt, s, x) => (x === undefined ? rt.tickerid() : String(x).replace(/^HA:/, '')));
def('ticker.heikinashi', ['symbol'], (rt, s, x) => 'HA:' + String(x === undefined ? rt.sym.name : x).replace(/^.*:/, ''));
V4_ALIASES.heikinashi = 'ticker.heikinashi';
def('ticker.modify', ['tickerid', 'session', 'adjustment'], (rt, s, x) => x);
def('ticker.inherit', ['from_tickerid', 'symbol'], (rt, s, a, b) => b);
for (const k of ['renko', 'linebreak', 'kagi', 'pointfigure']) def('ticker.' + k, ['symbol'], (rt, s, x) => x);
Object.assign(K, { 'barmerge.gaps_on': 'gaps_on', 'barmerge.gaps_off': 'gaps_off', 'barmerge.lookahead_on': 'lookahead_on', 'barmerge.lookahead_off': 'lookahead_off' });

function normSym(rt, s) {
  if (s === undefined || isNa(s) || s === '') return rt.sym.name;
  s = String(s);
  if (s.startsWith('HA:')) return s;
  return s.includes(':') ? s.split(':').pop() : s;
}
const SEC_P = ['symbol', 'timeframe', 'expression', 'gaps', 'lookahead', 'ignore_invalid_symbol', 'currency', 'calc_bars_count'];
const secCompile = (rt, node, scope, C) => {
  const codes = mapArgs(node, SEC_P, C, scope);
  if (!codes[2]) throw new Error('request.security يحتاج expression');
  rt.usesSecurity = true;
  const id = node.id;
  return (f) => {
    const sym = normSym(rt, ev(codes[0], f));
    const tf = ev(codes[1], f);
    const gaps = ev(codes[3], f), la = ev(codes[4], f);
    return rt.security(id, sym, tf, codes[2].code, f, gaps === 'gaps_on' || gaps === true, la === 'lookahead_on' || la === true);
  };
};
defc('request.security', SEC_P, secCompile);
defc('security', ['symbol', 'resolution', 'expression', 'gaps', 'lookahead'], secCompile);
const SECL_P = ['symbol', 'timeframe', 'expression', 'ignore_invalid_symbol', 'currency', 'ignore_invalid_timeframe', 'calc_bars_count'];
defc('request.security_lower_tf', SECL_P, (rt, node, scope, C) => {
  const codes = mapArgs(node, SECL_P, C, scope);
  rt.usesSecurity = true;
  const id = node.id;
  return (f) => rt.securityLower(id, normSym(rt, ev(codes[0], f)), ev(codes[1], f), codes[2].code, f);
});
for (const k of ['financial', 'quandl', 'dividends', 'earnings', 'splits', 'economic', 'seed', 'footprint']) def('request.' + k, ['a', 'b', 'c', 'd'], (rt) => { if (!rt._warnedReq) { rt.warnings.push('request.' + k + ' يحتاج بيانات من الإنترنت — يعيد na دون اتصال'); rt._warnedReq = true; } return NaN; });
def('request.currency_rate', ['from', 'to'], (rt, s, a, b) => (a === b ? 1 : NaN));

// ---------------------------------------------------------------- chart.point
def('chart.point.new', ['time', 'index', 'price'], (rt, s, t, i, p) => ({ __k: 'chart.point', time: t, index: i, price: p }));
def('chart.point.from_index', ['index', 'price'], (rt, s, i, p) => ({ __k: 'chart.point', time: NaN, index: i, price: p }));
def('chart.point.from_time', ['time', 'price'], (rt, s, t, p) => ({ __k: 'chart.point', time: t, index: NaN, price: p }));
def('chart.point.now', ['price'], (rt, s, p) => ({ __k: 'chart.point', time: rt.t[rt.i], index: rt.i, price: p === undefined ? rt.c[rt.i] : p }));
def('chart.point.copy', ['id'], (rt, s, p) => ({ ...p }));

// misc constants
Object.assign(K, {
  'order.ascending': 'ascending', 'order.descending': 'descending',
  'alert.freq_all': 'all', 'alert.freq_once_per_bar': 'once_per_bar', 'alert.freq_once_per_bar_close': 'once_per_bar_close',
  'format.inherit': 'inherit', 'format.price': 'price', 'format.volume': 'volume', 'format.percent': 'percent', 'format.mintick': 'mintick',
  'scale.right': 'right', 'scale.left': 'left', 'scale.none': 'none',
  'display.all': 'all', 'display.none': 'none', 'display.data_window': 'data_window', 'display.pane': 'pane', 'display.price_scale': 'price_scale', 'display.status_line': 'status_line',
  'font.family_default': 'default', 'font.family_monospace': 'monospace',
  'text.align_left': 'left', 'text.align_center': 'center', 'text.align_right': 'right', 'text.align_top': 'top', 'text.align_bottom': 'bottom', 'text.wrap_auto': 'auto', 'text.wrap_none': 'none',
  'text.format_bold': 'bold', 'text.format_italic': 'italic', 'text.format_none': 'none',
});
for (const c of ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD', 'CNY', 'RUB', 'TRY', 'BTC', 'ETH', 'USDT', 'XAU', 'XAG', 'NONE']) K['currency.' + c] = c === 'NONE' ? '' : c;
void B; void nz; void typeOfValue;

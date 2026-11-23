// Shared registry of Pine builtins.
export const B = Object.create(null);   // functions: name → { p: [param names], f(rt, state, ...args), st: needs call-site state, compile? }
export const V = Object.create(null);   // variables: name → (rt) => value
export const K = Object.create(null);   // constants: name → value
export const V4_ALIASES = Object.create(null);

export function def(name, params, f, st = false) { B[name] = { p: params, f, st }; }
export function defc(name, params, compile) { B[name] = { p: params, compile }; }
export function defv(name, g) { V[name] = g; }
export function defk(name, v) { K[name] = v; }

export const NA = NaN;
export class RuntimeErr extends Error {}
export function isNa(x) { return x === undefined || x === null || (typeof x === 'number' && x !== x); }
export function truthy(x) { return x === true || (typeof x === 'number' && x !== 0 && x === x); }
export function nz(x, y = 0) { return isNa(x) ? y : x; }
export function num(x, d = NaN) { return typeof x === 'number' ? x : x === true ? 1 : x === false ? 0 : d; }
export function len(x, d) { x = num(x, d); return isNa(x) ? d : Math.max(0, Math.trunc(x)); }

export function typeOfValue(o) {
  if (Array.isArray(o)) return 'array';
  if (o instanceof Map) return 'map';
  if (o && typeof o === 'object') return o.__type || o.__k || 'object';
  if (typeof o === 'number') return 'float';
  if (typeof o === 'boolean') return 'bool';
  if (typeof o === 'string') return o.startsWith('#') && /^#[0-9a-f]{8}$/.test(o) ? 'color' : 'string';
  return null;
}

// ---- colors: canonical '#rrggbbaa' ----------------------------------------
const hex2 = (x) => { x = Math.max(0, Math.min(255, Math.round(x))); return (x < 16 ? '0' : '') + x.toString(16); };
export function makeColor(r, g, b, a = 255) { return '#' + hex2(r) + hex2(g) + hex2(b) + hex2(a); }
const ccache = new Map();
export function parseColor(c) {
  if (typeof c !== 'string') return null;
  let r = ccache.get(c);
  if (r) return r;
  if (/^#[0-9a-fA-F]{8}$/.test(c)) r = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), parseInt(c.slice(7, 9), 16)];
  else if (/^#[0-9a-fA-F]{6}$/.test(c)) r = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255];
  else return null;
  if (ccache.size < 5000) ccache.set(c, r);
  return r;
}
export function colorWithTransp(c, transp) {
  const p = parseColor(c);
  if (!p || isNa(transp)) return c;
  return makeColor(p[0], p[1], p[2], (1 - Math.max(0, Math.min(100, transp)) / 100) * 255);
}
export function toCss(c) {
  const p = parseColor(c);
  if (!p) return null;
  return p[3] === 255 ? `rgb(${p[0]},${p[1]},${p[2]})` : `rgba(${p[0]},${p[1]},${p[2]},${(p[3] / 255).toFixed(3)})`;
}

// ---- number formatting -----------------------------------------------------
export function decimalsOf(x) {
  if (!isFinite(x) || x <= 0) return 2;
  const s = x.toString();
  if (s.includes('e-')) return parseInt(s.split('e-')[1], 10);
  const d = s.indexOf('.');
  return d < 0 ? 0 : s.length - d - 1;
}

export function fmtPattern(x, pat) {
  // Java DecimalFormat subset: "#.##", "0.00", "#,##0.00", "#.###%", "#"
  if (isNa(x)) return 'NaN';
  let pct = false;
  if (pat.endsWith('%')) { pct = true; pat = pat.slice(0, -1); x *= 100; }
  const parts = pat.split('.');
  const intPat = parts[0], fracPat = parts[1] || '';
  const minFrac = (fracPat.match(/0/g) || []).length, maxFrac = fracPat.length;
  let s = Math.abs(x).toFixed(maxFrac);
  if (maxFrac > minFrac) { s = s.replace(/0+$/, ''); const d = s.indexOf('.'); if (d >= 0) { const fl = s.length - d - 1; if (fl < minFrac) s += '0'.repeat(minFrac - fl); } }
  if (s.endsWith('.')) s = s.slice(0, -1);
  let [ip, fp] = s.split('.');
  const minInt = (intPat.match(/0/g) || []).length;
  if (ip === '0' && minInt === 0 && fp) ip = intPat.includes('#') && !intPat.includes('0') ? '0' : ip;
  while (ip.length < minInt) ip = '0' + ip;
  if (intPat.includes(',')) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let r = fp ? ip + '.' + fp : ip;
  if (x < 0 && /[1-9]/.test(r)) r = '-' + r;
  return r + (pct ? '%' : '');
}

export function fmtVolume(x) {
  const a = Math.abs(x);
  if (a >= 1e9) return (x / 1e9).toFixed(3).replace(/\.?0+$/, '') + 'B';
  if (a >= 1e6) return (x / 1e6).toFixed(3).replace(/\.?0+$/, '') + 'M';
  if (a >= 1e3) return (x / 1e3).toFixed(3).replace(/\.?0+$/, '') + 'K';
  return String(+x.toFixed(2));
}

export function toStr(rt, x, format) {
  if (x === undefined || x === null) return 'NaN';
  if (typeof x === 'string') {
    if (rt && rt.enums && x.includes('::')) { const [en, fn] = x.split('::'); const e = rt.enums[en]; if (e) { const fd = e.fields.find((q) => q.name === fn); if (fd) return fd.title; } }
    return x;
  }
  if (typeof x === 'boolean') return x ? 'true' : 'false';
  if (Array.isArray(x)) return '[' + x.map((y) => toStr(rt, y)).join(', ') + ']';
  if (typeof x !== 'number') return String(x);
  if (x !== x) return 'NaN';
  if (format === undefined || format === null || format === '' || (typeof format === 'number' && isNaN(format))) {
    if (Number.isInteger(x)) return String(x);
    return String(+x.toPrecision(15)).replace(/e\+?/, 'E');
  }
  if (format === 'mintick' || format === 'price') { const d = rt ? rt.sym.digits : 2; return x.toFixed(d); }
  if (format === 'percent') return x.toFixed(2) + '%';
  if (format === 'volume') return fmtVolume(x);
  if (format === 'inherit') return String(+x.toPrecision(12));
  return fmtPattern(x, String(format));
}

// ---- small numeric helpers -------------------------------------------------
export function pushTrim(a, v, max = 15000) {
  a.push(v);
  if (a.length > max * 1.5) a.splice(0, a.length - max);
}
export function hist(a, n) { // value n bars back in an accumulation array (n=0 → last)
  const k = a.length - 1 - n;
  return k >= 0 ? a[k] : NaN;
}

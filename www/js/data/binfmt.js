// BTXD v1 — compact binary OHLCV container shared by the app and the build tools.
// Layout: "BTXD" | u8 version | u32 headerLen (LE) | header JSON (utf8) | varint body
// Body per bar: dt (unsigned, in meta.timeUnit seconds), open-prevClose (zigzag),
// high-max(o,c) (unsigned), min(o,c)-low (unsigned), close-open (zigzag), volume*volScale (unsigned)
// Prices are stored as integers of meta.priceScale (1/point) so they are exact.

export function createBars(n) {
  return {
    t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n),
    l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n), length: n,
  };
}

export function sliceBars(b, from, to) {
  return {
    t: b.t.subarray(from, to), o: b.o.subarray(from, to), h: b.h.subarray(from, to),
    l: b.l.subarray(from, to), c: b.c.subarray(from, to), v: b.v.subarray(from, to), length: to - from,
  };
}

class ByteWriter {
  constructor(cap = 1 << 20) { this.buf = new Uint8Array(cap); this.pos = 0; }
  ensure(n) {
    if (this.pos + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.pos + n) cap *= 2;
    const nb = new Uint8Array(cap); nb.set(this.buf.subarray(0, this.pos)); this.buf = nb;
  }
  uvar(x) { // unsigned LEB128 for 0..2^53
    this.ensure(10);
    while (x >= 128) { this.buf[this.pos++] = (x % 128) | 128; x = Math.floor(x / 128); }
    this.buf[this.pos++] = x;
  }
  svar(x) { this.uvar(x >= 0 ? x * 2 : -x * 2 - 1); }
  bytes(u8) { this.ensure(u8.length); this.buf.set(u8, this.pos); this.pos += u8.length; }
  u8(x) { this.ensure(1); this.buf[this.pos++] = x; }
  u32(x) { this.ensure(4); this.buf[this.pos++] = x & 255; this.buf[this.pos++] = (x >>> 8) & 255; this.buf[this.pos++] = (x >>> 16) & 255; this.buf[this.pos++] = (x >>> 24) & 255; }
  result() { return this.buf.slice(0, this.pos); }
}

export function chooseVolScale(v, n) {
  // pick a power of ten so the median non-zero volume has >= ~4 significant digits as an integer
  const sample = [];
  const step = Math.max(1, Math.floor(n / 2000));
  for (let i = 0; i < n; i += step) if (v[i] > 0) sample.push(v[i]);
  if (!sample.length) return 1;
  sample.sort((a, b) => a - b);
  const med = sample[sample.length >> 1];
  let scale = 1;
  while (med * scale < 1000 && scale < 1e9) scale *= 10;
  // integer volumes stay unscaled
  if (sample.every((x) => Number.isInteger(x))) scale = 1;
  return scale;
}

export function encodeBars(meta, bars) {
  const n = bars.length;
  const point = meta.point;
  const ps = Math.round(1 / point);
  const timeUnit = meta.timeUnit || 60;
  const volScale = meta.volScale || chooseVolScale(bars.v, n);
  // check that times are aligned to timeUnit, otherwise fall back to seconds
  let tu = timeUnit;
  for (let i = 0; i < n; i++) { if ((bars.t[i] / 1000) % tu !== 0) { tu = 1; break; } }
  const startTime = n ? bars.t[0] : 0;
  const header = {
    ...meta, count: n, priceScale: ps, timeUnit: tu, volScale,
    startTime, from: n ? bars.t[0] : 0, to: n ? bars.t[n - 1] : 0,
    basePrice: n ? Math.round(bars.o[0] * ps) : 0,
  };
  const w = new ByteWriter(Math.max(1024, n * 9));
  w.bytes(new TextEncoder().encode('BTXD'));
  w.u8(1);
  const hj = new TextEncoder().encode(JSON.stringify(header));
  w.u32(hj.length);
  w.bytes(hj);
  let pt = startTime, pc = header.basePrice;
  for (let i = 0; i < n; i++) {
    const t = bars.t[i];
    let o = Math.round(bars.o[i] * ps), c = Math.round(bars.c[i] * ps);
    let h = Math.round(bars.h[i] * ps), l = Math.round(bars.l[i] * ps);
    const mx = Math.max(o, c), mn = Math.min(o, c);
    if (h < mx) h = mx;
    if (l > mn) l = mn;
    w.uvar(Math.round((t - pt) / 1000 / tu));
    w.svar(o - pc);
    w.uvar(h - mx);
    w.uvar(mn - l);
    w.svar(c - o);
    const vv = bars.v[i];
    w.uvar(vv > 0 && isFinite(vv) ? Math.round(vv * volScale) : 0);
    pt = t; pc = c;
  }
  return w.result();
}

export function decodeHeader(u8) {
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  if (magic !== 'BTXD') throw new Error('Not a BTXD file');
  const hl = u8[5] | (u8[6] << 8) | (u8[7] << 16) | (u8[8] << 24);
  const header = JSON.parse(new TextDecoder().decode(u8.subarray(9, 9 + hl)));
  return { header, offset: 9 + hl };
}

export function decodeBars(u8) {
  const { header, offset } = decodeHeader(u8);
  const n = header.count;
  const bars = createBars(n);
  const ps = header.priceScale, tu = header.timeUnit * 1000, vs = header.volScale || 1;
  let pos = offset;
  const rd = () => {
    let x = 0, mul = 1, b;
    do { b = u8[pos++]; x += (b & 127) * mul; mul *= 128; } while (b & 128);
    return x;
  };
  const sd = () => { const z = rd(); return z % 2 === 0 ? z / 2 : -(z + 1) / 2; };
  let pt = header.startTime, pc = header.basePrice;
  for (let i = 0; i < n; i++) {
    const t = pt + rd() * tu;
    const o = pc + sd();
    const dh = rd(), dl = rd();
    const c = o + sd();
    const v = rd();
    bars.t[i] = t;
    bars.o[i] = o / ps; bars.c[i] = c / ps;
    bars.h[i] = (Math.max(o, c) + dh) / ps;
    bars.l[i] = (Math.min(o, c) - dl) / ps;
    bars.v[i] = v / vs;
    pt = t; pc = c;
  }
  return { meta: header, bars };
}

// Merge two sorted bar sets; bars from `b` win on equal timestamps.
export function mergeBars(a, b) {
  const out = createBars(a.length + b.length);
  let i = 0, j = 0, k = 0;
  const put = (s, x) => { out.t[k] = s.t[x]; out.o[k] = s.o[x]; out.h[k] = s.h[x]; out.l[k] = s.l[x]; out.c[k] = s.c[x]; out.v[k] = s.v[x]; k++; };
  while (i < a.length || j < b.length) {
    if (j >= b.length) put(a, i++);
    else if (i >= a.length) put(b, j++);
    else if (a.t[i] < b.t[j]) put(a, i++);
    else if (a.t[i] > b.t[j]) put(b, j++);
    else { put(b, j++); i++; }
  }
  return sliceBars(out, 0, k);
}

export function compactBars(b) { // copy (subarray views → owned arrays)
  const out = createBars(b.length);
  out.t.set(b.t); out.o.set(b.o); out.h.set(b.h); out.l.set(b.l); out.c.set(b.c); out.v.set(b.v);
  return out;
}

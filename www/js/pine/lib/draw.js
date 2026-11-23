// Plotting + drawing objects (plot*, hline, fill, bgcolor, barcolor, label, line, box, table, linefill, polyline)
import { B, def, defc, defv, K, isNa, truthy, num, colorWithTransp, RuntimeErr } from './registry.js';

const DEF_PLOT = '#2962ffff';
// display flags: pane=1, data_window=2, price_scale=4, status_line=8 (all=15)
export function dispFlags(d) { if (d === undefined || d === null || (typeof d === 'number' && isNaN(d))) return 15; if (typeof d === 'number') return d; return d === 'none' ? 0 : 15; }

function setColor(rec, key, i, c) {
  // per-bar colors stored lazily: rec[key+'0'] holds the first color; array allocated when colors vary
  const k0 = key + '0';
  if (rec[k0] === undefined) { rec[k0] = c; if (rec[key]) rec[key][i] = c; return; }
  if (!rec[key]) {
    if (c === rec[k0] || (c !== c && rec[k0] !== rec[k0])) return;
    rec[key] = new Array(rec.n0 || 0);
    rec[key].fill(rec[k0]);
  }
  rec[key][i] = c;
}
export function colorAt(rec, key, i) {
  const a = rec[key];
  if (a) { const c = a[i]; return c === undefined ? rec[key + '0'] : c; }
  return rec[key + '0'];
}
function applyTransp(rt, c) { return rt.transp !== undefined && typeof c === 'string' ? colorWithTransp(c, rt.transp) : c; }

function reg(rt, list, factory) {
  const id = rt.meta.id;
  let r = rt.outById[id];
  if (!r) { r = factory(); r.id = id; r.n0 = rt.n; rt.outById[id] = r; rt.out[list].push(r); }
  return r;
}

const PLOT_P = ['series', 'title', 'color', 'linewidth', 'style', 'trackprice', 'histbase', 'offset', 'join', 'editable', 'show_last', 'display', 'format', 'precision', 'force_overlay'];
def('plot', PLOT_P, (rt, s, series, title, color, lw, style, track, histbase, offset, join, editable, showLast, display, format, precision) => {
  if (rt.isSub) return { __plot: -1 };
  const r = reg(rt, 'plots', () => ({ kind: 'plot', title: title ?? 'Plot', style: typeof style === 'string' ? style : 'line', lineWidth: num(lw, 1) || 1, values: rt.newArr(), offset: num(offset, 0) || 0, trackprice: truthy(track), histbase: num(histbase, 0) || 0, join: truthy(join), display: dispFlags(display), format, precision, showLast: showLast }));
  let v = series;
  if (typeof v === 'boolean') v = v ? 1 : 0;
  r.values[rt.i] = typeof v === 'number' ? v : NaN;
  setColor(r, 'colors', rt.i, applyTransp(rt, color === undefined ? DEF_PLOT : color));
  return { __plot: r.id };
});
const SHAPE_P = ['series', 'title', 'style', 'location', 'color', 'offset', 'text', 'textcolor', 'editable', 'size', 'show_last', 'display', 'format', 'precision', 'force_overlay'];
def('plotshape', SHAPE_P, (rt, s, series, title, style, loc, color, offset, text, textcolor, editable, size, showLast, display) => {
  if (rt.isSub) return NaN;
  const r = reg(rt, 'shapes', () => ({ kind: 'shape', title: title ?? 'Shape', style: style || 'xcross', location: loc || 'abovebar', values: rt.newArr(), offset: num(offset, 0) || 0, text: text ?? '', size: size || 'auto', display: dispFlags(display) }));
  const on = typeof series === 'boolean' ? series : !isNa(series) && series !== 0 && series !== false;
  r.values[rt.i] = on ? (r.location === 'absolute' ? num(series) : 1) : NaN;
  setColor(r, 'colors', rt.i, applyTransp(rt, color === undefined ? DEF_PLOT : color));
  setColor(r, 'textcolors', rt.i, textcolor === undefined ? undefined : textcolor);
  if (typeof text === 'string' && text !== r.text) { if (!r.texts) r.texts = {}; r.texts[rt.i] = text; }
  return NaN;
});
const CHAR_P = ['series', 'title', 'char', 'location', 'color', 'offset', 'text', 'textcolor', 'editable', 'size', 'show_last', 'display', 'format', 'precision', 'force_overlay'];
def('plotchar', CHAR_P, (rt, s, series, title, ch, loc, color, offset, text, textcolor, editable, size, showLast, display) => {
  if (rt.isSub) return NaN;
  const r = reg(rt, 'shapes', () => ({ kind: 'char', title: title ?? 'Char', char: ch || '★', location: loc || 'abovebar', values: rt.newArr(), offset: num(offset, 0) || 0, text: text ?? '', size: size || 'auto', display: dispFlags(display) }));
  const on = typeof series === 'boolean' ? series : !isNa(series) && series !== 0;
  r.values[rt.i] = on ? (r.location === 'absolute' ? num(series) : 1) : NaN;
  setColor(r, 'colors', rt.i, applyTransp(rt, color === undefined ? DEF_PLOT : color));
  setColor(r, 'textcolors', rt.i, textcolor);
  return NaN;
});
def('plotarrow', ['series', 'title', 'colorup', 'colordown', 'offset', 'minheight', 'maxheight', 'editable', 'show_last', 'display', 'format', 'precision', 'force_overlay'], (rt, s, series, title, cu, cd, offset, minh, maxh, editable, showLast, display) => {
  if (rt.isSub) return NaN;
  const r = reg(rt, 'shapes', () => ({ kind: 'arrow', title: title ?? 'Arrow', values: rt.newArr(), offset: num(offset, 0) || 0, minh: num(minh, 5), maxh: num(maxh, 100), display: dispFlags(display) }));
  const v = num(series);
  r.values[rt.i] = v === 0 ? NaN : v;
  setColor(r, 'colors', rt.i, v >= 0 ? (cu === undefined ? '#4caf50e6' : cu) : (cd === undefined ? '#f23645e6' : cd));
  return NaN;
});
def('plotcandle', ['open', 'high', 'low', 'close', 'title', 'color', 'wickcolor', 'editable', 'show_last', 'bordercolor', 'display', 'format', 'precision', 'force_overlay'], (rt, s, o, h, l, c, title, color, wick, editable, showLast, border, display) => {
  if (rt.isSub) return NaN;
  const r = reg(rt, 'candles', () => ({ kind: 'candle', title: title ?? 'Candles', o: rt.newArr(), h: rt.newArr(), l: rt.newArr(), c: rt.newArr(), display: dispFlags(display) }));
  r.o[rt.i] = num(o); r.h[rt.i] = num(h); r.l[rt.i] = num(l); r.c[rt.i] = num(c);
  setColor(r, 'colors', rt.i, color);
  setColor(r, 'wicks', rt.i, wick);
  setColor(r, 'borders', rt.i, border);
  return NaN;
});
def('plotbar', ['open', 'high', 'low', 'close', 'title', 'color', 'editable', 'show_last', 'display', 'format', 'precision', 'force_overlay'], (rt, s, o, h, l, c, title, color, editable, showLast, display) => {
  if (rt.isSub) return NaN;
  const r = reg(rt, 'candles', () => ({ kind: 'bar', title: title ?? 'Bars', o: rt.newArr(), h: rt.newArr(), l: rt.newArr(), c: rt.newArr(), display: dispFlags(display) }));
  r.o[rt.i] = num(o); r.h[rt.i] = num(h); r.l[rt.i] = num(l); r.c[rt.i] = num(c);
  setColor(r, 'colors', rt.i, color);
  return NaN;
});
def('hline', ['price', 'title', 'color', 'linestyle', 'linewidth', 'editable', 'display'], (rt, s, price, title, color, style, lw, editable, display) => {
  if (rt.isSub) return { __hline: -1 };
  const r = reg(rt, 'hlines', () => ({ kind: 'hline', title: title ?? 'Level', display: dispFlags(display) }));
  r.price = num(price); r.color = applyTransp(rt, color === undefined ? '#787b86ff' : color); r.style = style || 'dashed'; r.lineWidth = num(lw, 1) || 1;
  return { __hline: r.id };
});
defc('fill', ['hline1', 'hline2', 'color', 'title', 'editable', 'show_last', 'fillgaps', 'display'], (rt, node, scope, C) => {
  const pos = node.args.map((a) => C(a, scope));
  const named = {};
  for (const k in node.named) named[k] = C(node.named[k], scope);
  const meta = { id: node.id, line: node.line, named: Object.keys(node.named) };
  const g = (i, ...names) => (f) => { for (const nm of names) if (named[nm]) return named[nm](f); return pos[i] ? pos[i](f) : undefined; };
  const A = g(0, 'plot1', 'hline1'), Bv = g(1, 'plot2', 'hline2');
  const P2 = pos[2], T = named.transp;
  const ref = (x) => (x && x.__plot !== undefined ? { type: 'plot', id: x.__plot } : x && x.__hline !== undefined ? { type: 'hline', id: x.__hline } : null);
  return (f) => {
    if (rt.isSub) return NaN;
    const a = A(f), b = Bv(f);
    const p2 = P2 ? P2(f) : undefined;
    const gradient = !!named.top_value || typeof p2 === 'number';
    rt.meta = meta;
    rt.transp = T ? T(f) : undefined;
    const r = reg(rt, 'fills', () => ({ kind: 'fill', a: ref(a), b: ref(b), gradient, title: named.title ? named.title(f) : 'Fill' }));
    if (gradient) {
      if (!r.tv) { r.tv = rt.newArr(); r.bv = rt.newArr(); }
      const tv = named.top_value ? named.top_value(f) : p2;
      const bv = named.bottom_value ? named.bottom_value(f) : pos[3] ? pos[3](f) : NaN;
      const tc = named.top_color ? named.top_color(f) : pos[4] ? pos[4](f) : undefined;
      const bc = named.bottom_color ? named.bottom_color(f) : pos[5] ? pos[5](f) : undefined;
      r.tv[rt.i] = num(tv); r.bv[rt.i] = num(bv);
      setColor(r, 'tcolors', rt.i, tc); setColor(r, 'bcolors', rt.i, bc);
    } else {
      const c = named.color ? named.color(f) : p2;
      setColor(r, 'colors', rt.i, applyTransp(rt, c === undefined ? '#2962ff33' : c));
    }
    return NaN;
  };
});
def('bgcolor', ['color', 'offset', 'editable', 'show_last', 'title', 'display', 'force_overlay'], (rt, s, color, offset) => {
  if (rt.isSub) return NaN;
  const r = reg(rt, 'bgcolors', () => ({ kind: 'bgcolor', offset: num(offset, 0) || 0 }));
  setColor(r, 'colors', rt.i, applyTransp(rt, color));
  return NaN;
});
def('barcolor', ['color', 'offset', 'editable', 'show_last', 'title', 'display'], (rt, s, color, offset) => {
  if (rt.isSub) return NaN;
  const r = reg(rt, 'barcolors', () => ({ kind: 'barcolor', offset: num(offset, 0) || 0 }));
  setColor(r, 'colors', rt.i, applyTransp(rt, color));
  return NaN;
});

Object.assign(K, {
  'plot.style_line': 'line', 'plot.style_linebr': 'linebr', 'plot.style_stepline': 'stepline', 'plot.style_stepline_diamond': 'stepline_diamond', 'plot.style_steplinebr': 'steplinebr',
  'plot.style_histogram': 'histogram', 'plot.style_cross': 'cross', 'plot.style_area': 'area', 'plot.style_areabr': 'areabr', 'plot.style_columns': 'columns', 'plot.style_circles': 'circles',
  'hline.style_solid': 'solid', 'hline.style_dotted': 'dotted', 'hline.style_dashed': 'dashed',
  'shape.xcross': 'xcross', 'shape.cross': 'cross', 'shape.triangleup': 'triangleup', 'shape.triangledown': 'triangledown', 'shape.flag': 'flag', 'shape.circle': 'circle',
  'shape.arrowup': 'arrowup', 'shape.arrowdown': 'arrowdown', 'shape.labelup': 'labelup', 'shape.labeldown': 'labeldown', 'shape.square': 'square', 'shape.diamond': 'diamond',
  'location.abovebar': 'abovebar', 'location.belowbar': 'belowbar', 'location.top': 'top', 'location.bottom': 'bottom', 'location.absolute': 'absolute',
  'size.auto': 'auto', 'size.tiny': 'tiny', 'size.small': 'small', 'size.normal': 'normal', 'size.large': 'large', 'size.huge': 'huge',
  'xloc.bar_index': 'bi', 'xloc.bar_time': 'bt', 'yloc.price': 'pr', 'yloc.abovebar': 'ab', 'yloc.belowbar': 'bl',
  'extend.none': 'n', 'extend.left': 'l', 'extend.right': 'r', 'extend.both': 'b',
  'line.style_solid': 'solid', 'line.style_dotted': 'dotted', 'line.style_dashed': 'dashed', 'line.style_arrow_left': 'arrow_left', 'line.style_arrow_right': 'arrow_right', 'line.style_arrow_both': 'arrow_both',
  'position.top_left': 'top_left', 'position.top_center': 'top_center', 'position.top_right': 'top_right', 'position.middle_left': 'middle_left', 'position.middle_center': 'middle_center',
  'position.middle_right': 'middle_right', 'position.bottom_left': 'bottom_left', 'position.bottom_center': 'bottom_center', 'position.bottom_right': 'bottom_right',
});
for (const st of ['none', 'xcross', 'cross', 'triangleup', 'triangledown', 'flag', 'circle', 'arrowup', 'arrowdown', 'label_up', 'label_down', 'label_left', 'label_right', 'label_lower_left', 'label_lower_right', 'label_upper_left', 'label_upper_right', 'label_center', 'square', 'diamond', 'text_outline']) K['label.style_' + st] = st;

// ---------------------------------------------------------------- drawing objects
const LIMITS = { label: 'max_labels_count', line: 'max_lines_count', box: 'max_boxes_count', polyline: 'max_polylines_count' };
function track(rt, kind, o) {
  const list = rt.S.objs[kind];
  o.oid = ++rt.S.oid;
  list.push(o);
  const lim = LIMITS[kind] ? Math.min(500, num(rt.decl.args[LIMITS[kind]], 50) || 50) : (kind === 'table' ? 100 : 5000);
  while (list.length > lim) { const x = list.shift(); x.deleted = true; }
  return o;
}
function untrack(rt, o) {
  if (!o || typeof o !== 'object' || o.deleted) return NaN;
  const list = rt.S.objs[o.__k];
  if (list) { const k = list.indexOf(o); if (k >= 0) list.splice(k, 1); }
  o.deleted = true;
  return NaN;
}
const isPoint = (x) => x && typeof x === 'object' && x.__k === 'chart.point';
function ptX(p, xloc) { return xloc === 'bt' ? p.time : p.index; }
function obj(x, kind) { return x && typeof x === 'object' && x.__k === kind ? x : null; }
function setter(kind, field, conv) {
  return (rt, s, o, v) => { const x = obj(o, kind); if (x) x[field] = conv ? conv(v) : v; return NaN; };
}
function getter(kind, field) { return (rt, s, o) => { const x = obj(o, kind); return x ? x[field] : NaN; }; }

// label
const LABEL_P = ['x', 'y', 'text', 'xloc', 'yloc', 'color', 'style', 'textcolor', 'size', 'textalign', 'tooltip', 'text_font_family', 'force_overlay', 'text_formatting'];
def('label.new', LABEL_P, (rt, s, x, y, text, xloc, yloc, color, style, textcolor, size, textalign, tooltip, font) => {
  if (isPoint(x)) { // label.new(point, text, xloc, yloc, color, style, textcolor, size, textalign, tooltip, font)
    const p = x; [text, xloc, yloc, color, style, textcolor, size, textalign, tooltip, font] = [y, text, xloc, yloc, color, style, textcolor, size, textalign, tooltip];
    xloc = xloc || 'bi'; x = ptX(p, xloc); y = p.price;
  }
  return track(rt, 'label', { __k: 'label', x: num(x), y: num(y), text: text ?? '', xloc: xloc || 'bi', yloc: yloc || 'pr', color: color === undefined ? '#2962ffff' : color, style: style || 'label_down', textcolor: textcolor === undefined ? '#ffffffff' : textcolor, size: size || 'normal', textalign: textalign || 'center', tooltip: tooltip ?? '', font: font || 'default' });
});
def('label.delete', ['id'], (rt, s, o) => untrack(rt, obj(o, 'label')));
def('label.copy', ['id'], (rt, s, o) => { const x = obj(o, 'label'); return x ? track(rt, 'label', { ...x, deleted: false }) : NaN; });
for (const [f, k] of [['x', 'x'], ['y', 'y'], ['text', 'text'], ['color', 'color'], ['style', 'style'], ['textcolor', 'textcolor'], ['size', 'size'], ['textalign', 'textalign'], ['tooltip', 'tooltip'], ['xloc', 'xloc'], ['yloc', 'yloc'], ['text_font_family', 'font']]) def('label.set_' + f, ['id', f], setter('label', k));
def('label.set_xy', ['id', 'x', 'y'], (rt, s, o, x, y) => { const l = obj(o, 'label'); if (l) { l.x = num(x); l.y = num(y); } return NaN; });
def('label.set_xloc', ['id', 'x', 'xloc'], (rt, s, o, x, xl) => { const l = obj(o, 'label'); if (l) { l.x = num(x); l.xloc = xl; } return NaN; });
def('label.set_point', ['id', 'point'], (rt, s, o, p) => { const l = obj(o, 'label'); if (l && isPoint(p)) { l.x = ptX(p, l.xloc); l.y = p.price; } return NaN; });
for (const f of ['x', 'y', 'text']) def('label.get_' + f, ['id'], getter('label', f));

// line
const LINE_P = ['x1', 'y1', 'x2', 'y2', 'xloc', 'extend', 'color', 'style', 'width', 'force_overlay'];
def('line.new', LINE_P, (rt, s, x1, y1, x2, y2, xloc, extend, color, style, width) => {
  if (isPoint(x1)) { const p1 = x1, p2 = y1; [xloc, extend, color, style, width] = [x2, y2, xloc, extend, color]; xloc = xloc || 'bi'; x1 = ptX(p1, xloc); y1 = p1.price; x2 = ptX(p2, xloc); y2 = p2.price; }
  return track(rt, 'line', { __k: 'line', x1: num(x1), y1: num(y1), x2: num(x2), y2: num(y2), xloc: xloc || 'bi', extend: extend || 'n', color: color === undefined ? '#2962ffff' : color, style: style || 'solid', width: num(width, 1) || 1 });
});
def('line.delete', ['id'], (rt, s, o) => untrack(rt, obj(o, 'line')));
def('line.copy', ['id'], (rt, s, o) => { const x = obj(o, 'line'); return x ? track(rt, 'line', { ...x, deleted: false }) : NaN; });
for (const f of ['x1', 'y1', 'x2', 'y2', 'color', 'style', 'width', 'extend']) def('line.set_' + f, ['id', f], setter('line', f));
def('line.set_xy1', ['id', 'x', 'y'], (rt, s, o, x, y) => { const l = obj(o, 'line'); if (l) { l.x1 = num(x); l.y1 = num(y); } return NaN; });
def('line.set_xy2', ['id', 'x', 'y'], (rt, s, o, x, y) => { const l = obj(o, 'line'); if (l) { l.x2 = num(x); l.y2 = num(y); } return NaN; });
def('line.set_xloc', ['id', 'x1', 'x2', 'xloc'], (rt, s, o, a, b, xl) => { const l = obj(o, 'line'); if (l) { l.x1 = num(a); l.x2 = num(b); l.xloc = xl; } return NaN; });
def('line.set_first_point', ['id', 'point'], (rt, s, o, p) => { const l = obj(o, 'line'); if (l && isPoint(p)) { l.x1 = ptX(p, l.xloc); l.y1 = p.price; } return NaN; });
def('line.set_second_point', ['id', 'point'], (rt, s, o, p) => { const l = obj(o, 'line'); if (l && isPoint(p)) { l.x2 = ptX(p, l.xloc); l.y2 = p.price; } return NaN; });
for (const f of ['x1', 'y1', 'x2', 'y2']) def('line.get_' + f, ['id'], getter('line', f));
def('line.get_price', ['id', 'x'], (rt, s, o, x) => { const l = obj(o, 'line'); if (!l || l.x2 === l.x1) return l ? l.y1 : NaN; return l.y1 + (l.y2 - l.y1) * (num(x) - l.x1) / (l.x2 - l.x1); });

// box
const BOX_P = ['left', 'top', 'right', 'bottom', 'border_color', 'border_width', 'border_style', 'extend', 'xloc', 'bgcolor', 'text', 'text_size', 'text_color', 'text_halign', 'text_valign', 'text_wrap', 'text_font_family', 'force_overlay', 'text_formatting'];
def('box.new', BOX_P, (rt, s, left, top, right, bottom, bc, bw, bs, extend, xloc, bg, text, ts, tc, th, tv, tw, font) => {
  if (isPoint(left)) {
    const p1 = left, p2 = top;
    [bc, bw, bs, extend, xloc, bg, text, ts, tc, th, tv, tw, font] = [right, bottom, bc, bw, bs, extend, xloc, bg, text, ts, tc, th, tv];
    xloc = xloc || 'bi'; left = ptX(p1, xloc); top = p1.price; right = ptX(p2, xloc); bottom = p2.price;
  }
  return track(rt, 'box', { __k: 'box', left: num(left), top: num(top), right: num(right), bottom: num(bottom), border_color: bc === undefined ? '#2962ffff' : bc, border_width: num(bw, 1), border_style: bs || 'solid', extend: extend || 'n', xloc: xloc || 'bi', bgcolor: bg === undefined ? '#2962ff33' : bg, text: text ?? '', text_size: ts || 'auto', text_color: tc === undefined ? '#000000ff' : tc, text_halign: th || 'center', text_valign: tv || 'center', text_wrap: tw || 'none' });
});
def('box.delete', ['id'], (rt, s, o) => untrack(rt, obj(o, 'box')));
def('box.copy', ['id'], (rt, s, o) => { const x = obj(o, 'box'); return x ? track(rt, 'box', { ...x, deleted: false }) : NaN; });
for (const f of ['left', 'top', 'right', 'bottom', 'border_color', 'border_width', 'border_style', 'extend', 'bgcolor', 'text', 'text_size', 'text_color', 'text_halign', 'text_valign', 'text_wrap', 'text_font_family']) def('box.set_' + f, ['id', f], setter('box', f));
def('box.set_lefttop', ['id', 'left', 'top'], (rt, s, o, l, t) => { const b = obj(o, 'box'); if (b) { b.left = num(l); b.top = num(t); } return NaN; });
def('box.set_rightbottom', ['id', 'right', 'bottom'], (rt, s, o, r, bt) => { const b = obj(o, 'box'); if (b) { b.right = num(r); b.bottom = num(bt); } return NaN; });
def('box.set_top_left_point', ['id', 'point'], (rt, s, o, p) => { const b = obj(o, 'box'); if (b && isPoint(p)) { b.left = ptX(p, b.xloc); b.top = p.price; } return NaN; });
def('box.set_bottom_right_point', ['id', 'point'], (rt, s, o, p) => { const b = obj(o, 'box'); if (b && isPoint(p)) { b.right = ptX(p, b.xloc); b.bottom = p.price; } return NaN; });
def('box.set_xloc', ['id', 'left', 'right', 'xloc'], (rt, s, o, l, r, xl) => { const b = obj(o, 'box'); if (b) { b.left = num(l); b.right = num(r); b.xloc = xl; } return NaN; });
for (const f of ['left', 'top', 'right', 'bottom']) def('box.get_' + f, ['id'], getter('box', f));

// table
def('table.new', ['position', 'columns', 'rows', 'bgcolor', 'frame_color', 'frame_width', 'border_color', 'border_width', 'force_overlay'], (rt, s, pos, cols, rows, bg, fc, fw, bc, bw) => {
  return track(rt, 'table', { __k: 'table', position: pos || 'top_right', cols: num(cols, 1), rows: num(rows, 1), bgcolor: bg, frame_color: fc, frame_width: num(fw, 0), border_color: bc, border_width: num(bw, 0), cells: {}, merges: [] });
});
const CELL_P = ['table_id', 'column', 'row', 'text', 'width', 'height', 'text_color', 'text_halign', 'text_valign', 'text_size', 'bgcolor', 'tooltip', 'text_font_family', 'text_formatting'];
def('table.cell', CELL_P, (rt, s, t, c, r, text, w, h, tc, th, tv, ts, bg, tip, font) => {
  const tb = obj(t, 'table');
  if (!tb) return NaN;
  c = num(c); r = num(r);
  if (!(c >= 0 && c < tb.cols && r >= 0 && r < tb.rows)) throw new RuntimeErr(`خلية الجدول (${c}, ${r}) خارج حدود الجدول ${tb.cols}x${tb.rows}`);
  tb.cells[c + ',' + r] = { text: text ?? '', width: num(w, 0), height: num(h, 0), text_color: tc === undefined ? '#000000ff' : tc, text_halign: th || 'center', text_valign: tv || 'center', text_size: ts || 'normal', bgcolor: bg, tooltip: tip, font: font || 'default' };
  return NaN;
});
function cellSetter(field) {
  return (rt, s, t, c, r, v) => {
    const tb = obj(t, 'table'); if (!tb) return NaN;
    const k = num(c) + ',' + num(r);
    const cell = tb.cells[k] || (tb.cells[k] = { text: '', text_color: '#000000ff', text_halign: 'center', text_valign: 'center', text_size: 'normal' });
    cell[field] = v; return NaN;
  };
}
for (const f of ['text', 'bgcolor', 'text_color', 'text_size', 'text_halign', 'text_valign', 'width', 'height', 'tooltip', 'text_font_family', 'text_formatting']) def('table.cell_set_' + f, ['table_id', 'column', 'row', f], cellSetter(f === 'text_font_family' ? 'font' : f));
for (const f of ['position', 'bgcolor', 'frame_color', 'frame_width', 'border_color', 'border_width']) def('table.set_' + f, ['table_id', f], setter('table', f));
def('table.clear', ['table_id', 'start_column', 'start_row', 'end_column', 'end_row'], (rt, s, t, sc, sr, ec, er) => {
  const tb = obj(t, 'table'); if (!tb) return NaN;
  ec = ec === undefined ? sc : ec; er = er === undefined ? sr : er;
  for (let c = sc; c <= ec; c++) for (let r = sr; r <= er; r++) delete tb.cells[c + ',' + r];
  tb.merges = tb.merges.filter((m) => !(m[0] >= sc && m[0] <= ec && m[1] >= sr && m[1] <= er));
  return NaN;
});
def('table.merge_cells', ['table_id', 'start_column', 'start_row', 'end_column', 'end_row'], (rt, s, t, sc, sr, ec, er) => { const tb = obj(t, 'table'); if (tb) tb.merges.push([sc, sr, ec, er]); return NaN; });
def('table.delete', ['table_id'], (rt, s, t) => untrack(rt, obj(t, 'table')));

// linefill
def('linefill.new', ['line1', 'line2', 'color'], (rt, s, a, b, c) => {
  if (!obj(a, 'line') || !obj(b, 'line')) return NaN;
  // a linefill between the same two lines replaces the previous one
  const list = rt.S.objs.linefill;
  const ex = list.find((x) => x.line1 === a && x.line2 === b);
  if (ex) { ex.color = c; return ex; }
  return track(rt, 'linefill', { __k: 'linefill', line1: a, line2: b, color: c });
});
def('linefill.set_color', ['id', 'color'], setter('linefill', 'color'));
def('linefill.delete', ['id'], (rt, s, o) => untrack(rt, obj(o, 'linefill')));
def('linefill.get_line1', ['id'], getter('linefill', 'line1'));
def('linefill.get_line2', ['id'], getter('linefill', 'line2'));

// polyline
def('polyline.new', ['points', 'curved', 'closed', 'xloc', 'line_color', 'fill_color', 'line_style', 'line_width', 'force_overlay'], (rt, s, pts, curved, closed, xloc, lc, fc, ls, lw) => {
  xloc = xloc || 'bi';
  const p = Array.isArray(pts) ? pts.filter(isPoint).map((q) => [ptX(q, xloc), q.price]) : [];
  return track(rt, 'polyline', { __k: 'polyline', pts: p, curved: truthy(curved), closed: truthy(closed), xloc, line_color: lc === undefined ? '#2962ffff' : lc, fill_color: fc, line_style: ls || 'solid', line_width: num(lw, 1) || 1 });
});
def('polyline.delete', ['id'], (rt, s, o) => untrack(rt, obj(o, 'polyline')));

// *.all arrays (live objects)
for (const k of ['label', 'line', 'box', 'table', 'linefill', 'polyline']) defv(k + '.all', (rt) => rt.S.objs[k].slice());

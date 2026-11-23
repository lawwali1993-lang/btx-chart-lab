// Rendering of Pine Script outputs (plots, fills, shapes, labels, lines, boxes, tables, strategy markers)
import { colorAt } from '../pine/lib/draw.js';
import { css, withAlpha, dash, SIZE_PX, FONT_PX, roundRect, contrastText, lowerBound, fmtPrice, autoDigits } from './util.js';

const isNum = (v) => typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;

export function plotVal(ind, p, i) {
  const ri = i - ind.offset - (p.offset || 0);
  if (ri < 0 || ri >= p.values.length) return NaN;
  return p.values[ri];
}
function plotColor(ind, p, i, key = 'colors') {
  const ri = i - ind.offset - (p.offset || 0);
  return colorAt(p, key, ri);
}

/** x (pixel) for an object coordinate given xloc. */
export function objX(ch, ind, x, xloc) {
  if (xloc === 'bt') return ch.xOf(ch.indexOfTime(x));
  return ch.xOf(x + ind.offset);
}

// ---------------------------------------------------------------- background colors
export function drawBg(ch, ctx, pane, ind) {
  for (const bg of ind.res.out.bgcolors) {
    const sp = ch.spacing;
    let runC = null, runX0 = 0, runX1 = 0;
    const flush = () => { if (runC) { ctx.fillStyle = runC; ctx.fillRect(runX0, pane.top, runX1 - runX0, pane.h); } };
    for (let i = ch.i0; i <= ch.i1; i++) {
      const ri = i - ind.offset - (bg.offset || 0);
      if (ri < 0 || ri >= ind.res.n) { flush(); runC = null; continue; }
      const c = css(colorAt(bg, 'colors', ri));
      const x = ch.xOf(i);
      if (c && c === runC && Math.abs(x - sp / 2 - runX1) < 1) runX1 = x + sp / 2;
      else { flush(); runC = c; runX0 = x - sp / 2; runX1 = x + sp / 2; }
    }
    flush();
  }
}

// ---------------------------------------------------------------- fills
function refValues(ind, ref) {
  if (!ref) return null;
  if (ref.type === 'hline') { const h = ind.res.out.hlines.find((x) => x.id === ref.id); return h ? { hline: h } : null; }
  const p = ind.res.out.plots.find((x) => x.id === ref.id);
  return p ? { plot: p } : null;
}
export function drawFills(ch, ctx, pane, ind) {
  for (const fl of ind.res.out.fills) {
    if (ind.hidden && ind.hidden['fill' + fl.id]) continue;
    const A = refValues(ind, fl.a), B = refValues(ind, fl.b);
    if (!A || !B) continue;
    if (A.hline && B.hline) {
      const c = css(fl.colors0 !== undefined ? fl.colors0 : '#2962ff22');
      if (!c) continue;
      const y1 = ch.yOf(pane, A.hline.price), y2 = ch.yOf(pane, B.hline.price);
      ctx.fillStyle = c;
      ctx.fillRect(0, Math.min(y1, y2), ch.W, Math.abs(y2 - y1));
      continue;
    }
    const va = (i) => (A.plot ? plotVal(ind, A.plot, i) : A.hline.price);
    const vb = (i) => (B.plot ? plotVal(ind, B.plot, i) : B.hline.price);
    const offA = A.plot ? A.plot.offset || 0 : 0;
    for (let i = ch.i0; i <= ch.i1 + 1; i++) {
      const a0 = va(i - 1), b0 = vb(i - 1), a1 = va(i), b1 = vb(i);
      if (!isNum(a0) || !isNum(b0) || !isNum(a1) || !isNum(b1)) continue;
      const ri = i - ind.offset - offA;
      const x0 = ch.xOf(i - 1), x1 = ch.xOf(i);
      const ya0 = ch.yOf(pane, a0), yb0 = ch.yOf(pane, b0), ya1 = ch.yOf(pane, a1), yb1 = ch.yOf(pane, b1);
      if (fl.gradient) {
        const tv = fl.tv[ri], bv = fl.bv[ri];
        const tc = css(colorAt(fl, 'tcolors', ri)), bc = css(colorAt(fl, 'bcolors', ri));
        if (!isNum(tv) || !isNum(bv) || (!tc && !bc)) continue;
        const g = ctx.createLinearGradient(0, ch.yOf(pane, tv), 0, ch.yOf(pane, bv));
        g.addColorStop(0, tc || 'rgba(0,0,0,0)'); g.addColorStop(1, bc || 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
      } else {
        const c = css(colorAt(fl, 'colors', ri));
        if (!c) continue;
        ctx.fillStyle = c;
      }
      ctx.beginPath();
      ctx.moveTo(x0, ya0); ctx.lineTo(x1, ya1); ctx.lineTo(x1, yb1); ctx.lineTo(x0, yb0);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// ---------------------------------------------------------------- plots
export function drawPlots(ch, ctx, pane, ind) {
  const sp = ch.spacing;
  for (const p of ind.res.out.plots) {
    if (p.display === 'none' || (ind.hidden && ind.hidden[p.id])) continue;
    const st = p.style || 'line';
    const lw = Math.max(1, p.lineWidth || 1);
    const base = ch.yOf(pane, p.histbase || 0);
    if (st === 'histogram' || st === 'columns') {
      const w = st === 'columns' ? Math.max(1, Math.round(sp * 0.7)) : lw;
      for (let i = ch.i0; i <= ch.i1; i++) {
        const v = plotVal(ind, p, i);
        if (!isNum(v)) continue;
        const c = css(plotColor(ind, p, i));
        if (!c) continue;
        const x = ch.xOf(i), y = ch.yOf(pane, v);
        ctx.fillStyle = c;
        ctx.fillRect(Math.round(x - w / 2), Math.min(y, base), w, Math.max(1, Math.abs(base - y)));
      }
      continue;
    }
    if (st === 'circles' || st === 'cross') {
      const r = lw + 1.5;
      for (let i = ch.i0; i <= ch.i1; i++) {
        const v = plotVal(ind, p, i);
        if (!isNum(v)) continue;
        const c = css(plotColor(ind, p, i));
        if (!c) continue;
        const x = ch.xOf(i), y = ch.yOf(pane, v);
        if (st === 'circles') { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(x - r - 1, y); ctx.lineTo(x + r + 1, y); ctx.moveTo(x, y - r - 1); ctx.lineTo(x, y + r + 1); ctx.stroke(); }
      }
      continue;
    }
    const isArea = st === 'area' || st === 'areabr';
    const isStep = st.startsWith('stepline');
    const breaks = st === 'linebr' || st === 'areabr' || st === 'steplinebr';
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    let px = NaN, py = NaN;
    let path = null, pathColor = null;
    const flush = () => { if (path) { ctx.strokeStyle = pathColor; ctx.stroke(path); path = null; } };
    // areas: fill under segments first
    const lo = ch.i0 - 1, hi = ch.i1 + 1;
    // find previous valid point before view for continuity
    let startI = lo;
    if (!breaks) { for (let k = lo; k > lo - 2000 && k >= 0; k--) { if (isNum(plotVal(ind, p, k))) { startI = k; break; } } }
    for (let i = startI; i <= hi; i++) {
      const v = plotVal(ind, p, i);
      if (!isNum(v)) { if (breaks) { flush(); px = NaN; } continue; }
      const x = ch.xOf(i), y = ch.yOf(pane, v);
      const c = css(plotColor(ind, p, i));
      if (px === px && c) {
        if (isArea) {
          ctx.fillStyle = withAlpha(plotColor(ind, p, i), 0.25);
          ctx.beginPath();
          ctx.moveTo(px, py);
          if (isStep) ctx.lineTo(x, py);
          ctx.lineTo(x, y); ctx.lineTo(x, base); ctx.lineTo(px, base); ctx.closePath(); ctx.fill();
        }
        if (c !== pathColor) { flush(); }
        if (!path) { path = new Path2D(); path.moveTo(px, py); pathColor = c; }
        if (isStep) { path.lineTo(x, py); path.lineTo(x, y); } else path.lineTo(x, y);
      } else if (!c) flush();
      if (st === 'stepline_diamond' && c) { flush(); ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 4); ctx.lineTo(x - 4, y); ctx.closePath(); ctx.fill(); }
      px = x; py = y;
    }
    flush();
    if (p.trackprice) {
      const v = lastVisible(ind, p, ch);
      if (isNum(v)) { const y = ch.yOf(pane, v); ctx.strokeStyle = css(p.colors0) || '#888'; ctx.lineWidth = 1; dash(ctx, 'dotted'); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ch.W, y); ctx.stroke(); ctx.setLineDash([]); }
    }
  }
  // plotcandle / plotbar
  for (const cd of ind.res.out.candles) {
    if (cd.display === 'none') continue;
    const w = Math.max(1, Math.round(sp * 0.7));
    for (let i = ch.i0; i <= ch.i1; i++) {
      const ri = i - ind.offset;
      if (ri < 0 || ri >= ind.res.n) continue;
      const o = cd.o[ri], h = cd.h[ri], l = cd.l[ri], c = cd.c[ri];
      if (!isNum(o) || !isNum(c) || !isNum(h) || !isNum(l)) continue;
      const col = css(colorAt(cd, 'colors', ri)) || (c >= o ? ch.theme.up : ch.theme.down);
      const wick = css(colorAt(cd, 'wicks', ri)) || col;
      const x = Math.round(ch.xOf(i)) + 0.5;
      const yo = ch.yOf(pane, o), yc = ch.yOf(pane, c), yh = ch.yOf(pane, h), yl = ch.yOf(pane, l);
      ctx.strokeStyle = wick; ctx.lineWidth = 1;
      if (cd.kind === 'bar') {
        ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(x, yh); ctx.lineTo(x, yl); ctx.moveTo(x - w / 2, yo); ctx.lineTo(x, yo); ctx.moveTo(x, yc); ctx.lineTo(x + w / 2, yc); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(x, yh); ctx.lineTo(x, yl); ctx.stroke();
        ctx.fillStyle = col; ctx.fillRect(Math.round(x - w / 2), Math.min(yo, yc), w, Math.max(1, Math.abs(yc - yo)));
        const bc = css(colorAt(cd, 'borders', ri)); if (bc) { ctx.strokeStyle = bc; ctx.strokeRect(Math.round(x - w / 2) + 0.5, Math.min(yo, yc) + 0.5, w - 1, Math.max(1, Math.abs(yc - yo)) - 1); }
      }
    }
  }
}

export function lastVisible(ind, p, ch) {
  for (let i = Math.min(ch.i1, ch.n - 1); i >= ch.i0; i--) { const v = plotVal(ind, p, i); if (isNum(v)) return v; }
  return NaN;
}

export function drawHlines(ch, ctx, pane, ind) {
  for (const h of ind.res.out.hlines) {
    if (h.display === 'none' || !isNum(h.price) || (ind.hidden && ind.hidden[h.id])) continue;
    const c = css(h.color); if (!c) continue;
    const y = Math.round(ch.yOf(pane, h.price)) + 0.5;
    ctx.strokeStyle = c; ctx.lineWidth = h.lineWidth || 1;
    dash(ctx, h.style, 1);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ch.W, y); ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ---------------------------------------------------------------- shapes
export function drawShapeAt(ctx, style, x, y, s, color) {
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, s / 6);
  const h = s / 2;
  ctx.beginPath();
  switch (style) {
    case 'triangleup': ctx.moveTo(x, y - h); ctx.lineTo(x + h, y + h); ctx.lineTo(x - h, y + h); ctx.closePath(); ctx.fill(); break;
    case 'triangledown': ctx.moveTo(x, y + h); ctx.lineTo(x + h, y - h); ctx.lineTo(x - h, y - h); ctx.closePath(); ctx.fill(); break;
    case 'arrowup': ctx.moveTo(x, y - h); ctx.lineTo(x + h, y); ctx.lineTo(x + h / 3, y); ctx.lineTo(x + h / 3, y + h); ctx.lineTo(x - h / 3, y + h); ctx.lineTo(x - h / 3, y); ctx.lineTo(x - h, y); ctx.closePath(); ctx.fill(); break;
    case 'arrowdown': ctx.moveTo(x, y + h); ctx.lineTo(x + h, y); ctx.lineTo(x + h / 3, y); ctx.lineTo(x + h / 3, y - h); ctx.lineTo(x - h / 3, y - h); ctx.lineTo(x - h / 3, y); ctx.lineTo(x - h, y); ctx.closePath(); ctx.fill(); break;
    case 'circle': ctx.arc(x, y, h, 0, Math.PI * 2); ctx.fill(); break;
    case 'square': ctx.rect(x - h, y - h, s, s); ctx.fill(); break;
    case 'diamond': ctx.moveTo(x, y - h); ctx.lineTo(x + h, y); ctx.lineTo(x, y + h); ctx.lineTo(x - h, y); ctx.closePath(); ctx.fill(); break;
    case 'cross': ctx.moveTo(x - h, y); ctx.lineTo(x + h, y); ctx.moveTo(x, y - h); ctx.lineTo(x, y + h); ctx.stroke(); break;
    case 'xcross': ctx.moveTo(x - h, y - h); ctx.lineTo(x + h, y + h); ctx.moveTo(x + h, y - h); ctx.lineTo(x - h, y + h); ctx.stroke(); break;
    case 'flag': ctx.moveTo(x - h, y + h); ctx.lineTo(x - h, y - h); ctx.lineTo(x + h, y - h / 3); ctx.lineTo(x - h, y + h / 6); ctx.stroke(); ctx.fill(); break;
    default: ctx.arc(x, y, h, 0, Math.PI * 2); ctx.fill();
  }
}

function textLines(ctx, text, x, y, color, px, align = 'center', base = 'middle', outline = null) {
  const lines = String(text).split('\n');
  ctx.font = `${px}px -apple-system, Roboto, sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  const lh = px * 1.2;
  let y0 = base === 'top' ? y + lh / 2 : base === 'bottom' ? y - lh * (lines.length - 0.5) : y - (lh * (lines.length - 1)) / 2;
  for (const ln of lines) {
    if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = 3; ctx.strokeText(ln, x, y0); }
    ctx.fillStyle = color; ctx.fillText(ln, x, y0); y0 += lh;
  }
}

export function drawShapes(ch, ctx, pane, ind, bars) {
  const isMain = pane.id === 'main';
  for (const sh of ind.res.out.shapes) {
    if (sh.display === 'none' || (ind.hidden && ind.hidden[sh.id])) continue;
    const s = SIZE_PX[sh.size] || 10;
    let maxAbs = 0;
    if (sh.kind === 'arrow') for (let i = ch.i0; i <= ch.i1; i++) { const v = plotVal(ind, sh, i); if (isNum(v)) maxAbs = Math.max(maxAbs, Math.abs(v)); }
    for (let i = ch.i0; i <= ch.i1; i++) {
      const v = plotVal(ind, sh, i);
      if (!isNum(v)) continue;
      const ri = i - ind.offset - (sh.offset || 0);
      const c = css(colorAt(sh, 'colors', ri));
      if (!c) continue;
      const x = ch.xOf(i);
      if (sh.kind === 'arrow') {
        const hgt = sh.minh + (sh.maxh - sh.minh) * (maxAbs ? Math.abs(v) / maxAbs : 1);
        const up = v > 0;
        const yb = isMain && i < bars.length ? (up ? ch.yOf(pane, bars.l[i]) + 4 : ch.yOf(pane, bars.h[i]) - 4) : (up ? pane.top + pane.h - 4 : pane.top + 4);
        ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 2;
        const tip = up ? yb : yb;
        const tail = up ? yb + hgt * 0.5 : yb - hgt * 0.5;
        ctx.beginPath(); ctx.moveTo(x, tail); ctx.lineTo(x, tip); ctx.stroke();
        drawShapeAt(ctx, up ? 'triangleup' : 'triangledown', x, up ? tip + 3 : tip - 3, 7, c);
        continue;
      }
      let loc = sh.location;
      if (!isMain && (loc === 'abovebar' || loc === 'belowbar')) loc = loc === 'abovebar' ? 'top' : 'bottom';
      let y;
      const gap = 4 + s / 2;
      if (loc === 'abovebar') y = ch.yOf(pane, bars.h[i]) - gap;
      else if (loc === 'belowbar') y = ch.yOf(pane, bars.l[i]) + gap;
      else if (loc === 'top') y = pane.top + gap;
      else if (loc === 'bottom') y = pane.top + pane.h - gap;
      else y = ch.yOf(pane, v);
      const text = (sh.texts && sh.texts[ri]) ?? sh.text;
      const tc = css(colorAt(sh, 'textcolors', ri)) || c;
      const fpx = 10;
      if (sh.kind === 'char') {
        textLines(ctx, sh.char, x, y, c, Math.max(10, s + 2));
        if (text) textLines(ctx, text, x, loc === 'belowbar' || loc === 'bottom' ? y + s : y - s, tc, fpx, 'center', loc === 'belowbar' || loc === 'bottom' ? 'top' : 'bottom');
        continue;
      }
      if (sh.style === 'labelup' || sh.style === 'labeldown') {
        drawBubble(ctx, sh.style === 'labelup' ? 'label_up' : 'label_down', x, sh.style === 'labelup' ? y - s / 2 : y + s / 2, text || '', c, css(colorAt(sh, 'textcolors', ri)) || contrastText(colorAt(sh, 'colors', ri)), fpx);
        continue;
      }
      drawShapeAt(ctx, sh.style, x, y, s, c);
      if (text) {
        const below = loc === 'belowbar' || loc === 'bottom' || (loc === 'absolute' && /up/.test(sh.style));
        textLines(ctx, text, x, below ? y + s / 2 + 3 : y - s / 2 - 3, tc, fpx, 'center', below ? 'top' : 'bottom');
      }
    }
  }
}

function drawBubble(ctx, style, x, y, text, bg, fg, px) {
  ctx.font = `${px}px -apple-system, Roboto, sans-serif`;
  const lines = String(text).split('\n');
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 10;
  const h = lines.length * px * 1.2 + 6;
  const t = 6; // pointer
  let bx, by;
  switch (style) {
    case 'label_up': bx = x - w / 2; by = y + t; break;
    case 'label_left': bx = x + t; by = y - h / 2; break;
    case 'label_right': bx = x - t - w; by = y - h / 2; break;
    case 'label_center': bx = x - w / 2; by = y - h / 2; break;
    case 'label_lower_left': bx = x + t / 2; by = y + t / 2; break;
    case 'label_lower_right': bx = x - w - t / 2; by = y + t / 2; break;
    case 'label_upper_left': bx = x + t / 2; by = y - h - t / 2; break;
    case 'label_upper_right': bx = x - w - t / 2; by = y - h - t / 2; break;
    default: bx = x - w / 2; by = y - t - h; // label_down
  }
  ctx.fillStyle = bg;
  roundRect(ctx, bx, by, w, h, 3); ctx.fill();
  ctx.beginPath();
  if (style === 'label_up') { ctx.moveTo(x, y); ctx.lineTo(x - t, y + t + 0.5); ctx.lineTo(x + t, y + t + 0.5); }
  else if (style === 'label_left') { ctx.moveTo(x, y); ctx.lineTo(x + t + 0.5, y - t); ctx.lineTo(x + t + 0.5, y + t); }
  else if (style === 'label_right') { ctx.moveTo(x, y); ctx.lineTo(x - t - 0.5, y - t); ctx.lineTo(x - t - 0.5, y + t); }
  else if (style === 'label_down') { ctx.moveTo(x, y); ctx.lineTo(x - t, y - t - 0.5); ctx.lineTo(x + t, y - t - 0.5); }
  ctx.closePath(); ctx.fill();
  if (text) textLines(ctx, text, bx + w / 2, by + h / 2, fg, px);
}

// ---------------------------------------------------------------- drawing objects
function lineEnds(ch, x1, y1, x2, y2, ext) {
  if (!ext || ext === 'n' || (x1 === x2 && y1 === y2)) return [x1, y1, x2, y2];
  const dx = x2 - x1, dy = y2 - y1;
  const big = 1e5;
  let a = [x1, y1], b = [x2, y2];
  if (dx === 0) { if (ext === 'r' || ext === 'b') b = [x2, dy >= 0 ? y2 + big : y2 - big]; if (ext === 'l' || ext === 'b') a = [x1, dy >= 0 ? y1 - big : y1 + big]; return [...a, ...b]; }
  const k = big / Math.abs(dx);
  if (ext === 'r' || ext === 'b') b = [x2 + dx * k, y2 + dy * k];
  if (ext === 'l' || ext === 'b') a = [x1 - dx * k, y1 - dy * k];
  return [...a, ...b];
}

function arrowHead(ctx, x1, y1, x2, y2, size) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(ang - 0.4), y2 - size * Math.sin(ang - 0.4));
  ctx.lineTo(x2 - size * Math.cos(ang + 0.4), y2 - size * Math.sin(ang + 0.4));
  ctx.closePath(); ctx.fill();
}

export function drawObjects(ch, ctx, pane, ind, bars) {
  const o = ind.res.objs;
  if (!o) return;
  // boxes
  for (const b of o.box) {
    if (b.deleted) continue;
    let x1 = objX(ch, ind, b.left, b.xloc), x2 = objX(ch, ind, b.right, b.xloc);
    if (b.extend === 'l' || b.extend === 'b') x1 = -10;
    if (b.extend === 'r' || b.extend === 'b') x2 = ch.W + 10;
    const y1 = ch.yOf(pane, b.top), y2 = ch.yOf(pane, b.bottom);
    if (!isNum(x1) || !isNum(x2) || !isNum(y1) || !isNum(y2)) continue;
    const L = Math.min(x1, x2), T = Math.min(y1, y2), W = Math.abs(x2 - x1), H = Math.abs(y2 - y1);
    if (L > ch.W || L + W < 0) continue;
    const bg = css(b.bgcolor); if (bg) { ctx.fillStyle = bg; ctx.fillRect(L, T, W, H); }
    const bc = css(b.border_color);
    if (bc && b.border_width > 0) { ctx.strokeStyle = bc; ctx.lineWidth = b.border_width; dash(ctx, b.border_style); ctx.strokeRect(L, T, W, H); ctx.setLineDash([]); }
    if (b.text) {
      const px = FONT_PX[b.text_size] || 11;
      const ha = b.text_halign, va = b.text_valign;
      const tx = ha === 'left' ? L + 4 : ha === 'right' ? L + W - 4 : L + W / 2;
      const ty = va === 'top' ? T + 4 : va === 'bottom' ? T + H - 4 : T + H / 2;
      ctx.save(); ctx.beginPath(); ctx.rect(L, T, W, H); ctx.clip();
      textLines(ctx, b.text, tx, ty, css(b.text_color) || ch.theme.text, px, ha === 'left' ? 'left' : ha === 'right' ? 'right' : 'center', va === 'top' ? 'top' : va === 'bottom' ? 'bottom' : 'middle');
      ctx.restore();
    }
  }
  // linefills
  for (const lf of o.linefill) {
    if (lf.deleted || !lf.line1 || !lf.line2 || lf.line1.deleted || lf.line2.deleted) continue;
    const c = css(lf.color); if (!c) continue;
    const p = (ln) => lineEnds(ch, objX(ch, ind, ln.x1, ln.xloc), ch.yOf(pane, ln.y1), objX(ch, ind, ln.x2, ln.xloc), ch.yOf(pane, ln.y2), ln.extend);
    const a = p(lf.line1), b = p(lf.line2);
    ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[2], a[3]); ctx.lineTo(b[2], b[3]); ctx.lineTo(b[0], b[1]); ctx.closePath(); ctx.fill();
  }
  // lines
  for (const ln of o.line) {
    if (ln.deleted) continue;
    const c = css(ln.color); if (!c) continue;
    const x1 = objX(ch, ind, ln.x1, ln.xloc), x2 = objX(ch, ind, ln.x2, ln.xloc);
    const y1 = ch.yOf(pane, ln.y1), y2 = ch.yOf(pane, ln.y2);
    if (![x1, x2, y1, y2].every(isNum)) continue;
    const e = lineEnds(ch, x1, y1, x2, y2, ln.extend);
    ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = ln.width || 1;
    dash(ctx, ln.style);
    ctx.beginPath(); ctx.moveTo(e[0], e[1]); ctx.lineTo(e[2], e[3]); ctx.stroke(); ctx.setLineDash([]);
    if (ln.style === 'arrow_right' || ln.style === 'arrow_both') arrowHead(ctx, x1, y1, x2, y2, 6 + ln.width * 2);
    if (ln.style === 'arrow_left' || ln.style === 'arrow_both') arrowHead(ctx, x2, y2, x1, y1, 6 + ln.width * 2);
  }
  // polylines
  for (const pl of o.polyline) {
    if (pl.deleted || pl.pts.length < 2) continue;
    const pts = pl.pts.map(([x, y]) => [objX(ch, ind, x, pl.xloc), ch.yOf(pane, y)]).filter((q) => isNum(q[0]) && isNum(q[1]));
    if (pts.length < 2) continue;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    if (pl.curved) { for (let k = 1; k < pts.length - 1; k++) { const mx = (pts[k][0] + pts[k + 1][0]) / 2, my = (pts[k][1] + pts[k + 1][1]) / 2; ctx.quadraticCurveTo(pts[k][0], pts[k][1], mx, my); } ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); }
    else for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    if (pl.closed) ctx.closePath();
    const fc = css(pl.fill_color); if (fc) { ctx.fillStyle = fc; ctx.fill(); }
    const lc = css(pl.line_color); if (lc) { ctx.strokeStyle = lc; ctx.lineWidth = pl.line_width; dash(ctx, pl.line_style); ctx.stroke(); ctx.setLineDash([]); }
  }
  // labels
  for (const lb of o.label) {
    if (lb.deleted) continue;
    const x = objX(ch, ind, lb.x, lb.xloc);
    if (!isNum(x) || x < -200 || x > ch.W + 200) continue;
    let y;
    const bi = lb.xloc === 'bt' ? Math.round(ch.indexOfTime(lb.x)) : lb.x + ind.offset;
    if (lb.yloc === 'ab' && pane.id === 'main' && bi >= 0 && bi < bars.length) y = ch.yOf(pane, bars.h[bi]) - 3;
    else if (lb.yloc === 'bl' && pane.id === 'main' && bi >= 0 && bi < bars.length) y = ch.yOf(pane, bars.l[bi]) + 3;
    else y = ch.yOf(pane, lb.y);
    if (!isNum(y)) continue;
    const px = FONT_PX[lb.size] || 12;
    const bg = css(lb.color), fg = css(lb.textcolor) || '#ffffff';
    const st = lb.style;
    let style = st;
    if (lb.yloc === 'ab' && st === 'label_down') style = 'label_down';
    if (lb.yloc === 'bl' && st === 'label_down') style = 'label_up';
    if (st === 'none' || st === 'text_outline') { textLines(ctx, lb.text, x, y, fg, px, lb.textalign === 'left' ? 'left' : lb.textalign === 'right' ? 'right' : 'center', 'middle', st === 'text_outline' ? (bg || '#000') : null); continue; }
    if (st.startsWith('label_')) { if (bg) drawBubble(ctx, style, x, y, lb.text, bg, fg, px); else textLines(ctx, lb.text, x, y, fg, px); continue; }
    const s = SIZE_PX[lb.size] || 10;
    if (bg) drawShapeAt(ctx, st, x, y, s, bg);
    if (lb.text) { const below = /up/.test(st); textLines(ctx, lb.text, x, below ? y + s / 2 + 3 : y - s / 2 - 3, fg === '#ffffff' && ch.theme.name === 'light' ? ch.theme.text : fg, px, 'center', below ? 'top' : 'bottom'); }
  }
}

// ---------------------------------------------------------------- tables
export function drawTables(ch, ctx, pane, ind) {
  const o = ind.res.objs;
  if (!o) return;
  for (const t of o.table) {
    if (t.deleted) continue;
    const cols = t.cols, rows = t.rows;
    const cw = new Array(cols).fill(0), rh = new Array(rows).fill(0);
    const cell = (c, r) => t.cells[c + ',' + r];
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      const x = cell(c, r);
      if (!x) continue;
      const px = FONT_PX[x.text_size] || 11;
      ctx.font = `${px}px -apple-system, Roboto, sans-serif`;
      const lines = String(x.text).split('\n');
      const w = Math.max(0, ...lines.map((l) => ctx.measureText(l).width)) + 10;
      const h = lines.length * px * 1.25 + 6;
      const minW = x.width > 0 ? x.width / 100 * ch.W : 0, minH = x.height > 0 ? x.height / 100 * pane.h : 0;
      cw[c] = Math.max(cw[c], w, minW); rh[r] = Math.max(rh[r], h, minH);
    }
    const W = cw.reduce((a, b) => a + b, 0), H = rh.reduce((a, b) => a + b, 0);
    if (W === 0 || H === 0) continue;
    const m = 8;
    const pos = t.position || 'top_right';
    const X = pos.endsWith('left') ? m : pos.endsWith('center') ? (ch.W - W) / 2 : ch.W - W - m;
    const Y = pos.startsWith('top') ? pane.top + m + (pane.id === 'main' ? 22 : 18) : pos.startsWith('middle') ? pane.top + (pane.h - H) / 2 : pane.top + pane.h - H - m;
    const bg = css(t.bgcolor); if (bg) { ctx.fillStyle = bg; ctx.fillRect(X, Y, W, H); }
    const merged = new Map();
    for (const [sc, sr, ec, er] of t.merges) merged.set(sc + ',' + sr, [ec, er]);
    const skip = new Set();
    for (const [sc, sr, ec, er] of t.merges) for (let c = sc; c <= ec; c++) for (let r = sr; r <= er; r++) if (c !== sc || r !== sr) skip.add(c + ',' + r);
    let y = Y;
    for (let r = 0; r < rows; r++) {
      let x = X;
      for (let c = 0; c < cols; c++) {
        const key = c + ',' + r;
        const cl = cell(c, r);
        let w = cw[c], h = rh[r];
        const mg = merged.get(key);
        if (mg) { w = 0; for (let k = c; k <= mg[0]; k++) w += cw[k]; h = 0; for (let k = r; k <= mg[1]; k++) h += rh[k]; }
        if (!skip.has(key) && cl) {
          const cb = css(cl.bgcolor); if (cb) { ctx.fillStyle = cb; ctx.fillRect(x, y, w, h); }
          if (t.border_width > 0 && css(t.border_color)) { ctx.strokeStyle = css(t.border_color); ctx.lineWidth = t.border_width; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
          const px = FONT_PX[cl.text_size] || 11;
          const ha = cl.text_halign, va = cl.text_valign;
          textLines(ctx, cl.text, ha === 'left' ? x + 5 : ha === 'right' ? x + w - 5 : x + w / 2, va === 'top' ? y + 3 : va === 'bottom' ? y + h - 3 : y + h / 2, css(cl.text_color) || ch.theme.text, px, ha === 'left' ? 'left' : ha === 'right' ? 'right' : 'center', va === 'top' ? 'top' : va === 'bottom' ? 'bottom' : 'middle');
        }
        x += cw[c];
      }
      y += rh[r];
    }
    if (t.frame_width > 0 && css(t.frame_color)) { ctx.strokeStyle = css(t.frame_color); ctx.lineWidth = t.frame_width; ctx.strokeRect(X, Y, W, H); }
  }
}

// ---------------------------------------------------------------- strategy markers
export function drawStrategy(ch, ctx, pane, ind, bars) {
  const B = ind.res.broker;
  if (!B || !B.events || ind.hideTrades) return;
  const ev = B.events;
  // events are sorted by bar; find visible range
  let k = lowerBound(ev.map((e) => e.bar), ch.i0 - ind.offset - 1);
  const stack = new Map();
  ctx.font = '10px -apple-system, Roboto, sans-serif';
  ctx.textAlign = 'center';
  for (; k < ev.length; k++) {
    const e = ev[k];
    const i = e.bar + ind.offset;
    if (i > ch.i1) break;
    if (i < ch.i0) continue;
    const x = ch.xOf(i);
    const buy = (e.type === 'entry' && e.dir === 1) || (e.type === 'exit' && e.dir === -1);
    const col = e.type === 'entry' ? (e.dir === 1 ? '#2962ff' : '#f23645') : '#e040fb';
    const sk = i + (buy ? 'b' : 's');
    const n = stack.get(sk) || 0; stack.set(sk, n + 1);
    const yP = ch.yOf(pane, e.price);
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x - 5, yP); ctx.lineTo(x + 5, yP); ctx.stroke();
    if (buy) {
      const y = ch.yOf(pane, bars.l[i]) + 10 + n * 26;
      drawShapeAt(ctx, 'arrowup', x, y, 10, col);
      ctx.fillStyle = col; ctx.textBaseline = 'top';
      ctx.fillText((e.comment || e.id) + (e.qty ? ' +' + round(e.qty) : ''), x, y + 7);
    } else {
      const y = ch.yOf(pane, bars.h[i]) - 10 - n * 26;
      drawShapeAt(ctx, 'arrowdown', x, y, 10, col);
      ctx.fillStyle = col; ctx.textBaseline = 'bottom';
      ctx.fillText((e.comment || e.id) + (e.qty ? ' -' + round(e.qty) : ''), x, y - 7);
    }
  }
}
const round = (x) => Math.round(x * 10000) / 10000;

// ---------------------------------------------------------------- value range for autoscale
export function indicatorRange(ch, ind, pane, out) {
  let lo = out[0], hi = out[1];
  const upd = (v) => { if (isNum(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
  for (const p of ind.res.out.plots) {
    if (p.display === 'none' || (ind.hidden && ind.hidden[p.id])) continue;
    for (let i = ch.i0; i <= ch.i1; i++) upd(plotVal(ind, p, i));
    if ((p.style === 'histogram' || p.style === 'columns' || p.style === 'area') && pane.id !== 'main') upd(p.histbase || 0);
  }
  if (pane.id !== 'main') {
    for (const h of ind.res.out.hlines) if (h.display !== 'none') upd(h.price);
    for (const cd of ind.res.out.candles) for (let i = ch.i0; i <= ch.i1; i++) { const ri = i - ind.offset; upd(cd.h[ri]); upd(cd.l[ri]); }
    for (const sh of ind.res.out.shapes) if (sh.location === 'absolute') for (let i = ch.i0; i <= ch.i1; i++) upd(plotVal(ind, sh, i));
  }
  out[0] = lo; out[1] = hi;
}

export function formatIndValue(ind, v, pane) {
  if (!isNum(v)) return '∅';
  const d = ind.res.decl;
  if (d && d.format === 'volume') { const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(2) + 'K' : v.toFixed(0); }
  const prec = d && isNum(d.precision) ? d.precision : pane && pane.id === 'main' ? pane.digits : autoDigits(Math.abs(v));
  return fmtPrice(v, prec);
}

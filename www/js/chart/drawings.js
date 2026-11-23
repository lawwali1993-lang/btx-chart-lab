// User drawing tools: model, rendering, hit-testing
import { fmtPrice, dash, roundRect } from './util.js';

export const TOOLS = {
  trend: { n: 2, name: 'خط اتجاه' },
  ray: { n: 2, name: 'شعاع' },
  extended: { n: 2, name: 'خط ممتد' },
  arrow: { n: 2, name: 'سهم' },
  hline: { n: 1, name: 'خط أفقي' },
  hray: { n: 1, name: 'شعاع أفقي' },
  vline: { n: 1, name: 'خط عمودي' },
  rect: { n: 2, name: 'مستطيل' },
  channel: { n: 3, name: 'قناة متوازية' },
  fib: { n: 2, name: 'فيبوناتشي' },
  long: { n: 1, name: 'مركز شراء' },
  short: { n: 1, name: 'مركز بيع' },
  measure: { n: 2, name: 'قياس' },
  text: { n: 1, name: 'نص' },
};
export const FIB_LEVELS = [
  [0, '#787b86'], [0.236, '#f23645'], [0.382, '#ff9800'], [0.5, '#4caf50'], [0.618, '#089981'], [0.786, '#00bcd4'], [1, '#787b86'], [1.618, '#2962ff'], [2.618, '#9c27b0'],
];
const DEF_COLOR = { trend: '#2962ff', ray: '#2962ff', extended: '#2962ff', arrow: '#ff9800', hline: '#ff9800', hray: '#ff9800', vline: '#9598a1', rect: '#9c27b0', channel: '#2962ff', fib: '#787b86', measure: '#2962ff', text: '#d1d4dc', long: '#089981', short: '#f23645' };

let uid = Date.now() % 100000;
export function createDrawing(type, pts, extra = {}) {
  return { id: 'd' + (++uid), type, pts: pts.map((q) => ({ t: q.t, p: q.p })), style: { color: DEF_COLOR[type] || '#2962ff', width: type === 'fib' ? 1 : 2, dash: 'solid', fill: true, text: '', size: 14, extend: false }, ...extra };
}

/** Called once a 1-point position tool is placed: build default stop/target/right edge. */
export function initPosition(d, ch, pane) {
  const p = d.pts[0].p;
  const range = (pane.vmax - pane.vmin) || p * 0.01;
  const dir = d.type === 'long' ? 1 : -1;
  d.stop = p - dir * range * 0.06;
  d.target = p + dir * range * 0.12;
  const i = ch.indexOfTime(d.pts[0].t);
  d.t2 = ch.timeOfIndex(i + Math.max(10, Math.round(60 / ch.spacing)));
}

function seg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L = dx * dx + dy * dy;
  let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx, y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}
function extendLine(x1, y1, x2, y2, left, right, W) {
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0) return [x1, y1, x2, y2];
  const k = dy / dx;
  let a = [x1, y1], b = [x2, y2];
  if (right) { const xe = dx > 0 ? W + 50 : -50; b = [xe, y1 + k * (xe - x1)]; }
  if (left) { const xs = dx > 0 ? -50 : W + 50; a = [xs, y1 + k * (xs - x1)]; }
  return [...a, ...b];
}

export function geom(ch, pane, d) {
  const P = d.pts.map((q) => [ch.xOf(ch.indexOfTime(q.t)), ch.yOf(pane, q.p)]);
  return P;
}

export function renderDrawing(ch, ctx, pane, d, selected, info) {
  if (d.hidden) return;
  const P = geom(ch, pane, d);
  const st = d.style;
  ctx.strokeStyle = st.color; ctx.fillStyle = st.color; ctx.lineWidth = st.width || 1;
  dash(ctx, st.dash);
  const W = ch.W;
  const handles = [];
  switch (d.type) {
    case 'trend': case 'ray': case 'extended': case 'arrow': {
      if (P.length < 2) break;
      const e = extendLine(P[0][0], P[0][1], P[1][0], P[1][1], d.type === 'extended', d.type === 'ray' || d.type === 'extended', W);
      ctx.beginPath(); ctx.moveTo(e[0], e[1]); ctx.lineTo(e[2], e[3]); ctx.stroke();
      if (d.type === 'arrow') {
        const ang = Math.atan2(P[1][1] - P[0][1], P[1][0] - P[0][0]); const s = 8 + st.width * 2;
        ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(P[1][0], P[1][1]); ctx.lineTo(P[1][0] - s * Math.cos(ang - 0.45), P[1][1] - s * Math.sin(ang - 0.45)); ctx.lineTo(P[1][0] - s * Math.cos(ang + 0.45), P[1][1] - s * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill();
      }
      handles.push(...P);
      break;
    }
    case 'hline': {
      const y = P[0][1];
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      tag(ctx, W - 4, y, fmtPrice(d.pts[0].p, info.digits), st.color, 'right');
      handles.push([Math.min(W - 40, Math.max(20, P[0][0])), y]);
      break;
    }
    case 'hray': {
      const [x, y] = P[0];
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(W, y); ctx.stroke();
      handles.push(P[0]);
      break;
    }
    case 'vline': {
      const x = P[0][0];
      ctx.beginPath(); ctx.moveTo(x, pane.top); ctx.lineTo(x, pane.top + pane.h); ctx.stroke();
      handles.push([x, pane.top + pane.h / 2]);
      break;
    }
    case 'rect': {
      if (P.length < 2) break;
      const x = Math.min(P[0][0], P[1][0]), y = Math.min(P[0][1], P[1][1]), w = Math.abs(P[1][0] - P[0][0]), h = Math.abs(P[1][1] - P[0][1]);
      if (st.fill) { ctx.globalAlpha = 0.18; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; }
      ctx.strokeRect(x, y, w, h);
      handles.push(P[0], P[1], [P[0][0], P[1][1]], [P[1][0], P[0][1]]);
      break;
    }
    case 'channel': {
      if (P.length < 2) break;
      const off = P.length > 2 ? P[2][1] - (P[0][1] + (P[1][1] - P[0][1]) * ((P[2][0] - P[0][0]) / ((P[1][0] - P[0][0]) || 1))) : 0;
      ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); ctx.lineTo(P[1][0], P[1][1]); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1] + off); ctx.lineTo(P[1][0], P[1][1] + off); ctx.stroke();
      ctx.setLineDash([4, 4]); ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1] + off / 2); ctx.lineTo(P[1][0], P[1][1] + off / 2); ctx.stroke();
      ctx.globalAlpha = 0.12; ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); ctx.lineTo(P[1][0], P[1][1]); ctx.lineTo(P[1][0], P[1][1] + off); ctx.lineTo(P[0][0], P[0][1] + off); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
      handles.push(P[0], P[1]); if (P[2]) handles.push([(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2 + off]);
      break;
    }
    case 'fib': {
      if (P.length < 2) break;
      const p1 = d.pts[0].p, p2 = d.pts[1].p;
      const x1 = Math.min(P[0][0], P[1][0]), x2 = st.extend ? W : Math.max(P[0][0], P[1][0]);
      ctx.setLineDash([]);
      ctx.font = '10px -apple-system, Roboto, sans-serif';
      let prevY = null;
      for (const [lv, col] of FIB_LEVELS) {
        const price = p2 + (p1 - p2) * lv;
        const y = ch.yOf(pane, price);
        if (prevY !== null) { ctx.fillStyle = col; ctx.globalAlpha = 0.08; ctx.fillRect(x1, Math.min(y, prevY), x2 - x1, Math.abs(y - prevY)); ctx.globalAlpha = 1; }
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
        ctx.fillStyle = col; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillText(`${lv} (${fmtPrice(price, info.digits)})`, x1 - 3 < 60 ? x1 + 90 : x1 - 3, y - 1);
        prevY = y;
      }
      ctx.strokeStyle = '#787b86'; dash(ctx, 'dashed'); ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); ctx.lineTo(P[1][0], P[1][1]); ctx.stroke(); ctx.setLineDash([]);
      handles.push(P[0], P[1]);
      break;
    }
    case 'measure': {
      if (P.length < 2) break;
      const dp = d.pts[1].p - d.pts[0].p;
      const col = dp >= 0 ? '#2962ff' : '#f23645';
      const x = Math.min(P[0][0], P[1][0]), y = Math.min(P[0][1], P[1][1]), w = Math.abs(P[1][0] - P[0][0]), h = Math.abs(P[1][1] - P[0][1]);
      ctx.fillStyle = col; ctx.globalAlpha = 0.15; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(P[0][0], (P[0][1] + P[1][1]) / 2); ctx.lineTo(P[1][0], (P[0][1] + P[1][1]) / 2); ctx.moveTo((P[0][0] + P[1][0]) / 2, P[0][1]); ctx.lineTo((P[0][0] + P[1][0]) / 2, P[1][1]); ctx.stroke();
      const bars = Math.round(ch.indexOfTime(d.pts[1].t) - ch.indexOfTime(d.pts[0].t));
      const mins = Math.round((d.pts[1].t - d.pts[0].t) / 60000);
      const pct = dp / d.pts[0].p * 100;
      const pts = Math.round(dp / info.point);
      const span = Math.abs(mins) >= 1440 ? (mins / 1440).toFixed(1) + 'd' : Math.abs(mins) >= 60 ? Math.floor(mins / 60) + 'h ' + Math.abs(mins % 60) + 'm' : mins + 'm';
      const money = info.lots ? ` · ${(dp * info.lots * info.contract).toFixed(2)}$ @${info.lots}lot` : '';
      const txt = `${dp >= 0 ? '+' : ''}${fmtPrice(dp, info.digits)} (${pct.toFixed(2)}%) ${pts} pts\n${bars} bars, ${span}${money}`;
      label(ctx, (P[0][0] + P[1][0]) / 2, dp >= 0 ? y - 6 : y + h + 6, txt, col, dp >= 0 ? 'bottom' : 'top');
      handles.push(P[0], P[1]);
      break;
    }
    case 'text': {
      ctx.font = `${st.size || 14}px -apple-system, Roboto, sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const lines = String(st.text || 'Text').split('\n');
      lines.forEach((ln, k) => ctx.fillText(ln, P[0][0], P[0][1] + k * (st.size || 14) * 1.2));
      handles.push(P[0]);
      break;
    }
    case 'long': case 'short': {
      const x1 = P[0][0], x2 = ch.xOf(ch.indexOfTime(d.t2));
      const ye = P[0][1], ys = ch.yOf(pane, d.stop), yt = ch.yOf(pane, d.target);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(8,153,129,0.2)'; ctx.fillRect(x1, Math.min(ye, yt), x2 - x1, Math.abs(yt - ye));
      ctx.fillStyle = 'rgba(242,54,69,0.2)'; ctx.fillRect(x1, Math.min(ye, ys), x2 - x1, Math.abs(ys - ye));
      ctx.strokeStyle = '#787b86'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x1, ye); ctx.lineTo(x2, ye); ctx.stroke();
      const e = d.pts[0].p;
      const tp = Math.abs(d.target - e), sl = Math.abs(d.stop - e);
      const rr = sl > 0 ? tp / sl : 0;
      const tpPts = Math.round(tp / info.point), slPts = Math.round(sl / info.point);
      const m = (pts) => (info.lots ? ` · ${(pts * info.point * info.lots * info.contract).toFixed(2)}$` : '');
      label(ctx, (x1 + x2) / 2, Math.min(ye, yt) - 4 + (d.type === 'short' ? Math.abs(yt - ye) + 8 : 0), `Target: ${fmtPrice(d.target, info.digits)} (${tpPts} pts${m(tpPts)})`, '#089981', d.type === 'long' ? 'bottom' : 'top');
      label(ctx, (x1 + x2) / 2, d.type === 'long' ? Math.max(ye, ys) + 4 : Math.min(ye, ys) - 4, `Stop: ${fmtPrice(d.stop, info.digits)} (${slPts} pts${m(slPts)})`, '#f23645', d.type === 'long' ? 'top' : 'bottom');
      label(ctx, (x1 + x2) / 2, ye, `R:R ${rr.toFixed(2)}${info.lots ? ' · ' + info.lots + ' lot' : ''}`, '#363a45', 'middle');
      handles.push([x1, ye], [x1, ys], [x1, yt], [x2, ye]);
      break;
    }
  }
  ctx.setLineDash([]);
  if (selected) {
    for (const [x, y] of handles) {
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#2962ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
  d._handles = handles;
}

function tag(ctx, x, y, text, color, align) {
  ctx.font = '11px -apple-system, Roboto, sans-serif';
  const w = ctx.measureText(text).width + 8;
  const bx = align === 'right' ? x - w : x;
  ctx.fillStyle = color; roundRect(ctx, bx, y - 9, w, 18, 3); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + w / 2, y);
}
function label(ctx, x, y, text, bg, vAlign) {
  ctx.font = '11px -apple-system, Roboto, sans-serif';
  const lines = text.split('\n');
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 10;
  const h = lines.length * 14 + 6;
  const by = vAlign === 'bottom' ? y - h : vAlign === 'top' ? y : y - h / 2;
  ctx.fillStyle = bg; roundRect(ctx, x - w / 2, by, w, h, 3); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((l, k) => ctx.fillText(l, x, by + 10 + k * 14));
}

/** Hit test: returns {k} for handle index, {body:true}, or null */
export function hitDrawing(ch, pane, d, x, y, tol = 14) {
  if (d.hidden) return null;
  const hs = d._handles || [];
  for (let k = 0; k < hs.length; k++) if (Math.hypot(hs[k][0] - x, hs[k][1] - y) <= tol + 4) return { k };
  const P = geom(ch, pane, d);
  const W = ch.W;
  switch (d.type) {
    case 'trend': case 'ray': case 'extended': case 'arrow': {
      if (P.length < 2) return null;
      const e = extendLine(P[0][0], P[0][1], P[1][0], P[1][1], d.type === 'extended', d.type === 'ray' || d.type === 'extended', W);
      return seg(x, y, e[0], e[1], e[2], e[3]) <= tol ? { body: true } : null;
    }
    case 'hline': return Math.abs(y - P[0][1]) <= tol ? { body: true } : null;
    case 'hray': return x >= P[0][0] - tol && Math.abs(y - P[0][1]) <= tol ? { body: true } : null;
    case 'vline': return Math.abs(x - P[0][0]) <= tol ? { body: true } : null;
    case 'rect': case 'measure': case 'fib': {
      if (P.length < 2) return null;
      const x1 = Math.min(P[0][0], P[1][0]) - tol, x2 = (d.type === 'fib' && d.style.extend ? W : Math.max(P[0][0], P[1][0])) + tol;
      const y1 = Math.min(P[0][1], P[1][1]) - tol, y2 = Math.max(P[0][1], P[1][1]) + tol;
      if (d.type === 'fib') { const pr = ch.priceOf(pane, y); const lo = Math.min(d.pts[0].p, d.pts[1].p), hi = Math.max(d.pts[0].p, d.pts[1].p); return x >= x1 && x <= x2 && pr >= lo - (hi - lo) * 1.7 && pr <= hi + (hi - lo) * 1.7 ? { body: true } : null; }
      return x >= x1 && x <= x2 && y >= y1 && y <= y2 ? { body: true } : null;
    }
    case 'channel': {
      if (P.length < 2) return null;
      return seg(x, y, P[0][0], P[0][1], P[1][0], P[1][1]) <= tol ? { body: true } : null;
    }
    case 'text': {
      const w = String(d.style.text || 'Text').length * (d.style.size || 14) * 0.6;
      return x >= P[0][0] - tol && x <= P[0][0] + w + tol && Math.abs(y - P[0][1]) <= (d.style.size || 14) ? { body: true } : null;
    }
    case 'long': case 'short': {
      const x1 = P[0][0], x2 = ch.xOf(ch.indexOfTime(d.t2));
      const ys = ch.yOf(pane, d.stop), yt = ch.yOf(pane, d.target);
      return x >= x1 - tol && x <= x2 + tol && y >= Math.min(ys, yt) - tol && y <= Math.max(ys, yt) + tol ? { body: true } : null;
    }
  }
  return null;
}

/** Move handle k of drawing to (t, p). */
export function moveHandle(d, k, t, p) {
  if (d.type === 'long' || d.type === 'short') {
    if (k === 0) { d.pts[0] = { t, p }; }
    else if (k === 1) d.stop = p;
    else if (k === 2) d.target = p;
    else if (k === 3) d.t2 = t;
    return;
  }
  if (d.type === 'rect' && k >= 2) {
    if (k === 2) { d.pts[0].t = t; d.pts[1].p = p; } else { d.pts[1].t = t; d.pts[0].p = p; }
    return;
  }
  if (d.type === 'channel' && k === 2) { d.pts[2] = { t, p }; return; }
  if (d.pts[k]) d.pts[k] = { t, p };
}
export function moveBy(d, dt, dp) {
  for (const q of d.pts) { q.t += dt; q.p += dp; }
  if (d.type === 'long' || d.type === 'short') { d.stop += dp; d.target += dp; d.t2 += dt; }
}

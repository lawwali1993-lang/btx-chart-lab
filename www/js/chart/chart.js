// Canvas chart engine: panes, scales, candles, indicators, drawings, trade lines, crosshair, touch gestures.
import { THEMES, css, niceStep, fmtPrice, autoDigits, fmtVol, fmtTime, dash, roundRect, lowerBound, contrastText } from './util.js';
import { drawBg, drawFills, drawPlots, drawHlines, drawShapes, drawObjects, drawTables, drawStrategy, indicatorRange, plotVal, formatIndValue } from './render-pine.js';
import { TOOLS, createDrawing, initPosition, renderDrawing, hitDrawing, moveHandle, moveBy } from './drawings.js';
import { heikinAshi } from '../data/aggregate.js';

const TIME_H = 26;
const SEP = 6;
const isNum = (v) => typeof v === 'number' && v === v && isFinite(v);

export class Chart {
  constructor(el, cb = {}) {
    this.el = el;
    this.cb = cb;
    el.classList.add('chart');
    this.cv = document.createElement('canvas'); this.cv.className = 'chart-base';
    this.ov = document.createElement('canvas'); this.ov.className = 'chart-overlay';
    this.legend = document.createElement('div'); this.legend.className = 'legends';
    this.goLast = document.createElement('button'); this.goLast.className = 'go-last hidden'; this.goLast.innerHTML = '&#x276F;&#x276F;'; this.goLast.title = 'آخر شمعة';
    this.goLast.onclick = () => { this.scrollToEnd(); };
    el.append(this.cv, this.ov, this.legend, this.goLast);
    this.ctx = this.cv.getContext('2d');
    this.octx = this.ov.getContext('2d');
    this.theme = THEMES.dark;
    this.opts = { chartType: 'candles', showVolume: true, grid: true, tzMin: 180, magnet: true, showLastPrice: true, logMain: false };
    this.bars = null; this.n = 0; this.sym = { digits: 2, point: 0.01, name: '' }; this.tfMs = 60000; this.tfLabel = '1m';
    this.spacing = 6; this.endIdx = 0;
    this.panes = [{ id: 'main', ratio: 3, auto: true, vmin: 0, vmax: 1 }];
    this.indicators = [];
    this.drawings = [];
    this.selected = null;
    this.trade = null;
    this.tool = null;
    this.cross = null;
    this.barColorFn = null;
    this.replayPick = false;
    this.pending = null; // drawing being created
    this.W = 100; this.H = 100; this.axisW = 60;
    this.dirty = true; this.odirty = true;
    this._raf = 0;
    this.setupEvents();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.resize();
  }

  // ------------------------------------------------------------------ data & view
  setTheme(name) { this.theme = THEMES[name] || THEMES.dark; this.invalidate(); }
  setOptions(o) { Object.assign(this.opts, o); this._ha = null; this.invalidate(); }
  setSymbol(sym, tfMs, tfLabel) { this.sym = sym; this.tfMs = tfMs; this.tfLabel = tfLabel; this.invalidate(); }

  /** bars: {t,o,h,l,c,v,length}. keepView: keep scroll position (relative to the end when following) */
  setBars(bars, keepView = false, partial = false) {
    const prevN = this.n;
    const wasAtEnd = this.n && this.endIdx >= this.n - 1 - 0.5;
    this.bars = bars; this.n = bars ? bars.length : 0; this.partial = partial;
    this._ha = null;
    if (!keepView || !prevN) {
      this.endIdx = this.n - 1 + Math.max(3, Math.round(40 / this.spacing));
    } else if (wasAtEnd && this.n > prevN) {
      this.endIdx += this.n - prevN;
    }
    this.clampView();
    this.invalidate();
  }

  setIndicators(list) {
    this.indicators = list;
    // panes: main + one pane per non-overlay indicator (order preserved)
    const old = new Map(this.panes.map((p) => [p.id, p]));
    const panes = [old.get('main') || { id: 'main', ratio: 3, auto: true }];
    for (const ind of list) {
      if (ind.paneId && ind.paneId !== 'main' && !panes.some((p) => p.id === ind.paneId)) {
        panes.push(old.get(ind.paneId) || { id: ind.paneId, ratio: 1, auto: true });
      }
    }
    this.panes = panes;
    this.buildLegends();
    this.invalidate();
  }
  setDrawings(list) { this.drawings = list; this.invalidate(); }
  setTrade(t) { this.trade = t; this.invalidate(); }
  setTool(t) { this.tool = t; this.pending = null; if (t) this.select(null); this.invalidate(); }
  select(d) { this.selected = d; if (this.cb.onSelectDrawing) this.cb.onSelectDrawing(d); this.invalidate(); }

  scrollToEnd() { this.endIdx = this.n - 1 + Math.max(3, Math.round(40 / this.spacing)); this.clampView(); this.invalidate(); }
  scrollToTime(t) { const i = this.indexOfTime(t); this.endIdx = i + this.W / this.spacing / 2; this.clampView(); this.invalidate(); }

  clampView() {
    const vis = this.W / this.spacing;
    const maxEnd = this.n - 1 + vis * 0.75;
    const minEnd = Math.min(vis * 0.25, this.n - 1);
    if (this.endIdx > maxEnd) this.endIdx = maxEnd;
    if (this.endIdx < minEnd) this.endIdx = minEnd;
  }

  // ------------------------------------------------------------------ coordinates
  xOf(i) { return this.W - (this.endIdx - i) * this.spacing - this.spacing / 2; }
  idxAt(x) { return this.endIdx - (this.W - this.spacing / 2 - x) / this.spacing; }
  barAt(x) { return Math.round(this.idxAt(x)); }
  indexOfTime(t) {
    const T = this.bars ? this.bars.t : null;
    const n = this.n;
    if (!n) return 0;
    if (t <= T[0]) return (t - T[0]) / this.tfMs;
    if (t >= T[n - 1]) return n - 1 + (t - T[n - 1]) / this.tfMs;
    let j = lowerBound(T, t, n);
    if (T[j] === t) return j;
    j--;
    return j + (t - T[j]) / Math.max(1, T[j + 1] - T[j]);
  }
  timeOfIndex(i) {
    const T = this.bars.t, n = this.n;
    if (!n) return 0;
    if (i <= 0) return T[0] + i * this.tfMs;
    if (i >= n - 1) return T[n - 1] + (i - (n - 1)) * this.tfMs;
    const j = Math.floor(i), f = i - j;
    return T[j] + f * (T[j + 1] - T[j]);
  }
  yOf(pane, p) {
    if (!isNum(p)) return NaN;
    if (pane.log && p > 0) { const a = Math.log(pane.vmin), b = Math.log(pane.vmax); return pane.top + pane.pad + (b - Math.log(p)) / (b - a) * (pane.h - 2 * pane.pad); }
    return pane.top + pane.pad + (pane.vmax - p) / (pane.vmax - pane.vmin) * (pane.h - 2 * pane.pad);
  }
  priceOf(pane, y) {
    const f = (y - pane.top - pane.pad) / (pane.h - 2 * pane.pad);
    if (pane.log) { const a = Math.log(pane.vmin), b = Math.log(pane.vmax); return Math.exp(b - f * (b - a)); }
    return pane.vmax - f * (pane.vmax - pane.vmin);
  }
  paneAt(y) { for (const p of this.panes) if (y >= p.top && y < p.top + p.h + SEP) return p; return this.panes[this.panes.length - 1]; }

  // ------------------------------------------------------------------ layout & scaling
  resize() {
    const r = this.el.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.CW = Math.max(50, Math.floor(r.width)); this.CH = Math.max(50, Math.floor(r.height));
    for (const c of [this.cv, this.ov]) { c.width = this.CW * dpr; c.height = this.CH * dpr; c.style.width = this.CW + 'px'; c.style.height = this.CH + 'px'; }
    this.invalidate();
  }
  layout() {
    const H = this.CH - TIME_H;
    const total = this.panes.reduce((s, p) => s + p.ratio, 0);
    let y = 0;
    this.panes.forEach((p, k) => {
      const h = Math.max(40, Math.floor((H - SEP * (this.panes.length - 1)) * p.ratio / total));
      p.top = y; p.h = k === this.panes.length - 1 ? Math.max(40, H - y) : h; p.pad = Math.max(6, Math.round(p.h * 0.06));
      y += p.h + SEP;
    });
    this.H = H;
  }
  computeVisible() {
    this.i0 = Math.max(0, Math.floor(this.idxAt(0)) - 1);
    this.i1 = Math.min(this.n - 1, Math.ceil(this.idxAt(this.W)) + 1);
  }
  displayBars() {
    if (this.opts.chartType === 'ha' && this.bars) { if (!this._ha || this._haSrc !== this.bars) { this._ha = heikinAshi(this.bars); this._haSrc = this.bars; } return this._ha; }
    return this.bars;
  }
  autoscale() {
    const b = this.displayBars();
    for (const pane of this.panes) {
      pane.log = pane.id === 'main' && this.opts.logMain;
      if (!pane.auto && isNum(pane.vmin) && isNum(pane.vmax) && pane.vmax > pane.vmin) continue;
      const r = [Infinity, -Infinity];
      if (pane.id === 'main' && b) {
        const lineOnly = this.opts.chartType === 'line' || this.opts.chartType === 'area';
        for (let i = this.i0; i <= this.i1; i++) {
          if (lineOnly) { const c = b.c[i]; if (c < r[0]) r[0] = c; if (c > r[1]) r[1] = c; }
          else { if (b.l[i] < r[0]) r[0] = b.l[i]; if (b.h[i] > r[1]) r[1] = b.h[i]; }
        }
      }
      for (const ind of this.indicators) if (ind.res && ind.visible !== false && (ind.paneId || 'main') === pane.id && ind.scale !== 'none') indicatorRange(this, ind, pane, r);
      if (!isFinite(r[0]) || !isFinite(r[1])) { r[0] = 0; r[1] = 1; }
      if (r[1] - r[0] < 1e-9) { const m = Math.abs(r[0]) * 0.001 || 0.5; r[0] -= m; r[1] += m; }
      pane.vmin = r[0]; pane.vmax = r[1];
      if (pane.log && pane.vmin <= 0) pane.log = false;
    }
  }

  // ------------------------------------------------------------------ render loop
  invalidate() { this.dirty = true; this.odirty = true; this.schedule(); }
  invalidateOverlay() { this.odirty = true; this.schedule(); }
  schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      if (this.dirty) { this.dirty = false; this.render(); }
      if (this.odirty) { this.odirty = false; this.renderOverlay(); this.updateLegends(); }
    });
  }

  measureAxis() {
    const ctx = this.ctx;
    ctx.font = '11px -apple-system, Roboto, sans-serif';
    let w = 50;
    for (const p of this.panes) {
      const d = this.paneDigits(p);
      for (const v of [p.vmin, p.vmax]) if (isNum(v)) w = Math.max(w, ctx.measureText(this.fmtAxis(p, v, d)).width + 16);
    }
    return Math.ceil(w);
  }
  paneDigits(p) {
    if (p.id === 'main') return this.sym.digits;
    const ind = this.indicators.find((x) => x.paneId === p.id);
    if (ind && ind.res && ind.res.decl && isNum(ind.res.decl.precision)) return ind.res.decl.precision;
    return autoDigits(Math.abs(p.vmax - p.vmin));
  }
  fmtAxis(p, v, d) {
    if (p.id !== 'main') { const ind = this.indicators.find((x) => x.paneId === p.id); if (ind && ind.res && ind.res.decl && ind.res.decl.format === 'volume') return fmtVol(v); }
    return fmtPrice(v, d);
  }

  render() {
    const ctx = this.ctx, dpr = this.dpr, th = this.theme;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = th.bg; ctx.fillRect(0, 0, this.CW, this.CH);
    if (!this.bars || !this.n) {
      ctx.fillStyle = th.text2; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(this.emptyText || 'لا توجد بيانات', this.CW / 2, this.CH / 2);
      return;
    }
    // two passes: axis width depends on scale, scale depends on width
    this.W = this.CW - this.axisW;
    this.layout(); this.computeVisible(); this.autoscale();
    const aw = this.measureAxis();
    if (Math.abs(aw - this.axisW) > 2) { this.axisW = aw; this.W = this.CW - aw; this.computeVisible(); this.autoscale(); }
    this.panes[0].digits = this.sym.digits;
    const b = this.displayBars();
    // grid
    const timeTicks = this.timeTicks();
    if (this.opts.grid) {
      ctx.strokeStyle = th.grid; ctx.lineWidth = 1; ctx.beginPath();
      for (const tk of timeTicks) { const x = Math.round(tk.x) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, this.H); }
      for (const p of this.panes) for (const v of this.priceTicks(p)) { const y = Math.round(this.yOf(p, v)) + 0.5; ctx.moveTo(0, y); ctx.lineTo(this.W, y); }
      ctx.stroke();
    }
    const info = this.drawInfo();
    for (const pane of this.panes) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, pane.top, this.W, pane.h); ctx.clip();
      const inds = this.indicators.filter((x) => x.res && x.visible !== false && (x.paneId || 'main') === pane.id);
      for (const ind of inds) drawBg(this, ctx, pane, ind);
      if (pane.id === 'main') {
        if (this.opts.showVolume) this.drawVolume(ctx, pane, b);
        for (const ind of inds) drawFills(this, ctx, pane, ind);
        this.drawSeries(ctx, pane, b);
      } else for (const ind of inds) drawFills(this, ctx, pane, ind);
      for (const ind of inds) { drawPlots(this, ctx, pane, ind); drawHlines(this, ctx, pane, ind); }
      for (const ind of inds) { drawObjects(this, ctx, pane, ind, b); drawShapes(this, ctx, pane, ind, b); }
      if (pane.id === 'main') {
        for (const ind of inds) drawStrategy(this, ctx, pane, ind, b);
        if (this.opts.showLastPrice) this.drawLastLine(ctx, pane, b);
        for (const d of this.drawings) renderDrawing(this, ctx, pane, d, d === this.selected, info);
        if (this.pending) renderDrawing(this, ctx, pane, this.pending, true, info);
        if (this.trade) this.drawTrade(ctx, pane);
      }
      for (const ind of inds) drawTables(this, ctx, pane, ind);
      ctx.restore();
    }
    // separators
    ctx.fillStyle = th.border;
    for (let k = 1; k < this.panes.length; k++) ctx.fillRect(0, this.panes[k].top - SEP / 2 - 0.5, this.CW, 1);
    this.drawPriceAxes(ctx, b);
    this.drawTimeAxis(ctx, timeTicks);
    this.goLast.classList.toggle('hidden', this.endIdx >= this.n - 1 - 2 || this.n < 2);
  }

  drawInfo() {
    const t = this.trade;
    return { digits: this.sym.digits, point: this.sym.point || 0.01, lots: t ? t.lots : this.opts.lots || 0, contract: this.sym.contractSize || 1 };
  }

  drawVolume(ctx, pane, b) {
    let mx = 0;
    for (let i = this.i0; i <= this.i1; i++) if (b.v[i] > mx) mx = b.v[i];
    if (!(mx > 0)) return;
    const hgt = pane.h * 0.18, bottom = pane.top + pane.h;
    const w = Math.max(1, Math.round(this.spacing * 0.75));
    const B = this.bars;
    for (let i = this.i0; i <= this.i1; i++) {
      const v = B.v[i]; if (!(v > 0)) continue;
      const hh = v / mx * hgt;
      ctx.fillStyle = B.c[i] >= B.o[i] ? this.theme.volUp : this.theme.volDown;
      ctx.fillRect(Math.round(this.xOf(i) - w / 2), bottom - hh, w, hh);
    }
  }

  drawSeries(ctx, pane, b) {
    const th = this.theme, type = this.opts.chartType;
    if (type === 'line' || type === 'area') {
      ctx.beginPath();
      let first = true, x0 = 0;
      for (let i = this.i0; i <= this.i1; i++) { const x = this.xOf(i), y = this.yOf(pane, b.c[i]); if (first) { ctx.moveTo(x, y); first = false; x0 = x; } else ctx.lineTo(x, y); }
      ctx.strokeStyle = th.line; ctx.lineWidth = 2; ctx.stroke();
      if (type === 'area') {
        ctx.lineTo(this.xOf(this.i1), pane.top + pane.h); ctx.lineTo(x0, pane.top + pane.h); ctx.closePath();
        const g = ctx.createLinearGradient(0, pane.top, 0, pane.top + pane.h); g.addColorStop(0, 'rgba(41,98,255,0.35)'); g.addColorStop(1, 'rgba(41,98,255,0.02)');
        ctx.fillStyle = g; ctx.fill();
      }
      return;
    }
    const sp = this.spacing;
    let bw = Math.max(1, Math.round(sp * 0.72));
    if (bw > 2 && bw % 2 === 0) bw--;
    const thin = sp < 2.5;
    const raw = this.bars;
    for (let i = this.i0; i <= this.i1; i++) {
      const o = b.o[i], h = b.h[i], l = b.l[i], c = b.c[i];
      const up = c >= o;
      let col = up ? th.up : th.down, wick = up ? th.wickUp : th.wickDown;
      if (this.barColorFn) { const bc = this.barColorFn(i); if (bc) { col = bc; wick = bc; } }
      const x = Math.round(this.xOf(i)) + 0.5;
      const yh = this.yOf(pane, h), yl = this.yOf(pane, l), yo = this.yOf(pane, o), yc = this.yOf(pane, c);
      ctx.strokeStyle = wick; ctx.fillStyle = col; ctx.lineWidth = 1;
      if (thin) { ctx.beginPath(); ctx.moveTo(x, yh); ctx.lineTo(x, yl); ctx.stroke(); continue; }
      if (type === 'bars') {
        ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(x, yh); ctx.lineTo(x, yl);
        ctx.moveTo(x - bw / 2, Math.round(yo) + 0.5); ctx.lineTo(x, Math.round(yo) + 0.5); ctx.moveTo(x, Math.round(yc) + 0.5); ctx.lineTo(x + bw / 2, Math.round(yc) + 0.5); ctx.stroke();
        continue;
      }
      ctx.beginPath(); ctx.moveTo(x, yh); ctx.lineTo(x, Math.min(yo, yc)); ctx.moveTo(x, Math.max(yo, yc)); ctx.lineTo(x, yl); ctx.stroke();
      const top = Math.round(Math.min(yo, yc)), hgt = Math.max(1, Math.round(Math.abs(yc - yo)));
      if (type === 'hollow' && up) { ctx.strokeStyle = col; ctx.strokeRect(Math.round(x - bw / 2) + 0.5, top + 0.5, bw - 1, Math.max(1, hgt - 1)); }
      else ctx.fillRect(Math.round(x - bw / 2), top, bw, hgt);
    }
    void raw;
  }

  drawLastLine(ctx, pane, b) {
    const i = this.n - 1;
    const c = this.bars.c[i];
    const y = Math.round(this.yOf(pane, c)) + 0.5;
    ctx.strokeStyle = this.bars.c[i] >= this.bars.o[i] ? this.theme.up : this.theme.down;
    ctx.lineWidth = 1; dash(ctx, 'dotted', 1.2);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.W, y); ctx.stroke(); ctx.setLineDash([]);
    if (this.trade && this.trade.ask) {
      const ya = Math.round(this.yOf(pane, this.trade.ask)) + 0.5;
      ctx.strokeStyle = '#f23645'; ctx.globalAlpha = 0.7; dash(ctx, 'dotted', 1.2);
      ctx.beginPath(); ctx.moveTo(0, ya); ctx.lineTo(this.W, ya); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------ trade lines
  tradeLines(pane) {
    const t = this.trade;
    const out = [];
    if (!t) return out;
    for (const p of t.positions || []) {
      out.push({ kind: 'pos', id: p.id, price: p.openPrice, color: p.side === 1 ? '#2962ff' : '#f23645', text: `${p.side === 1 ? 'BUY' : 'SELL'} ${p.lots} · ${p.pnlText || ''}`, pnlColor: p.pnlColor, ref: p });
      if (isNum(p.sl)) out.push({ kind: 'sl', id: p.id, price: p.sl, color: '#f23645', text: `SL ${p.slText || ''}`, ref: p });
      if (isNum(p.tp)) out.push({ kind: 'tp', id: p.id, price: p.tp, color: '#089981', text: `TP ${p.tpText || ''}`, ref: p });
    }
    for (const o of t.orders || []) {
      out.push({ kind: 'order', id: o.id, price: o.price, color: o.side === 1 ? '#2962ff' : '#f23645', text: `${o.type.replace('_', ' ').toUpperCase()} ${o.lots}`, ref: o, dashed: true });
      if (isNum(o.sl)) out.push({ kind: 'osl', id: o.id, price: o.sl, color: '#f23645', text: 'SL', ref: o, dashed: true });
      if (isNum(o.tp)) out.push({ kind: 'otp', id: o.id, price: o.tp, color: '#089981', text: 'TP', ref: o, dashed: true });
    }
    for (const L of out) L.y = this.yOf(pane, this.drag && this.drag.type === 'trade' && this.drag.line.kind === L.kind && this.drag.line.id === L.id ? this.drag.price : L.price);
    return out;
  }
  drawTrade(ctx, pane) {
    const lines = this.tradeLines(pane);
    ctx.font = '11px -apple-system, Roboto, sans-serif';
    for (const L of lines) {
      const y = Math.round(L.y) + 0.5;
      ctx.strokeStyle = L.color; ctx.lineWidth = 1;
      dash(ctx, L.kind === 'pos' ? 'solid' : 'dashed');
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.W, y); ctx.stroke(); ctx.setLineDash([]);
      const txt = L.text;
      const w = ctx.measureText(txt).width + 14;
      const x = this.W * 0.18;
      ctx.fillStyle = this.theme.bg; roundRect(ctx, x, y - 10, w, 20, 3); ctx.fill();
      ctx.strokeStyle = L.color; ctx.lineWidth = 1; roundRect(ctx, x + 0.5, y - 9.5, w - 1, 19, 3); ctx.stroke();
      ctx.fillStyle = L.kind === 'pos' && L.pnlColor ? L.pnlColor : L.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, x + w / 2, y + 0.5);
      L.box = [x, y - 12, w, 24];
    }
    if (this.drag && this.drag.type === 'trade') {
      const y = this.yOf(pane, this.drag.price);
      const tag = fmtPrice(this.drag.price, this.sym.digits) + (this.drag.ptsText ? '  ' + this.drag.ptsText : '');
      ctx.fillStyle = '#2962ff'; const w = ctx.measureText(tag).width + 12; roundRect(ctx, this.W - w - 4, y - 22, w, 18, 3); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(tag, this.W - w / 2 - 4, y - 13);
    }
  }

  // ------------------------------------------------------------------ axes
  priceTicks(p) {
    const n = Math.max(2, Math.floor(p.h / 42));
    if (p.log) {
      const out = []; const a = p.vmin, b = p.vmax; const step = niceStep((b - a) / n);
      for (let v = Math.ceil(a / step) * step; v <= b; v += step) out.push(v);
      return out;
    }
    const step = niceStep((p.vmax - p.vmin) / n);
    const out = [];
    const lo = this.priceOf(p, p.top + p.h), hi = this.priceOf(p, p.top);
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) out.push(+v.toPrecision(12));
    return out;
  }
  drawPriceAxes(ctx, b) {
    const th = this.theme, x0 = this.W;
    ctx.fillStyle = th.axisBg; ctx.fillRect(x0, 0, this.axisW, this.H);
    ctx.fillStyle = th.border; ctx.fillRect(x0, 0, 1, this.H);
    ctx.font = '11px -apple-system, Roboto, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const p of this.panes) {
      const d = this.paneDigits(p);
      p.digits = d;
      ctx.fillStyle = th.text2;
      for (const v of this.priceTicks(p)) { const y = this.yOf(p, v); if (y < p.top + 6 || y > p.top + p.h - 6) continue; ctx.fillText(this.fmtAxis(p, v, d), x0 + 6, y); }
      // last value tags of indicator plots
      const tags = [];
      for (const ind of this.indicators) {
        if (!ind.res || ind.visible === false || (ind.paneId || 'main') !== p.id) continue;
        for (const pl of ind.res.out.plots) {
          if (pl.display === 'none' || (ind.hidden && ind.hidden[pl.id])) continue;
          const i = Math.min(this.n - 1, this.i1);
          let v = NaN; for (let k = i; k >= Math.max(this.i0, i - 3); k--) { v = plotVal(ind, pl, k); if (isNum(v)) break; }
          if (!isNum(v)) continue;
          const c = css(pl.colors0) || '#2962ff';
          tags.push({ y: this.yOf(p, v), text: formatIndValue(ind, v, p), color: c });
        }
      }
      if (p.id === 'main') {
        const c = this.bars.c[this.n - 1];
        tags.push({ y: this.yOf(p, c), text: fmtPrice(c, d), color: this.bars.c[this.n - 1] >= this.bars.o[this.n - 1] ? th.up : th.down, main: true });
        if (this.trade && this.trade.ask) tags.push({ y: this.yOf(p, this.trade.ask), text: fmtPrice(this.trade.ask, d), color: '#f23645' });
        for (const d2 of this.drawings) if (d2.type === 'hline' && !d2.hidden) tags.push({ y: this.yOf(p, d2.pts[0].p), text: fmtPrice(d2.pts[0].p, d), color: d2.style.color });
        if (this.trade) for (const L of this.tradeLines(p)) tags.push({ y: L.y, text: fmtPrice(L.price, d), color: L.color });
      }
      ctx.save(); ctx.beginPath(); ctx.rect(x0, p.top, this.axisW, p.h); ctx.clip();
      // avoid overlapping tags: keep the main price tag fixed, nudge others
      tags.sort((a, b2) => a.y - b2.y);
      for (let k = 1; k < tags.length; k++) if (isNum(tags[k].y) && isNum(tags[k - 1].y) && tags[k].y - tags[k - 1].y < 18) tags[k].y = tags[k - 1].y + 18;
      tags.sort((a, b2) => (a.main ? 1 : 0) - (b2.main ? 1 : 0));
      for (const tg of tags) {
        if (!isNum(tg.y) || tg.y < p.top - 8 || tg.y > p.top + p.h + 8) continue;
        ctx.fillStyle = tg.color; roundRect(ctx, x0 + 1, tg.y - 9, this.axisW - 2, 18, 2); ctx.fill();
        ctx.fillStyle = contrastText(tg.color.startsWith('#') && tg.color.length === 7 ? tg.color + 'ff' : tg.color); ctx.fillText(tg.text, x0 + 6, tg.y + 0.5);
      }
      ctx.restore();
      if (!p.auto) { ctx.fillStyle = '#2962ff'; ctx.font = '9px sans-serif'; ctx.fillText('M', x0 + this.axisW - 12, p.top + 10); ctx.font = '11px -apple-system, Roboto, sans-serif'; }
    }
  }
  timeTicks() {
    if (!this.n) return [];
    const tz = this.opts.tzMin * 60000;
    const minPx = 80;
    const barsPerLabel = Math.max(1, Math.ceil(minPx / this.spacing));
    const span = barsPerLabel * this.tfMs;
    const UNITS = [60e3, 120e3, 300e3, 600e3, 900e3, 1800e3, 3600e3, 7200e3, 10800e3, 14400e3, 21600e3, 43200e3, 864e5, 1728e5, 6048e5, 'M1', 'M3', 'M6', 'Y'];
    let unit = UNITS.find((u) => (typeof u === 'number' ? u >= span : true));
    if (typeof unit === 'number' && unit >= 864e5 && span > 6048e5) unit = span > 2592e6 * 3 ? (span > 2592e6 * 6 ? 'Y' : 'M6') : span > 2592e6 ? 'M3' : 'M1';
    const key = (t) => {
      const lt = t + tz;
      if (typeof unit === 'number') return Math.floor(lt / unit);
      const d = new Date(lt);
      const m = d.getUTCFullYear() * 12 + d.getUTCMonth();
      return unit === 'M1' ? m : unit === 'M3' ? Math.floor(m / 3) : unit === 'M6' ? Math.floor(m / 6) : d.getUTCFullYear();
    };
    const out = [];
    const T = this.bars.t;
    let prev = this.i0 > 0 ? key(T[this.i0 - 1]) : null;
    let lastX = -1e9;
    for (let i = this.i0; i <= this.i1; i++) {
      const k = key(T[i]);
      if (k !== prev) {
        const x = this.xOf(i);
        if (x - lastX >= minPx * 0.7) {
          const d = new Date(T[i] + tz), pd = i > 0 ? new Date(T[i - 1] + tz) : null;
          let txt, bold = false;
          if (pd && d.getUTCFullYear() !== pd.getUTCFullYear()) { txt = String(d.getUTCFullYear()); bold = true; }
          else if (pd && d.getUTCMonth() !== pd.getUTCMonth() && (typeof unit !== 'number' || unit >= 864e5)) { txt = fmtTime(T[i], this.opts.tzMin, 'month'); bold = true; }
          else if (typeof unit !== 'number' || unit >= 864e5 || (pd && d.getUTCDate() !== pd.getUTCDate())) { txt = String(d.getUTCDate()); bold = typeof unit === 'number' && unit < 864e5; }
          else txt = fmtTime(T[i], this.opts.tzMin, 'hm');
          out.push({ x, text: txt, bold });
          lastX = x;
        }
        prev = k;
      }
    }
    return out;
  }
  drawTimeAxis(ctx, ticks) {
    const th = this.theme, y0 = this.H;
    ctx.fillStyle = th.axisBg; ctx.fillRect(0, y0, this.CW, TIME_H);
    ctx.fillStyle = th.border; ctx.fillRect(0, y0, this.CW, 1);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const tk of ticks) {
      ctx.font = (tk.bold ? 'bold ' : '') + '11px -apple-system, Roboto, sans-serif';
      ctx.fillStyle = tk.bold ? th.text : th.text2;
      ctx.fillText(tk.text, tk.x, y0 + TIME_H / 2);
    }
  }

  // ------------------------------------------------------------------ overlay (crosshair, replay pick)
  renderOverlay() {
    const ctx = this.octx, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.CW, this.CH);
    const c = this.cross;
    if (!c || !this.n) return;
    const th = this.theme;
    const x = Math.round(this.xOf(c.i)) + 0.5, y = Math.round(c.y) + 0.5;
    if (this.replayPick) {
      ctx.fillStyle = 'rgba(41,98,255,0.12)'; ctx.fillRect(x, 0, this.W - x, this.H);
      ctx.strokeStyle = '#2962ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.H); ctx.stroke();
    } else {
      ctx.strokeStyle = th.cross; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.H);
      if (y >= 0 && y <= this.H) { ctx.moveTo(0, y); ctx.lineTo(this.W, y); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.font = '11px -apple-system, Roboto, sans-serif'; ctx.textBaseline = 'middle';
    // time label
    const t = this.timeOfIndex(c.i);
    const tl = fmtTime(t, this.opts.tzMin, 'full');
    const tw = ctx.measureText(tl).width + 14;
    const tx = Math.max(0, Math.min(this.CW - tw, x - tw / 2));
    ctx.fillStyle = th.crossLabel; roundRect(ctx, tx, this.H + 2, tw, TIME_H - 4, 3); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(tl, tx + tw / 2, this.H + TIME_H / 2);
    // price label
    if (c.pane && y >= c.pane.top && y <= c.pane.top + c.pane.h && !this.replayPick) {
      const pr = this.priceOf(c.pane, y);
      const pl = this.fmtAxis(c.pane, pr, this.paneDigits(c.pane));
      ctx.fillStyle = th.crossLabel; roundRect(ctx, this.W + 1, y - 9, this.axisW - 2, 18, 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(pl, this.W + 6, y + 0.5);
    }
  }

  // ------------------------------------------------------------------ legends (DOM)
  buildLegends() {
    this.legend.innerHTML = '';
    this.legendRows = [];
    for (const p of this.panes) {
      const box = document.createElement('div');
      box.className = 'legend-pane';
      box.dataset.pane = p.id;
      if (p.id === 'main') {
        const row = document.createElement('div'); row.className = 'legend-main';
        box.append(row);
        this.mainLegend = row;
      }
      for (const ind of this.indicators.filter((x) => (x.paneId || 'main') === p.id)) {
        const row = document.createElement('div');
        row.className = 'legend-ind' + (ind.visible === false ? ' off' : '') + (ind.error ? ' err' : '');
        const name = document.createElement('span'); name.className = 'lg-name'; name.textContent = ind.title;
        const vals = document.createElement('span'); vals.className = 'lg-vals';
        const btns = document.createElement('span'); btns.className = 'lg-btns';
        const mk = (cls, html, act, tip) => { const bt = document.createElement('button'); bt.className = cls; bt.innerHTML = html; bt.title = tip; bt.onclick = (e) => { e.stopPropagation(); this.cb.onLegend && this.cb.onLegend(act, ind); }; return bt; };
        btns.append(mk('lg-eye', ind.visible === false ? '◌' : '◉', 'toggle', 'إظهار/إخفاء'), mk('lg-set', '⚙', 'settings', 'الإعدادات'), mk('lg-src', '{}', 'source', 'الكود'), mk('lg-del', '✕', 'remove', 'حذف'));
        row.append(name, vals, btns);
        row.onclick = () => row.classList.toggle('open');
        box.append(row);
        this.legendRows.push({ ind, vals, pane: p });
      }
      this.legend.append(box);
    }
    this.positionLegends();
  }
  positionLegends() {
    const boxes = this.legend.children;
    for (let k = 0; k < boxes.length; k++) {
      const p = this.panes[k];
      if (!p || p.top === undefined) continue;
      boxes[k].style.top = (p.top + 2) + 'px';
      boxes[k].style.maxWidth = Math.max(120, this.W - 10) + 'px';
    }
  }
  updateLegends() {
    if (!this.n) { if (this.mainLegend) this.mainLegend.innerHTML = ''; return; }
    this.positionLegends();
    const i = this.cross ? Math.max(0, Math.min(this.n - 1, this.cross.i)) : this.n - 1;
    const b = this.displayBars();
    const d = this.sym.digits;
    if (this.mainLegend) {
      const o = b.o[i], h = b.h[i], l = b.l[i], c = b.c[i];
      const pc = i > 0 ? b.c[i - 1] : o;
      const ch = c - pc, chp = pc ? ch / pc * 100 : 0;
      const col = c >= o ? 'up' : 'dn';
      this.mainLegend.innerHTML = `<b class="lg-sym">${this.sym.name}</b> <span class="lg-tf">${this.tfLabel}</span>${this.partial && i === this.n - 1 ? ' <span class="lg-live">●</span>' : ''} `
        + `<span class="lg-ohlc">O<i class="${col}">${fmtPrice(o, d)}</i> H<i class="${col}">${fmtPrice(h, d)}</i> L<i class="${col}">${fmtPrice(l, d)}</i> C<i class="${col}">${fmtPrice(c, d)}</i> `
        + `<i class="${ch >= 0 ? 'up' : 'dn'}">${ch >= 0 ? '+' : ''}${fmtPrice(ch, d)} (${chp >= 0 ? '+' : ''}${chp.toFixed(2)}%)</i> V<i>${fmtVol(this.bars.v[i])}</i></span>`;
    }
    for (const r of this.legendRows || []) {
      const ind = r.ind;
      if (!ind.res || ind.visible === false) { r.vals.innerHTML = ind.error ? '<i class="dn">خطأ</i>' : ''; continue; }
      const parts = [];
      for (const p of ind.res.out.plots) {
        if (p.display === 'none' || (ind.hidden && ind.hidden[p.id])) continue;
        const v = plotVal(ind, p, i);
        const ri = i - ind.offset - (p.offset || 0);
        const col = css(p.colors ? p.colors[ri] ?? p.colors0 : p.colors0) || '#888';
        parts.push(`<i style="color:${col}">${formatIndValue(ind, v, r.pane)}</i>`);
        if (parts.length >= 8) break;
      }
      r.vals.innerHTML = parts.join(' ');
    }
  }

  // ------------------------------------------------------------------ interaction
  setupEvents() {
    const el = this.ov;
    el.style.touchAction = 'none';
    this.ptrs = new Map();
    const pos = (e) => { const r = this.ov.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      const [x, y] = pos(e);
      this.ptrs.set(e.pointerId, { x, y, x0: x, y0: y });
      if (this.ptrs.size === 2) { this.startPinch(); return; }
      this.onDown(x, y, e);
    });
    el.addEventListener('pointermove', (e) => {
      const [x, y] = pos(e);
      const p = this.ptrs.get(e.pointerId);
      if (p) { p.x = x; p.y = y; }
      if (this.pinch && this.ptrs.size >= 2) { this.onPinch(); return; }
      if (p) this.onMove(x, y, e);
      else if (e.pointerType === 'mouse') this.hover(x, y);
    });
    const up = (e) => {
      const p = this.ptrs.get(e.pointerId);
      this.ptrs.delete(e.pointerId);
      if (this.pinch) { if (this.ptrs.size < 2) this.pinch = null; this.drag = null; return; }
      if (p) this.onUp(p.x, p.y, e);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !this.ptrs.size && !this.crossLocked) { this.cross = null; this.invalidateOverlay(); } });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [x] = pos(e);
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { this.endIdx += (e.deltaX || e.deltaY) / this.spacing; this.clampView(); this.invalidate(); return; }
      this.zoomAt(x, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    el.addEventListener('dblclick', (e) => { const [x, y] = pos(e); if (x > this.W) { const p = this.paneAt(y); p.auto = true; this.invalidate(); } });
  }

  zoomAt(x, f) {
    const anchor = this.idxAt(x);
    this.spacing = Math.max(0.8, Math.min(80, this.spacing * f));
    this.endIdx = anchor + (this.W - this.spacing / 2 - x) / this.spacing;
    this.clampView();
    this.invalidate();
    if (this.cb.onView) this.cb.onView();
  }

  hover(x, y) {
    if (this.crossLocked) return;
    if (x > this.W || y > this.H) { if (this.cross) { this.cross = null; this.invalidateOverlay(); } return; }
    this.setCross(x, y);
  }
  setCross(x, y) {
    let i = this.barAt(Math.min(x, this.W));
    i = Math.max(0, Math.min(this.n - 1 + 200, i));
    const pane = this.paneAt(y);
    let yy = y;
    if (this.opts.magnet && pane.id === 'main' && i >= 0 && i < this.n && this.tool) yy = this.snapY(pane, i, y);
    this.cross = { i, y: yy, pane };
    this.invalidateOverlay();
    if (this.cb.onCross) this.cb.onCross(this.cross);
  }
  snapY(pane, i, y) {
    const b = this.bars;
    let best = y, bd = 28;
    for (const v of [b.o[i], b.h[i], b.l[i], b.c[i]]) { const yy = this.yOf(pane, v); const d = Math.abs(yy - y); if (d < bd) { bd = d; best = yy; } }
    return best;
  }
  pointFrom(x, y, pane) {
    const i = this.idxAt(x);
    const ri = Math.round(i);
    let yy = y;
    if (this.opts.magnet && pane.id === 'main' && ri >= 0 && ri < this.n) yy = this.snapY(pane, ri, y);
    return { t: this.timeOfIndex(ri), p: this.priceOf(pane, yy) };
  }

  onDown(x, y, e) {
    this.downAt = { x, y, t: performance.now(), moved: false };
    const pane = this.paneAt(y);
    clearTimeout(this.lpTimer);
    if (!this.n) return;
    // separators
    for (let k = 1; k < this.panes.length; k++) {
      const p = this.panes[k];
      if (Math.abs(y - (p.top - SEP / 2)) < 10 && x < this.W) { this.drag = { type: 'sep', k, y0: y, r0: this.panes[k - 1].ratio, r1: p.ratio, h0: this.panes[k - 1].h, h1: p.h }; return; }
    }
    if (x > this.W && y < this.H) {
      const now = performance.now();
      if (this._lastAxisTap && now - this._lastAxisTap < 320) { pane.auto = true; this._lastAxisTap = 0; this.invalidate(); return; }
      this._lastAxisTap = now;
      this.drag = { type: 'pscale', pane, y0: y, min: pane.vmin, max: pane.vmax, wasAuto: pane.auto };
      return;
    }
    if (y > this.H) { this.drag = { type: 'tscale', x0: x, sp: this.spacing }; return; }
    if (this.replayPick) { this.setCross(x, y); this.drag = { type: 'pick' }; return; }
    // drawing tool active
    if (this.tool && TOOLS[this.tool] && pane.id === 'main') {
      const pt = this.pointFrom(x, y, pane);
      if (!this.pending) {
        this.pending = createDrawing(this.tool, [pt, pt]);
        if (TOOLS[this.tool].n === 1) this.pending.pts = [pt];
        this.drag = { type: 'create', startX: x, startY: y };
      } else {
        // subsequent taps for multi-point tools
        this.pending.pts[this.pending.pts.length - 1] = pt;
        this.drag = { type: 'create-next' };
      }
      this.invalidate();
      return;
    }
    // trade lines
    if (this.trade && pane.id === 'main') {
      for (const L of this.tradeLines(pane)) {
        if (Math.abs(y - L.y) <= 12) {
          this.drag = { type: 'trade', line: L, price: L.price, y0: y, startPrice: L.price };
          this.invalidate();
          return;
        }
      }
    }
    // drawings (selected first)
    if (pane.id === 'main') {
      const order = this.selected ? [this.selected, ...this.drawings.filter((d) => d !== this.selected)] : this.drawings.slice().reverse();
      for (const d of order) {
        if (d.locked) continue;
        const h = hitDrawing(this, pane, d, x, y);
        if (h) {
          if (this.selected !== d) this.select(d);
          const pt = this.pointFrom(x, y, pane);
          this.drag = { type: h.k !== undefined ? 'dhandle' : 'dmove', d, k: h.k, last: pt, start: JSON.stringify(d) };
          return;
        }
      }
    }
    this.drag = { type: 'pan', x0: x, y0: y, end0: this.endIdx, min0: pane.vmin, max0: pane.vmax, pane };
    if (e.pointerType !== 'mouse') {
      this.lpTimer = setTimeout(() => {
        if (this.downAt && !this.downAt.moved) { this.crossLocked = true; this.drag = { type: 'cross' }; this.setCross(x, y); if (navigator.vibrate) try { navigator.vibrate(10); } catch (er) { /* */ } }
      }, 380);
    }
  }

  onMove(x, y, e) {
    const d = this.downAt;
    if (d && Math.hypot(x - d.x, y - d.y) > 6) { d.moved = true; clearTimeout(this.lpTimer); }
    const g = this.drag;
    if (!g) return;
    switch (g.type) {
      case 'pan': {
        if (this.crossLocked) { this.setCross(x, y); return; }
        this.endIdx = g.end0 - (x - g.x0) / this.spacing;
        this.clampView();
        const p = g.pane;
        if (!p.auto) { const dp = (y - g.y0) / (p.h - 2 * p.pad) * (g.max0 - g.min0); p.vmin = g.min0 + dp; p.vmax = g.max0 + dp; }
        this.invalidate();
        if (e.pointerType === 'mouse') this.hover(x, y);
        if (this.cb.onView) this.cb.onView();
        break;
      }
      case 'cross': case 'pick': this.setCross(x, y); break;
      case 'pscale': {
        const p = g.pane;
        if (Math.abs(y - g.y0) < 3 && g.wasAuto) return;
        p.auto = false;
        const f = Math.exp((y - g.y0) / 120);
        const mid = (g.min + g.max) / 2, half = (g.max - g.min) / 2 * f;
        p.vmin = mid - half; p.vmax = mid + half;
        this.invalidate();
        break;
      }
      case 'tscale': {
        const f = Math.exp((x - g.x0) / 150);
        const anchor = this.endIdx;
        this.spacing = Math.max(0.8, Math.min(80, g.sp * f));
        this.endIdx = anchor; this.clampView(); this.invalidate();
        break;
      }
      case 'sep': {
        const a = this.panes[g.k - 1], b = this.panes[g.k];
        const dy = y - g.y0;
        const h0 = Math.max(40, g.h0 + dy), h1 = Math.max(40, g.h1 - dy);
        const tot = g.r0 + g.r1;
        a.ratio = tot * h0 / (h0 + h1); b.ratio = tot * h1 / (h0 + h1);
        this.invalidate();
        break;
      }
      case 'create': case 'create-next': {
        const pane = this.panes[0];
        if (!this.pending) return;
        const pt = this.pointFrom(x, y, pane);
        const k = this.pending.pts.length - 1;
        if (TOOLS[this.pending.type].n === 1) this.pending.pts[0] = pt; else this.pending.pts[k] = pt;
        this.setCross(x, y);
        this.invalidate();
        break;
      }
      case 'dhandle': case 'dmove': {
        const pane = this.panes[0];
        const pt = this.pointFrom(x, y, pane);
        if (g.type === 'dhandle') moveHandle(g.d, g.k, pt.t, pt.p);
        else { moveBy(g.d, pt.t - g.last.t, pt.p - g.last.p); g.last = pt; }
        this.invalidate();
        break;
      }
      case 'trade': {
        const pane = this.panes[0];
        g.price = this.priceOf(pane, y);
        const pt = this.sym.point || 0.01;
        g.price = Math.round(g.price / pt) * pt;
        const ref = g.line.kind === 'pos' ? g.line.ref.openPrice : g.line.ref.openPrice ?? g.line.ref.price;
        g.ptsText = isNum(ref) ? Math.round((g.price - ref) / pt) + ' pts' : '';
        this.invalidate();
        break;
      }
    }
  }

  onUp(x, y, e) {
    clearTimeout(this.lpTimer);
    const g = this.drag;
    this.drag = null;
    const tap = this.downAt && !this.downAt.moved && performance.now() - this.downAt.t < 450;
    if (!g) return;
    switch (g.type) {
      case 'pick': {
        const i = Math.max(0, Math.min(this.n - 1, this.cross ? this.cross.i : this.barAt(x)));
        if (this.cb.onReplayPick) this.cb.onReplayPick(i);
        break;
      }
      case 'create': case 'create-next': {
        const d = this.pending; if (!d) break;
        const need = TOOLS[d.type].n;
        const moved = !tap;
        if (need === 1) { this.finishDrawing(); break; }
        if (g.type === 'create' && moved) {
          // press-drag-release created the 2nd point
          if (need === 2) { this.finishDrawing(); break; }
          d.pts.push({ ...d.pts[d.pts.length - 1] });
        } else if (g.type === 'create') {
          // tap placed the first point: second point follows next tap
          d.pts[1] = { ...d.pts[0] };
        } else {
          if (d.pts.length >= need) { this.finishDrawing(); break; }
          d.pts.push({ ...d.pts[d.pts.length - 1] });
        }
        this.invalidate();
        break;
      }
      case 'dhandle': case 'dmove': if (JSON.stringify(g.d) !== g.start && this.cb.onDrawingChanged) this.cb.onDrawingChanged(g.d); break;
      case 'trade': {
        if (Math.abs(g.price - g.startPrice) > 1e-12 && this.cb.onTradeDrag) this.cb.onTradeDrag(g.line, g.price);
        else if (tap && this.cb.onTradeTap) this.cb.onTradeTap(g.line);
        this.invalidate();
        break;
      }
      case 'pan': case 'cross': {
        if (tap && !this.crossLocked) {
          // tap: deselect drawings / toggle crosshair on touch
          if (this.selected) this.select(null);
          else if (e.pointerType !== 'mouse') { if (this.cross) { this.cross = null; this.invalidateOverlay(); } else this.setCross(x, y); }
          if (this.cb.onTap) this.cb.onTap({ x, y, i: this.barAt(x) });
        } else if (tap && this.crossLocked) { this.crossLocked = false; this.cross = null; this.invalidateOverlay(); }
        if (g.type === 'cross') { /* keep crosshair visible until next tap */ }
        break;
      }
      case 'pscale': case 'tscale': case 'sep': if (this.cb.onView) this.cb.onView(); break;
    }
  }

  finishDrawing() {
    const d = this.pending;
    this.pending = null;
    if (!d) return;
    if (d.type === 'long' || d.type === 'short') initPosition(d, this, this.panes[0]);
    if (d.type === 'hline') d.pts[0].t = this.timeOfIndex(this.n - 1);
    this.drawings.push(d);
    this.select(d);
    if (this.cb.onDrawingCreated) this.cb.onDrawingCreated(d);
    this.invalidate();
  }

  startPinch() {
    clearTimeout(this.lpTimer);
    const [a, b] = [...this.ptrs.values()];
    this.drag = null;
    this.pending = this.pending && this.tool ? this.pending : null;
    this.pinch = { d0: Math.abs(a.x - b.x) || 1, sp0: this.spacing, mid: (a.x + b.x) / 2, anchor: this.idxAt((a.x + b.x) / 2), dy0: Math.abs(a.y - b.y) || 1 };
  }
  onPinch() {
    const [a, b] = [...this.ptrs.values()];
    const g = this.pinch;
    const d = Math.abs(a.x - b.x) || 1;
    const mid = (a.x + b.x) / 2;
    this.spacing = Math.max(0.8, Math.min(80, g.sp0 * d / g.d0));
    this.endIdx = g.anchor + (this.W - this.spacing / 2 - mid) / this.spacing;
    this.clampView();
    this.invalidate();
  }
}

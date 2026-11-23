// BTX Chart Lab — application controller
import { Chart } from './chart/chart.js';
import { TOOLS } from './chart/drawings.js';
import { h, $, $$, sheet, toast, closeTopSheet, anySheet, confirmBox } from './ui/dom.js';
import { Editor } from './ui/editor.js';
import { parseTf, aggregate, limitedView, bucketStart, heikinAshi } from './data/aggregate.js';
import { sliceBars } from './data/binfmt.js';
import * as store from './data/store.js';
import { PineRuntime, scanSecuritySymbols } from './pine/runtime.js';
import { parse } from './pine/parser.js';
import { BUILTIN_SCRIPTS, NEW_SCRIPT_TEMPLATE } from './pine/builtins.js';
import * as A from './trading/account.js';
import { initPanels } from './ui/panels.js';
import { initSheets } from './ui/sheets.js';

const DEFAULT_STATE = {
  symbol: 'XAUUSD', tf: '1', chartType: 'candles', theme: 'dark', tzMin: 180,
  align: { mode: 'utc', offsetMin: 0 }, maxBars: 10000, showVolume: true, grid: true, magnet: true, tools: true,
  favTfs: ['1', '5', '15', '60', '240', 'D'],
  indicators: [],
  tester: { lots: false, magnifier: true },
  trade: { lots: 0.01, showBar: false },
  acct: { balance: 1000, currency: 'USD', leverage: 500, commissionPerLot: 0, stopOut: 0 },
  panel: { tab: 'editor', open: false, height: 44 },
  editor: { source: NEW_SCRIPT_TEMPLATE, name: 'سكربت جديد', id: null },
};

class App {
  constructor() {
    this.state = structuredClone(DEFAULT_STATE);
    this.inds = [];
    this.replay = { active: false, cursor: 0, playing: false, speed: 5, unit: 'bar', timer: 0 };
    this.symbols = [];
    this.base = null; this.meta = null; this.agg = null; this.view = null;
    this.drawings = [];
    this.account = null;
    this.calcStart = 0;
    this.logs = [];
  }

  async boot() {
    const saved = await store.kv.get('state', null);
    if (saved) this.state = { ...structuredClone(DEFAULT_STATE), ...saved, tester: { ...DEFAULT_STATE.tester, ...(saved.tester || {}) }, trade: { ...DEFAULT_STATE.trade, ...(saved.trade || {}) }, acct: { ...DEFAULT_STATE.acct, ...(saved.acct || {}) }, panel: { ...DEFAULT_STATE.panel, ...(saved.panel || {}) }, editor: { ...DEFAULT_STATE.editor, ...(saved.editor || {}) } };
    this.applyTheme();
    document.body.classList.toggle('no-tools', !this.state.tools);
    this.account = (await store.kv.get('account', null)) || A.newAccount(this.state.acct);
    this.chart = new Chart($('#chart'), {
      onLegend: (act, ind) => this.legendAction(act, ind),
      onReplayPick: (i) => this.replayPicked(i),
      onDrawingCreated: () => { this.setTool(null); this.saveDrawings(); },
      onDrawingChanged: () => this.saveDrawings(),
      onSelectDrawing: (d) => this.sheets.drawingPop(d),
      onTradeDrag: (line, price) => this.panels.tradeDrag(line, price),
      onTradeTap: (line) => this.panels.tradeTap(line),
      onView: () => {},
    });
    this.chart.setTheme(this.state.theme);
    this.chart.setOptions({ chartType: this.state.chartType, showVolume: this.state.showVolume, grid: this.state.grid, tzMin: this.state.tzMin, magnet: this.state.magnet });
    this.editor = new Editor($('#tab-editor'), {
      onRun: (src) => this.runEditor(src),
      onSave: (src) => this.saveEditor(src),
      onOpen: () => this.sheets.openScript(),
      onNew: () => this.sheets.newScript(),
      onChange: (src) => { this.state.editor.source = src; this.saveStateSoon(); },
      toast,
    });
    this.editor.set(this.state.editor.source, this.state.editor.name);
    this.panels = initPanels(this);
    this.sheets = initSheets(this);
    this.buildTools();
    this.bindTop();
    this.bindPanel();
    window.btxBack = () => this.back();
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.back(); });
    this.symbols = await store.listSymbols();
    if (!this.symbols.length) { this.chart.emptyText = 'لا توجد بيانات — استورد ملف CSV من القائمة'; this.chart.invalidate(); this.sheets.symbols(); return; }
    if (!this.symbols.some((s) => s.name === this.state.symbol)) this.state.symbol = this.symbols[0].name;
    await this.loadSymbol(this.state.symbol, false);
    // restore indicators
    for (const s of this.state.indicators) this.inds.push({ ...s, rt: null, res: null });
    if (!this.inds.length) { this.addBuiltin('ema', false); }
    this.recomputeAll();
    this.panels.refresh();
  }

  applyTheme() {
    document.body.classList.toggle('theme-light', this.state.theme === 'light');
    document.body.classList.toggle('theme-dark', this.state.theme !== 'light');
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = this.state.theme === 'light' ? '#ffffff' : '#131722';
  }

  // ------------------------------------------------------------------ state persistence
  saveStateSoon() { clearTimeout(this._st); this._st = setTimeout(() => this.saveState(), 400); }
  saveState() {
    this.state.indicators = this.inds.map((x) => ({ uid: x.uid, title: x.title, source: x.source, inputs: x.inputs, visible: x.visible, hidden: x.hidden, styles: x.styles, builtinId: x.builtinId, scriptId: x.scriptId }));
    store.kv.set('state', this.state);
  }
  saveAccount() { store.kv.set('account', this.account); }
  async saveDrawings() { await store.kv.set('drawings:' + this.state.symbol, this.drawings.map((d) => { const { _handles, ...rest } = d; return rest; })); }

  busy(on, text = '') { $('#busy').classList.toggle('hidden', !on); $('#busyText').textContent = text; }

  // ------------------------------------------------------------------ data
  get spec() {
    const m = this.meta || {};
    return { name: m.name || this.state.symbol, digits: m.digits ?? 2, point: m.point || 0.01, contractSize: m.contractSize || 1, quoteCurrency: m.quoteCurrency || 'USD', baseCurrency: m.baseCurrency || '', spread: m.spread ?? m.defaultSpread ?? 0, timezone: m.timezone || 'Etc/UTC', description: m.description || '', type: m.type || 'cfd', quoteToUsd: m.quoteToUsd || 1 };
  }
  get baseSeconds() { return (this.meta && (this.meta.baseSeconds || this.meta.timeUnit)) || 60; }

  async loadSymbol(name, recompute = true) {
    this.busy(true, 'تحميل ' + name + '...');
    try {
      if (this.replay.active) this.exitReplay(true);
      const rec = await store.loadSymbol(name, (t) => this.busy(true, t));
      this.state.symbol = name;
      this.meta = rec.meta; this.base = rec.bars;
      if (this.meta.tfSeconds) this.meta.baseSeconds = this.meta.tfSeconds;
      this.aggCache = new Map();
      this.drawings = (await store.kv.get('drawings:' + name, [])) || [];
      this.chart.setDrawings(this.drawings);
      $('#btnSymbol').textContent = name;
      this.setTf(this.state.tf, recompute, true);
      this.saveState();
    } catch (e) {
      console.error(e);
      toast('خطأ: ' + e.message, 4000);
    } finally { this.busy(false); }
  }

  aggFor(tfStr) {
    const tf = parseTf(tfStr);
    const key = tf.period + '|' + JSON.stringify(this.state.align);
    let a = this.aggCache.get(key);
    if (!a) {
      a = aggregate(this.base, tf, this.state.align, this.baseSeconds);
      if (this.aggCache.size > 6) this.aggCache.delete(this.aggCache.keys().next().value);
      this.aggCache.set(key, a);
    }
    return a;
  }

  setTf(tfStr, recompute = true, newSymbol = false) {
    const tf = parseTf(tfStr);
    if (!tf) { toast('إطار زمني غير صالح'); return; }
    if (tf.seconds < this.baseSeconds && tf.kind !== 'M') { toast('الإطار أصغر من بيانات الرمز الأساسية'); return; }
    this.state.tf = tfStr;
    this.tf = tf;
    this.agg = this.aggFor(tfStr);
    $('#btnTf').textContent = tf.label;
    this.chart.setSymbol(this.spec, tf.seconds * 1000, tf.label);
    this.updateView(false);
    if (recompute) this.recomputeAll();
    this.saveStateSoon();
  }

  /** Visible bars for the chart: full data or limited to the replay cursor. */
  updateView(keepView = true) {
    let v;
    if (this.replay.active) v = limitedView(this.agg, this.base, this.replay.cursor);
    else v = { bars: this.agg.bars, partial: false };
    this.view = v;
    this.chart.setBars(v.bars, keepView, v.partial);
    this.updateTradeLines();
  }

  /** Base bars visible "now" (respecting replay). */
  baseCount() { return this.replay.active ? this.replay.cursor : this.base.length; }
  currentBid() { const k = this.baseCount() - 1; return k >= 0 ? this.base.c[k] : NaN; }
  currentTime() { const k = this.baseCount() - 1; return k >= 0 ? this.base.t[k] + this.baseSeconds * 1000 : 0; }

  /** For request.security: bars of a symbol/timeframe limited to the current replay time. */
  getBarsFor(symbol, tf, untilTime, ha) {
    let base = this.base, meta = this.meta, aggs = null;
    if (symbol && symbol !== this.state.symbol) {
      const rec = store.cached(symbol);
      if (!rec) return null;
      base = rec.bars; meta = rec.meta;
    } else aggs = this.aggCache;
    const tfo = typeof tf === 'string' ? parseTf(tf) : tf;
    let a;
    if (aggs) { const key = tfo.period + '|' + JSON.stringify(this.state.align); a = aggs.get(key); if (!a) { a = aggregate(base, tfo, this.state.align, this.baseSeconds); aggs.set(key, a); } }
    else a = aggregate(base, tfo, this.state.align, (meta && meta.baseSeconds) || 60);
    let bars = a.bars;
    if (this.replay.active) {
      const tNow = this.base.t[this.replay.cursor - 1];
      let lo = 0, hi = base.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (base.t[m] <= tNow) lo = m + 1; else hi = m; }
      bars = limitedView(a, base, lo).bars;
    }
    if (ha) bars = heikinAshi(bars);
    const sym = meta ? { name: symbol, digits: meta.digits, point: meta.point } : undefined;
    return { bars, symbol: sym };
  }

  magnifierFor(start) {
    if (this.agg.identity) return null;
    const agg = this.agg, base = this.base;
    const limit = this.baseCount();
    return (i) => {
      const k = i + start;
      const s = agg.start[k];
      let e = k + 1 < agg.start.length ? agg.start[k + 1] : base.length;
      if (e > limit) e = limit;
      if (!(e > s)) return null;
      const path = [];
      for (let j = s; j < e; j++) {
        const o = base.o[j], hh = base.h[j], l = base.l[j], c = base.c[j];
        if (Math.abs(hh - o) < Math.abs(l - o)) path.push(o, hh, l, c); else path.push(o, l, hh, c);
      }
      return path;
    };
  }

  // ------------------------------------------------------------------ indicators
  newUid() { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  addBuiltin(id, recompute = true) {
    const b = BUILTIN_SCRIPTS.find((x) => x.id === id);
    if (!b) return;
    return this.addScript(b.src, b.name, { builtinId: id }, recompute);
  }
  addScript(source, title, extra = {}, recompute = true) {
    const inst = { uid: this.newUid(), title: title || 'Script', source, inputs: [], visible: true, hidden: {}, styles: {}, rt: null, res: null, ...extra };
    this.inds.push(inst);
    if (recompute) { this.runInd(inst); this.pushIndicators(); }
    this.saveState();
    return inst;
  }
  removeInd(inst) {
    this.inds = this.inds.filter((x) => x !== inst);
    this.pushIndicators();
    this.saveState();
    this.panels.refresh();
  }

  calcRange() {
    const n = this.view.bars.length;
    if (this.replay.active && this.replay.start !== undefined) return Math.max(0, Math.min(this.replay.start, n - 1));
    return Math.max(0, n - this.state.maxBars);
  }

  async ensureSecuritySymbols(ast) {
    for (const s of scanSecuritySymbols(ast)) {
      if (s === this.state.symbol || store.cached(s)) continue;
      if (this.symbols.some((x) => x.name === s)) { try { await store.loadSymbol(s); } catch (e) { /* */ } }
    }
  }

  runInd(inst, incremental = false) {
    const view = this.view;
    if (!view || !view.bars.length) return;
    const t0 = performance.now();
    try {
      if (!inst.ast) {
        inst.ast = parse(inst.source);
        this.ensureSecuritySymbols(inst.ast).then(() => { if (inst.needsRerun) { inst.needsRerun = false; this.runInd(inst); this.pushIndicators(); } });
      }
      const n = view.bars.length;
      const start = this.calcRange();
      const complete = view.partial ? n - 1 : n;
      const sub = sliceBars(view.bars, start, n);
      let rt = inst.rt;
      const canInc = incremental && rt && rt.offset === start && !rt.usesSecurity && rt.done <= complete - start && rt.n <= sub.length && rt.agg === this.agg && rt.sym.name === this.state.symbol;
      if (canInc) {
        rt.extend(sub);
        rt.opts.partialLast = view.partial;
        rt.run(complete - start);
        if (view.partial) rt.runForming();
      } else {
        rt = new PineRuntime({
          ast: inst.ast, bars: sub, symbol: this.spec, tf: this.tf, align: this.state.align, inputs: inst.inputs,
          getBars: (s, tf, until, ha) => this.getBarsFor(s, tf, until, ha),
          strategyOverrides: { ...this.state.tester, ...(inst.testerOverrides || {}) },
          magnifier: this.state.tester.magnifier ? this.magnifierFor(start) : null,
          theme: { bg: this.state.theme === 'light' ? '#ffffffff' : '#131722ff', fg: this.state.theme === 'light' ? '#131722ff' : '#d1d4dcff' },
          partialLast: view.partial, now: this.currentTime(),
        });
        rt.offset = start; rt.agg = this.agg;
        rt.run(complete - start);
        if (view.partial) rt.runForming();
      }
      if (!canInc) { rt.offset = start; rt.agg = this.agg; }
      inst.rt = rt;
      inst.res = rt.result();
      inst.offset = start;
      inst.error = null;
      inst.isStrategy = inst.res.decl.kind === 'strategy';
      if (!inst.titleLocked) inst.title = inst.res.decl.shorttitle || inst.res.decl.title || inst.title;
      inst.paneId = inst.res.decl.overlay ? 'main' : inst.uid;
      inst.ms = performance.now() - t0;
      this.applyStyles(inst);
      if (inst.res.warnings.length && !inst.warned) { inst.warned = true; for (const w of inst.res.warnings) this.log('warn', inst.title + ': ' + w); }
    } catch (e) {
      console.error(e);
      inst.error = { msg: e.message, line: e.line };
      inst.res = null; inst.rt = null;
      inst.paneId = inst.paneId || 'main';
      this.log('error', `${inst.title}: ${e.line ? 'سطر ' + e.line + ': ' : ''}${e.message}`);
    }
  }
  applyStyles(inst) {
    if (!inst.res || !inst.styles) return;
    for (const p of inst.res.out.plots) {
      const s = inst.styles[p.id];
      if (!s) continue;
      if (s.color && !p.colors) p.colors0 = s.color;
      if (s.width) p.lineWidth = s.width;
    }
  }

  recomputeAll(incremental = false) {
    if (!this.view) return;
    for (const inst of this.inds) this.runInd(inst, incremental);
    this.pushIndicators();
  }
  pushIndicators() {
    const list = this.inds.map((x) => ({ ...x, visible: x.visible !== false }));
    // chart objects carry references; bar colors from overlay indicators
    this.chart.setIndicators(this.inds);
    const bcs = this.inds.filter((x) => x.res && x.visible !== false && x.res.out.barcolors.length);
    this.chart.barColorFn = bcs.length ? (i) => {
      for (const ind of bcs) for (const bc of ind.res.out.barcolors) {
        const ri = i - ind.offset - (bc.offset || 0);
        if (ri < 0 || ri >= ind.res.n) continue;
        const c = bc.colors ? bc.colors[ri] : bc.colors0;
        if (typeof c === 'string') return c.length === 9 ? c : c;
      }
      return null;
    } : null;
    void list;
    this.panels.refreshTester();
    this.panels.refreshLog();
  }

  legendAction(act, ind) {
    if (act === 'toggle') { ind.visible = ind.visible === false; this.pushIndicators(); this.saveState(); }
    else if (act === 'remove') this.removeInd(ind);
    else if (act === 'settings') this.sheets.indicatorSettings(ind);
    else if (act === 'source') { this.editorTarget = ind; this.editor.set(ind.source, ind.title); this.state.editor = { source: ind.source, name: ind.title, id: ind.scriptId || null }; this.openPanel('editor'); }
  }

  // ------------------------------------------------------------------ editor actions
  runEditor(src) {
    let ast;
    try { ast = parse(src); } catch (e) { this.editor.errors([{ line: e.line, msg: e.message }]); return; }
    void ast;
    let inst = this.editorTarget && this.inds.includes(this.editorTarget) ? this.editorTarget : null;
    if (inst) { inst.source = src; inst.ast = null; inst.rt = null; inst.warned = false; }
    else inst = this.addScript(src, this.state.editor.name, { scriptId: this.state.editor.id }, false);
    this.editorTarget = inst;
    this.runInd(inst);
    this.pushIndicators();
    this.saveState();
    const msgs = [];
    if (inst.error) msgs.push({ line: inst.error.line, msg: inst.error.msg });
    else {
      msgs.push({ level: 'ok', msg: `✓ تم التشغيل على ${inst.res.n.toLocaleString()} شمعة خلال ${inst.ms.toFixed(0)}ms` });
      for (const w of inst.res.warnings) msgs.push({ level: 'warn', msg: w });
      if (inst.isStrategy) this.openPanel('tester');
    }
    this.editor.errors(msgs);
  }
  async saveEditor(src) {
    let id = this.state.editor.id;
    let name = this.state.editor.name;
    try { const a = parse(src); void a; const m = /(?:indicator|strategy|study)\s*\(\s*(?:title\s*=\s*)?["']([^"']+)/.exec(src); if (m && (!name || name === 'سكربت جديد')) name = m[1]; } catch (e) { /* save anyway */ }
    if (!id) id = 's' + Date.now().toString(36);
    await store.scripts.put({ id, name, source: src });
    this.state.editor = { source: src, name, id };
    this.editor.setName(name);
    if (this.editorTarget) this.editorTarget.scriptId = id;
    this.saveState();
    toast('تم حفظ السكربت: ' + name);
  }

  // ------------------------------------------------------------------ toolbar & panels
  buildTools() {
    const ic = {
      cursor: '<svg viewBox="0 0 24 24"><path d="M5 3l13 8-6 1.5L9 19z"/></svg>',
      trend: '<svg viewBox="0 0 24 24"><path d="M4 19 20 5"/><circle cx="4" cy="19" r="1.6"/><circle cx="20" cy="5" r="1.6"/></svg>',
      ray: '<svg viewBox="0 0 24 24"><path d="M4 18 21 7"/><circle cx="4" cy="18" r="1.6"/><circle cx="11" cy="13.5" r="1.6"/></svg>',
      extended: '<svg viewBox="0 0 24 24"><path d="M2 20 22 4"/><circle cx="8" cy="15" r="1.6"/><circle cx="16" cy="9" r="1.6"/></svg>',
      arrow: '<svg viewBox="0 0 24 24"><path d="M4 19 19 6M19 6h-6M19 6v6"/></svg>',
      hline: '<svg viewBox="0 0 24 24"><path d="M2 12h20"/><circle cx="12" cy="12" r="1.6"/></svg>',
      hray: '<svg viewBox="0 0 24 24"><path d="M6 12h16"/><circle cx="6" cy="12" r="1.6"/></svg>',
      vline: '<svg viewBox="0 0 24 24"><path d="M12 2v20"/><circle cx="12" cy="12" r="1.6"/></svg>',
      rect: '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12"/></svg>',
      channel: '<svg viewBox="0 0 24 24"><path d="M3 15 15 4M9 20 21 9"/></svg>',
      fib: '<svg viewBox="0 0 24 24"><path d="M3 5h18M3 10h18M3 14h18M3 19h18"/></svg>',
      long: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="8" fill="rgba(8,153,129,.35)"/><rect x="4" y="12" width="16" height="6" fill="rgba(242,54,69,.35)"/></svg>',
      short: '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="6" fill="rgba(242,54,69,.35)"/><rect x="4" y="12" width="16" height="8" fill="rgba(8,153,129,.35)"/></svg>',
      measure: '<svg viewBox="0 0 24 24"><path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/></svg>',
      text: '<svg viewBox="0 0 24 24"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>',
      magnet: '<svg viewBox="0 0 24 24"><path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z"/></svg>',
      eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
      trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    };
    const nav = $('#tools');
    const add = (id, html, title, fn) => { const b = h('button', { class: 'ib', title, html, onclick: fn }); b.dataset.tool = id; nav.append(b); return b; };
    add('cursor', ic.cursor, 'مؤشر', () => this.setTool(null));
    for (const k of ['trend', 'ray', 'extended', 'arrow', 'hline', 'hray', 'vline', 'rect', 'channel', 'fib', 'long', 'short', 'measure', 'text']) add(k, ic[k], TOOLS[k].name, () => this.setTool(this.chart.tool === k ? null : k));
    nav.append(h('div', { class: 'sep' }));
    this.magnetBtn = add('magnet', ic.magnet, 'المغناطيس', () => { this.state.magnet = !this.state.magnet; this.chart.setOptions({ magnet: this.state.magnet }); this.magnetBtn.classList.toggle('on', this.state.magnet); this.saveStateSoon(); });
    this.magnetBtn.classList.toggle('on', this.state.magnet);
    add('eye', ic.eye, 'إخفاء/إظهار الرسومات', () => { const hide = !this.drawings.every((d) => d.hidden); for (const d of this.drawings) d.hidden = hide; this.chart.invalidate(); this.saveDrawings(); });
    add('trash', ic.trash, 'حذف كل الرسومات', async () => { if (!this.drawings.length) return; if (await confirmBox('حذف كل الرسومات على هذا الرمز؟', 'حذف', true)) { this.drawings.length = 0; this.chart.select(null); this.chart.invalidate(); this.saveDrawings(); } });
    this.setTool(null);
  }
  setTool(t) {
    this.chart.setTool(t);
    for (const b of $$('#tools .ib')) if (b.dataset.tool && b.dataset.tool !== 'magnet') b.classList.toggle('on', (t || 'cursor') === b.dataset.tool);
    if (t === 'text') toast('اضغط على الشارت لوضع النص');
    else if (t && TOOLS[t] && TOOLS[t].n > 1) toast('اضغط نقطتين على الشارت (أو اسحب)');
  }

  bindTop() {
    $('#btnMenu').onclick = () => this.sheets.menu();
    $('#btnSymbol').onclick = () => this.sheets.symbols();
    $('#btnTf').onclick = () => this.sheets.timeframes();
    $('#btnType').onclick = () => this.sheets.chartType();
    $('#btnInd').onclick = () => this.sheets.indicators();
    $('#btnReplay').onclick = () => this.sheets.replayMenu();
    $('#btnTrade').onclick = () => this.toggleTradeBar();
    $('#btnSettings').onclick = () => this.sheets.settings();
    $('#btnTools').onclick = () => { this.state.tools = !this.state.tools; document.body.classList.toggle('no-tools', !this.state.tools); this.saveStateSoon(); };
    if (this.state.trade.showBar) this.toggleTradeBar(true);
  }
  bindPanel() {
    const panel = $('#panel');
    for (const b of $$('#tabs button[data-tab]')) b.onclick = () => { if (this.state.panel.open && this.state.panel.tab === b.dataset.tab) this.closePanel(); else this.openPanel(b.dataset.tab); };
    $('#panelClose').onclick = () => this.closePanel();
    $('#panelMax').onclick = () => { panel.classList.toggle('max'); if (panel.classList.contains('collapsed')) this.openPanel(this.state.panel.tab); };
    // drag to resize
    const tabs = $('#tabs');
    let drag = null;
    tabs.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; drag = { y: e.clientY, h: panel.getBoundingClientRect().height }; tabs.setPointerCapture(e.pointerId); });
    tabs.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const H = $('#app').getBoundingClientRect().height;
      const hh = Math.max(38, Math.min(H * 0.9, drag.h - (e.clientY - drag.y)));
      panel.classList.remove('collapsed', 'max');
      panel.style.height = hh + 'px';
      this.state.panel.open = hh > 60;
      this.state.panel.height = hh / H * 100;
    });
    tabs.addEventListener('pointerup', () => { if (drag) { drag = null; if (!this.state.panel.open) this.closePanel(); this.saveStateSoon(); } });
    if (this.state.panel.open) this.openPanel(this.state.panel.tab); else this.closePanel();
  }
  openPanel(tab) {
    const panel = $('#panel');
    panel.classList.remove('collapsed');
    panel.style.height = (this.state.panel.height || 44) + '%';
    this.state.panel.open = true; this.state.panel.tab = tab;
    for (const b of $$('#tabs button[data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
    for (const c of $$('.tabc')) c.classList.toggle('on', c.id === 'tab-' + tab);
    if (tab === 'tester') this.panels.refreshTester(true);
    if (tab === 'trade') this.panels.refreshTrade(true);
    if (tab === 'log') this.panels.refreshLog(true);
    this.saveStateSoon();
  }
  closePanel() {
    const panel = $('#panel');
    panel.classList.add('collapsed'); panel.classList.remove('max');
    this.state.panel.open = false;
    for (const b of $$('#tabs button[data-tab]')) b.classList.remove('on');
    this.saveStateSoon();
  }

  back() {
    if (closeTopSheet()) return true;
    if (this.chart.replayPick) { this.chart.replayPick = false; this.chart.cross = null; this.chart.invalidate(); if (!this.replay.active) toast('أُلغي اختيار نقطة الإعادة'); return true; }
    if (this.chart.tool) { this.setTool(null); return true; }
    if (this.chart.selected) { this.chart.select(null); return true; }
    if ($('#panel').classList.contains('max')) { $('#panel').classList.remove('max'); return true; }
    if (this.state.panel.open) { this.closePanel(); return true; }
    if (this.chart.cross) { this.chart.cross = null; this.chart.crossLocked = false; this.chart.invalidateOverlay(); return true; }
    return false;
  }

  log(level, msg) {
    this.logs.push({ level, msg, at: Date.now() });
    if (this.logs.length > 500) this.logs.shift();
    this.panels && this.panels.refreshLog();
  }

  // ------------------------------------------------------------------ replay
  startReplayPick() {
    this.chart.replayPick = true;
    this.chart.setTool(null);
    toast('اضغط على الشمعة التي تريد بدء الإعادة بعدها', 3000);
  }
  replayPicked(i) {
    this.chart.replayPick = false;
    this.chart.cross = null;
    const agg = this.view && this.replay.active ? this.agg : this.agg;
    const cursor = i + 1 < agg.start.length ? agg.start[i + 1] : this.base.length;
    this.startReplayAt(cursor);
  }
  startReplayRandom() {
    const n = this.base.length;
    const min = Math.min(n - 1, Math.max(this.state.maxBars, Math.floor(n * 0.1)));
    const cursor = Math.floor(min + Math.random() * (n * 0.97 - min));
    this.startReplayAt(Math.max(100, cursor));
  }
  startReplayAtTime(t) {
    let lo = 0, hi = this.base.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.base.t[m] < t) lo = m + 1; else hi = m; }
    this.startReplayAt(Math.max(50, lo));
  }
  startReplayAt(cursor) {
    this.stopPlay();
    if (this.account.positions.length || this.account.orders.length) {
      const bid = this.currentBid();
      A.closeAll(this.account, this.spec, bid, this.currentTime());
      this.account.orders = [];
      this.saveAccount();
    }
    this.replay.active = true;
    this.replay.cursor = Math.max(1, Math.min(this.base.length, cursor));
    const v = limitedView(this.agg, this.base, this.replay.cursor);
    this.replay.start = Math.max(0, v.bars.length - this.state.maxBars);
    this.updateView(false);
    this.chart.scrollToEnd();
    for (const x of this.inds) x.rt = null;
    this.recomputeAll();
    this.sheets.replayBar(true);
    $('#btnReplay').classList.add('on');
    this.panels.refreshTrade();
    toast('وضع الإعادة: اضغط ▶ للتشغيل أو ⏭ للتقدم شمعة');
  }
  exitReplay(silent = false) {
    this.stopPlay();
    this.replay.active = false;
    this.replay.start = undefined;
    this.chart.replayPick = false;
    this.sheets.replayBar(false);
    $('#btnReplay').classList.remove('on');
    if (!silent) { for (const x of this.inds) x.rt = null; this.updateView(true); this.recomputeAll(); this.chart.scrollToEnd(); }
    this.panels.refreshTrade();
  }
  stepReplay(times = 1) {
    if (!this.replay.active) return;
    const base = this.base;
    const prev = this.replay.cursor;
    let cur = prev;
    for (let s = 0; s < times; s++) {
      if (cur >= base.length) break;
      if (this.replay.unit === 'bar' && !this.agg.identity) {
        const k = this.agg.aggIdx[cur - 1];
        const lastOfBar = k + 1 < this.agg.start.length ? this.agg.start[k + 1] : base.length;
        // if the current bar is partial, finish it; otherwise move to the end of the next bar
        if (cur < lastOfBar) cur = lastOfBar;
        else cur = k + 2 < this.agg.start.length ? this.agg.start[k + 2] : base.length;
      } else cur++;
    }
    if (cur === prev) { this.stopPlay(); toast('نهاية البيانات'); return; }
    // process trading on every new base bar
    const events = [];
    for (let j = prev; j < cur; j++) {
      if (this.account.positions.length || this.account.orders.length) {
        const ev = A.processBar(this.account, this.spec, base.o[j], base.h[j], base.l[j], base.c[j], base.t[j] + this.baseSeconds * 1000);
        if (ev.length) events.push(...ev);
      }
    }
    this.replay.cursor = cur;
    const oldN = this.view.bars.length;
    this.updateView(true);
    const incremental = this.view.bars.length >= oldN;
    this.recomputeAll(incremental);
    if (events.length) { this.saveAccount(); this.tradeEvents(events); }
    this.sheets.replayBar(true);
    this.panels.refreshTrade();
  }
  tradeEvents(events) {
    for (const e of events) {
      const acc = this.account;
      if (e.type === 'tp') toast(`✅ TP: ${e.rec.points} نقطة  ${A.money(acc, e.rec.net, true)}`);
      else if (e.type === 'sl') toast(`⛔ SL: ${e.rec.points} نقطة  ${A.money(acc, e.rec.net, true)}`);
      else if (e.type === 'fill') toast(`تم تنفيذ ${e.order.type.replace('_', ' ')} ${e.order.lots}`);
      else if (e.type === 'stopout') toast('⚠️ Stop Out — أُغلقت صفقة لنفاد الهامش', 3500);
      this.log(e.type === 'stopout' || e.type === 'sl' ? 'warn' : 'info', `تداول: ${e.type} ${e.rec ? A.money(acc, e.rec.net, true) + ' (' + e.rec.points + ' pts)' : ''}`);
    }
  }
  togglePlay() {
    if (this.replay.playing) this.stopPlay();
    else {
      this.replay.playing = true;
      if (window.BTX && window.BTX.keepScreenOn) try { window.BTX.keepScreenOn(true); } catch (e) { /* */ }
      const tick = () => {
        if (!this.replay.playing) return;
        const sp = this.replay.speed;
        const per = sp > 20 ? Math.round(sp / 20) : 1;
        const t0 = performance.now();
        this.stepReplay(per);
        const took = performance.now() - t0;
        const interval = Math.max(10, (1000 / Math.min(sp, 20)) - took);
        this.replay.timer = setTimeout(tick, interval);
      };
      tick();
    }
    this.sheets.replayBar(true);
  }
  stopPlay() { this.replay.playing = false; clearTimeout(this.replay.timer); if (window.BTX && window.BTX.keepScreenOn) try { window.BTX.keepScreenOn(false); } catch (e) { /* */ } if (this.replay.active) this.sheets && this.sheets.replayBar(true); }

  // ------------------------------------------------------------------ trading glue
  toggleTradeBar(force) {
    this.state.trade.showBar = force !== undefined ? force : !this.state.trade.showBar;
    $('#btnTrade').classList.toggle('on', this.state.trade.showBar);
    document.body.classList.toggle('trading', this.state.trade.showBar);
    this.panels.renderTradeBar();
    this.updateTradeLines();
    this.saveStateSoon();
  }
  updateTradeLines() {
    if (!this.chart) return;
    const acc = this.account;
    if (!acc || !this.base) { this.chart.setTrade(null); return; }
    const sp = this.spec;
    const bid = this.currentBid();
    const show = this.state.trade.showBar || acc.positions.length || acc.orders.length;
    if (!show) { this.chart.setTrade(null); return; }
    const pos = acc.positions.map((p) => {
      const cp = A.closePriceFor(sp, p.side, bid);
      const pr = A.profitUsd(sp, p.side, p.lots, p.openPrice, cp);
      const pts = A.points(sp, p.side, p.openPrice, cp);
      const slPr = isFinite(p.sl) ? A.profitUsd(sp, p.side, p.lots, p.openPrice, p.sl) : NaN;
      const tpPr = isFinite(p.tp) ? A.profitUsd(sp, p.side, p.lots, p.openPrice, p.tp) : NaN;
      return { ...p, pnlText: `${A.money(acc, pr, true)} (${pts > 0 ? '+' : ''}${pts})`, pnlColor: pr >= 0 ? '#26a69a' : '#ef5350', slText: isFinite(slPr) ? A.money(acc, slPr, true) : '', tpText: isFinite(tpPr) ? A.money(acc, tpPr, true) : '' };
    });
    this.chart.setTrade({ positions: pos, orders: acc.orders, ask: this.state.trade.showBar ? A.ask(sp, bid) : null, lots: this.state.trade.lots });
  }
}

const app = new App();
window.app = app;
const __t0 = performance.now();
app.boot().then(() => { window.__bootMs = Math.round(performance.now() - __t0); }).catch((e) => { console.error(e); toast('خطأ في التشغيل: ' + e.message, 6000); });
export default app;
void bucketStart; void anySheet; void sheet;

// Bottom panels: strategy tester, trading, log; quick trade bar
import { h, $, sheet, toast, confirmBox, fmtMoney, fmtNum, fmtDate, download } from './dom.js';
import { strategyReport } from '../pine/strategy.js';
import * as A from '../trading/account.js';

export function initPanels(app) {
  const P = {};
  let testerSub = 'overview', tradeSub = 'positions';
  let selStrategy = null;

  // ================================================================ STRATEGY TESTER
  P.refreshTester = (force) => {
    const root = $('#tab-tester');
    if (!force && !(app.state.panel.open && app.state.panel.tab === 'tester')) return;
    root.innerHTML = '';
    const strats = app.inds.filter((x) => x.isStrategy && x.res);
    if (!strats.length) {
      root.append(h('div', { class: 'panel-pad' },
        h('p', { class: 'note' }, 'لا توجد استراتيجية على الشارت. أضف استراتيجية من قائمة المؤشرات (ƒx ← استراتيجيات) أو اكتب strategy() في محرر Pine واضغط إضافة.'),
        h('button', { class: 'btn pri', onclick: () => app.sheets.indicators('استراتيجيات') }, 'إضافة استراتيجية')));
      return;
    }
    if (!selStrategy || !strats.includes(selStrategy)) selStrategy = strats[0];
    const ind = selStrategy;
    const B = ind.res.broker;
    const bars = app.view.bars;
    const sub = { t: bars.t.subarray(ind.offset), o: bars.o.subarray(ind.offset), c: bars.c.subarray(ind.offset) };
    const rep = strategyReport(B, sub, ind.res.n);
    const cur = B.cfg.currency === 'USD' ? '$' : ' ' + B.cfg.currency;
    const m = (v) => (isFinite(v) ? (v < 0 ? '-' : '') + fmtMoney(Math.abs(v)) + cur : '—');
    const head = h('div', { class: 'ed-bar' },
      strats.length > 1 ? h('select', { onchange: (e) => { selStrategy = strats[+e.target.value]; P.refreshTester(true); } }, strats.map((s, k) => h('option', { value: k, selected: s === ind }, s.title))) : h('span', { class: 'name' }, ind.title),
      h('button', { class: 'btn sm', onclick: () => properties() }, '⚙ الخصائص'),
      h('button', { class: 'btn sm', onclick: () => exportTrades(B) }, 'تصدير CSV'),
      h('span', { class: 'mini' }, `${ind.res.n.toLocaleString()} شمعة · ${B.cfg.magnifier && app.agg && !app.agg.identity ? 'Bar Magnifier ✓' : 'OHLC'} · ${B.cfg.lots ? 'وحدة: لوت' : 'وحدة: عقود'}`));
    const tabs = h('div', { class: 'tabs2' }, ...[['overview', 'نظرة عامة'], ['summary', 'ملخص الأداء'], ['trades', 'قائمة الصفقات']].map(([k, t]) => h('button', { class: testerSub === k ? 'on' : '', onclick: () => { testerSub = k; P.refreshTester(true); } }, t)));
    root.append(head, h('div', { class: 'panel-pad', style: { paddingTop: 0 } }, tabs));
    const body = h('div', {});
    root.append(body);
    if (testerSub === 'overview') {
      const a = rep.all;
      const kp = (t, v, cls = '') => h('div', { class: 'kpi' }, h('small', {}, t), h('b', { class: cls }, v));
      body.append(h('div', { class: 'kpis' },
        kp('صافي الربح', m(a.net) + ` (${fmtNum(a.netPct)}%)`, a.net >= 0 ? 'up' : 'dn'),
        kp('عدد الصفقات المغلقة', String(a.total)),
        kp('نسبة الربح', isFinite(a.winRate) ? fmtNum(a.winRate) + '%' : '—'),
        kp('معامل الربح', isFinite(a.pf) ? fmtNum(a.pf, 3) : a.pf === Infinity ? '∞' : '—'),
        kp('أقصى تراجع', m(-rep.maxDD) + ` (${fmtNum(rep.maxDDpct)}%)`, 'dn'),
        kp('متوسط الصفقة', m(a.avg), a.avg >= 0 ? 'up' : 'dn'),
        kp('متوسط الشموع بالصفقة', fmtNum(a.avgBars, 1)),
        kp('صفقات مفتوحة', String(rep.openTrades) + (rep.openTrades ? ' · ' + m(rep.openPL) : ''))));
      const cv = h('canvas', { class: 'eqc' });
      body.append(h('div', { class: 'panel-pad' }, cv));
      requestAnimationFrame(() => drawEquity(cv, rep, B));
    } else if (testerSub === 'summary') {
      const rows = [
        ['صافي الربح', (s) => m(s.net)], ['إجمالي الربح', (s) => m(s.gp)], ['إجمالي الخسارة', (s) => m(-s.gl)], ['معامل الربح', (s) => (isFinite(s.pf) ? fmtNum(s.pf, 3) : '—')],
        ['العمولات المدفوعة', (s) => m(s.commission)], ['إجمالي الصفقات', (s) => s.total], ['الرابحة', (s) => s.wins], ['الخاسرة', (s) => s.losses], ['نسبة الربح', (s) => (isFinite(s.winRate) ? fmtNum(s.winRate) + '%' : '—')],
        ['متوسط الصفقة', (s) => m(s.avg)], ['متوسط الرابحة', (s) => m(s.avgWin)], ['متوسط الخاسرة', (s) => m(-s.avgLoss)], ['نسبة متوسط الربح/الخسارة', (s) => fmtNum(s.ratio, 3)],
        ['أكبر صفقة رابحة', (s) => m(s.largestWin)], ['أكبر صفقة خاسرة', (s) => m(s.largestLoss)], ['أقصى أرباح متتالية', (s) => s.maxConsWins], ['أقصى خسائر متتالية', (s) => s.maxConsLosses], ['متوسط عدد الشموع', (s) => fmtNum(s.avgBars, 1)],
      ];
      const t = h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, ''), h('th', { class: 'num' }, 'الكل'), h('th', { class: 'num' }, 'شراء'), h('th', { class: 'num' }, 'بيع')),
        rows.map(([name, f]) => h('tr', {}, h('td', { style: { direction: 'rtl', textAlign: 'right' } }, name), h('td', { class: 'num' }, f(rep.all)), h('td', { class: 'num' }, f(rep.long)), h('td', { class: 'num' }, f(rep.short)))),
        h('tr', {}, h('td', { style: { textAlign: 'right' } }, 'رأس المال الابتدائي'), h('td', { class: 'num' }, m(rep.initialCapital)), h('td'), h('td')),
        h('tr', {}, h('td', { style: { textAlign: 'right' } }, 'أقصى تراجع'), h('td', { class: 'num' }, m(-rep.maxDD) + ` (${fmtNum(rep.maxDDpct)}%)`), h('td'), h('td')),
        h('tr', {}, h('td', { style: { textAlign: 'right' } }, 'أقصى صعود'), h('td', { class: 'num' }, m(rep.maxRU)), h('td'), h('td')),
        h('tr', {}, h('td', { style: { textAlign: 'right' } }, 'عائد الشراء والاحتفاظ'), h('td', { class: 'num' }, fmtNum(rep.buyHold) + '%'), h('td'), h('td')),
        h('tr', {}, h('td', { style: { textAlign: 'right' } }, 'Sharpe / Sortino'), h('td', { class: 'num' }, fmtNum(rep.sharpe, 3) + ' / ' + fmtNum(rep.sortino, 3)), h('td'), h('td')),
        h('tr', {}, h('td', { style: { textAlign: 'right' } }, 'أقصى حجم مُحتفظ به'), h('td', { class: 'num' }, fmtNum(rep.maxHeld, 4)), h('td'), h('td')));
      body.append(t);
    } else {
      const C = B.closed.slice(-1000).reverse();
      const tz = app.state.tzMin;
      const t = h('table', { class: 'tbl' },
        h('tr', {}, ['#', 'النوع', 'الإشارة', 'الدخول', 'سعر الدخول', 'الخروج', 'سعر الخروج', 'الكمية', 'الربح', '%', 'التراكمي', 'Run-up', 'Drawdown'].map((x) => h('th', {}, x))),
        C.map((tr) => h('tr', { onclick: () => app.chart.scrollToTime(tr.entryTime) },
          h('td', {}, tr.n), h('td', { class: tr.dir === 1 ? 'up' : 'dn' }, tr.dir === 1 ? 'Long' : 'Short'), h('td', {}, tr.entryComment + ' → ' + tr.exitComment),
          h('td', {}, fmtDate(tr.entryTime, tz)), h('td', { class: 'num' }, tr.entryPrice.toFixed(app.spec.digits)),
          h('td', {}, fmtDate(tr.exitTime, tz)), h('td', { class: 'num' }, tr.exitPrice.toFixed(app.spec.digits)),
          h('td', { class: 'num' }, fmtNum(tr.qty, 4)), h('td', { class: 'num ' + (tr.profit >= 0 ? 'up' : 'dn') }, m(tr.profit)), h('td', { class: 'num' }, fmtNum(tr.profitPct) + '%'),
          h('td', { class: 'num' }, m(tr.cum)), h('td', { class: 'num' }, m(tr.runup)), h('td', { class: 'num' }, m(tr.drawdown)))));
      body.append(t);
      if (B.closed.length > 1000) body.append(h('p', { class: 'note panel-pad' }, 'يتم عرض آخر 1000 صفقة. صدّر CSV لرؤية الكل.'));
    }
  };

  function drawEquity(cv, rep, B) {
    const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    const W = r.width, H = r.height;
    const eq = rep.equity;
    ctx.clearRect(0, 0, W, H);
    if (eq.length < 2) return;
    let lo = Infinity, hi = -Infinity;
    for (const v of eq) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi === lo) { hi += 1; lo -= 1; }
    const x = (i) => i / (eq.length - 1) * (W - 50);
    const y = (v) => 8 + (hi - v) / (hi - lo) * (H - 16);
    // drawdown shading
    let peak = -Infinity;
    ctx.fillStyle = 'rgba(242,54,69,0.18)';
    for (let i = 0; i < eq.length; i++) { peak = Math.max(peak, eq[i]); if (eq[i] < peak) ctx.fillRect(x(i), y(peak), Math.max(1, (W - 50) / eq.length), y(eq[i]) - y(peak)); }
    ctx.beginPath();
    for (let i = 0; i < eq.length; i++) { if (i === 0) ctx.moveTo(x(i), y(eq[i])); else ctx.lineTo(x(i), y(eq[i])); }
    ctx.strokeStyle = '#2962ff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.lineTo(x(eq.length - 1), H); ctx.lineTo(0, H); ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(41,98,255,.25)'); g.addColorStop(1, 'rgba(41,98,255,0)');
    ctx.fillStyle = g; ctx.fill();
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--fg2');
    ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(fmtMoney(hi, 0), W - 48, 12); ctx.fillText(fmtMoney(lo, 0), W - 48, H - 4);
    const y0 = y(B.cfg.initialCapital); ctx.strokeStyle = 'rgba(120,123,134,.5)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(W - 50, y0); ctx.stroke(); ctx.setLineDash([]);
  }

  function exportTrades(B) {
    const rows = [['#', 'type', 'entry_signal', 'exit_signal', 'entry_time', 'entry_price', 'exit_time', 'exit_price', 'qty', 'profit', 'profit_pct', 'cum_profit', 'runup', 'drawdown', 'commission'].join(',')];
    for (const t of B.closed) rows.push([t.n, t.dir === 1 ? 'long' : 'short', t.entryComment, t.exitComment, new Date(t.entryTime).toISOString(), t.entryPrice, new Date(t.exitTime).toISOString(), t.exitPrice, t.qty, t.profit.toFixed(2), t.profitPct.toFixed(3), t.cum.toFixed(2), t.runup.toFixed(2), t.drawdown.toFixed(2), t.commission.toFixed(2)].join(','));
    download(`trades_${app.state.symbol}_${Date.now()}.csv`, rows.join('\n'), 'text/csv');
  }

  function properties() {
    const T = app.state.tester;
    const f = {};
    const num = (k, d, step = 'any') => (f[k] = h('input', { type: 'number', step, value: T[k] ?? d ?? '' }));
    const body = h('div', { class: 'form' },
      h('div', { class: 'full note' }, 'القيم الفارغة تعني استخدام القيم المكتوبة داخل strategy() في السكربت.'),
      h('label', {}, 'رأس المال الابتدائي'), num('initial_capital'),
      h('label', {}, 'نوع حجم الأمر'), f.default_qty_type = h('select', {}, h('option', { value: '' }, '(من السكربت)'), h('option', { value: 'fixed', selected: T.default_qty_type === 'fixed' }, 'ثابت (عقود/لوت)'), h('option', { value: 'cash', selected: T.default_qty_type === 'cash' }, 'نقدي'), h('option', { value: 'percent_of_equity', selected: T.default_qty_type === 'percent_of_equity' }, '% من رأس المال')),
      h('label', {}, 'قيمة حجم الأمر'), num('default_qty_value'),
      h('label', {}, 'Pyramiding'), num('pyramiding', '', 1),
      h('label', {}, 'نوع العمولة'), f.commission_type = h('select', {}, h('option', { value: '' }, '(من السكربت)'), h('option', { value: 'percent', selected: T.commission_type === 'percent' }, '%'), h('option', { value: 'cash_per_contract', selected: T.commission_type === 'cash_per_contract' }, 'لكل عقد/لوت'), h('option', { value: 'cash_per_order', selected: T.commission_type === 'cash_per_order' }, 'لكل أمر')),
      h('label', {}, 'قيمة العمولة'), num('commission_value'),
      h('label', {}, 'الانزلاق (ticks)'), num('slippage', '', 1),
      h('label', {}, 'تنفيذ الأوامر عند الإغلاق'), f.process_orders_on_close = h('select', {}, h('option', { value: '' }, '(من السكربت)'), h('option', { value: 'true', selected: T.process_orders_on_close === true }, 'نعم'), h('option', { value: 'false', selected: T.process_orders_on_close === false }, 'لا')),
      h('label', {}, 'Bar Magnifier (بيانات الدقيقة)'), f.magnifier = h('input', { type: 'checkbox', checked: T.magnifier !== false }),
      h('label', {}, 'الكمية باللوت'), f.lots = h('input', { type: 'checkbox', checked: !!T.lots }),
      h('div', { class: 'full note' }, `عند تفعيل "الكمية باللوت": qty=1 تعني 1 لوت = ${app.spec.contractSize} وحدة من ${app.spec.name}، والربح يُحسب بالدولار (مثل MT5). عند التعطيل يعمل مثل TradingView تماماً (qty بالعقود/الأونصات).`));
    const s = sheet({
      title: 'خصائص الاستراتيجية', body,
      footer: [h('button', { class: 'btn pri', style: { flex: 1 }, onclick: () => {
        const nv = (k) => { const v = f[k].value; return v === '' ? undefined : parseFloat(v); };
        Object.assign(T, { initial_capital: nv('initial_capital'), default_qty_value: nv('default_qty_value'), pyramiding: nv('pyramiding'), commission_value: nv('commission_value'), slippage: nv('slippage'),
          default_qty_type: f.default_qty_type.value || undefined, commission_type: f.commission_type.value || undefined,
          process_orders_on_close: f.process_orders_on_close.value === '' ? undefined : f.process_orders_on_close.value === 'true', magnifier: f.magnifier.checked, lots: f.lots.checked });
        app.saveState();
        for (const x of app.inds) if (x.isStrategy) x.rt = null;
        app.recomputeAll();
        s.close();
        P.refreshTester(true);
      } }, 'تطبيق'), h('button', { class: 'btn', style: { flex: 1 }, onclick: () => s.close() }, 'إلغاء')],
    });
  }

  // ================================================================ TRADING
  const tk = { side: 1, type: 'market', price: '', sl: '', tp: '', unit: 'pts', risk: '' };

  function needReplay() {
    if (app.replay.active) return false;
    const s = sheet({
      title: 'التداول التدريبي', body: h('div', {}, h('p', { class: 'note' }, 'التداول يعمل داخل وضع الإعادة (Replay) حتى تتحرك الأسعار شمعة بشمعة كما في السوق الحقيقي بدون رؤية المستقبل.'),
        h('div', { class: 'list' },
          h('div', { class: 'li', onclick: () => { s.close(); app.startReplayRandom(); } }, h('div', { class: 't' }, h('b', {}, '🎲 نقطة عشوائية'), h('small', {}, 'أفضل للتدريب بدون معرفة ما سيحدث'))),
          h('div', { class: 'li', onclick: () => { s.close(); app.startReplayPick(); } }, h('div', { class: 't' }, h('b', {}, '👆 اختر نقطة من الشارت'), h('small', {}, 'اضغط على الشمعة التي تبدأ بعدها'))))),
    });
    return true;
  }

  P.order = (side, opts = {}) => {
    if (needReplay()) return;
    const acc = app.account, spec = app.spec;
    const bid = app.currentBid();
    const lots = A.normLots(opts.lots ?? app.state.trade.lots);
    const t = app.currentTime();
    try {
      const entry = side === 1 ? A.ask(spec, bid) : bid;
      const conv = (v, isSl) => {
        if (v === '' || v === undefined || v === null || isNaN(parseFloat(v))) return NaN;
        v = parseFloat(v);
        if (tk.unit === 'pts' && opts.fromTicket) { const d = v * spec.point; return isSl ? entry - side * d : entry + side * d; }
        return v;
      };
      const sl = opts.fromTicket ? conv(tk.sl, true) : NaN, tp = opts.fromTicket ? conv(tk.tp, false) : NaN;
      if (opts.type && opts.type !== 'market') {
        const price = parseFloat(tk.price);
        if (!isFinite(price)) throw new Error('أدخل سعر الأمر المعلق');
        const ptype = (side === 1 ? 'buy_' : 'sell_') + opts.type;
        const slp = tk.unit === 'pts' && isFinite(parseFloat(tk.sl)) ? price - side * parseFloat(tk.sl) * spec.point : (isFinite(parseFloat(tk.sl)) ? parseFloat(tk.sl) : NaN);
        const tpp = tk.unit === 'pts' && isFinite(parseFloat(tk.tp)) ? price + side * parseFloat(tk.tp) * spec.point : (isFinite(parseFloat(tk.tp)) ? parseFloat(tk.tp) : NaN);
        A.placePending(acc, spec, ptype, lots, price, bid, t, slp, tpp);
        toast(`تم وضع ${ptype.replace('_', ' ').toUpperCase()} ${lots} @ ${price}`);
      } else {
        const p = A.placeMarket(acc, spec, side, lots, bid, t, sl, tp);
        toast(`${side === 1 ? 'شراء' : 'بيع'} ${lots} @ ${p.openPrice.toFixed(spec.digits)}`);
      }
      app.saveAccount();
      app.updateTradeLines();
      P.refreshTrade();
    } catch (e) { toast(e.message, 3500); }
  };

  P.tradeDrag = (line, price) => {
    const acc = app.account, spec = app.spec;
    try {
      if (line.kind === 'sl' || line.kind === 'tp') {
        const p = line.ref;
        A.modifyPosition(acc, spec, p.id, line.kind === 'sl' ? price : p.sl, line.kind === 'tp' ? price : p.tp);
      } else if (line.kind === 'pos') {
        const p = acc.positions.find((x) => x.id === line.id);
        const profitSide = (price - p.openPrice) * p.side > 0;
        A.modifyPosition(acc, spec, p.id, profitSide ? p.sl : price, profitSide ? price : p.tp);
      } else if (line.kind === 'order') A.modifyOrder(acc, spec, line.id, price);
      else if (line.kind === 'osl') A.modifyOrder(acc, spec, line.id, NaN, price);
      else if (line.kind === 'otp') A.modifyOrder(acc, spec, line.id, NaN, undefined, price);
      app.saveAccount();
    } catch (e) { toast(e.message); }
    app.updateTradeLines(); P.refreshTrade();
  };
  P.tradeTap = (line) => {
    if (line.kind === 'pos' || line.kind === 'sl' || line.kind === 'tp') modifyPos(line.id);
    else orderMenu(line.id);
  };

  function modifyPos(id) {
    const acc = app.account, spec = app.spec;
    const p = acc.positions.find((x) => x.id === id);
    if (!p) return;
    const sl = h('input', { type: 'number', step: spec.point, value: isFinite(p.sl) ? p.sl : '' });
    const tp = h('input', { type: 'number', step: spec.point, value: isFinite(p.tp) ? p.tp : '' });
    const part = h('input', { type: 'number', step: 0.01, value: p.lots });
    const s = sheet({
      title: `${p.side === 1 ? 'شراء' : 'بيع'} ${p.lots} @ ${p.openPrice.toFixed(spec.digits)}`,
      body: h('div', { class: 'form' }, h('label', {}, 'وقف الخسارة SL'), sl, h('label', {}, 'جني الأرباح TP'), tp, h('label', {}, 'حجم الإغلاق'), part,
        h('div', { class: 'full row' }, h('button', { class: 'btn sm', onclick: () => { sl.value = p.openPrice.toFixed(spec.digits); } }, 'SL عند الدخول (Breakeven)'))),
      footer: [
        h('button', { class: 'btn pri', style: { flex: 1 }, onclick: () => { try { A.modifyPosition(acc, spec, id, parseFloat(sl.value), parseFloat(tp.value)); app.saveAccount(); app.updateTradeLines(); P.refreshTrade(); s.close(); } catch (e) { toast(e.message); } } }, 'تعديل'),
        h('button', { class: 'btn red', style: { flex: 1 }, onclick: () => { closePos(id, parseFloat(part.value)); s.close(); } }, 'إغلاق'),
      ],
    });
  }
  function orderMenu(id) {
    const acc = app.account;
    const o = acc.orders.find((x) => x.id === id);
    if (!o) return;
    confirmBox(`إلغاء الأمر ${o.type.replace('_', ' ').toUpperCase()} ${o.lots} @ ${o.price}؟`, 'إلغاء الأمر', true).then((ok) => { if (ok) { A.cancelOrder(acc, id); app.saveAccount(); app.updateTradeLines(); P.refreshTrade(); } });
  }
  function closePos(id, lots) {
    const rec = A.closePosition(app.account, app.spec, id, app.currentBid(), app.currentTime(), lots);
    if (rec) toast(`أُغلقت: ${rec.points} نقطة ${A.money(app.account, rec.net, true)}`);
    app.saveAccount(); app.updateTradeLines(); P.refreshTrade();
  }

  P.renderTradeBar = () => {
    const bar = $('#tradeBar');
    if (!app.state.trade.showBar) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const spec = app.spec;
    const bid = app.currentBid();
    const ask = A.ask(spec, bid);
    if (!bar.firstChild) {
      const lot = h('input', { type: 'number', step: 0.01, min: 0.01, value: app.state.trade.lots, onchange: (e) => { app.state.trade.lots = Math.max(0.01, A.normLots(e.target.value)); e.target.value = app.state.trade.lots; app.saveStateSoon(); app.updateTradeLines(); } });
      bar.append(h('button', { class: 'sell', onclick: () => P.order(-1) }, h('small', {}, 'SELL'), h('b', { class: 'bidv' }, '')), lot, h('button', { class: 'buy', onclick: () => P.order(1) }, h('small', {}, 'BUY'), h('b', { class: 'askv' }, '')), h('div', { class: 'spr' }, ''));
    }
    bar.querySelector('.bidv').textContent = isFinite(bid) ? bid.toFixed(spec.digits) : '—';
    bar.querySelector('.askv').textContent = isFinite(ask) ? ask.toFixed(spec.digits) : '—';
    bar.querySelector('.spr').textContent = (spec.spread || 0) + ' pts';
  };

  P.refreshTrade = (force) => {
    P.renderTradeBar();
    app.updateTradeLines();
    const root = $('#tab-trade');
    if (!force && !(app.state.panel.open && app.state.panel.tab === 'trade')) return;
    const acc = app.account, spec = app.spec;
    const bid = app.currentBid();
    const snap = A.snapshot(acc, spec, bid);
    const M = (v, s) => A.money(acc, v, s);
    root.innerHTML = '';
    const kp = (t, v, cls = '') => h('div', { class: 'kpi' }, h('small', {}, t), h('b', { class: cls }, v));
    root.append(h('div', { class: 'acct' },
      kp('الرصيد', M(snap.balance)), kp('حقوق الملكية', M(snap.equity), snap.floating >= 0 ? 'up' : 'dn'), kp('الربح العائم', M(snap.floating, true), snap.floating >= 0 ? 'up' : 'dn'),
      kp('الهامش المستخدم', M(snap.margin)), kp('الهامش الحر', M(snap.free)), kp('مستوى الهامش', isFinite(snap.level) ? fmtNum(snap.level) + '%' : '—')));
    if (!app.replay.active) {
      root.append(h('div', { class: 'panel-pad' }, h('p', { class: 'note' }, 'ابدأ جلسة إعادة (Replay) للتداول التدريبي على البيانات التاريخية.'),
        h('div', { class: 'row' }, h('button', { class: 'btn pri', onclick: () => app.startReplayRandom() }, '🎲 بدء تدريب من نقطة عشوائية'), h('button', { class: 'btn', onclick: () => app.startReplayPick() }, '👆 اختيار نقطة'), h('button', { class: 'btn', onclick: () => accountSettings() }, '⚙ الحساب'))));
    }
    // ticket
    const ask = A.ask(spec, bid);
    const lotsIn = h('input', { type: 'number', step: 0.01, min: 0.01, value: app.state.trade.lots, style: { width: '90px' }, onchange: (e) => { app.state.trade.lots = Math.max(0.01, A.normLots(e.target.value)); app.saveStateSoon(); P.renderTradeBar(); upd(); } });
    const priceIn = h('input', { type: 'number', step: spec.point, placeholder: 'سعر الأمر', value: tk.price, oninput: (e) => { tk.price = e.target.value; } });
    const slIn = h('input', { type: 'number', step: 'any', placeholder: tk.unit === 'pts' ? 'SL بالنقاط' : 'سعر SL', value: tk.sl, oninput: (e) => { tk.sl = e.target.value; upd(); } });
    const tpIn = h('input', { type: 'number', step: 'any', placeholder: tk.unit === 'pts' ? 'TP بالنقاط' : 'سعر TP', value: tk.tp, oninput: (e) => { tk.tp = e.target.value; upd(); } });
    const riskIn = h('input', { type: 'number', step: 'any', placeholder: '% مخاطرة', value: tk.risk, style: { width: '90px' }, oninput: (e) => { tk.risk = e.target.value; } });
    const info = h('div', { class: 'mini' });
    const upd = () => {
      const lots = app.state.trade.lots;
      const pv = A.pointValueUsd(spec, lots, bid);
      let txt = `قيمة النقطة: ${M(pv)} · الهامش: ${M(A.marginUsd(spec, lots, bid, acc.leverage))}`;
      const sl = parseFloat(tk.sl);
      if (isFinite(sl)) {
        const entry = tk.type === 'market' ? (tk.side === 1 ? ask : bid) : parseFloat(tk.price);
        const pts = tk.unit === 'pts' ? sl : Math.abs(entry - sl) / spec.point;
        if (isFinite(pts)) txt += ` · المخاطرة: ${M(pts * pv)} (${fmtNum(pts * pv / Math.max(1e-9, snap.equity) * 100)}%)`;
      }
      const tpv = parseFloat(tk.tp);
      if (isFinite(tpv)) { const entry = tk.type === 'market' ? (tk.side === 1 ? ask : bid) : parseFloat(tk.price); const pts = tk.unit === 'pts' ? tpv : Math.abs(tpv - entry) / spec.point; if (isFinite(pts)) txt += ` · الهدف: ${M(pts * pv)}`; }
      info.textContent = txt;
    };
    const seg = (opts, key, cb) => h('div', { class: 'seg' }, opts.map(([v, t, cls]) => h('button', { class: (tk[key] === v ? 'on ' : '') + (cls || ''), onclick: () => { tk[key] = v; cb && cb(); P.refreshTrade(true); } }, t)));
    const ticket = h('div', { class: 'ticket' },
      seg([[1, 'شراء ' + (isFinite(ask) ? ask.toFixed(spec.digits) : ''), 'buyc'], [-1, 'بيع ' + (isFinite(bid) ? bid.toFixed(spec.digits) : ''), 'sellc']], 'side'),
      seg([['market', 'سوق'], ['limit', 'Limit'], ['stop', 'Stop']], 'type'),
      h('div', { class: 'row' }, h('span', { class: 'mini' }, 'اللوت'), h('button', { class: 'btn sm', onclick: () => { app.state.trade.lots = Math.max(0.01, A.normLots(app.state.trade.lots - 0.01)); P.refreshTrade(true); } }, '−'), lotsIn, h('button', { class: 'btn sm', onclick: () => { app.state.trade.lots = A.normLots(app.state.trade.lots + 0.01); P.refreshTrade(true); } }, '+'),
        riskIn, h('button', { class: 'btn sm', onclick: () => {
          const r = parseFloat(tk.risk), sl = parseFloat(tk.sl);
          if (!isFinite(r) || !isFinite(sl)) { toast('أدخل نسبة المخاطرة و SL أولاً'); return; }
          const entry = tk.side === 1 ? ask : bid;
          const pts = tk.unit === 'pts' ? sl : Math.abs(entry - sl) / spec.point;
          const l = A.lotsForRisk(spec, snap.equity * r / 100, pts, bid);
          if (!(l > 0)) { toast('المخاطرة صغيرة جداً لأقل لوت 0.01'); return; }
          app.state.trade.lots = l; P.refreshTrade(true);
        } }, 'احسب اللوت')),
      tk.type !== 'market' ? priceIn : null,
      h('div', { class: 'row' }, slIn, tpIn, seg([['pts', 'نقاط'], ['price', 'سعر']], 'unit')),
      info,
      h('button', { class: 'btn ' + (tk.side === 1 ? 'pri' : 'red'), onclick: () => P.order(tk.side, { fromTicket: true, type: tk.type }) }, `${tk.side === 1 ? 'شراء' : 'بيع'} ${app.state.trade.lots} ${tk.type === 'market' ? 'بسعر السوق' : tk.type.toUpperCase()}`));
    upd();
    root.append(ticket);
    const tabs = h('div', { class: 'tabs2', style: { padding: '0 8px' } }, ...[['positions', `المراكز (${acc.positions.length})`], ['orders', `المعلقة (${acc.orders.length})`], ['history', 'السجل'], ['stats', 'الإحصائيات']].map(([k, t]) => h('button', { class: tradeSub === k ? 'on' : '', onclick: () => { tradeSub = k; P.refreshTrade(true); } }, t)), h('span', { class: 'spacer' }), h('button', { class: 'btn sm', onclick: () => accountSettings() }, '⚙ الحساب'));
    root.append(tabs);
    const tz = app.state.tzMin;
    if (tradeSub === 'positions') {
      if (acc.positions.length > 1) root.append(h('div', { class: 'row panel-pad' }, h('button', { class: 'btn sm red', onclick: () => { A.closeAll(acc, spec, bid, app.currentTime()); app.saveAccount(); P.refreshTrade(true); } }, 'إغلاق الكل'), h('button', { class: 'btn sm', onclick: () => { A.closeAll(acc, spec, bid, app.currentTime(), (p) => A.profitUsd(spec, p.side, p.lots, p.openPrice, A.closePriceFor(spec, p.side, bid)) > 0); app.saveAccount(); P.refreshTrade(true); } }, 'إغلاق الرابحة'), h('button', { class: 'btn sm', onclick: () => { A.closeAll(acc, spec, bid, app.currentTime(), (p) => A.profitUsd(spec, p.side, p.lots, p.openPrice, A.closePriceFor(spec, p.side, bid)) < 0); app.saveAccount(); P.refreshTrade(true); } }, 'إغلاق الخاسرة')));
      root.append(h('table', { class: 'tbl' }, h('tr', {}, ['#', 'النوع', 'اللوت', 'الدخول', 'الحالي', 'SL', 'TP', 'نقاط', 'الربح', ''].map((x) => h('th', {}, x))),
        acc.positions.map((p) => {
          const cp = A.closePriceFor(spec, p.side, bid);
          const pr = A.profitUsd(spec, p.side, p.lots, p.openPrice, cp);
          return h('tr', { onclick: () => modifyPos(p.id) }, h('td', {}, p.id), h('td', { class: p.side === 1 ? 'up' : 'dn' }, p.side === 1 ? 'Buy' : 'Sell'), h('td', { class: 'num' }, p.lots), h('td', { class: 'num' }, p.openPrice.toFixed(spec.digits)), h('td', { class: 'num' }, cp.toFixed(spec.digits)),
            h('td', { class: 'num' }, isFinite(p.sl) ? p.sl.toFixed(spec.digits) : '—'), h('td', { class: 'num' }, isFinite(p.tp) ? p.tp.toFixed(spec.digits) : '—'), h('td', { class: 'num' }, A.points(spec, p.side, p.openPrice, cp)),
            h('td', { class: 'num ' + (pr >= 0 ? 'up' : 'dn') }, M(pr, true)), h('td', {}, h('button', { class: 'btn sm red', onclick: (e) => { e.stopPropagation(); closePos(p.id); } }, '✕')));
        })));
    } else if (tradeSub === 'orders') {
      root.append(h('table', { class: 'tbl' }, h('tr', {}, ['#', 'النوع', 'اللوت', 'السعر', 'SL', 'TP', ''].map((x) => h('th', {}, x))),
        acc.orders.map((o) => h('tr', {}, h('td', {}, o.id), h('td', {}, o.type.replace('_', ' ').toUpperCase()), h('td', { class: 'num' }, o.lots), h('td', { class: 'num' }, o.price.toFixed(spec.digits)), h('td', { class: 'num' }, isFinite(o.sl) ? o.sl : '—'), h('td', { class: 'num' }, isFinite(o.tp) ? o.tp : '—'),
          h('td', {}, h('button', { class: 'btn sm red', onclick: () => { A.cancelOrder(acc, o.id); app.saveAccount(); P.refreshTrade(true); } }, '✕'))))));
    } else if (tradeSub === 'history') {
      root.append(h('div', { class: 'row panel-pad' }, h('button', { class: 'btn sm', onclick: () => exportHistory() }, 'تصدير CSV')));
      root.append(h('table', { class: 'tbl' }, h('tr', {}, ['#', 'النوع', 'اللوت', 'فتح', 'سعر', 'إغلاق', 'سعر', 'السبب', 'نقاط', 'الصافي'].map((x) => h('th', {}, x))),
        acc.history.slice(-500).reverse().map((t) => h('tr', { onclick: () => app.chart.scrollToTime(t.openTime) }, h('td', {}, t.id), h('td', { class: t.side === 1 ? 'up' : 'dn' }, t.side === 1 ? 'Buy' : 'Sell'), h('td', { class: 'num' }, t.lots), h('td', {}, fmtDate(t.openTime, tz)), h('td', { class: 'num' }, t.openPrice.toFixed(spec.digits)), h('td', {}, fmtDate(t.closeTime, tz)), h('td', { class: 'num' }, t.closePrice.toFixed(spec.digits)), h('td', {}, t.reason.toUpperCase()), h('td', { class: 'num' }, t.points), h('td', { class: 'num ' + (t.net >= 0 ? 'up' : 'dn') }, M(t.net, true))))));
    } else {
      const s = A.stats(acc);
      root.append(h('div', { class: 'kpis' },
        kp('الصفقات', String(s.trades)), kp('نسبة الربح', isFinite(s.winRate) ? fmtNum(s.winRate) + '%' : '—'), kp('صافي الربح', M(s.net, true), s.net >= 0 ? 'up' : 'dn'), kp('النمو', fmtNum(s.growth) + '%', s.growth >= 0 ? 'up' : 'dn'),
        kp('معامل الربح', isFinite(s.pf) ? fmtNum(s.pf, 2) : '—'), kp('التوقع لكل صفقة', M(s.expectancy, true)), kp('متوسط النقاط', fmtNum(s.avgPoints, 1)), kp('متوسط الربح', M(s.avgWin)), kp('متوسط الخسارة', M(s.avgLoss)),
        kp('أفضل صفقة', M(s.best, true)), kp('أسوأ صفقة', M(s.worst, true)), kp('أقصى تراجع', M(s.maxDD) + ` (${fmtNum(s.maxDDpct)}%)`, 'dn'),
        kp('ربح متتالٍ / خسارة متتالية', `${s.maxConsWins} / ${s.maxConsLosses}`), kp('شراء: ربح%', `${s.longs} · ${isFinite(s.longWinRate) ? fmtNum(s.longWinRate) + '%' : '—'}`), kp('بيع: ربح%', `${s.shorts} · ${isFinite(s.shortWinRate) ? fmtNum(s.shortWinRate) + '%' : '—'}`), kp('إجمالي اللوتات', fmtNum(s.totalLots, 2))));
    }
  };

  function exportHistory() {
    const rows = [['id', 'side', 'lots', 'open_time', 'open_price', 'close_time', 'close_price', 'reason', 'points', 'profit', 'net', 'commission'].join(',')];
    for (const t of app.account.history) rows.push([t.id, t.side === 1 ? 'buy' : 'sell', t.lots, new Date(t.openTime).toISOString(), t.openPrice, new Date(t.closeTime).toISOString(), t.closePrice, t.reason, t.points, t.profit.toFixed(2), t.net.toFixed(2), t.commission.toFixed(2)].join(','));
    download(`training_history_${Date.now()}.csv`, rows.join('\n'), 'text/csv');
  }

  function accountSettings() {
    const acc = app.account;
    const f = {
      balance: h('input', { type: 'number', value: acc.currency === 'USC' ? acc.balance * 100 : acc.balance }),
      currency: h('select', {}, h('option', { value: 'USD', selected: acc.currency === 'USD' }, 'USD (عادي)'), h('option', { value: 'USC', selected: acc.currency === 'USC' }, 'USC (سنت)')),
      leverage: h('select', {}, [50, 100, 200, 400, 500, 1000, 2000, 3000].map((l) => h('option', { value: l, selected: acc.leverage === l }, '1:' + l))),
      comm: h('input', { type: 'number', step: 0.01, value: acc.commissionPerLot }),
      so: h('input', { type: 'number', value: acc.stopOut }),
      spread: h('input', { type: 'number', value: app.spec.spread }),
    };
    const s = sheet({
      title: 'إعدادات حساب التدريب',
      body: h('div', { class: 'form' },
        h('label', {}, 'عملة الحساب'), f.currency, h('label', {}, 'الرصيد'), f.balance, h('label', {}, 'الرافعة'), f.leverage,
        h('label', {}, 'العمولة $ لكل لوت (لكل جهة)'), f.comm, h('label', {}, 'Stop Out %'), f.so,
        h('label', {}, `السبريد (نقاط) لـ ${app.spec.name}`), f.spread,
        h('div', { class: 'full note' }, `مثال الذهب: 1 نقطة = 0.01$ في السعر. 0.01 لوت = 1 أونصة → كل 100 نقطة = 1$ ربح/خسارة (في حساب السنت تظهر 100 سنت). السبريد ${app.spec.spread} نقطة = ${(app.spec.spread * app.spec.point).toFixed(app.spec.digits)}$ في السعر.`)),
      footer: [
        h('button', { class: 'btn pri', style: { flex: 1 }, onclick: async () => {
          const cur = f.currency.value;
          let bal = parseFloat(f.balance.value); if (cur === 'USC') bal /= 100;
          acc.currency = cur; acc.leverage = +f.leverage.value; acc.commissionPerLot = parseFloat(f.comm.value) || 0; acc.stopOut = parseFloat(f.so.value) || 0;
          if (Math.abs(bal - acc.balance) > 1e-9) { acc.balance = bal; acc.initial = bal; acc.peak = bal; acc.maxDD = 0; }
          app.state.acct = { balance: acc.initial, currency: acc.currency, leverage: acc.leverage, commissionPerLot: acc.commissionPerLot, stopOut: acc.stopOut };
          const sp = parseFloat(f.spread.value);
          if (isFinite(sp)) { app.meta.spread = sp; const m = (await import('../data/store.js')); await m.saveSymbolMeta({ ...(await m.idb.get('symbols', app.meta.name) || { name: app.meta.name }), spread: sp }); }
          app.saveAccount(); app.saveState(); s.close(); P.refreshTrade(true);
        } }, 'حفظ'),
        h('button', { class: 'btn red', style: { flex: 1 }, onclick: async () => {
          if (!(await confirmBox('إعادة ضبط الحساب؟ سيتم حذف المراكز والسجل.', 'إعادة ضبط', true))) return;
          let bal = parseFloat(f.balance.value); if (f.currency.value === 'USC') bal /= 100;
          app.account = A.newAccount({ ...app.state.acct, balance: bal, currency: f.currency.value, leverage: +f.leverage.value, commissionPerLot: parseFloat(f.comm.value) || 0, stopOut: parseFloat(f.so.value) || 0 });
          app.saveAccount(); s.close(); P.refreshTrade(true);
        } }, 'إعادة ضبط'),
      ],
    });
  }
  P.accountSettings = accountSettings;

  // ================================================================ LOG
  P.refreshLog = (force) => {
    const root = $('#tab-log');
    if (!force && !(app.state.panel.open && app.state.panel.tab === 'log')) return;
    root.innerHTML = '';
    const tz = app.state.tzMin;
    const items = [];
    for (const ind of app.inds) {
      if (!ind.res) continue;
      for (const l of ind.res.logs.slice(-200)) items.push({ level: l.level === 'error' ? 'error' : l.level === 'warning' ? 'warn' : 'info', msg: `[${ind.title}] ${fmtDate(l.time + 0, tz)}  ${l.msg}`, at: l.time });
      for (const a of ind.res.alerts.slice(-100)) items.push({ level: 'alert', msg: `🔔 [${ind.title}] ${fmtDate(a.time, tz)}  ${a.message}`, at: a.time });
    }
    root.append(h('div', { class: 'row panel-pad' }, h('button', { class: 'btn sm', onclick: () => { app.logs = []; P.refreshLog(true); } }, 'مسح'), h('span', { class: 'mini' }, 'يعرض: أخطاء/تحذيرات السكربتات، log.info()، التنبيهات alert()، وأحداث التداول.')));
    const list = h('div', { style: { direction: 'ltr', fontSize: '12px' } });
    for (const it of [...app.logs.slice().reverse(), ...items.slice(-300).reverse()]) list.append(h('div', { style: { padding: '5px 8px', borderBottom: '1px solid var(--line)', color: it.level === 'error' ? 'var(--dn)' : it.level === 'warn' ? '#ff9800' : it.level === 'alert' ? '#e040fb' : 'var(--fg)', whiteSpace: 'pre-wrap' } }, it.msg));
    root.append(list);
  };

  P.refresh = () => { P.refreshTester(); P.refreshTrade(); P.refreshLog(); };
  return P;
}

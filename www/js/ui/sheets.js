// Sheets & floating bars: menu, symbols/import, timeframe, chart type, indicators, settings, replay, drawings
import { h, $, sheet, toast, confirmBox, promptBox, fmtNum, fmtDate, download } from './dom.js';
import * as store from '../data/store.js';
import { parseOHLCV } from '../data/csv.js';
import { mergeBars } from '../data/binfmt.js';
import { parseTf } from '../data/aggregate.js';
import { BUILTIN_SCRIPTS, NEW_SCRIPT_TEMPLATE, NEW_STRATEGY_TEMPLATE } from '../pine/builtins.js';

export function initSheets(app) {
  const S = {};

  // ================================================================ main menu
  S.menu = () => {
    const it = (icon, t, sub, fn) => h('div', { class: 'li', onclick: () => { s.close(); fn(); } }, h('span', { style: { fontSize: '20px', width: '28px', textAlign: 'center' } }, icon), h('div', { class: 't' }, h('b', {}, t), sub ? h('small', {}, sub) : null));
    const s = sheet({
      title: 'BTX Chart Lab',
      body: h('div', { class: 'list' },
        it('📈', 'الرموز والبيانات', 'اختيار رمز، إضافة رمز جديد، تعديل المواصفات', () => S.symbols()),
        it('📥', 'استيراد بيانات تاريخية (CSV)', 'MT5 · TradingView · Dukascopy · أي ملف OHLCV', () => S.importData()),
        it('ƒx', 'المؤشرات والاستراتيجيات', 'المدمجة + سكربتاتك', () => S.indicators()),
        it('📝', 'سكربتاتي', 'سكربتات Pine المحفوظة', () => S.openScript()),
        it('⏪', 'إعادة التشغيل (Replay)', 'تدريب شمعة بشمعة', () => S.replayMenu()),
        it('💰', 'حساب التدريب', 'الرصيد، الرافعة، السنت، العمولة، السبريد', () => app.panels.accountSettings()),
        it('⚙', 'الإعدادات', 'المظهر، المنطقة الزمنية، الجلسة، الأداء', () => S.settings()),
        it('💾', 'نسخ احتياطي / استعادة', 'السكربتات والرسومات والإعدادات', () => S.backup()),
        it('ℹ️', 'حول التطبيق', '', () => S.about())),
    });
  };

  // ================================================================ symbols
  S.symbols = async () => {
    app.symbols = await store.listSymbols();
    const body = h('div', {});
    const s = sheet({ title: 'الرموز', body, footer: [h('button', { class: 'btn pri', style: { flex: 1 }, onclick: () => { s.close(); S.importData(); } }, '＋ إضافة رمز / استيراد CSV')] });
    const tz = app.state.tzMin;
    const list = h('div', { class: 'list' });
    for (const m of app.symbols) {
      list.append(h('div', { class: 'li', onclick: async () => { s.close(); if (m.name !== app.state.symbol) await app.loadSymbol(m.name); } },
        h('div', { class: 't' }, h('b', {}, m.name + (m.name === app.state.symbol ? '  ✓' : '')), h('small', {}, `${m.description || ''} · ${m.count ? m.count.toLocaleString() + ' شمعة' : ''} · ${m.from ? fmtDate(typeof m.from === 'number' ? m.from : Date.parse(m.from), tz).slice(0, 10) : ''} → ${m.to ? fmtDate(typeof m.to === 'number' ? m.to : Date.parse(m.to), tz).slice(0, 10) : ''}`)),
        h('span', { class: 'badge' }, m.bundled && !m.imported ? 'مدمج' : 'مستورد'),
        h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); s.close(); S.symbolEdit(m); } }, '⋯')));
    }
    body.append(list, h('p', { class: 'note' }, 'البيانات المدمجة: ذهب XAUUSD دقيقة واحدة (M1) مع الفوليوم من Dukascopy منذ 2024. يمكنك استيراد بيانات حسابك من MT5 (أداة الرموز ← الأشرطة ← تصدير) لتطابق أسعار وسيطك تماماً.'));
  };

  S.symbolEdit = (m) => {
    const f = {
      description: h('input', { value: m.description || '' }),
      digits: h('input', { type: 'number', value: m.digits ?? 2 }),
      point: h('input', { type: 'number', step: 'any', value: m.point ?? 0.01 }),
      contractSize: h('input', { type: 'number', step: 'any', value: m.contractSize ?? 100 }),
      spread: h('input', { type: 'number', value: m.spread ?? m.defaultSpread ?? 0 }),
      quoteCurrency: h('input', { value: m.quoteCurrency || 'USD' }),
      baseCurrency: h('input', { value: m.baseCurrency || '' }),
      quoteToUsd: h('input', { type: 'number', step: 'any', value: m.quoteToUsd ?? 1 }),
      timezone: h('input', { value: m.timezone || 'Etc/UTC' }),
    };
    const s = sheet({
      title: 'مواصفات ' + m.name,
      body: h('div', { class: 'form' },
        h('label', {}, 'الوصف'), f.description, h('label', {}, 'عدد الخانات العشرية'), f.digits, h('label', {}, 'حجم النقطة (point)'), f.point,
        h('label', {}, 'حجم العقد (1 لوت)'), f.contractSize, h('label', {}, 'السبريد (نقاط)'), f.spread, h('label', {}, 'عملة التسعير'), f.quoteCurrency, h('label', {}, 'العملة الأساسية'), f.baseCurrency,
        h('label', {}, 'تحويل عملة التسعير إلى USD'), f.quoteToUsd, h('label', {}, 'منطقة الرمز الزمنية (Pine)'), f.timezone,
        h('div', { class: 'full note' }, 'الذهب: point=0.01، العقد=100 أونصة. اليورو/دولار: point=0.00001، العقد=100000. منطقة الرمز تؤثر على hour/dayofweek في Pine (Exness MT5 = Etc/UTC).'),
        h('div', { class: 'full row' },
          h('button', { class: 'btn sm', onclick: () => { s.close(); S.importData(m.name); } }, 'استيراد/دمج بيانات إضافية'),
          h('button', { class: 'btn sm', onclick: () => exportCsv(m.name) }, 'تصدير CSV'),
          m.imported ? h('button', { class: 'btn sm red', onclick: async () => { if (await confirmBox(m.bundled ? 'حذف البيانات المستوردة والعودة للبيانات المدمجة؟' : `حذف الرمز ${m.name} وبياناته؟`, 'حذف', true)) { await store.deleteSymbol(m.name); s.close(); app.symbols = await store.listSymbols(); if (app.state.symbol === m.name) { const nx = app.symbols.find((x) => x.name === m.name) || app.symbols[0]; if (nx) await app.loadSymbol(nx.name); } } } }, 'حذف') : null)),
      footer: [h('button', { class: 'btn pri', style: { flex: 1 }, onclick: async () => {
        const meta = { ...(await store.idb.get('symbols', m.name).catch(() => null) || { name: m.name }) };
        for (const k in f) { const v = f[k].value; meta[k] = ['digits', 'point', 'contractSize', 'spread', 'quoteToUsd'].includes(k) ? parseFloat(v) : v; }
        await store.saveSymbolMeta(meta);
        store.dropCache(m.name);
        s.close();
        if (app.state.symbol === m.name) await app.loadSymbol(m.name);
        toast('تم الحفظ');
      } }, 'حفظ')],
    });
  };

  async function exportCsv(name) {
    const rec = await store.loadSymbol(name);
    const b = rec.bars, d = rec.meta.digits ?? 2;
    const rows = ['time,open,high,low,close,volume'];
    const max = Math.min(b.length, 2000000);
    for (let i = b.length - max; i < b.length; i++) rows.push(`${new Date(b.t[i]).toISOString().replace('.000Z', 'Z')},${b.o[i].toFixed(d)},${b.h[i].toFixed(d)},${b.l[i].toFixed(d)},${b.c[i].toFixed(d)},${+b.v[i].toFixed(4)}`);
    download(`${name}_M1.csv`, rows.join('\n'), 'text/csv');
  }

  // ================================================================ import
  S.importData = (targetName) => {
    const inp = $('#fileInput');
    inp.value = '';
    inp.accept = '.csv,.txt,.tsv,text/csv,text/plain';
    inp.onchange = async () => {
      const file = inp.files[0];
      if (!file) return;
      app.busy(true, 'قراءة الملف ' + (file.size / 1048576).toFixed(1) + ' MB...');
      try {
        const text = await file.text();
        let res = parseOHLCV(text, { tzOffsetMinutes: 0 });
        app.busy(false);
        importForm(file.name, text, res, targetName);
      } catch (e) { app.busy(false); toast('خطأ: ' + e.message, 5000); }
    };
    inp.click();
  };

  function guessSpec(name, digits) {
    const n = name.toUpperCase();
    if (/XAU|GOLD/.test(n)) return { digits: 2, point: 0.01, contractSize: 100, baseCurrency: 'XAU', quoteCurrency: 'USD', spread: 30, type: 'commodity' };
    if (/XAG|SILVER/.test(n)) return { digits: 3, point: 0.001, contractSize: 5000, baseCurrency: 'XAG', quoteCurrency: 'USD', spread: 30, type: 'commodity' };
    if (/BTC|ETH|SOL|XRP|CRYPTO/.test(n)) return { digits, point: Math.pow(10, -digits), contractSize: 1, baseCurrency: n.slice(0, 3), quoteCurrency: 'USD', spread: 0, type: 'crypto' };
    if (/^[A-Z]{6}/.test(n)) { const jpy = n.slice(3, 6) === 'JPY'; return { digits: jpy ? 3 : 5, point: jpy ? 0.001 : 0.00001, contractSize: 100000, baseCurrency: n.slice(0, 3), quoteCurrency: n.slice(3, 6), spread: 10, type: 'forex' }; }
    return { digits, point: Math.pow(10, -digits), contractSize: 1, baseCurrency: '', quoteCurrency: 'USD', spread: 0, type: 'index' };
  }

  function importForm(fileName, text, res, targetName) {
    const base = (targetName || fileName.replace(/\.[^.]+$/, '').split(/[_\-\s.]/)[0] || 'SYMBOL').toUpperCase().replace(/[^A-Z0-9.#]/g, '');
    const g = guessSpec(base, res.info.digits);
    const f = {
      name: h('input', { value: base }),
      tz: h('select', {}, [-5, -4, 0, 1, 2, 3, 4].map((x) => h('option', { value: x * 60, selected: x === 0 }, (x >= 0 ? 'UTC+' : 'UTC') + x))),
      digits: h('input', { type: 'number', value: g.digits }),
      point: h('input', { type: 'number', step: 'any', value: g.point }),
      contractSize: h('input', { type: 'number', step: 'any', value: g.contractSize }),
      spread: h('input', { type: 'number', value: g.spread }),
      quoteCurrency: h('input', { value: g.quoteCurrency }),
      merge: h('input', { type: 'checkbox', checked: true }),
    };
    const info = res.info;
    const sum = h('div', { class: 'note', style: { color: 'var(--fg)' } },
      `الصيغة: ${info.format} · الفاصل: ${info.delimiter} · الشموع: ${info.rows.toLocaleString()} · المتجاهلة: ${info.skipped} · الإطار: ${parseTf(info.tf) ? parseTf(info.tf).label : info.tf} · من ${fmtDate(info.from).slice(0, 16)} إلى ${fmtDate(info.to).slice(0, 16)} · الفوليوم: ${info.hasVolume ? 'نعم' : 'لا'}`);
    const s = sheet({
      title: 'استيراد ' + fileName,
      body: h('div', { class: 'form' }, h('div', { class: 'full' }, sum),
        h('label', {}, 'اسم الرمز'), f.name,
        h('label', {}, 'توقيت البيانات في الملف'), f.tz,
        h('label', {}, 'الخانات العشرية'), f.digits, h('label', {}, 'حجم النقطة'), f.point, h('label', {}, 'حجم العقد (لوت)'), f.contractSize,
        h('label', {}, 'السبريد (نقاط)'), f.spread, h('label', {}, 'عملة التسعير'), f.quoteCurrency,
        h('label', {}, 'دمج مع البيانات الموجودة'), f.merge,
        h('div', { class: 'full note' }, 'تصدير من MT5: افتح "الرموز" (Ctrl+U) ← تبويب "الأشرطة" ← اختر الرمز والإطار M1 والفترة ← "طلب" ← "تصدير الأشرطة". توقيت خادم Exness = UTC+0.')),
      footer: [h('button', { class: 'btn pri', style: { flex: 1 }, onclick: async () => {
        const name = f.name.value.trim().toUpperCase();
        if (!name) { toast('أدخل اسم الرمز'); return; }
        s.close();
        app.busy(true, 'تحليل وحفظ البيانات...');
        try {
          const tzm = +f.tz.value;
          const r2 = tzm ? parseOHLCV(text, { tzOffsetMinutes: tzm }) : res;
          let bars = r2.bars;
          const exists = app.symbols.some((x) => x.name === name);
          if (exists && f.merge.checked) {
            try { const old = await store.loadSymbol(name); bars = mergeBars(old.bars, bars); } catch (e) { /* new */ }
          }
          const prev = await store.idb.get('symbols', name).catch(() => null);
          const meta = { ...(prev || {}), name, description: (prev && prev.description) || name, digits: +f.digits.value, point: +f.point.value, contractSize: +f.contractSize.value, spread: +f.spread.value, quoteCurrency: f.quoteCurrency.value, baseCurrency: g.baseCurrency, type: g.type, timeUnit: Math.min(60, info.tfSeconds), baseSeconds: info.tfSeconds, tfSeconds: info.tfSeconds, source: 'CSV: ' + fileName, timezone: (prev && prev.timezone) || 'Etc/UTC' };
          store.dropCache(name);
          await store.saveSymbolData(meta, bars);
          app.symbols = await store.listSymbols();
          app.busy(false);
          toast(`تم استيراد ${bars.length.toLocaleString()} شمعة إلى ${name}`);
          store.dropCache(name);
          await app.loadSymbol(name);
        } catch (e) { app.busy(false); toast('خطأ: ' + e.message, 5000); }
      } }, 'استيراد')],
    });
  }

  // ================================================================ timeframe
  S.timeframes = () => {
    const all = ['1', '2', '3', '5', '10', '15', '30', '45', '60', '120', '180', '240', '360', '480', '720', 'D', '2D', 'W', 'M'];
    const cur = app.state.tf;
    const custom = h('input', { placeholder: 'مخصص: 7 أو 7m أو 2h أو 3D', style: { flex: 1 } });
    const chip = (tf) => {
      const p = parseTf(tf);
      const fav = app.state.favTfs.includes(tf);
      return h('button', { class: 'chip' + (tf === cur ? ' on' : ''), onclick: () => { s.close(); app.setTf(tf); }, oncontextmenu: (e) => { e.preventDefault(); toggleFav(tf); } }, p.label + (fav ? ' ★' : ''));
    };
    const toggleFav = (tf) => { const f = app.state.favTfs; const k = f.indexOf(tf); if (k >= 0) f.splice(k, 1); else f.push(tf); app.saveStateSoon(); s.close(); S.timeframes(); };
    const s = sheet({
      title: 'الإطار الزمني',
      body: h('div', {}, h('div', { class: 'cat' }, 'المفضلة'), h('div', { class: 'chips' }, app.state.favTfs.map(chip)), h('div', { class: 'cat' }, 'الكل (ضغط مطوّل = مفضلة)'), h('div', { class: 'chips' }, all.map(chip)),
        h('div', { class: 'cat' }, 'إطار مخصص'), h('div', { class: 'row' }, custom, h('button', { class: 'btn pri', onclick: () => { const v = custom.value.trim(); const p = parseTf(v); if (!p) { toast('صيغة غير صحيحة'); return; } s.close(); app.setTf(/^\d+m$/.test(v) ? v.slice(0, -1) : v); } }, 'تطبيق'))),
    });
  };

  // ================================================================ chart type
  S.chartType = () => {
    const types = [['candles', 'شموع يابانية'], ['hollow', 'شموع مجوفة'], ['bars', 'أعمدة OHLC'], ['ha', 'هايكن آشي'], ['line', 'خط'], ['area', 'منطقة']];
    const s = sheet({
      title: 'نوع الشارت',
      body: h('div', { class: 'list' }, types.map(([k, t]) => h('div', { class: 'li', onclick: () => { app.state.chartType = k; app.chart.setOptions({ chartType: k }); app.saveStateSoon(); s.close(); } }, h('div', { class: 't' }, h('b', {}, t + (app.state.chartType === k ? '  ✓' : '')))))),
    });
  };

  // ================================================================ indicators
  S.indicators = async (focusCat) => {
    const mine = await store.scripts.all();
    const q = h('input', { class: 'search', placeholder: 'بحث...', type: 'search' });
    const list = h('div', { class: 'list' });
    const render = () => {
      const term = q.value.trim().toLowerCase();
      list.innerHTML = '';
      const add = (title, sub, fn, badge) => list.append(h('div', { class: 'li', onclick: fn }, h('div', { class: 't' }, h('b', {}, title), sub ? h('small', {}, sub) : null), badge ? h('span', { class: 'badge' }, badge) : null));
      if (mine.length) {
        list.append(h('div', { class: 'cat' }, 'سكربتاتي'));
        for (const sc of mine) if (!term || sc.name.toLowerCase().includes(term)) add(sc.name, 'محفوظ ' + new Date(sc.updated).toLocaleDateString(), () => { s.close(); app.addScript(sc.source, sc.name, { scriptId: sc.id }); toast('أُضيف ' + sc.name); }, /strategy\s*\(/.test(sc.source) ? 'استراتيجية' : '');
      }
      let lastCat = '';
      const cats = [...new Set(BUILTIN_SCRIPTS.map((b) => b.cat))];
      if (focusCat) cats.sort((a, b) => (b === focusCat) - (a === focusCat));
      for (const c of cats) for (const b of BUILTIN_SCRIPTS.filter((x) => x.cat === c)) {
        if (term && !b.name.toLowerCase().includes(term) && !b.id.includes(term)) continue;
        if (b.cat !== lastCat) { list.append(h('div', { class: 'cat' }, b.cat)); lastCat = b.cat; }
        add(b.name, null, () => { s.close(); const inst = app.addBuiltin(b.id); if (inst && inst.isStrategy) app.openPanel('tester'); toast('أُضيف ' + b.name); }, b.strategy ? 'استراتيجية' : '');
      }
    };
    q.oninput = render;
    render();
    const s = sheet({ title: 'المؤشرات والاستراتيجيات', body: h('div', {}, q, list), footer: [h('button', { class: 'btn', style: { flex: 1 }, onclick: () => { s.close(); S.newScript(); } }, '＋ سكربت Pine جديد'), h('button', { class: 'btn', style: { flex: 1 }, onclick: () => { s.close(); app.openPanel('editor'); app.editor.paste(); } }, '📋 لصق سكربت')] });
  };

  S.indicatorSettings = (ind) => {
    if (!ind.res && ind.error) { toast('خطأ في السكربت: ' + ind.error.msg, 4000); app.legendAction('source', ind); return; }
    const defs = (ind.rt && ind.rt.inputDefs) || [];
    let tab = defs.length ? 'inputs' : 'style';
    const body = h('div', {});
    const vals = ind.inputs.slice();
    const render = () => {
      body.innerHTML = '';
      body.append(h('div', { class: 'tabs2' }, h('button', { class: tab === 'inputs' ? 'on' : '', onclick: () => { tab = 'inputs'; render(); } }, 'المدخلات'), h('button', { class: tab === 'style' ? 'on' : '', onclick: () => { tab = 'style'; render(); } }, 'النمط')));
      const form = h('div', { class: 'form' });
      if (tab === 'inputs') {
        if (!defs.length) form.append(h('div', { class: 'full note' }, 'لا توجد مدخلات لهذا السكربت.'));
        let lastGroup = null;
        for (const d of defs) {
          if (!d) continue;
          if (d.group && d.group !== lastGroup) { form.append(h('div', { class: 'grp' }, d.group)); lastGroup = d.group; }
          const cur = vals[d.idx] !== undefined && vals[d.idx] !== null ? vals[d.idx] : d.defval;
          const set = (v) => { vals[d.idx] = v; };
          let ctl;
          if (d.options && d.options.length) {
            ctl = h('select', { onchange: (e) => { const o = d.options[+e.target.value]; set(o); } }, d.options.map((o, k) => h('option', { value: k, selected: o === cur }, d.optionTitles ? d.optionTitles[k] : String(o))));
          } else if (d.kind === 'bool') ctl = h('input', { type: 'checkbox', checked: !!cur, onchange: (e) => set(e.target.checked) });
          else if (d.kind === 'int' || d.kind === 'float' || d.kind === 'price') ctl = h('input', { type: 'number', step: d.step || (d.kind === 'int' ? 1 : 'any'), min: d.minval ?? '', max: d.maxval ?? '', value: cur, onchange: (e) => { let v = parseFloat(e.target.value); if (d.kind === 'int') v = Math.round(v); if (isFinite(d.minval)) v = Math.max(d.minval, v); if (isFinite(d.maxval)) v = Math.min(d.maxval, v); set(v); } });
          else if (d.kind === 'color') {
            const hex = typeof cur === 'string' ? cur.slice(0, 7) : '#2962ff';
            const al = typeof cur === 'string' && cur.length === 9 ? parseInt(cur.slice(7), 16) : 255;
            const c = h('input', { type: 'color', value: hex });
            const a = h('input', { type: 'range', min: 0, max: 100, value: Math.round(al / 255 * 100), style: { flex: 1 } });
            const upd = () => set(c.value + Math.round(a.value / 100 * 255).toString(16).padStart(2, '0'));
            c.oninput = upd; a.oninput = upd;
            ctl = h('div', { class: 'row' }, c, a);
          } else if (d.kind === 'source') ctl = h('select', { onchange: (e) => set(e.target.value) }, ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'volume'].map((o) => h('option', { value: o, selected: o === cur }, o)));
          else if (d.kind === 'timeframe') ctl = h('select', { onchange: (e) => set(e.target.value) }, ['', '1', '3', '5', '15', '30', '60', '120', '240', 'D', 'W', 'M'].map((o) => h('option', { value: o, selected: o === cur }, o === '' ? 'نفس الشارت' : parseTf(o).label)));
          else if (d.kind === 'symbol') ctl = h('select', { onchange: (e) => set(e.target.value) }, app.symbols.map((o) => h('option', { value: o.name, selected: o.name === cur || ('BTX:' + o.name) === cur }, o.name)));
          else if (d.kind === 'time') ctl = h('input', { type: 'datetime-local', value: isFinite(cur) ? new Date(cur).toISOString().slice(0, 16) : '', onchange: (e) => set(Date.parse(e.target.value + 'Z')) });
          else if (d.kind === 'text_area') ctl = h('textarea', { rows: 3, value: cur ?? '', onchange: (e) => set(e.target.value) });
          else ctl = h('input', { value: cur ?? '', onchange: (e) => set(e.target.value) });
          form.append(h('label', { title: d.tooltip || '' }, d.title), ctl);
        }
      } else {
        const out = ind.res ? ind.res.out : { plots: [], hlines: [], fills: [] };
        for (const p of out.plots) {
          const st = ind.styles[p.id] || (ind.styles[p.id] = {});
          const vis = h('input', { type: 'checkbox', checked: !ind.hidden[p.id], onchange: (e) => { if (e.target.checked) delete ind.hidden[p.id]; else ind.hidden[p.id] = true; } });
          const col = typeof p.colors0 === 'string' ? p.colors0.slice(0, 7) : '#2962ff';
          const c = h('input', { type: 'color', value: (st.color || col).slice(0, 7), onchange: (e) => { st.color = e.target.value + 'ff'; } });
          const w = h('select', { onchange: (e) => { st.width = +e.target.value; } }, [1, 2, 3, 4].map((x) => h('option', { value: x, selected: (st.width || p.lineWidth) === x }, x + 'px')));
          form.append(h('label', {}, p.title), h('div', { class: 'row' }, vis, p.colors ? h('span', { class: 'mini' }, 'لون ديناميكي') : c, w));
        }
        for (const hl of out.hlines) form.append(h('label', {}, hl.title), h('input', { type: 'checkbox', checked: !ind.hidden[hl.id], onchange: (e) => { if (e.target.checked) delete ind.hidden[hl.id]; else ind.hidden[hl.id] = true; } }));
        if (ind.isStrategy) form.append(h('label', {}, 'إظهار إشارات الصفقات'), h('input', { type: 'checkbox', checked: !ind.hideTrades, onchange: (e) => { ind.hideTrades = !e.target.checked; } }));
      }
      body.append(form);
    };
    render();
    const s = sheet({
      title: ind.title,
      body,
      footer: [
        h('button', { class: 'btn pri', style: { flex: 1 }, onclick: () => { ind.inputs = vals; ind.rt = null; app.runInd(ind); app.pushIndicators(); app.saveState(); s.close(); } }, 'تطبيق'),
        h('button', { class: 'btn', onclick: () => { vals.length = 0; render(); } }, 'الافتراضي'),
        h('button', { class: 'btn red', onclick: () => { s.close(); app.removeInd(ind); } }, 'حذف'),
      ],
    });
  };

  // ================================================================ scripts
  S.openScript = async () => {
    const mine = await store.scripts.all();
    const list = h('div', { class: 'list' });
    const s = sheet({ title: 'فتح سكربت', body: list });
    if (mine.length) list.append(h('div', { class: 'cat' }, 'سكربتاتي'));
    for (const sc of mine) list.append(h('div', { class: 'li', onclick: () => { s.close(); app.editorTarget = null; app.state.editor = { source: sc.source, name: sc.name, id: sc.id }; app.editor.set(sc.source, sc.name); app.openPanel('editor'); } },
      h('div', { class: 't' }, h('b', {}, sc.name), h('small', {}, new Date(sc.updated).toLocaleString())),
      h('button', { class: 'btn sm', onclick: async (e) => { e.stopPropagation(); const n = await promptBox('إعادة تسمية', sc.name); if (n) { await store.scripts.put({ ...sc, name: n }); s.close(); S.openScript(); } } }, '✎'),
      h('button', { class: 'btn sm red', onclick: async (e) => { e.stopPropagation(); if (await confirmBox('حذف ' + sc.name + '؟', 'حذف', true)) { await store.scripts.del(sc.id); s.close(); S.openScript(); } } }, '✕')));
    list.append(h('div', { class: 'cat' }, 'نسخ من المؤشرات المدمجة'));
    for (const b of BUILTIN_SCRIPTS) list.append(h('div', { class: 'li', onclick: () => { s.close(); app.editorTarget = null; app.state.editor = { source: b.src, name: b.name + ' (نسخة)', id: null }; app.editor.set(b.src, b.name + ' (نسخة)'); app.openPanel('editor'); } }, h('div', { class: 't' }, h('b', {}, b.name), h('small', {}, b.cat))));
  };
  S.newScript = () => {
    const s = sheet({
      title: 'سكربت جديد',
      body: h('div', { class: 'list' },
        h('div', { class: 'li', onclick: () => { s.close(); start(NEW_SCRIPT_TEMPLATE, 'مؤشر جديد'); } }, h('div', { class: 't' }, h('b', {}, 'مؤشر (indicator)'))),
        h('div', { class: 'li', onclick: () => { s.close(); start(NEW_STRATEGY_TEMPLATE, 'استراتيجية جديدة'); } }, h('div', { class: 't' }, h('b', {}, 'استراتيجية (strategy)'))),
        h('div', { class: 'li', onclick: () => { s.close(); start('', 'سكربت ملصوق'); app.editor.paste(); } }, h('div', { class: 't' }, h('b', {}, 'لصق سكربت من TradingView'), h('small', {}, 'انسخ الكود من TradingView ثم اضغط هنا')))),
    });
    function start(src, name) { app.editorTarget = null; app.state.editor = { source: src, name, id: null }; app.editor.set(src, name); app.openPanel('editor'); }
  };

  // ================================================================ settings
  S.settings = () => {
    const st = app.state;
    const f = {
      theme: h('select', {}, h('option', { value: 'dark', selected: st.theme === 'dark' }, 'داكن'), h('option', { value: 'light', selected: st.theme === 'light' }, 'فاتح')),
      tz: h('select', {}, Array.from({ length: 27 }, (_, k) => k - 12).map((x) => h('option', { value: x * 60, selected: st.tzMin === x * 60 }, (x >= 0 ? 'UTC+' : 'UTC') + x + (x === 3 ? ' (بغداد)' : x === 0 ? ' (MT5 Exness)' : '')))),
      align: h('select', {},
        h('option', { value: 'utc0', selected: st.align.mode === 'utc' && !st.align.offsetMin }, 'منتصف الليل UTC (مثل MT5 Exness)'),
        h('option', { value: 'utc3', selected: st.align.mode === 'utc' && st.align.offsetMin === 180 }, 'منتصف الليل UTC+3'),
        h('option', { value: 'utc2', selected: st.align.mode === 'utc' && st.align.offsetMin === 120 }, 'منتصف الليل UTC+2 (أغلب وسطاء MT4/5)'),
        h('option', { value: 'ny17', selected: st.align.mode === 'ny17' }, 'نيويورك 17:00 (مثل TradingView للفوركس والذهب)')),
      maxBars: h('select', {}, [2000, 5000, 10000, 20000, 50000, 100000, 300000, 1000000].map((x) => h('option', { value: x, selected: st.maxBars === x }, x.toLocaleString() + ' شمعة'))),
      vol: h('input', { type: 'checkbox', checked: st.showVolume }),
      grid: h('input', { type: 'checkbox', checked: st.grid }),
      log: h('input', { type: 'checkbox', checked: !!app.chart.opts.logMain }),
    };
    const s = sheet({
      title: 'الإعدادات',
      body: h('div', { class: 'form' },
        h('label', {}, 'المظهر'), f.theme, h('label', {}, 'توقيت العرض'), f.tz, h('label', {}, 'بداية الشمعة اليومية/الساعات'), f.align,
        h('label', {}, 'عدد الشموع لحساب المؤشرات'), f.maxBars, h('label', {}, 'إظهار الفوليوم'), f.vol, h('label', {}, 'الشبكة'), f.grid, h('label', {}, 'مقياس لوغاريتمي'), f.log,
        h('div', { class: 'full note' }, 'زيادة عدد الشموع تعطي تاريخاً أطول للمؤشرات والاختبار لكنها أبطأ. TradingView يحسب على 5k–20k شمعة حسب الاشتراك؛ هنا يمكنك الوصول إلى مليون شمعة.')),
      footer: [h('button', { class: 'btn pri', style: { flex: 1 }, onclick: () => {
        st.theme = f.theme.value; st.tzMin = +f.tz.value; st.maxBars = +f.maxBars.value; st.showVolume = f.vol.checked; st.grid = f.grid.checked;
        const a = f.align.value;
        const newAlign = a === 'ny17' ? { mode: 'ny17' } : { mode: 'utc', offsetMin: a === 'utc3' ? 180 : a === 'utc2' ? 120 : 0 };
        const alignChanged = JSON.stringify(newAlign) !== JSON.stringify(st.align);
        st.align = newAlign;
        app.applyTheme();
        app.chart.setTheme(st.theme);
        app.chart.setOptions({ tzMin: st.tzMin, showVolume: st.showVolume, grid: st.grid, logMain: f.log.checked });
        for (const x of app.inds) x.rt = null;
        if (alignChanged) { app.aggCache = new Map(); app.setTf(st.tf); } else app.recomputeAll();
        app.saveState();
        s.close();
      } }, 'حفظ')],
    });
  };

  // ================================================================ replay
  S.replayMenu = () => {
    const dt = h('input', { type: 'datetime-local', style: { flex: 1 } });
    const s = sheet({
      title: 'إعادة التشغيل (Bar Replay)',
      body: h('div', {},
        h('div', { class: 'list' },
          h('div', { class: 'li', onclick: () => { s.close(); app.startReplayPick(); } }, h('div', { class: 't' }, h('b', {}, '👆 اختيار شمعة من الشارت'), h('small', {}, 'تختفي كل الشموع بعدها وتبدأ الإعادة'))),
          h('div', { class: 'li', onclick: () => { s.close(); app.startReplayRandom(); } }, h('div', { class: 't' }, h('b', {}, '🎲 نقطة عشوائية'), h('small', {}, 'تدريب بدون معرفة الاتجاه مسبقاً'))),
          app.replay.active ? h('div', { class: 'li', onclick: () => { s.close(); app.exitReplay(); } }, h('div', { class: 't' }, h('b', {}, '⏹ الخروج من الإعادة'), h('small', {}, 'العودة لآخر البيانات'))) : null),
        h('div', { class: 'cat' }, 'الانتقال إلى تاريخ'),
        h('div', { class: 'row' }, dt, h('button', { class: 'btn pri', onclick: () => { const t = Date.parse(dt.value + 'Z') - app.state.tzMin * 60000; if (!isFinite(t)) { toast('اختر التاريخ'); return; } s.close(); app.startReplayAtTime(t); } }, 'ابدأ')),
        h('p', { class: 'note' }, 'الإعادة تستخدم بيانات الدقيقة لبناء الشمعة الحالية تدريجياً حتى على الأطر الكبيرة، وتطبق أوامر التداول و SL/TP بدقة الدقيقة الواحدة.')),
    });
  };

  S.replayBar = (show) => {
    const bar = $('#replayBar');
    if (!show) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
    bar.classList.remove('hidden');
    const r = app.replay;
    if (!bar.firstChild) {
      bar.append(
        h('button', { class: 'ib', title: 'خروج', onclick: () => app.exitReplay() }, '✕'),
        h('button', { class: 'ib', title: 'اختيار نقطة جديدة', onclick: () => app.startReplayPick() }, '⇤'),
        h('button', { class: 'ib play', title: 'تشغيل/إيقاف', onclick: () => app.togglePlay() }, '▶'),
        h('button', { class: 'ib', title: 'خطوة', onclick: () => { app.stopPlay(); app.stepReplay(1); } }, '⏭'),
        h('select', { class: 'speed', title: 'السرعة', onchange: (e) => { r.speed = +e.target.value; } }, [1, 2, 3, 5, 10, 20, 50, 100, 300].map((x) => h('option', { value: x, selected: r.speed === x }, x + 'x'))),
        h('select', { class: 'unit', title: 'وحدة الخطوة', onchange: (e) => { r.unit = e.target.value; } }, h('option', { value: 'bar', selected: r.unit === 'bar' }, 'شمعة'), h('option', { value: 'base', selected: r.unit === 'base' }, '1m')),
        h('span', { class: 'rtime' }, ''));
    }
    bar.querySelector('.play').textContent = r.playing ? '⏸' : '▶';
    const t = app.base && r.cursor > 0 ? app.base.t[r.cursor - 1] : NaN;
    bar.querySelector('.rtime').textContent = isFinite(t) ? fmtDate(t + 60000, app.state.tzMin) : '';
  };

  // ================================================================ drawing popup
  S.drawingPop = (d) => {
    const pop = $('#drawPop');
    pop.innerHTML = '';
    if (!d) { pop.classList.add('hidden'); return; }
    pop.classList.remove('hidden');
    const colors = ['#2962ff', '#f23645', '#089981', '#ff9800', '#e040fb', '#00bcd4', '#ffeb3b', '#d1d4dc', '#787b86'];
    const sw = h('button', { class: 'sw', style: { background: d.style.color }, onclick: () => {
      const s = sheet({ title: 'اللون', body: h('div', { class: 'colors' }, colors.map((c) => h('button', { style: { background: c }, class: c === d.style.color ? 'on' : '', onclick: () => { d.style.color = c; sw.style.background = c; app.chart.invalidate(); app.saveDrawings(); s.close(); } }))) });
    } });
    const width = h('button', { class: 'ib', title: 'السماكة', onclick: () => { d.style.width = (d.style.width % 4) + 1; width.textContent = d.style.width + 'px'; app.chart.invalidate(); app.saveDrawings(); } }, (d.style.width || 1) + 'px');
    const dsh = h('button', { class: 'ib', title: 'النمط', onclick: () => { d.style.dash = d.style.dash === 'solid' ? 'dashed' : d.style.dash === 'dashed' ? 'dotted' : 'solid'; dsh.textContent = d.style.dash === 'solid' ? '—' : d.style.dash === 'dashed' ? '- -' : '···'; app.chart.invalidate(); app.saveDrawings(); } }, d.style.dash === 'solid' ? '—' : d.style.dash === 'dashed' ? '- -' : '···');
    pop.append(sw, width, dsh);
    if (d.type === 'text') pop.append(h('button', { class: 'ib', title: 'تعديل النص', onclick: async () => { const t = await promptBox('النص', d.style.text, true); if (t !== null) { d.style.text = t; app.chart.invalidate(); app.saveDrawings(); } } }, '✎'));
    if (d.type === 'fib') pop.append(h('button', { class: 'ib', title: 'تمديد', onclick: () => { d.style.extend = !d.style.extend; app.chart.invalidate(); app.saveDrawings(); } }, '⇥'));
    if (d.type === 'long' || d.type === 'short') pop.append(h('button', { class: 'ib', title: 'تنفيذ كأمر', onclick: () => placeFromTool(d) }, '▶$'));
    pop.append(h('button', { class: 'ib', title: 'قفل', onclick: () => { d.locked = !d.locked; app.chart.select(null); app.saveDrawings(); toast(d.locked ? 'مقفل' : 'غير مقفل'); } }, d.locked ? '🔒' : '🔓'));
    pop.append(h('button', { class: 'ib', title: 'حذف', style: { color: '#f23645' }, onclick: () => { const k = app.drawings.indexOf(d); if (k >= 0) app.drawings.splice(k, 1); app.chart.select(null); app.chart.invalidate(); app.saveDrawings(); } }, '🗑'));
    if (d.type === 'text' && !d.style.text) promptBox('النص', '', true).then((t) => { d.style.text = t || 'Text'; app.chart.invalidate(); app.saveDrawings(); });
  };

  function placeFromTool(d) {
    // convert a long/short position drawing into a pending/market order
    const side = d.type === 'long' ? 1 : -1;
    const bid = app.currentBid();
    const entry = d.pts[0].p;
    const mkt = side === 1 ? Math.abs(entry - (bid + app.spec.spread * app.spec.point)) < app.spec.point * 20 : Math.abs(entry - bid) < app.spec.point * 20;
    if (!app.replay.active) { toast('ابدأ وضع الإعادة أولاً للتداول'); return; }
    try {
      const A = app.panelsAccount || null; void A;
      import('../trading/account.js').then((M) => {
        try {
          if (mkt) M.placeMarket(app.account, app.spec, side, app.state.trade.lots, bid, app.currentTime(), d.stop, d.target);
          else {
            const ask = M.ask(app.spec, bid);
            const type = side === 1 ? (entry < ask ? 'buy_limit' : 'buy_stop') : (entry > bid ? 'sell_limit' : 'sell_stop');
            M.placePending(app.account, app.spec, type, app.state.trade.lots, entry, bid, app.currentTime(), d.stop, d.target);
          }
          app.saveAccount(); app.panels.refreshTrade(); toast('تم إرسال الأمر من أداة المركز');
        } catch (e) { toast(e.message); }
      });
    } catch (e) { toast(e.message); }
  }

  // ================================================================ backup / about
  S.backup = () => {
    const s = sheet({
      title: 'نسخ احتياطي',
      body: h('div', { class: 'list' },
        h('div', { class: 'li', onclick: async () => {
          const data = { v: 1, state: app.state, scripts: await store.scripts.all(), account: app.account, drawings: {} };
          for (const k of await store.idb.keys('kv')) if (String(k).startsWith('drawings:')) data.drawings[k] = await store.kv.get(k);
          download(`btx-chart-lab-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json');
          s.close();
        } }, h('div', { class: 't' }, h('b', {}, 'تصدير نسخة احتياطية'), h('small', {}, 'السكربتات، الرسومات، الإعدادات، حساب التدريب'))),
        h('div', { class: 'li', onclick: () => {
          const inp = $('#fileInput'); inp.value = ''; inp.accept = '.json,application/json';
          inp.onchange = async () => {
            try {
              const data = JSON.parse(await inp.files[0].text());
              for (const sc of data.scripts || []) await store.scripts.put(sc);
              for (const k in data.drawings || {}) await store.kv.set(k, data.drawings[k]);
              if (data.account) await store.kv.set('account', data.account);
              if (data.state) await store.kv.set('state', data.state);
              toast('تمت الاستعادة — سيُعاد التحميل'); setTimeout(() => location.reload(), 900);
            } catch (e) { toast('ملف غير صالح: ' + e.message); }
          };
          inp.click(); s.close();
        } }, h('div', { class: 't' }, h('b', {}, 'استعادة من ملف'), h('small', {}, 'ملف JSON مُصدّر سابقاً'))),
        h('div', { class: 'li', onclick: async () => { if (await confirmBox('مسح كل الإعدادات والمؤشرات من الشارت (السكربتات المحفوظة تبقى)؟', 'مسح', true)) { await store.kv.set('state', null); location.reload(); } } }, h('div', { class: 't' }, h('b', {}, 'إعادة ضبط الواجهة'), h('small', {}, 'يحذف المؤشرات المضافة والإعدادات')))),
    });
  };
  S.about = () => {
    sheet({
      title: 'حول BTX Chart Lab',
      body: h('div', { class: 'note', style: { color: 'var(--fg)', fontSize: '14px', lineHeight: '1.8' } },
        h('p', {}, 'منصة شارت وتدريب تعمل دون اتصال: محرك Pine Script (v4/v5/v6) يشغّل مؤشرات واستراتيجيات TradingView، مختبر استراتيجيات مع Bar Magnifier، إعادة شمعة بشمعة، تداول تدريبي بحساب لوت دقيق (عادي/سنت)، أدوات رسم، واستيراد أي بيانات CSV.'),
        h('p', {}, 'البيانات المدمجة: XAUUSD M1 + الفوليوم من Dukascopy (أسعار Bid). قد تختلف عن أسعار وسيطك ببضع سنتات؛ استورد بيانات MT5 من حسابك للتطابق التام.'),
        h('p', {}, 'ملاحظة: بعض ميزات Pine التي تحتاج خوادم TradingView (المكتبات import، البيانات المالية، request.economic) غير متاحة دون اتصال.'),
        h('p', { style: { direction: 'ltr' } }, 'Build: ' + (window.BTX_BUILD || 'dev'))),
    });
  };

  return S;
}
void fmtNum;

// Tiny DOM helpers + bottom sheets, toasts, prompts
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const stack = [];
export function sheet({ title, body, footer, onClose, wide }) {
  const layer = $('#sheetLayer');
  const back = h('div', { class: 'sheet-back' });
  const closeBtn = h('button', { class: 'ib sm', html: '✕', onclick: () => close() });
  const head = h('div', { class: 'sheet-h' }, h('h3', {}, title || ''), closeBtn);
  const b = h('div', { class: 'sheet-b' }, body || '');
  const box = h('div', { class: 'sheet' + (wide ? ' wide' : '') }, head, b, footer ? h('div', { class: 'sheet-f' }, footer) : null);
  const wrap = h('div', {}, back, box);
  back.onclick = () => close();
  layer.append(wrap);
  let closed = false;
  function close(v) {
    if (closed) return;
    closed = true;
    wrap.remove();
    const k = stack.indexOf(api); if (k >= 0) stack.splice(k, 1);
    onClose && onClose(v);
  }
  const api = { close, body: b, box, setTitle: (t) => { head.querySelector('h3').textContent = t; } };
  stack.push(api);
  return api;
}
export function closeTopSheet() { const s = stack[stack.length - 1]; if (s) { s.close(); return true; } return false; }
export function anySheet() { return stack.length > 0; }

let toastTimer = 0;
export function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export function confirmBox(msg, okText = 'موافق', danger = false) {
  return new Promise((res) => {
    let ok = false;
    const s = sheet({
      title: 'تأكيد', body: h('div', { class: 'note', style: { fontSize: '14px', color: 'var(--fg)' } }, msg),
      footer: [h('button', { class: 'btn ' + (danger ? 'red' : 'pri'), style: { flex: 1 }, onclick: () => { ok = true; s.close(); } }, okText), h('button', { class: 'btn', style: { flex: 1 }, onclick: () => s.close() }, 'إلغاء')],
      onClose: () => res(ok),
    });
  });
}
export function promptBox(title, value = '', multiline = false) {
  return new Promise((res) => {
    let out = null;
    const inp = multiline ? h('textarea', { rows: 4, style: { width: '100%' } }) : h('input', { type: 'text', style: { width: '100%' } });
    inp.value = value;
    const s = sheet({
      title, body: inp,
      footer: [h('button', { class: 'btn pri', style: { flex: 1 }, onclick: () => { out = inp.value; s.close(); } }, 'حفظ'), h('button', { class: 'btn', style: { flex: 1 }, onclick: () => s.close() }, 'إلغاء')],
      onClose: () => res(out),
    });
    setTimeout(() => inp.focus(), 50);
  });
}

export function fmtMoney(v, d = 2) { return isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—'; }
export function fmtNum(v, d = 2) { return isFinite(v) ? (+v.toFixed(d)).toLocaleString('en-US', { maximumFractionDigits: d }) : '—'; }
export function fmtDate(t, tzMin = 0) {
  if (!isFinite(t)) return '—';
  const d = new Date(t + tzMin * 60000);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function download(name, text, mime = 'text/plain') {
  if (window.BTX && window.BTX.saveFile) {
    try { const where = window.BTX.saveFile(name, text, mime); toast('تم الحفظ: ' + where); return; } catch (e) { /* fall back */ }
  }
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: mime })), download: name });
  document.body.append(a); a.click(); a.remove();
}

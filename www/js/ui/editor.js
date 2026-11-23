// Pine Script editor: textarea with syntax-highlight overlay, line numbers, auto-indent, error list.
import { h } from './dom.js';

const KW = new Set(['if', 'else', 'for', 'to', 'by', 'in', 'while', 'break', 'continue', 'switch', 'var', 'varip', 'and', 'or', 'not', 'true', 'false', 'import', 'export', 'method', 'type', 'enum', 'series', 'simple', 'const', 'int', 'float', 'bool', 'string', 'color', 'na']);
const NS = new Set(['ta', 'math', 'str', 'array', 'matrix', 'map', 'color', 'input', 'request', 'strategy', 'label', 'line', 'box', 'table', 'linefill', 'polyline', 'chart', 'syminfo', 'timeframe', 'barstate', 'session', 'ticker', 'plot', 'hline', 'shape', 'location', 'size', 'position', 'extend', 'xloc', 'yloc', 'text', 'font', 'display', 'format', 'scale', 'currency', 'dayofweek', 'barmerge', 'order', 'alert', 'log', 'runtime']);
const VARS = new Set(['open', 'high', 'low', 'close', 'volume', 'time', 'bar_index', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'last_bar_index', 'time_close', 'year', 'month', 'dayofmonth', 'hour', 'minute', 'second', 'timenow']);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlight(src) {
  const re = /(\/\/.*$)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?)|(#[0-9a-fA-F]{6,8}\b)|(\b\d+\.?\d*(?:[eE][+-]?\d+)?\b|\.\d+\b)|([A-Za-z_][A-Za-z0-9_]*)(\s*\()?/gm;
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index));
    last = re.lastIndex;
    if (m[1]) out += `<span class="tk-c">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="tk-s">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="tk-col">${esc(m[3])}</span>`;
    else if (m[4]) out += `<span class="tk-n">${esc(m[4])}</span>`;
    else if (m[5]) {
      const w = m[5];
      const isCall = !!m[6];
      const nextDot = src[re.lastIndex] === '.' && !m[6];
      let cls = '';
      if (KW.has(w)) cls = 'tk-k';
      else if (NS.has(w) && nextDot) cls = 'tk-ns';
      else if (isCall) cls = 'tk-f';
      else if (VARS.has(w)) cls = 'tk-v';
      out += cls ? `<span class="${cls}">${w}</span>` : w;
      if (m[6]) out += esc(m[6]);
    }
  }
  out += esc(src.slice(last));
  return out + '\n';
}

export class Editor {
  constructor(root, cb) {
    this.cb = cb;
    this.name = h('span', { class: 'name' }, 'سكربت جديد');
    const bar = h('div', { class: 'ed-bar' },
      h('button', { class: 'btn sm pri', onclick: () => cb.onRun(this.value()) }, '▶ إضافة/تحديث على الشارت'),
      h('button', { class: 'btn sm', onclick: () => cb.onSave(this.value()) }, 'حفظ'),
      h('button', { class: 'btn sm', onclick: () => cb.onOpen() }, 'فتح'),
      h('button', { class: 'btn sm', onclick: () => cb.onNew() }, 'جديد'),
      h('button', { class: 'btn sm', onclick: () => this.paste() }, 'لصق'),
      h('button', { class: 'btn sm', onclick: () => this.copy() }, 'نسخ'),
      h('button', { class: 'btn sm', onclick: () => this.font(1) }, 'A+'),
      h('button', { class: 'btn sm', onclick: () => this.font(-1) }, 'A-'),
      this.name);
    this.gutter = h('div', { class: 'ed-gutter' });
    this.pre = h('pre', {});
    this.ta = h('textarea', { spellcheck: false, autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', wrap: 'off' });
    const main = h('div', { class: 'ed-main' }, this.pre, this.ta);
    this.errBox = h('div', { class: 'ed-err' });
    root.append(h('div', { class: 'ed-wrap' }, bar, h('div', { class: 'ed' }, this.gutter, main), this.errBox));
    this.size = 12.5;
    this.errLines = new Set();
    this.ta.addEventListener('input', () => this.refresh());
    this.ta.addEventListener('scroll', () => { this.pre.scrollTop = this.ta.scrollTop; this.pre.scrollLeft = this.ta.scrollLeft; this.gutter.scrollTop = this.ta.scrollTop; });
    this.ta.addEventListener('keydown', (e) => this.key(e));
  }
  value() { return this.ta.value; }
  set(src, name) { this.ta.value = src; if (name !== undefined) this.name.textContent = name; this.errors([]); this.refresh(); this.ta.scrollTop = 0; }
  setName(n) { this.name.textContent = n; }
  refresh() {
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      const v = this.ta.value;
      this.pre.innerHTML = highlight(v);
      const n = v.split('\n').length;
      let g = '';
      for (let i = 1; i <= n; i++) g += (this.errLines.has(i) ? `<span class="e">${i}</span>` : i) + '\n';
      this.gutter.innerHTML = g;
      this.pre.scrollTop = this.ta.scrollTop;
      this.cb.onChange && this.cb.onChange(v);
    }, 25);
  }
  font(d) {
    this.size = Math.max(9, Math.min(20, this.size + d));
    const lh = Math.round(this.size * 1.45);
    for (const el of [this.pre, this.ta, this.gutter]) { el.style.fontSize = this.size + 'px'; el.style.lineHeight = lh + 'px'; }
  }
  key(e) {
    const ta = this.ta;
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      ta.setRangeText('    ', s, en, 'end');
      this.refresh();
    } else if (e.key === 'Enter') {
      const s = ta.selectionStart;
      const before = ta.value.slice(0, s);
      const line = before.slice(before.lastIndexOf('\n') + 1);
      let ind = (/^\s*/.exec(line) || [''])[0];
      const tl = line.trim();
      if (/=>\s*$/.test(tl) || /^(if|else|for|while|switch|type|enum)\b/.test(tl) || /=\s*(if|switch|for|while)\b/.test(tl)) ind += '    ';
      e.preventDefault();
      ta.setRangeText('\n' + ind, s, ta.selectionEnd, 'end');
      this.refresh();
    }
  }
  async paste() {
    try { const t = await navigator.clipboard.readText(); if (t) { this.set(t); this.cb.onChange && this.cb.onChange(t); } } catch (e) { this.ta.focus(); document.execCommand && document.execCommand('paste'); }
  }
  async copy() {
    try { await navigator.clipboard.writeText(this.ta.value); this.cb.toast && this.cb.toast('تم النسخ'); } catch (e) { this.ta.select(); document.execCommand('copy'); }
  }
  errors(list) {
    this.errLines = new Set(list.filter((e) => e.line && e.level !== 'warn' && e.level !== 'ok').map((e) => e.line));
    this.errBox.innerHTML = '';
    for (const e of list) {
      const d = h('div', { class: e.level || '' }, (e.line ? `سطر ${e.line}: ` : '') + e.msg);
      if (e.line) d.onclick = () => this.gotoLine(e.line);
      this.errBox.append(d);
    }
    this.refresh();
  }
  gotoLine(n) {
    const lines = this.ta.value.split('\n');
    let pos = 0;
    for (let i = 0; i < n - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    this.ta.focus();
    this.ta.setSelectionRange(pos, pos + (lines[n - 1] || '').length);
    const lh = parseFloat(getComputedStyle(this.ta).lineHeight) || 18;
    this.ta.scrollTop = Math.max(0, (n - 4) * lh);
  }
}

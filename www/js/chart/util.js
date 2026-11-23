// Chart helpers: number/time formatting, nice ticks, color utils, canvas primitives
import { parseColor, toCss } from '../pine/lib/registry.js';

export const THEMES = {
  dark: {
    name: 'dark', bg: '#131722', bg2: '#1e222d', grid: 'rgba(42,46,57,0.6)', text: '#d1d4dc', text2: '#787b86', axisBg: '#131722', border: '#2a2e39',
    up: '#26a69a', down: '#ef5350', wickUp: '#26a69a', wickDown: '#ef5350', volUp: 'rgba(38,166,154,0.35)', volDown: 'rgba(239,83,80,0.35)',
    cross: '#9598a1', crossLabel: '#363a45', line: '#2962ff', selection: '#2962ff', pineBg: '#131722ff', pineFg: '#d1d4dcff',
  },
  light: {
    name: 'light', bg: '#ffffff', bg2: '#f0f3fa', grid: 'rgba(225,227,235,0.8)', text: '#131722', text2: '#787b86', axisBg: '#ffffff', border: '#e0e3eb',
    up: '#089981', down: '#f23645', wickUp: '#089981', wickDown: '#f23645', volUp: 'rgba(8,153,129,0.3)', volDown: 'rgba(242,54,69,0.3)',
    cross: '#9598a1', crossLabel: '#131722', line: '#2962ff', selection: '#2962ff', pineBg: '#ffffffff', pineFg: '#131722ff',
  },
};

export function css(c, fallback = null) {
  if (c === undefined || c === null || (typeof c === 'number' && isNaN(c))) return fallback;
  if (typeof c !== 'string') return fallback;
  if (c.startsWith('#') && (c.length === 9 || c.length === 7)) return toCss(c) || fallback;
  return c;
}
export function alphaOf(c) { const p = parseColor(c); return p ? p[3] / 255 : 1; }
export function withAlpha(c, a) {
  const p = parseColor(c);
  if (!p) return c;
  return `rgba(${p[0]},${p[1]},${p[2]},${(p[3] / 255 * a).toFixed(3)})`;
}

export function niceStep(raw) {
  if (!(raw > 0) || !isFinite(raw)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * p;
}

export function fmtPrice(v, digits) {
  if (!isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
}
export function autoDigits(range) {
  if (!(range > 0)) return 2;
  if (range < 0.0001) return 8;
  if (range < 0.01) return 6;
  if (range < 1) return 4;
  if (range < 50) return 3;
  return 2;
}
export function fmtVol(x) {
  const a = Math.abs(x);
  if (!isFinite(x)) return '—';
  if (a >= 1e9) return (x / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (x / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (x / 1e3).toFixed(2) + 'K';
  return (Math.round(x * 100) / 100).toString();
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const p2 = (x) => (x < 10 ? '0' : '') + x;
export function fmtTime(t, tzMin, kind = 'full') {
  const d = new Date(t + tzMin * 60000);
  if (kind === 'hm') return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes());
  if (kind === 'day') return d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
  if (kind === 'month') return MON[d.getUTCMonth()];
  if (kind === 'year') return String(d.getUTCFullYear());
  if (kind === 'date') return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

export function dash(ctx, style, w = 1) {
  if (style === 'dashed') ctx.setLineDash([6 * w, 4 * w]);
  else if (style === 'dotted') ctx.setLineDash([w * 1.5, w * 2.5]);
  else ctx.setLineDash([]);
}

export const SIZE_PX = { tiny: 7, small: 10, normal: 14, auto: 10, large: 20, huge: 28 };
export const FONT_PX = { tiny: 9, small: 10, normal: 12, auto: 11, large: 15, huge: 20 };

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function lowerBound(arr, x, n = arr.length) {
  let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
  return lo;
}

export function contrastText(bg) {
  const p = parseColor(bg);
  if (!p) return '#ffffff';
  const l = 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
  return l > 150 ? '#131722' : '#ffffff';
}

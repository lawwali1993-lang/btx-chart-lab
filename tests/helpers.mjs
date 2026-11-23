import { createBars } from '../www/js/data/binfmt.js';
export function synth(n = 3000, seed = 7, start = Date.UTC(2024, 0, 2), step = 60000) {
  const b = createBars(n);
  let x = seed >>> 0 || 1;
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  let p = 2050;
  for (let i = 0; i < n; i++) {
    const o = Math.round(p * 100) / 100;
    const c = Math.round((o + (rnd() - 0.5) * 3) * 100) / 100;
    const h = Math.round((Math.max(o, c) + rnd() * 1.5) * 100) / 100;
    const l = Math.round((Math.min(o, c) - rnd() * 1.5) * 100) / 100;
    b.t[i] = start + i * step; b.o[i] = o; b.h[i] = h; b.l[i] = l; b.c[i] = c; b.v[i] = Math.round(50 + rnd() * 500);
    p = c;
  }
  return b;
}
export const SYM = { name: 'XAUUSD', digits: 2, point: 0.01, contractSize: 100, quoteCurrency: 'USD', baseCurrency: 'XAU', timezone: 'Etc/UTC' };

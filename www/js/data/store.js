// Persistent storage (IndexedDB) + data loading for bundled and imported symbols.
import { decodeBars, encodeBars, decodeHeader, compactBars } from './binfmt.js';

const DB_NAME = 'btx-chart-lab';
const STORES = ['symbols', 'data', 'scripts', 'kv'];
let dbp = null;

function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('aborted'));
  });
}
export const idb = {
  get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
  put: (store, key, val) => tx(store, 'readwrite', (s) => s.put(val, key)),
  del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
  keys: (store) => tx(store, 'readonly', (s) => s.getAllKeys()),
  all: (store) => tx(store, 'readonly', (s) => s.getAll()),
};

// ---- compression helpers (browser streams; fallback = raw) ------------------
export async function gunzip(u8) {
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) return u8;
  const ds = new DecompressionStream('gzip');
  const out = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}
export async function gzip(u8) {
  if (typeof CompressionStream === 'undefined') return u8;
  const cs = new CompressionStream('gzip');
  const out = await new Response(new Blob([u8]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(out);
}

// ---- symbols ------------------------------------------------------------------
const cache = new Map(); // name → {meta, bars}

export async function bundledManifest() {
  try {
    const r = await fetch('data/manifest.json', { cache: 'no-store' });
    if (!r.ok) return [];
    return await r.json();
  } catch (e) { return []; }
}

export async function listSymbols() {
  const out = new Map();
  for (const m of await bundledManifest()) out.set(m.name, { ...m, bundled: true });
  try { for (const s of (await idb.all('symbols')) || []) out.set(s.name, { ...(out.get(s.name) || {}), ...s }); } catch (e) { /* */ }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveSymbolMeta(meta) { await idb.put('symbols', meta.name, meta); }

/** Load bars for a symbol: imported data in IDB overrides/extends bundled data. */
export async function loadSymbol(name, onProgress) {
  if (cache.has(name)) return cache.get(name);
  let meta = null, bars = null;
  const stored = await idb.get('symbols', name).catch(() => null);
  const imported = await idb.get('data', name).catch(() => null);
  if (imported) {
    onProgress && onProgress('فك ضغط البيانات المستوردة...');
    const r = decodeBars(await gunzip(imported));
    meta = r.meta; bars = r.bars;
  } else {
    const man = (await bundledManifest()).find((m) => m.name === name);
    if (man) {
      onProgress && onProgress('تحميل بيانات ' + name + '...');
      const resp = await fetch(man.file);
      if (!resp.ok) throw new Error('تعذر تحميل ملف البيانات ' + man.file);
      const u8 = new Uint8Array(await resp.arrayBuffer());
      onProgress && onProgress('فك ضغط ' + (u8.length / 1048576).toFixed(1) + ' MB...');
      const r = decodeBars(await gunzip(u8));
      meta = r.meta; bars = r.bars;
    }
  }
  if (!bars) throw new Error('لا توجد بيانات للرمز ' + name);
  if (stored) meta = { ...meta, ...stored };
  meta.name = name;
  const rec = { meta, bars };
  cache.set(name, rec);
  return rec;
}
export function cached(name) { return cache.get(name); }
export function dropCache(name) { cache.delete(name); }

export async function saveSymbolData(meta, bars) {
  const enc = encodeBars({ ...meta, timeUnit: meta.timeUnit || 60 }, bars);
  const gz = await gzip(enc);
  await idb.put('data', meta.name, gz);
  const { header } = decodeHeader(enc);
  const m = { ...meta, count: bars.length, from: bars.t[0], to: bars.t[bars.length - 1], bytes: gz.length, imported: true, priceScale: header.priceScale };
  await saveSymbolMeta(m);
  cache.set(meta.name, { meta: m, bars: compactBars(bars) });
  return m;
}
export async function deleteSymbol(name) {
  await idb.del('data', name).catch(() => {});
  await idb.del('symbols', name).catch(() => {});
  cache.delete(name);
}

// ---- key/value --------------------------------------------------------------------
export const kv = {
  get: async (k, d) => { try { const v = await idb.get('kv', k); return v === undefined ? d : v; } catch (e) { return d; } },
  set: (k, v) => idb.put('kv', k, v).catch(() => {}),
};
export const scripts = {
  all: async () => ((await idb.all('scripts').catch(() => [])) || []).sort((a, b) => (b.updated || 0) - (a.updated || 0)),
  get: (id) => idb.get('scripts', id),
  put: (s) => idb.put('scripts', s.id, { ...s, updated: Date.now() }),
  del: (id) => idb.del('scripts', id),
};

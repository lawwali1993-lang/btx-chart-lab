// Strategy broker emulator (TradingView semantics): market/limit/stop entries, strategy.order,
// close/close_all, exit brackets (profit/loss/limit/stop/trailing), pyramiding, reversal,
// commission, slippage, process_orders_on_close, bar magnifier (intrabar path from lower TF data).
// All state is a plain object (structuredClone-safe).
import { def, defv, K, truthy, isNa, num, RuntimeErr } from './lib/registry.js';

const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

export function brokerInit(rt, a) {
  const ov = rt.opts.strategyOverrides || {};
  const pick = (k, d) => (ov[k] !== undefined && ov[k] !== null && ov[k] !== '' ? ov[k] : a[k] !== undefined ? a[k] : d);
  const lots = !!ov.lots;
  const cfg = {
    initialCapital: num(pick('initial_capital', 1000000), 1000000),
    qtyType: pick('default_qty_type', 'fixed'),
    qtyValue: num(pick('default_qty_value', 1), 1),
    pyramiding: Math.max(0, num(pick('pyramiding', 0), 0)),
    commType: pick('commission_type', 'percent'),
    commValue: num(pick('commission_value', 0), 0),
    slippage: num(pick('slippage', 0), 0),
    poc: truthy(pick('process_orders_on_close', false)),
    closeRule: pick('close_entries_rule', 'FIFO'),
    lots,
    mult: lots ? (rt.sym.contractSize || 1) : 1,
    pv: lots ? 1 : (rt.sym.pointValue || 1),
    tick: rt.sym.point || 0.01,
    magnifier: ov.magnifier !== undefined ? !!ov.magnifier : truthy(a.use_bar_magnifier),
    currency: a.currency || rt.sym.quoteCurrency || 'USD',
  };
  return {
    cfg, orders: [], exits: [], trades: [], closed: [], pos: 0, avg: NaN,
    net: 0, gp: 0, gl: 0, comm: 0, wins: 0, losses: 0, even: 0,
    eq: [], peak: cfg.initialCapital, maxDD: 0, maxDDpct: 0, maxRU: 0, trough: cfg.initialCapital,
    maxHeld: 0, allow: 'all', tid: 0, lastEntryName: '', bar: -1, events: [],
  };
}

function qtyUnits(B, rt, qty, price) {
  const c = B.cfg;
  if (qty !== undefined && !isNa(qty)) return Math.abs(num(qty)) * c.mult;
  const eqv = c.initialCapital + B.net + openProfit(B, price);
  if (c.qtyType === 'cash') return c.qtyValue / price / c.pv;
  if (c.qtyType === 'percent_of_equity') return (eqv * c.qtyValue / 100) / price / c.pv;
  return c.qtyValue * c.mult;
}

function commission(B, price, units) {
  const c = B.cfg;
  if (!c.commValue) return 0;
  if (c.commType === 'cash_per_contract') return c.commValue * units / c.mult;
  if (c.commType === 'cash_per_order') return c.commValue;
  return price * units * c.pv * c.commValue / 100;
}

function openProfit(B, price) {
  let p = 0;
  for (const t of B.trades) p += (price - t.price) * t.dir * t.qty * B.cfg.pv;
  return p;
}

function recalcPos(B) {
  let q = 0, v = 0;
  for (const t of B.trades) { q += t.dir * t.qty; v += t.price * t.qty; }
  B.pos = Math.abs(q) < 1e-12 ? 0 : q;
  const aq = B.trades.reduce((s, t) => s + t.qty, 0);
  B.avg = aq > 0 ? v / aq : NaN;
  B.maxHeld = Math.max(B.maxHeld, Math.abs(B.pos));
}

function openTrade(B, rt, i, dir, units, price, entryId, comment) {
  if (units <= 0) return;
  const cm = commission(B, price, units);
  B.comm += cm;
  B.trades.push({ tid: ++B.tid, entryId, dir, qty: units, qty0: units, price, time: rt.t[i], bar: i, comment: comment ?? entryId, hi: price, lo: price, comm: cm });
  B.lastEntryName = entryId;
  B.events.push({ bar: i, time: rt.t[i], type: 'entry', dir, price, qty: units / B.cfg.mult, id: entryId, comment: comment ?? entryId });
  recalcPos(B);
}

function closeTrade(B, rt, i, t, units, price, exitId, comment) {
  units = Math.min(units, t.qty);
  if (units <= 0) return;
  const c = B.cfg;
  const frac = units / t.qty;
  const entryComm = t.comm * frac;
  const exitComm = commission(B, price, units);
  B.comm += exitComm;
  const gross = (price - t.price) * t.dir * units * c.pv;
  const profit = gross - entryComm - exitComm;
  B.net += profit;
  if (profit > 0) { B.gp += profit; B.wins++; } else if (profit < 0) { B.gl += -profit; B.losses++; } else B.even++;
  const runup = (t.dir === 1 ? t.hi - t.price : t.price - t.lo) * units * c.pv;
  const dd = (t.dir === 1 ? t.lo - t.price : t.price - t.hi) * units * c.pv;
  B.closed.push({
    n: B.closed.length + 1, entryId: t.entryId, exitId: exitId ?? '', dir: t.dir, qty: units / c.mult,
    entryPrice: t.price, exitPrice: price, entryTime: t.time, exitTime: rt.t[i], entryBar: t.bar, exitBar: i,
    profit, profitPct: (price - t.price) * t.dir / t.price * 100, cum: B.net, runup, drawdown: dd,
    commission: entryComm + exitComm, entryComment: t.comment, exitComment: comment ?? exitId ?? '',
  });
  B.events.push({ bar: i, time: rt.t[i], type: 'exit', dir: t.dir, price, qty: units / c.mult, id: exitId ?? '', comment: comment ?? exitId ?? '', profit });
  t.comm -= entryComm;
  t.qty -= units;
  if (t.qty <= 1e-12) B.trades.splice(B.trades.indexOf(t), 1);
  recalcPos(B);
}

function closeUnits(B, rt, i, units, price, filterId, exitId, comment) {
  // close `units` from open trades (FIFO, or matching entry id)
  const list = B.trades.filter((t) => !filterId || t.entryId === filterId);
  if (B.cfg.closeRule === 'ANY' && filterId) { /* only matching */ }
  for (const t of list) {
    if (units <= 1e-12) break;
    const q = Math.min(units, t.qty);
    closeTrade(B, rt, i, t, q, price, exitId, comment);
    units -= q;
  }
  return units;
}

function slip(B, price, dir) { return price + dir * B.cfg.slippage * B.cfg.tick; }

function executeOrder(B, rt, i, o, price) {
  const c = B.cfg;
  if (o.type === 'entry') {
    let dir = o.dir;
    if (B.allow !== 'all' && ((B.allow === 'long' && dir === -1) || (B.allow === 'short' && dir === 1))) {
      if (B.pos !== 0 && sign(B.pos) !== dir) closeUnits(B, rt, i, Infinity, price, null, o.id, o.comment);
      return true;
    }
    const units = o.units > 0 ? o.units : qtyUnits(B, rt, undefined, price);
    if (B.pos !== 0 && sign(B.pos) === dir) {
      if (B.trades.length >= Math.max(1, c.pyramiding)) return true; // pyramiding limit → order discarded
      openTrade(B, rt, i, dir, units, price, o.id, o.comment);
    } else if (B.pos !== 0) {
      closeUnits(B, rt, i, Infinity, price, null, o.id, o.comment);
      openTrade(B, rt, i, dir, units, price, o.id, o.comment);
    } else openTrade(B, rt, i, dir, units, price, o.id, o.comment);
    return true;
  }
  if (o.type === 'order') {
    const units = o.units > 0 ? o.units : qtyUnits(B, rt, undefined, price);
    if (B.pos === 0 || sign(B.pos) === o.dir) openTrade(B, rt, i, o.dir, units, price, o.id, o.comment);
    else {
      const rem = closeUnits(B, rt, i, units, price, null, o.id, o.comment);
      if (rem > 1e-12) openTrade(B, rt, i, o.dir, rem, price, o.id, o.comment);
    }
    return true;
  }
  if (o.type === 'close') {
    const tr = B.trades.filter((t) => t.entryId === o.entryId);
    if (!tr.length) return true;
    const total = tr.reduce((s, t) => s + t.qty, 0);
    let units = o.units > 0 ? o.units : o.pct !== undefined ? total * o.pct / 100 : total;
    closeUnits(B, rt, i, units, price, o.entryId, o.entryId, o.comment);
    return true;
  }
  if (o.type === 'closeall') { closeUnits(B, rt, i, Infinity, price, null, 'Close all', o.comment ?? 'Close all'); return true; }
  return true;
}

function cleanupExits(B) {
  B.exits = B.exits.filter((ex) => {
    const has = B.trades.some((t) => !ex.from || t.entryId === ex.from);
    if (has) { ex.armed = true; return true; }
    return !ex.armed;
  });
}

// ---- intrabar path ---------------------------------------------------------
function barPath(o, h, l, c) {
  return Math.abs(h - o) < Math.abs(l - o) ? [o, h, l, c] : [o, l, h, c];
}
function buildPath(B, rt, i) {
  if (B.cfg.magnifier && rt.opts.magnifier) {
    const p = rt.opts.magnifier(i);
    if (p && p.length) return p;
  }
  return barPath(rt.o[i], rt.h[i], rt.l[i], rt.c[i]);
}

// candidate triggers: {level, ge: bool (price >= level triggers), kind, ref}
function collect(B) {
  const ev = [];
  for (const o of B.orders) {
    if (o.market || o.type === 'close' || o.type === 'closeall') continue;
    if (o.type !== 'entry' && o.type !== 'order') continue;
    if (!isNa(o.stop) && !o.stopHit) ev.push({ level: o.stop, ge: o.dir === 1, kind: 'stop', o });
    else if (!isNa(o.limit)) ev.push({ level: o.limit, ge: o.dir === -1, kind: 'limit', o });
  }
  for (const ex of B.exits) {
    for (const t of B.trades) {
      if (ex.from && t.entryId !== ex.from) continue;
      const lv = exitLevels(B, ex, t);
      if (!isNa(lv.tp)) ev.push({ level: lv.tp, ge: t.dir === 1, kind: 'tp', ex, t });
      if (!isNa(lv.sl)) ev.push({ level: lv.sl, ge: t.dir === -1, kind: 'sl', ex, t });
      if (!isNa(lv.tr)) ev.push({ level: lv.tr, ge: t.dir === -1, kind: 'trail', ex, t });
    }
  }
  return ev;
}

function exitLevels(B, ex, t) {
  const tk = B.cfg.tick, d = t.dir;
  let tp = NaN, sl = NaN, tr = NaN;
  const tps = [];
  if (!isNa(ex.limit)) tps.push(ex.limit);
  if (!isNa(ex.profit)) tps.push(t.price + d * ex.profit * tk);
  if (tps.length) tp = d === 1 ? Math.min(...tps) : Math.max(...tps);
  const sls = [];
  if (!isNa(ex.stop)) sls.push(ex.stop);
  if (!isNa(ex.loss)) sls.push(t.price - d * ex.loss * tk);
  if (sls.length) sl = d === 1 ? Math.max(...sls) : Math.min(...sls);
  const st = t.trail && t.trail[ex.id];
  if (st && st.active) tr = st.best - d * ex.trailOffset * tk;
  return { tp, sl, tr };
}

function updateTrails(B, price) {
  for (const ex of B.exits) {
    if (isNa(ex.trailOffset) || (isNa(ex.trailPoints) && isNa(ex.trailPrice))) continue;
    for (const t of B.trades) {
      if (ex.from && t.entryId !== ex.from) continue;
      t.trail = t.trail || {};
      let st = t.trail[ex.id];
      if (!st) st = t.trail[ex.id] = { active: false, best: NaN };
      const act = !isNa(ex.trailPrice) ? ex.trailPrice : t.price + t.dir * ex.trailPoints * B.cfg.tick;
      if (!st.active && (t.dir === 1 ? price >= act : price <= act)) { st.active = true; st.best = price; }
      if (st.active) st.best = t.dir === 1 ? Math.max(st.best, price) : Math.min(st.best, price);
    }
  }
}

function fire(B, rt, i, e, price) {
  if (e.kind === 'stop' || e.kind === 'limit') {
    const o = e.o;
    if (e.kind === 'stop' && !isNa(o.limit)) { o.stopHit = true; return; } // stop-limit: becomes a limit order
    const k = B.orders.indexOf(o);
    if (k >= 0) B.orders.splice(k, 1);
    const fill = e.kind === 'stop' ? slip(B, price, o.dir) : price;
    executeOrder(B, rt, i, o, fill);
    if (o.oca && o.ocaType === 'cancel') B.orders = B.orders.filter((x) => x.oca !== o.oca);
  } else {
    const { ex, t } = e;
    if (B.trades.indexOf(t) < 0) return;
    const units = !isNa(ex.units) && ex.units > 0 ? Math.min(ex.units, t.qty) : t.qty * (isNa(ex.pct) ? 100 : ex.pct) / 100;
    const fill = e.kind === 'tp' ? price : slip(B, price, -t.dir);
    const cm = e.kind === 'tp' ? (ex.commentProfit ?? ex.comment) : e.kind === 'sl' ? (ex.commentLoss ?? ex.comment) : (ex.commentTrail ?? ex.comment);
    closeTrade(B, rt, i, t, units, fill, ex.id, cm ?? ex.id);
  }
  cleanupExits(B);
}

function walk(B, rt, i, path) {
  // 1) gap check at the open
  let guard = 0;
  const p0 = path[0];
  for (;;) {
    const ev = collect(B).filter((e) => (e.ge ? p0 >= e.level : p0 <= e.level));
    if (!ev.length || ++guard > 200) break;
    fire(B, rt, i, ev[0], p0);
  }
  updateTrails(B, p0);
  for (let k = 0; k + 1 < path.length; k++) {
    let a = path[k];
    const b = path[k + 1];
    if (a === b) continue;
    const up = b > a;
    for (let g = 0; g < 200; g++) {
      const ev = collect(B).filter((e) => (up ? e.ge && e.level > a && e.level <= b : !e.ge && e.level < a && e.level >= b));
      // also orders that are already beyond the current price (e.g. newly armed exits)
      const now = collect(B).filter((e) => (e.ge ? a >= e.level : a <= e.level));
      if (now.length) { fire(B, rt, i, now[0], a); continue; }
      if (!ev.length) break;
      ev.sort((x, y) => (up ? x.level - y.level : y.level - x.level));
      const e = ev[0];
      // trailing: advance best price up to the trigger
      updateTrails(B, e.level);
      fire(B, rt, i, e, e.level);
      a = e.level;
    }
    updateTrails(B, b);
    for (const t of B.trades) { if (b > t.hi) t.hi = b; if (b < t.lo) t.lo = b; }
  }
}

export function brokerBarOpen(rt, i) {
  const B = rt.S.broker;
  B.bar = i;
  const path = buildPath(B, rt, i);
  // market orders placed on the previous bar fill at this bar's open
  const mk = B.orders.filter((o) => o.market);
  if (mk.length) {
    B.orders = B.orders.filter((o) => !o.market);
    for (const o of mk) {
      const dir = o.type === 'entry' || o.type === 'order' ? o.dir : -sign(B.pos);
      executeOrder(B, rt, i, o, slip(B, path[0], dir));
    }
    cleanupExits(B);
  }
  walk(B, rt, i, path);
  for (const t of B.trades) { if (rt.h[i] > t.hi) t.hi = rt.h[i]; if (rt.l[i] < t.lo) t.lo = rt.l[i]; }
}

export function brokerBarClose(rt, i) {
  const B = rt.S.broker;
  const c = B.cfg;
  if (c.poc) {
    const mk = B.orders.filter((o) => o.market);
    if (mk.length) {
      B.orders = B.orders.filter((o) => !o.market);
      for (const o of mk) executeOrder(B, rt, i, o, rt.c[i]);
      cleanupExits(B);
    }
  }
  const op = openProfit(B, rt.c[i]);
  const eq = c.initialCapital + B.net + op;
  B.eq[i] = eq;
  if (eq > B.peak) { B.peak = eq; }
  const dd = B.peak - eq;
  if (dd > B.maxDD) { B.maxDD = dd; B.maxDDpct = B.peak > 0 ? dd / B.peak * 100 : 0; }
  const ru = eq - Math.min(B.trough, eq);
  if (ru > B.maxRU) B.maxRU = ru;
  if (eq < B.trough) B.trough = eq;
}

// ---- strategy.* functions ----------------------------------------------------
function BK(rt) {
  const B = rt.S.broker;
  if (!B) { if (rt.isSub) return null; throw new RuntimeErr('دوال strategy.* تحتاج strategy() بدلاً من indicator()'); }
  return B;
}
const dirOf = (d) => (d === 'long' || d === true || d === 1 ? 1 : -1);

function placeOrder(rt, type, id, direction, qty, limit, stop, oca, ocaType, comment) {
  const B = BK(rt); if (!B) return NaN;
  id = String(id);
  const price = rt.c[rt.i];
  const units = qty === undefined || isNa(qty) ? 0 : Math.abs(num(qty)) * B.cfg.mult;
  const o = { type, id, dir: dirOf(direction), units: units || qtyUnits(B, rt, undefined, price), limit: num(limit), stop: num(stop), oca, ocaType, comment, bar: rt.i };
  o.market = isNa(o.limit) && isNa(o.stop);
  // a new order with the same id replaces the pending one
  B.orders = B.orders.filter((x) => !((x.type === 'entry' || x.type === 'order') && x.id === id));
  // pyramiding check at placement (TradingView ignores entries beyond the limit)
  if (type === 'entry' && B.pos !== 0 && sign(B.pos) === o.dir && B.trades.length >= Math.max(1, B.cfg.pyramiding)) return NaN;
  B.orders.push(o);
  return NaN;
}

def('strategy.entry', ['id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment', 'alert_message', 'disable_alert', 'long'], (rt, s, id, dir, qty, limit, stop, oca, ocaType, comment, am, da, long) => {
  if (dir === undefined && long !== undefined) dir = long;
  return placeOrder(rt, 'entry', id, dir, qty, limit, stop, oca, ocaType, comment);
});
def('strategy.order', ['id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment', 'alert_message', 'disable_alert', 'long'], (rt, s, id, dir, qty, limit, stop, oca, ocaType, comment, am, da, long) => {
  if (dir === undefined && long !== undefined) dir = long;
  return placeOrder(rt, 'order', id, dir, qty, limit, stop, oca, ocaType, comment);
});
def('strategy.close', ['id', 'comment', 'qty', 'qty_percent', 'alert_message', 'immediately', 'disable_alert'], (rt, s, id, comment, qty, pct, am, imm) => {
  const B = BK(rt); if (!B) return NaN;
  id = String(id);
  if (!B.trades.some((t) => t.entryId === id)) return NaN;
  const o = { type: 'close', entryId: id, units: qty === undefined || isNa(qty) ? 0 : num(qty) * B.cfg.mult, pct: pct === undefined || isNa(pct) ? undefined : num(pct), comment, market: true };
  if (truthy(imm)) { executeOrder(B, rt, rt.i, o, rt.c[rt.i]); cleanupExits(B); return NaN; }
  B.orders = B.orders.filter((x) => !(x.type === 'close' && x.entryId === id));
  B.orders.push(o);
  return NaN;
});
def('strategy.close_all', ['comment', 'alert_message', 'immediately', 'disable_alert'], (rt, s, comment, am, imm) => {
  const B = BK(rt); if (!B) return NaN;
  if (B.pos === 0) return NaN;
  const o = { type: 'closeall', comment, market: true };
  if (truthy(imm)) { executeOrder(B, rt, rt.i, o, rt.c[rt.i]); cleanupExits(B); return NaN; }
  B.orders = B.orders.filter((x) => x.type !== 'closeall');
  B.orders.push(o);
  return NaN;
});
def('strategy.exit', ['id', 'from_entry', 'qty', 'qty_percent', 'profit', 'limit', 'loss', 'stop', 'trail_price', 'trail_points', 'trail_offset', 'oca_name', 'comment', 'comment_profit', 'comment_loss', 'comment_trailing', 'alert_message', 'alert_profit', 'alert_loss', 'alert_trailing', 'disable_alert'],
  (rt, s, id, from, qty, pct, profit, limit, loss, stop, trp, trpts, troff, oca, comment, cp, cl, ct) => {
    const B = BK(rt); if (!B) return NaN;
    id = String(id); from = from === undefined || isNa(from) ? '' : String(from);
    const ex = { id, from, units: qty === undefined || isNa(qty) ? NaN : num(qty) * B.cfg.mult, pct: pct === undefined || isNa(pct) ? NaN : num(pct), profit: num(profit), limit: num(limit), loss: num(loss), stop: num(stop), trailPrice: num(trp), trailPoints: num(trpts), trailOffset: num(troff), comment, commentProfit: cp, commentLoss: cl, commentTrail: ct, armed: false };
    if ([ex.profit, ex.limit, ex.loss, ex.stop, ex.trailPrice, ex.trailPoints].every(isNa)) return NaN;
    const k = B.exits.findIndex((x) => x.id === id && x.from === from);
    if (k >= 0) { ex.armed = B.exits[k].armed; B.exits[k] = ex; } else B.exits.push(ex);
    return NaN;
  });
def('strategy.cancel', ['id'], (rt, s, id) => { const B = BK(rt); if (!B) return NaN; id = String(id); B.orders = B.orders.filter((o) => o.id !== id); B.exits = B.exits.filter((e) => e.id !== id); return NaN; });
def('strategy.cancel_all', [], (rt) => { const B = BK(rt); if (!B) return NaN; B.orders = []; B.exits = []; return NaN; });
def('strategy.risk.allow_entry_in', ['value'], (rt, s, v) => { const B = BK(rt); if (B) B.allow = v; return NaN; });
for (const k of ['max_drawdown', 'max_intraday_loss', 'max_cons_loss_days', 'max_intraday_filled_orders', 'max_position_size']) def('strategy.risk.' + k, ['value', 'type', 'alert_message'], () => NaN);
def('strategy.convert_to_account', ['value'], (rt, s, v) => v);
def('strategy.convert_to_symbol', ['value'], (rt, s, v) => v);
def('strategy.default_entry_qty', ['fill_price'], (rt, s, p) => { const B = BK(rt); return B ? qtyUnits(B, rt, undefined, num(p)) / B.cfg.mult : NaN; });

const bv = (fn) => (rt) => { const B = rt.S.broker; return B ? fn(B, rt) : NaN; };
defv('strategy.position_size', bv((B) => B.pos / B.cfg.mult));
defv('strategy.position_avg_price', bv((B) => (B.pos === 0 ? NaN : B.avg)));
defv('strategy.position_entry_name', bv((B) => (B.pos === 0 ? '' : B.lastEntryName)));
defv('strategy.openprofit', bv((B, rt) => openProfit(B, rt.c[rt.i])));
defv('strategy.netprofit', bv((B) => B.net));
defv('strategy.netprofit_percent', bv((B) => B.net / B.cfg.initialCapital * 100));
defv('strategy.grossprofit', bv((B) => B.gp));
defv('strategy.grossloss', bv((B) => B.gl));
defv('strategy.equity', bv((B, rt) => B.cfg.initialCapital + B.net + openProfit(B, rt.c[rt.i])));
defv('strategy.initial_capital', bv((B) => B.cfg.initialCapital));
defv('strategy.closedtrades', bv((B) => B.closed.length));
defv('strategy.opentrades', bv((B) => B.trades.length));
defv('strategy.wintrades', bv((B) => B.wins));
defv('strategy.losstrades', bv((B) => B.losses));
defv('strategy.eventrades', bv((B) => B.even));
defv('strategy.max_drawdown', bv((B) => B.maxDD));
defv('strategy.max_runup', bv((B) => B.maxRU));
defv('strategy.max_contracts_held_all', bv((B) => B.maxHeld / B.cfg.mult));
defv('strategy.account_currency', bv((B) => B.cfg.currency));
defv('strategy.avg_trade', bv((B) => (B.closed.length ? B.net / B.closed.length : NaN)));
defv('strategy.avg_winning_trade', bv((B) => (B.wins ? B.gp / B.wins : NaN)));
defv('strategy.avg_losing_trade', bv((B) => (B.losses ? B.gl / B.losses : NaN)));
defv('strategy.margin_liquidation_price', () => NaN);
defv('strategy.closedtrades.first_index', bv(() => 0));
const ct = (f) => (rt, s, n) => { const B = rt.S.broker; if (!B) return NaN; const t = B.closed[num(n)]; return t ? f(t, B) : NaN; };
const ot = (f) => (rt, s, n) => { const B = rt.S.broker; if (!B) return NaN; const t = B.trades[num(n)]; return t ? f(t, B, rt) : NaN; };
const CT = { entry_price: (t) => t.entryPrice, exit_price: (t) => t.exitPrice, profit: (t) => t.profit, profit_percent: (t) => t.profitPct, entry_time: (t) => t.entryTime, exit_time: (t) => t.exitTime, entry_bar_index: (t) => t.entryBar, exit_bar_index: (t) => t.exitBar, size: (t) => t.qty * t.dir, entry_id: (t) => t.entryId, exit_id: (t) => t.exitId, commission: (t) => t.commission, max_runup: (t) => t.runup, max_drawdown: (t) => t.drawdown, entry_comment: (t) => t.entryComment, exit_comment: (t) => t.exitComment };
for (const k in CT) def('strategy.closedtrades.' + k, ['trade_num'], ct(CT[k]));
const OT = { entry_price: (t) => t.price, entry_time: (t) => t.time, entry_bar_index: (t) => t.bar, size: (t, B) => t.qty / B.cfg.mult * t.dir, entry_id: (t) => t.entryId, commission: (t) => t.comm, entry_comment: (t) => t.comment, profit: (t, B, rt) => (rt.c[rt.i] - t.price) * t.dir * t.qty * B.cfg.pv, profit_percent: (t, B, rt) => (rt.c[rt.i] - t.price) * t.dir / t.price * 100, max_runup: (t, B) => (t.dir === 1 ? t.hi - t.price : t.price - t.lo) * t.qty * B.cfg.pv, max_drawdown: (t, B) => (t.dir === 1 ? t.lo - t.price : t.price - t.hi) * t.qty * B.cfg.pv };
for (const k in OT) def('strategy.opentrades.' + k, ['trade_num'], ot(OT[k]));

Object.assign(K, {
  'strategy.long': 'long', 'strategy.short': 'short', 'strategy.fixed': 'fixed', 'strategy.cash': 'cash', 'strategy.percent_of_equity': 'percent_of_equity',
  'strategy.commission.percent': 'percent', 'strategy.commission.cash_per_contract': 'cash_per_contract', 'strategy.commission.cash_per_order': 'cash_per_order',
  'strategy.oca.none': 'none', 'strategy.oca.cancel': 'cancel', 'strategy.oca.reduce': 'reduce',
  'strategy.direction.all': 'all', 'strategy.direction.long': 'long', 'strategy.direction.short': 'short',
});

/** Compute the TradingView-style performance summary from broker state. */
export function strategyReport(B, bars, n) {
  const c = B.cfg;
  const closed = B.closed;
  const split = (f) => closed.filter(f);
  const stats = (list) => {
    const wins = list.filter((t) => t.profit > 0), losses = list.filter((t) => t.profit < 0);
    const gp = wins.reduce((s, t) => s + t.profit, 0), gl = -losses.reduce((s, t) => s + t.profit, 0);
    const net = gp - gl;
    let mcw = 0, mcl = 0, cw = 0, cl = 0;
    for (const t of list) { if (t.profit > 0) { cw++; cl = 0; } else if (t.profit < 0) { cl++; cw = 0; } mcw = Math.max(mcw, cw); mcl = Math.max(mcl, cl); }
    const avgBars = list.length ? list.reduce((s, t) => s + (t.exitBar - t.entryBar), 0) / list.length : NaN;
    return {
      net, netPct: net / c.initialCapital * 100, gp, gl, pf: gl > 0 ? gp / gl : (gp > 0 ? Infinity : NaN), total: list.length, wins: wins.length, losses: losses.length,
      winRate: list.length ? wins.length / list.length * 100 : NaN, avg: list.length ? net / list.length : NaN, avgWin: wins.length ? gp / wins.length : NaN, avgLoss: losses.length ? gl / losses.length : NaN,
      ratio: wins.length && losses.length ? (gp / wins.length) / (gl / losses.length) : NaN,
      largestWin: wins.length ? Math.max(...wins.map((t) => t.profit)) : NaN, largestLoss: losses.length ? Math.min(...losses.map((t) => t.profit)) : NaN,
      maxConsWins: mcw, maxConsLosses: mcl, avgBars, commission: list.reduce((s, t) => s + t.commission, 0),
    };
  };
  const all = stats(closed), long = stats(split((t) => t.dir === 1)), short = stats(split((t) => t.dir === -1));
  // equity-based ratios
  const eq = [];
  for (let i = 0; i < n; i++) if (B.eq[i] !== undefined) eq.push(B.eq[i]);
  const rets = [];
  for (let i = 1; i < eq.length; i++) if (eq[i - 1] > 0) rets.push(eq[i] / eq[i - 1] - 1);
  const mean = rets.reduce((s, x) => s + x, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length || 1));
  const dsd = Math.sqrt(rets.reduce((s, x) => s + (x < 0 ? x * x : 0), 0) / (rets.length || 1));
  const bh = n > 1 && bars ? (bars.c[n - 1] - bars.o[0]) / bars.o[0] * 100 : NaN;
  return {
    all, long, short, initialCapital: c.initialCapital, maxDD: B.maxDD, maxDDpct: B.maxDDpct, maxRU: B.maxRU,
    openPL: B.trades.length && bars ? B.trades.reduce((s, t) => s + (bars.c[n - 1] - t.price) * t.dir * t.qty * c.pv, 0) : 0,
    openTrades: B.trades.length, sharpe: sd > 0 ? mean / sd * Math.sqrt(252) : NaN, sortino: dsd > 0 ? mean / dsd * Math.sqrt(252) : NaN,
    buyHold: bh, maxHeld: B.maxHeld / c.mult, commission: B.comm, equity: eq, currency: c.currency, lots: c.lots,
  };
}

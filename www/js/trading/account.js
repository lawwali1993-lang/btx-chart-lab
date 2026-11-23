// Manual trading account (MT5-style hedging): market & pending orders, SL/TP, partial close,
// spread, commission, leverage/margin, stop-out, cent accounts, statistics.
// Prices on the chart are BID; ASK = BID + spread * point.

export function newAccount(opts = {}) {
  return {
    currency: opts.currency || 'USD',      // 'USD' or 'USC' (cent account: amounts shown ×100)
    balance: opts.balance ?? 1000,          // stored in USD
    initial: opts.balance ?? 1000,
    leverage: opts.leverage ?? 500,
    commissionPerLot: opts.commissionPerLot ?? 0, // USD per lot per side
    stopOut: opts.stopOut ?? 0,             // margin level % (Exness: 0%)
    positions: [], orders: [], history: [], nextId: 1, peak: opts.balance ?? 1000, maxDD: 0,
  };
}

export const ORDER_TYPES = ['buy_limit', 'sell_limit', 'buy_stop', 'sell_stop'];

export function ask(spec, bid) { return round(bid + (spec.spread ?? spec.defaultSpread ?? 0) * spec.point, spec.digits + 2); }
function round(x, d = 8) { const m = Math.pow(10, d); return Math.round(x * m) / m; }

/** Profit in USD for a position-like {side, lots, openPrice} closed at price `close`. */
export function profitUsd(spec, side, lots, open, close) {
  const q = (close - open) * side * lots * (spec.contractSize || 1);
  const quote = spec.quoteCurrency || 'USD';
  if (quote === 'USD') return q;
  if ((spec.baseCurrency || '') === 'USD') return q / close;
  return q * (spec.quoteToUsd || 1);
}
export function points(spec, side, open, close) { return Math.round((close - open) * side / spec.point); }
export function marginUsd(spec, lots, price, leverage) {
  const notional = lots * (spec.contractSize || 1) * price;
  const quote = spec.quoteCurrency || 'USD';
  let usd = notional;
  if ((spec.baseCurrency || '') === 'USD') usd = lots * (spec.contractSize || 1);
  else if (quote !== 'USD') usd = notional * (spec.quoteToUsd || 1);
  return usd / Math.max(1, leverage);
}
/** USD value of one point for `lots`. */
export function pointValueUsd(spec, lots, price) { return profitUsd(spec, 1, lots, price, price + spec.point); }
/** Lot size for a risk amount (USD) and a stop distance in points. */
export function lotsForRisk(spec, riskUsd, slPoints, price, step = 0.01) {
  const pv = pointValueUsd(spec, 1, price);
  if (!(slPoints > 0) || !(pv > 0)) return 0;
  return Math.max(0, Math.floor(riskUsd / (slPoints * pv) / step + 1e-9) * step);
}

export function closePriceFor(spec, side, bid) { return side === 1 ? bid : ask(spec, bid); }

export function floating(acc, spec, bid) {
  let p = 0;
  for (const pos of acc.positions) p += profitUsd(spec, pos.side, pos.lots, pos.openPrice, closePriceFor(spec, pos.side, bid)) + (pos.swap || 0);
  return p;
}
export function snapshot(acc, spec, bid) {
  const fl = floating(acc, spec, bid);
  const equity = acc.balance + fl;
  const margin = acc.positions.reduce((s, p) => s + marginUsd(spec, p.lots, p.openPrice, acc.leverage), 0);
  return { balance: acc.balance, equity, floating: fl, margin, free: equity - margin, level: margin > 0 ? equity / margin * 100 : Infinity };
}

export function placeMarket(acc, spec, side, lots, bid, time, sl = NaN, tp = NaN, comment = '') {
  lots = normLots(lots);
  if (!(lots > 0)) throw new Error('حجم اللوت غير صالح');
  const price = side === 1 ? ask(spec, bid) : bid;
  const snap = snapshot(acc, spec, bid);
  const need = marginUsd(spec, lots, price, acc.leverage);
  if (need > snap.free + 1e-9) throw new Error(`الهامش غير كافٍ: المطلوب ${need.toFixed(2)}$ والمتاح ${snap.free.toFixed(2)}$`);
  validateStops(spec, side, price, sl, tp);
  const comm = acc.commissionPerLot * lots;
  acc.balance -= comm;
  const pos = { id: acc.nextId++, side, lots, openPrice: price, openTime: time, sl: num(sl), tp: num(tp), comment, commission: comm, swap: 0, maxPts: 0, minPts: 0 };
  acc.positions.push(pos);
  return pos;
}

export function placePending(acc, spec, type, lots, price, bid, time, sl = NaN, tp = NaN, comment = '') {
  lots = normLots(lots);
  if (!(lots > 0)) throw new Error('حجم اللوت غير صالح');
  if (!ORDER_TYPES.includes(type)) throw new Error('نوع أمر غير معروف');
  const side = type.startsWith('buy') ? 1 : -1;
  const cur = side === 1 ? ask(spec, bid) : bid;
  if (type === 'buy_limit' && !(price < cur)) throw new Error('Buy Limit يجب أن يكون أسفل سعر Ask الحالي');
  if (type === 'sell_limit' && !(price > cur)) throw new Error('Sell Limit يجب أن يكون أعلى سعر Bid الحالي');
  if (type === 'buy_stop' && !(price > cur)) throw new Error('Buy Stop يجب أن يكون أعلى سعر Ask الحالي');
  if (type === 'sell_stop' && !(price < cur)) throw new Error('Sell Stop يجب أن يكون أسفل سعر Bid الحالي');
  validateStops(spec, side, price, sl, tp);
  const o = { id: acc.nextId++, type, side, lots, price: round(price, spec.digits), time, sl: num(sl), tp: num(tp), comment };
  acc.orders.push(o);
  return o;
}

function validateStops(spec, side, price, sl, tp) {
  if (isFinite(sl) && (side === 1 ? sl >= price : sl <= price)) throw new Error('وقف الخسارة في الجهة الخطأ من سعر الدخول');
  if (isFinite(tp) && (side === 1 ? tp <= price : tp >= price)) throw new Error('جني الأرباح في الجهة الخطأ من سعر الدخول');
}
function num(x) { x = typeof x === 'string' ? parseFloat(x) : x; return x === null || x === undefined || x === '' || isNaN(x) || x === 0 ? NaN : x; }
export function normLots(l) { return Math.round(Number(l) * 100) / 100; }

export function modifyPosition(acc, spec, id, sl, tp) {
  const p = acc.positions.find((x) => x.id === id);
  if (!p) return;
  validateStops(spec, p.side, p.openPrice, num(sl), num(tp));
  p.sl = num(sl); p.tp = num(tp);
}
export function modifyOrder(acc, spec, id, price, sl, tp) {
  const o = acc.orders.find((x) => x.id === id);
  if (!o) return;
  if (isFinite(price)) o.price = round(price, spec.digits);
  if (sl !== undefined) o.sl = num(sl);
  if (tp !== undefined) o.tp = num(tp);
}
export function cancelOrder(acc, id) { acc.orders = acc.orders.filter((o) => o.id !== id); }

export function closePosition(acc, spec, id, bid, time, lots, reason = 'manual', fillPrice) {
  const p = acc.positions.find((x) => x.id === id);
  if (!p) return null;
  lots = lots === undefined ? p.lots : Math.min(p.lots, normLots(lots));
  if (!(lots > 0)) return null;
  const price = fillPrice !== undefined ? fillPrice : closePriceFor(spec, p.side, bid);
  const pr = profitUsd(spec, p.side, lots, p.openPrice, price);
  const comm = acc.commissionPerLot * lots;
  const frac = lots / p.lots;
  const entryComm = p.commission * frac;
  acc.balance += pr - comm;
  const rec = {
    id: p.id, side: p.side, lots, openPrice: p.openPrice, closePrice: price, openTime: p.openTime, closeTime: time,
    profit: pr, net: pr - comm - entryComm, points: points(spec, p.side, p.openPrice, price), commission: comm + entryComm, reason, sl: p.sl, tp: p.tp,
    maxPts: p.maxPts, minPts: p.minPts, comment: p.comment,
  };
  acc.history.push(rec);
  p.commission -= entryComm;
  p.lots = normLots(p.lots - lots);
  if (p.lots <= 0) acc.positions = acc.positions.filter((x) => x !== p);
  if (acc.balance > acc.peak) acc.peak = acc.balance;
  acc.maxDD = Math.max(acc.maxDD, acc.peak - acc.balance);
  return rec;
}
export function closeAll(acc, spec, bid, time, filter) {
  for (const p of acc.positions.slice()) if (!filter || filter(p)) closePosition(acc, spec, p.id, bid, time, undefined, 'manual');
}

/**
 * Advance the account through one base bar (bid OHLC). Pending orders, SL/TP and stop-out are
 * evaluated along the intrabar path (O→H→L→C or O→L→H→C, whichever extreme is nearer the open).
 * Returns list of events.
 */
export function processBar(acc, spec, o, h, l, c, time) {
  const path = Math.abs(h - o) < Math.abs(l - o) ? [o, h, l, c] : [o, l, h, c];
  const events = [];
  checkAt(acc, spec, path[0], time, events, true);
  for (let k = 0; k + 1 < path.length; k++) {
    let a = path[k];
    const b = path[k + 1];
    if (a === b) continue;
    // walk trigger levels between a and b (bid space) in price order
    for (let guard = 0; guard < 100; guard++) {
      const lv = nextTrigger(acc, spec, a, b);
      if (!lv) break;
      checkAt(acc, spec, lv.bid, time, events, false, lv);
      a = lv.bid;
    }
    for (const p of acc.positions) {
      const pts = points(spec, p.side, p.openPrice, closePriceFor(spec, p.side, b));
      if (pts > p.maxPts) p.maxPts = pts;
      if (pts < p.minPts) p.minPts = pts;
    }
    stopOutCheck(acc, spec, b, time, events);
  }
  const eq = snapshot(acc, spec, c).equity;
  if (eq > acc.peak) acc.peak = eq;
  acc.maxDD = Math.max(acc.maxDD, acc.peak - eq);
  return events;
}

// Find the first trigger encountered moving from bid a to bid b. Returns {bid, kind, ref}
function nextTrigger(acc, spec, a, b) {
  const up = b > a;
  const sp = (spec.spread ?? spec.defaultSpread ?? 0) * spec.point;
  const cands = [];
  const add = (bidLevel, kind, ref) => {
    if (up ? bidLevel > a && bidLevel <= b : bidLevel < a && bidLevel >= b) cands.push({ bid: bidLevel, kind, ref });
  };
  for (const o of acc.orders) {
    // buy orders trigger on ASK, sell orders on BID
    const lvl = o.side === 1 ? o.price - sp : o.price;
    if ((o.type === 'buy_limit' || o.type === 'sell_stop') && !up) add(lvl, 'order', o);
    if ((o.type === 'buy_stop' || o.type === 'sell_limit') && up) add(lvl, 'order', o);
  }
  for (const p of acc.positions) {
    if (p.side === 1) {
      if (isFinite(p.tp) && up) add(p.tp, 'tp', p);
      if (isFinite(p.sl) && !up) add(p.sl, 'sl', p);
    } else {
      if (isFinite(p.tp) && !up) add(p.tp - sp, 'tp', p);
      if (isFinite(p.sl) && up) add(p.sl - sp, 'sl', p);
    }
  }
  // stop-out level: equity is linear in bid → solve E(bid) = threshold
  if (acc.positions.length) {
    const snap = snapshot(acc, spec, a);
    const target = Math.max(0, (acc.stopOut || 0) / 100 * snap.margin);
    let k = 0;
    for (const p of acc.positions) k += p.side * p.lots * (spec.contractSize || 1);
    if (k !== 0) {
      const lvl = a + (target - snap.equity) / k;
      if (up ? lvl > a && lvl <= b : lvl < a && lvl >= b) cands.push({ bid: lvl, kind: 'so' });
    }
  }
  if (!cands.length) return null;
  cands.sort((x, y) => (up ? x.bid - y.bid : y.bid - x.bid));
  return cands[0];
}

function checkAt(acc, spec, bid, time, events, gapCheck, lv) {
  const ak = ask(spec, bid);
  if (lv) {
    if (lv.kind === 'so') { stopOutCheck(acc, spec, lv.bid, time, events, true); return; }
    if (lv.kind === 'order') fillOrder(acc, spec, lv.ref, lv.ref.price, bid, time, events);
    else {
      const p = lv.ref;
      const price = lv.kind === 'tp' ? p.tp : p.sl;
      const rec = closePosition(acc, spec, p.id, bid, time, undefined, lv.kind, price);
      if (rec) events.push({ type: lv.kind, rec });
    }
    return;
  }
  if (!gapCheck) return;
  // at the open: anything already beyond its level fills at the open price (gap)
  for (const o of acc.orders.slice()) {
    const hit = o.type === 'buy_limit' ? ak <= o.price : o.type === 'buy_stop' ? ak >= o.price : o.type === 'sell_limit' ? bid >= o.price : bid <= o.price;
    if (hit) fillOrder(acc, spec, o, o.side === 1 ? ak : bid, bid, time, events);
  }
  for (const p of acc.positions.slice()) {
    const cp = closePriceFor(spec, p.side, bid);
    let kind = null;
    if (p.side === 1) { if (isFinite(p.tp) && cp >= p.tp) kind = 'tp'; else if (isFinite(p.sl) && cp <= p.sl) kind = 'sl'; }
    else { if (isFinite(p.tp) && cp <= p.tp) kind = 'tp'; else if (isFinite(p.sl) && cp >= p.sl) kind = 'sl'; }
    if (kind) { const rec = closePosition(acc, spec, p.id, bid, time, undefined, kind, cp); if (rec) events.push({ type: kind, rec }); }
  }
}

function fillOrder(acc, spec, o, price, bid, time, events) {
  acc.orders = acc.orders.filter((x) => x !== o);
  const comm = acc.commissionPerLot * o.lots;
  acc.balance -= comm;
  const pos = { id: o.id, side: o.side, lots: o.lots, openPrice: price, openTime: time, sl: o.sl, tp: o.tp, comment: o.comment || o.type, commission: comm, swap: 0, maxPts: 0, minPts: 0 };
  acc.positions.push(pos);
  events.push({ type: 'fill', order: o, pos });
}

function stopOutCheck(acc, spec, bid, time, events, atLevel) {
  if (!acc.positions.length) return;
  let s = snapshot(acc, spec, bid);
  let guard = 0;
  const eps = atLevel ? 1e-7 : 0;
  while (acc.positions.length && (s.equity <= eps || (acc.stopOut > 0 && s.margin > 0 && s.level <= acc.stopOut + eps)) && guard++ < 1000) {
    // close the most losing position first
    let worst = null, wp = Infinity;
    for (const p of acc.positions) { const pr = profitUsd(spec, p.side, p.lots, p.openPrice, closePriceFor(spec, p.side, bid)); if (pr < wp) { wp = pr; worst = p; } }
    const rec = closePosition(acc, spec, worst.id, bid, time, undefined, 'stopout');
    events.push({ type: 'stopout', rec });
    s = snapshot(acc, spec, bid);
  }
}

export function stats(acc) {
  const h = acc.history;
  const wins = h.filter((t) => t.net > 0), losses = h.filter((t) => t.net < 0);
  const gp = wins.reduce((s, t) => s + t.net, 0), gl = -losses.reduce((s, t) => s + t.net, 0);
  let cw = 0, cl = 0, mcw = 0, mcl = 0;
  for (const t of h) { if (t.net > 0) { cw++; cl = 0; } else if (t.net < 0) { cl++; cw = 0; } mcw = Math.max(mcw, cw); mcl = Math.max(mcl, cl); }
  const longs = h.filter((t) => t.side === 1), shorts = h.filter((t) => t.side === -1);
  const wr = (l) => (l.length ? l.filter((t) => t.net > 0).length / l.length * 100 : NaN);
  return {
    trades: h.length, wins: wins.length, losses: losses.length, winRate: wr(h), longWinRate: wr(longs), shortWinRate: wr(shorts), longs: longs.length, shorts: shorts.length,
    net: gp - gl, gp, gl, pf: gl > 0 ? gp / gl : gp > 0 ? Infinity : NaN, avgWin: wins.length ? gp / wins.length : NaN, avgLoss: losses.length ? gl / losses.length : NaN,
    expectancy: h.length ? (gp - gl) / h.length : NaN, avgPoints: h.length ? h.reduce((s, t) => s + t.points, 0) / h.length : NaN,
    best: h.length ? Math.max(...h.map((t) => t.net)) : NaN, worst: h.length ? Math.min(...h.map((t) => t.net)) : NaN,
    maxConsWins: mcw, maxConsLosses: mcl, maxDD: acc.maxDD, maxDDpct: acc.peak > 0 ? acc.maxDD / acc.peak * 100 : 0,
    totalLots: h.reduce((s, t) => s + t.lots, 0), commission: h.reduce((s, t) => s + t.commission, 0), growth: (acc.balance - acc.initial) / acc.initial * 100,
  };
}

/** Format money in the account currency (USC = cents). */
export function money(acc, usd, withSign = false) {
  const cent = acc.currency === 'USC';
  const v = cent ? usd * 100 : usd;
  const s = (withSign && v > 0 ? '+' : '') + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return s + (cent ? ' USC' : ' $');
}

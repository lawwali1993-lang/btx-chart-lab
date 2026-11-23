import assert from 'node:assert';
import * as A from '../www/js/trading/account.js';
const gold = { name: 'XAUUSD', digits: 2, point: 0.01, contractSize: 100, quoteCurrency: 'USD', baseCurrency: 'XAU', spread: 30 };
const near = (a, b) => Math.abs(a - b) < 1e-9;
// 0.01 lot gold: 100 points ($1 move) = $1
assert(near(A.profitUsd(gold, 1, 0.01, 2000, 2001), 1));
assert.equal(A.points(gold, 1, 2000, 2000.8), 80);
assert(near(A.pointValueUsd(gold, 0.01, 2000), 0.01));
assert(near(A.lotsForRisk(gold, 10, 500, 2000), 0.02)); // $10 risk / (500 pts * $0.01 per pt per 0.01 lot... ) → 0.02 lot
assert(near(A.marginUsd(gold, 0.01, 2000, 500), 4));
let acc = A.newAccount({ balance: 100, leverage: 500 });
const p = A.placeMarket(acc, gold, 1, 0.01, 2000.00, 0);
assert(near(p.openPrice, 2000.30)); // buy at ask
let s = A.snapshot(acc, gold, 2000.00); assert(near(s.floating, -0.30));
// TP hit within bar
A.modifyPosition(acc, gold, p.id, 1999.00, 2001.50);
let ev = A.processBar(acc, gold, 2000.2, 2001.6, 2000.1, 2001.0, 60000);
assert.equal(ev.length, 1); assert.equal(ev[0].type, 'tp'); assert(near(acc.balance, 101.2));
// sell with SL: sell closes on ASK
const q = A.placeMarket(acc, gold, -1, 0.02, 2001.0, 1, 2002.0, 1995);
ev = A.processBar(acc, gold, 2001.0, 2001.8, 2000.9, 2001.5, 120000); // ask high = 2002.1 >= sl
assert.equal(ev[0].type, 'sl'); assert(near(ev[0].rec.closePrice, 2002.0)); assert(near(ev[0].rec.profit, -2));
// pending buy limit fills on ask
acc = A.newAccount({ balance: 1000 });
const o = A.placePending(acc, gold, 'buy_limit', 0.01, 1990.00, 2000, 0, NaN, 1991.00);
ev = A.processBar(acc, gold, 2000, 2000.5, 1989.5, 1990.5, 60000);
// path: O→H (nearer) →L: ask hits 1990 when bid = 1989.70; then TP 1991 not reached on L→C (bid 1990.5 < 1991)
assert.equal(ev[0].type, 'fill'); assert.equal(acc.positions.length, 1); assert(near(acc.positions[0].openPrice, 1990));
ev = A.processBar(acc, gold, 1990.5, 1991.2, 1990.4, 1991.0, 120000);
assert.equal(ev[0].type, 'tp'); assert(near(acc.balance, 1001));
// gap: SL beyond open → fills at open
acc = A.newAccount({ balance: 1000 });
A.placeMarket(acc, gold, 1, 0.1, 2000, 0, 1995, NaN);
ev = A.processBar(acc, gold, 1990, 1991, 1989, 1990.5, 60000);
assert.equal(ev[0].type, 'sl'); assert(near(ev[0].rec.closePrice, 1990));
// partial close + commission
acc = A.newAccount({ balance: 1000, commissionPerLot: 7 });
const r = A.placeMarket(acc, gold, 1, 1, 2000, 0);
assert(near(acc.balance, 993));
A.closePosition(acc, gold, r.id, 2001, 1, 0.4);
assert(near(acc.positions[0].lots, 0.6));
// stop-out at equity <= 0
acc = A.newAccount({ balance: 10, leverage: 2000 });
A.placeMarket(acc, gold, 1, 0.05, 2000, 0);
ev = A.processBar(acc, gold, 2000, 2000.1, 1996, 1996.5, 60000);
assert(ev.some((e) => e.type === 'stopout')); assert.equal(acc.positions.length, 0); assert(Math.abs(acc.balance) < 0.05, 'balance after stop-out ' + acc.balance);
// cent account formatting
const c = A.newAccount({ balance: 10, currency: 'USC' });
assert.equal(A.money(c, 1.5), '150.00 USC');
console.log('account tests ok', A.stats(acc));

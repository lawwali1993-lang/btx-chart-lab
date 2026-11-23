import assert from 'node:assert';
import { parseOHLCV, parseDateTime } from '../www/js/data/csv.js';
import { parseTf, aggregate, bucketStart, limitedView, nyOffsetMs } from '../www/js/data/aggregate.js';
import { createBars } from '../www/js/data/binfmt.js';
// MT5 export
const mt5 = '<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>\n2024.01.02\t01:00:00\t2063.12\t2064.00\t2062.50\t2063.80\t120\t0\t20\n2024.01.02\t01:01:00\t2063.80\t2065.10\t2063.70\t2064.90\t98\t0\t20\n';
let r = parseOHLCV(mt5); assert.equal(r.info.format,'MT5'); assert.equal(r.bars.length,2); assert.equal(r.bars.t[0], Date.UTC(2024,0,2,1,0)); assert.equal(r.bars.v[1],98); assert.equal(r.info.tf,'1'); assert.equal(r.info.digits,2);
// Dukascopy
const duk = 'Gmt time,Open,High,Low,Close,Volume\n02.01.2024 00:00:00.000,2062.5,2063,2062.1,2062.9,0.0123\n02.01.2024 00:05:00.000,2062.9,2063.4,2062.8,2063.2,0.02\n';
r = parseOHLCV(duk); assert.equal(r.info.format,'Dukascopy'); assert.equal(r.bars.t[1], Date.UTC(2024,0,2,0,5)); assert.equal(r.info.tf,'5');
// TradingView export unix
const tv = 'time,open,high,low,close,Volume\n1704157200,2063.1,2064,2062,2063.5,10\n1704160800,2063.5,2066,2063,2065,12\n';
r = parseOHLCV(tv); assert.equal(r.bars.t[0], 1704157200000); assert.equal(r.info.tf,'60');
// headerless MT4 style comma + tz offset
const mt4 = '2024.01.02,01:00,2063.12,2064.00,2062.50,2063.80,120\n2024.01.02,01:01,2063.80,2065.10,2063.70,2064.90,98\n';
r = parseOHLCV(mt4, {tzOffsetMinutes: 120}); assert.equal(r.bars.t[0], Date.UTC(2024,0,1,23,0)); 
// histdata
const hd = '20240102 010000;2063.12;2064.00;2062.50;2063.80;0\n20240102 010100;2063.80;2065.10;2063.70;2064.90;0\n';
r = parseOHLCV(hd); assert.equal(r.bars.t[1], Date.UTC(2024,0,2,1,1));
// reverse order & semicolon decimal comma
const rev = 'Date;Open;High;Low;Close;Volume\n2024-01-02 01:01;2063,8;2065,1;2063,7;2064,9;5\n2024-01-02 01:00;2063,1;2064;2062,5;2063,8;7\n';
r = parseOHLCV(rev); assert.equal(r.bars.t[0], Date.UTC(2024,0,2,1,0)); assert.equal(r.bars.c[1], 2064.9);
assert.equal(parseDateTime('2024-03-10T12:00:00+03:00'), Date.UTC(2024,2,10,9));
// tf
assert.equal(parseTf('60').label,'1h'); assert.equal(parseTf('D').kind,'D'); assert.equal(parseTf('1M').kind,'M'); assert.equal(parseTf('15m').seconds,900); assert.equal(parseTf('4h').seconds,14400); assert.equal(parseTf('W').period,'W');
// weekly bucket: Wed 2024-01-03 → Monday 2024-01-01
assert.equal(bucketStart(Date.UTC(2024,0,3,15), parseTf('W'), {mode:'utc'}), Date.UTC(2024,0,1));
assert.equal(bucketStart(Date.UTC(2024,0,7,23), parseTf('W'), {mode:'utc'}), Date.UTC(2024,0,1));
assert.equal(bucketStart(Date.UTC(2024,0,8,0), parseTf('W'), {mode:'utc'}), Date.UTC(2024,0,8));
assert.equal(bucketStart(Date.UTC(2024,4,17,15), parseTf('M'), {mode:'utc'}), Date.UTC(2024,4,1));
assert.equal(bucketStart(Date.UTC(2024,4,17,15,37), parseTf('240'), {mode:'utc'}), Date.UTC(2024,4,17,12));
assert.equal(bucketStart(Date.UTC(2024,4,17,15,37), parseTf('240'), {mode:'utc', offsetMin:180}), Date.UTC(2024,4,17,13));
// NY 17:00 session: in summer (EDT, -4) 17:00 NY = 21:00 UTC
assert.equal(nyOffsetMs(Date.UTC(2024,6,1)), -4*3600000); assert.equal(nyOffsetMs(Date.UTC(2024,0,1)), -5*3600000);
assert.equal(bucketStart(Date.UTC(2024,6,1,22), parseTf('D'), {mode:'ny17'}), Date.UTC(2024,6,1,21));
assert.equal(bucketStart(Date.UTC(2024,6,1,20), parseTf('D'), {mode:'ny17'}), Date.UTC(2024,5,30,21));
// aggregation
const n=600; const b=createBars(n); for(let i=0;i<n;i++){b.t[i]=Date.UTC(2024,0,2)+i*60000; b.o[i]=100+i; b.h[i]=101+i; b.l[i]=99+i; b.c[i]=100.5+i; b.v[i]=1;}
const a = aggregate(b, parseTf('60'), {mode:'utc'}); assert.equal(a.bars.length,10); assert.equal(a.bars.o[1],160); assert.equal(a.bars.c[1],219.5); assert.equal(a.bars.h[1],220); assert.equal(a.bars.l[1],159); assert.equal(a.bars.v[1],60);
const lv = limitedView(a, b, 75); assert.equal(lv.bars.length,2); assert.equal(lv.bars.c[1], 174.5); assert.equal(lv.bars.h[1], 175); assert(lv.partial);
const id = aggregate(b, parseTf('1'), {mode:'utc'}); assert(id.identity);
console.log('data tests ok');

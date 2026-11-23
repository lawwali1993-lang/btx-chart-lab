import { encodeBars, decodeBars, createBars, mergeBars, sliceBars } from '../www/js/data/binfmt.js';
import assert from 'node:assert';
import zlib from 'node:zlib';
const n = 200000; const b = createBars(n);
let p = 2063.12, t = Date.UTC(2024,0,2);
for (let i=0;i<n;i++){ t += (i%1440===0? 3*864e5/1440*60 : 60000); const o = p; const c = Math.round((o + (Math.random()-0.5)*2)*100)/100; const h=Math.max(o,c)+Math.round(Math.random()*80)/100; const l=Math.min(o,c)-Math.round(Math.random()*80)/100; b.t[i]=t; b.o[i]=o; b.h[i]=h; b.l[i]=l; b.c[i]=c; b.v[i]= Math.round(Math.random()*500)/1000; p=c; }
const enc = encodeBars({symbol:'X', point:0.01, timeUnit:60}, b);
const gz = zlib.gzipSync(enc,{level:9});
const {meta, bars} = decodeBars(enc);
for (let i=0;i<n;i++){ for (const f of ['t','o','h','l','c']) assert(Math.abs(bars[f][i]-b[f][i])<1e-9, f+i); assert(Math.abs(bars.v[i]-b.v[i])<1e-9,'v'+i); }
console.log('roundtrip ok', n, 'bars raw', enc.length, 'gz', gz.length, 'bytes/bar', (gz.length/n).toFixed(2), 'volScale', meta.volScale);
const m = mergeBars(sliceBars(b,0,1000), sliceBars(b,500,2000)); assert.equal(m.length, 2000); for (let i=1;i<m.length;i++) assert(m.t[i]>m.t[i-1]);
console.log('merge ok');

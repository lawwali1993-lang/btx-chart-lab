// Pine Script runtime: compiles the AST into closures and executes bar-by-bar with
// TradingView semantics (series history, call-site state, var/varip, request.security).
import { parse, PineError } from './parser.js';
import { B, V, K, V4_ALIASES, truthy, isNa, typeOfValue, RuntimeErr } from './lib/registry.js';
import './lib/core.js';
import './lib/ta.js';
import './lib/draw.js';
import { brokerBarOpen, brokerBarClose } from './strategy.js';
import { parseTf, bucketStart, bucketEnd } from '../data/aggregate.js';

export { PineError };
const MAXH = 10000;           // history kept per series (max_bars_back)
const LOOP_LIMIT = 1000000;   // iterations per loop execution

export { RuntimeErr };
const STMT_TYPES = new Set(['VarDecl', 'TupleDecl', 'Assign', 'FuncDecl', 'TypeDecl', 'EnumDecl', 'Import', 'Break', 'Continue', 'ExprStmt']);

function newFrame(info) {
  const v = new Array(info.nslots); for (let i = 0; i < info.nslots; i++) v[i] = NaN;
  return { v, h: [], init: [], s: {} };
}

function pushHist(fr, slots) {
  for (let k = 0; k < slots.length; k++) {
    const s = slots[k];
    let a = fr.h[s];
    if (!a) a = fr.h[s] = [];
    a.push(fr.v[s]);
    if (a.length > MAXH * 1.5) a.splice(0, a.length - MAXH);
  }
}

function histRead(a, n) {
  if (!a) return NaN;
  const k = a.length - n;
  if (k < 0 || n < 0 || k >= a.length) return NaN;
  const x = a[k];
  return x === undefined ? NaN : x;
}

const SOURCES = { open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v', time: 't' };

export class PineRuntime {
  /**
   * @param {object} opts { source|ast, bars, symbol, tf (parsed), align, inputs: [], maxBars,
   *   getBars(symbol, tfString) → {bars, tf}, isSub, captureIds, theme, onLog, strategyOverrides,
   *   magnifier: {base, start, aggIdx} for bar magnifier }
   */
  constructor(opts) {
    this.opts = opts;
    this.ast = opts.ast || parse(opts.source);
    this.version = this.ast.version;
    this.sym = opts.symbol || { name: 'SYMBOL', digits: 2, point: 0.01 };
    this.tf = opts.tf || parseTf('1');
    this.align = opts.align || { mode: 'utc', offsetMin: 0 };
    this.isSub = !!opts.isSub;
    this.inputValues = opts.inputs || [];
    this.inputDefs = [];
    this.inputCount = 0;
    this.decl = { kind: 'indicator', title: 'Script', overlay: false, args: {} };
    this.brk = 0;
    this.ln = 0;
    this.logs = [];
    this.warnings = [];
    this.alerts = [];
    this.userTypes = {};
    this.enums = {};
    this.methods = {};
    this.funcs = {};
    this.captures = opts.captureIds ? {} : null;
    this.securityRuns = {};
    this.out = { plots: [], shapes: [], candles: [], hlines: [], fills: [], bgcolors: [], barcolors: [] };
    this.outById = {};
    this.cache = {};
    this.setBars(opts.bars);
    this.S = { root: null, objs: { label: [], line: [], box: [], table: [], linefill: [], polyline: [] }, oid: 0, broker: null };
    this.compile();
    this.S.root = newFrame(this.rootInfo);
    this.done = 0; // number of bars executed
  }

  setBars(bars) {
    this.bars = bars;
    this.t = bars.t; this.o = bars.o; this.h = bars.h; this.l = bars.l; this.c = bars.c; this.v = bars.v;
    this.n = bars.length;
    this.cache = {};
  }

  // ---------------------------------------------------------------- compile
  compile() {
    const rt = this;
    const rootInfo = { name: '__root__', nslots: 0, histSlots: [], hist: new Set() };
    this.rootInfo = rootInfo;
    const globalScope = { vars: new Map(), parent: null, fn: rootInfo };
    const constInts = new Map(); // decl node → is const int
    const reassigned = new Set();
    // pre-pass: find reassigned variable names (for const-int inference)
    (function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.type === 'Assign' && n.target.type === 'Ident') reassigned.add(n.target.name);
      for (const k in n) if (k !== 'type' && typeof n[k] === 'object') walk(n[k]);
    })(this.ast.body);

    const lookup = (scope, name) => {
      for (let s = scope; s; s = s.parent) { const v = s.vars.get(name); if (v) return v; }
      return null;
    };
    const err = (node, msg) => { throw new PineError(msg, node.line, node.col); };

    const isConstInt = (node, scope) => {
      if (!node) return false;
      if (node.type === 'Num') return node.isInt;
      if (node.type === 'Unary' && node.op === '-') return isConstInt(node.arg, scope);
      if (node.type === 'Binary' && ['+', '-', '*', '%'].includes(node.op)) return isConstInt(node.left, scope) && isConstInt(node.right, scope);
      if (node.type === 'Binary' && node.op === '/' && this.version < 6) return isConstInt(node.left, scope) && isConstInt(node.right, scope);
      if (node.type === 'Ident') { const v = lookup(scope, node.name); return !!(v && v.constInt); }
      return false;
    };

    const C = (node, scope) => compileExpr(node, scope);

    const compileBlock = (block, scope, newScope = true) => {
      const sc = newScope ? { vars: new Map(), parent: scope, fn: scope.fn } : scope;
      const stmts = block.body.map((s) => compileStmt(s, sc));
      const n = stmts.length;
      if (n === 1) return stmts[0];
      return (f) => {
        let v = NaN;
        for (let k = 0; k < n; k++) { v = stmts[k](f); if (rt.brk) break; }
        return v;
      };
    };

    const declare = (scope, name, info) => { scope.vars.set(name, info); return info; };

    const frameOf = (vinfo, scope) => vinfo.fn === scope.fn ? null : (vinfo.fn === rootInfo ? 'root' : null);

    const compileStmt = (node, scope) => {
      const code = compileStmtInner(node, scope);
      const line = node.line;
      return (f) => { rt.ln = line; return code(f); };
    };

    const compileStmtInner = (node, scope) => {
      switch (node.type) {
        case 'ExprStmt': return C(node.expr, scope);
        case 'VarDecl': {
          const init = C(node.init, scope);
          const fn = scope.fn;
          const slot = fn.nslots++;
          const ci = !node.kind && scope.fn === rootInfo && !reassigned.has(node.name) && isConstInt(node.init, scope);
          declare(scope, node.name, { slot, fn, kind: node.kind, typeName: node.typeName, constInt: ci });
          const isInt = node.typeName === 'int';
          if (node.kind) {
            return (f) => {
              if (f.init[slot] !== 1) { let x = init(f); if (isInt && typeof x === 'number' && !isNaN(x)) x = Math.trunc(x); f.v[slot] = x; f.init[slot] = 1; }
              return f.v[slot];
            };
          }
          if (isInt) return (f) => { let x = init(f); if (typeof x === 'number' && !isNaN(x)) x = Math.trunc(x); return (f.v[slot] = x); };
          return (f) => (f.v[slot] = init(f));
        }
        case 'TupleDecl': {
          const init = C(node.init, scope);
          if (node.reassign) {
            const targets = node.names.map((nm) => { const vi = lookup(scope, nm); if (!vi) err(node, `متغير غير معرف '${nm}'`); return vi; });
            return (f) => {
              const r = init(f);
              for (let k = 0; k < targets.length; k++) { const vi = targets[k]; const fr = vi.fn === scope.fn ? f : rt.S.root; fr.v[vi.slot] = Array.isArray(r) ? (r[k] === undefined ? NaN : r[k]) : NaN; }
              return r;
            };
          }
          const slots = node.names.map((nm) => { const slot = scope.fn.nslots++; if (nm !== '_') declare(scope, nm, { slot, fn: scope.fn, kind: node.kind }); return slot; });
          const isVar = !!node.kind;
          return (f) => {
            if (isVar && f.init[slots[0]] === 1) return NaN;
            const r = init(f);
            for (let k = 0; k < slots.length; k++) f.v[slots[k]] = Array.isArray(r) ? (r[k] === undefined ? NaN : r[k]) : NaN;
            if (isVar) f.init[slots[0]] = 1;
            return r;
          };
        }
        case 'Assign': {
          const val = C(node.value, scope);
          const op = node.op;
          if (node.target.type === 'Ident') {
            const vi = lookup(scope, node.target.name);
            if (!vi) err(node, `لا يمكن الإسناد إلى متغير غير معرف '${node.target.name}' — استخدم = للتعريف`);
            const slot = vi.slot;
            const own = vi.fn === scope.fn;
            const isInt = vi.typeName === 'int';
            const get = own ? (f) => f : () => rt.S.root;
            const fix = isInt ? (x) => (typeof x === 'number' && !isNaN(x) ? Math.trunc(x) : x) : (x) => x;
            switch (op) {
              case ':=': return (f) => (get(f).v[slot] = fix(val(f)));
              case '+=': return (f) => { const fr = get(f); return (fr.v[slot] = fix(fr.v[slot] + val(f))); };
              case '-=': return (f) => { const fr = get(f); return (fr.v[slot] = fix(fr.v[slot] - val(f))); };
              case '*=': return (f) => { const fr = get(f); return (fr.v[slot] = fix(fr.v[slot] * val(f))); };
              case '/=': return (f) => { const fr = get(f); return (fr.v[slot] = fix(fr.v[slot] / val(f))); };
              case '%=': return (f) => { const fr = get(f); return (fr.v[slot] = fix(fr.v[slot] % val(f))); };
            }
          }
          // member assignment obj.a.b := v
          const objCode = C(node.target.object, scope);
          const prop = node.target.prop;
          return (f) => {
            const o = objCode(f);
            if (o == null || typeof o !== 'object') throw new RuntimeErr(`لا يمكن تعيين الحقل '${prop}' لقيمة na`);
            const v = val(f);
            switch (op) {
              case ':=': o[prop] = v; break;
              case '+=': o[prop] = o[prop] + v; break;
              case '-=': o[prop] = o[prop] - v; break;
              case '*=': o[prop] = o[prop] * v; break;
              case '/=': o[prop] = o[prop] / v; break;
              case '%=': o[prop] = o[prop] % v; break;
            }
            return o[prop];
          };
        }
        case 'FuncDecl': {
          const info = { name: node.name, nslots: 0, histSlots: [], hist: new Set(), paramSlots: [], defs: [], params: node.params, body: null, isMethod: node.isMethod };
          const fscope = { vars: new Map(), parent: globalScope, fn: info };
          for (const p of node.params) {
            const slot = info.nslots++;
            info.paramSlots.push(slot);
            declare(fscope, p.name, { slot, fn: info, typeName: p.typeName });
          }
          info.defs = node.params.map((p) => (p.def ? C(p.def, globalScope) : null));
          if (node.isMethod) {
            const t = node.params[0] && node.params[0].typeName;
            (rt.methods[node.name] = rt.methods[node.name] || []).push({ info, type: t });
          } else rt.funcs[node.name] = info;
          info.body = compileBlock(node.body, fscope, false);
          return () => NaN;
        }
        case 'TypeDecl': {
          const t = { name: node.name, fields: node.fields.map((fd) => ({ name: fd.name, typeName: fd.typeName, def: fd.def ? C(fd.def, globalScope) : null })) };
          rt.userTypes[node.name] = t;
          return () => NaN;
        }
        case 'EnumDecl': {
          const e = { name: node.name, fields: node.fields, values: {} };
          for (const fd of node.fields) e.values[fd.name] = node.name + '::' + fd.name;
          rt.enums[node.name] = e;
          return () => NaN;
        }
        case 'Import':
          rt.warnings.push(`السطر ${node.line}: مكتبات import غير مدعومة دون اتصال (${node.path}). انسخ دوال المكتبة داخل السكربت.`);
          if (node.alias) rt.libAliases = { ...(rt.libAliases || {}), [node.alias]: node.path };
          return () => NaN;
        case 'Break': return () => { rt.brk = 1; return NaN; };
        case 'Continue': return () => { rt.brk = 2; return NaN; };
        default: return compileExpr(node, scope);
      }
    };

    const dottedName = (node, scope) => {
      // returns "a.b.c" if node is a pure member chain of identifiers not shadowed by user variables
      const parts = [];
      let n = node;
      while (n.type === 'Member') { parts.unshift(n.prop); n = n.object; }
      if (n.type !== 'Ident') return null;
      if (lookup(scope, n.name)) return null;
      parts.unshift(n.name);
      return parts.join('.');
    };

    const compileArgs = (node, scope, params, name, off = 0) => {
      const codes = [];
      node.args.forEach((a, i) => { codes[i + off] = C(a, scope); });
      for (const k in node.named) {
        let idx = params ? params.indexOf(k) : -1;
        if (idx < 0) {
          if (k === 'when') { idx = params ? params.length : codes.length; codes.when = C(node.named[k], scope); continue; }
          if (k === 'transp') { codes.transp = C(node.named[k], scope); continue; }
          rt.warnings.push(`السطر ${node.line}: الوسيط '${k}' غير معروف في ${name} — تم تجاهله`);
          continue;
        }
        codes[idx] = C(node.named[k], scope);
      }
      return codes;
    };

    const callBuiltin = (name, node, scope, extraFirst) => {
      const b = B[name];
      if (b.compile) return b.compile(rt, node, scope, C, extraFirst);
      const codes = compileArgs(node, scope, b.p, name, extraFirst ? 1 : 0);
      if (extraFirst) codes[0] = extraFirst;
      const nargs = codes.length;
      const fn = b.f;
      const id = node.id;
      const when = codes.when, transp = codes.transp;
      const st = b.st;
      const meta = { id, line: node.line, node, nargs: node.args.length + (extraFirst ? 1 : 0), named: Object.keys(node.named) };
      return (f) => {
        if (when && !truthy(when(f))) return NaN;
        const args = new Array(nargs);
        for (let k = 0; k < nargs; k++) args[k] = codes[k] ? codes[k](f) : undefined;
        let s = null;
        if (st) { s = f.s[id]; if (!s) { s = f.s[id] = {}; } }
        rt.meta = meta;
        if (transp) rt.transp = transp(f); else rt.transp = undefined;
        return fn(rt, s, ...args);
      };
    };

    const callUser = (info, node, scope, selfCode) => {
      const codes = [];
      const off = selfCode ? 1 : 0;
      if (selfCode) codes[0] = selfCode;
      node.args.forEach((a, i) => { codes[i + off] = C(a, scope); });
      for (const k in node.named) {
        const idx = info.params.findIndex((p) => p.name === k);
        if (idx < 0) err(node, `الدالة ${info.name} لا تملك وسيطاً باسم '${k}'`);
        codes[idx] = C(node.named[k], scope);
      }
      const np = info.params.length;
      if (codes.length > np) err(node, `عدد وسائط كثير عند استدعاء ${info.name}`);
      const id = node.id;
      return (f) => {
        let child = f.s[id];
        if (!child) child = f.s[id] = newFrame(info);
        else if (child.v.length < info.nslots) { while (child.v.length < info.nslots) child.v.push(NaN); }
        const ps = info.paramSlots;
        for (let k = 0; k < np; k++) {
          const c = codes[k];
          child.v[ps[k]] = c ? c(f) : (info.defs[k] ? info.defs[k](child) : NaN);
        }
        const saveLn = rt.ln;
        const r = info.body(child);
        rt.brk = 0;
        rt.ln = saveLn;
        if (info.histSlots.length) pushHist(child, info.histSlots);
        return r;
      };
    };

    const compileCall = (node, scope) => {
      const callee = node.callee;
      if (callee.type === 'Ident') {
        const name = callee.name;
        if (lookup(scope, name)) err(node, `'${name}' متغير وليس دالة`);
        if (rt.funcs[name]) return callUser(rt.funcs[name], node, scope);
        let bn = name;
        if (!B[bn] && V4_ALIASES[bn]) bn = V4_ALIASES[bn];
        if (B[bn]) return callBuiltin(bn, node, scope);
        err(node, `دالة غير معروفة '${name}'`);
      }
      if (callee.type === 'Member') {
        const dn = dottedName(callee, scope);
        if (dn) {
          if (B[dn]) return callBuiltin(dn, node, scope);
          const base = dn.split('.')[0];
          // UDT constructor / static methods
          const parts = dn.split('.');
          if (rt.userTypes[parts[0]] && parts.length === 2) {
            const T = rt.userTypes[parts[0]];
            if (parts[1] === 'new') return compileNew(T, node, scope);
            if (parts[1] === 'copy') { const a = C(node.args[0], scope); return (f) => { const o = a(f); return o && typeof o === 'object' ? { ...o } : NaN; }; }
          }
          if (rt.libAliases && rt.libAliases[base]) err(node, `مكتبة '${rt.libAliases[base]}' غير متاحة دون اتصال`);
          if (rt.enums[parts[0]]) err(node, `استدعاء غير صالح على enum`);
          if (!lookup(scope, base) && !V[base] && !rt.userTypes[base]) {
            // maybe namespace typo
            if (/^(ta|math|str|array|color|input|request|strategy|label|line|box|table|map|matrix|timeframe|syminfo|ticker|chart|polyline|linefill|log|runtime)$/.test(base)) err(node, `الدالة '${dn}' غير مدعومة`);
          }
        }
        // method call on value
        const objCode = C(callee.object, scope);
        const mname = callee.prop;
        const userMs = () => rt.methods[mname];
        const argNodes = node.args;
        // pre-compile builtin variants lazily by type
        const variants = {};
        const getVariant = (kind) => {
          if (variants[kind]) return variants[kind];
          const bn = kind + '.' + mname;
          if (!B[bn]) return null;
          variants[kind] = callBuiltin(bn, node, scope, (f) => rt._self);
          return variants[kind];
        };
        const userVariants = new Map();
        return (f) => {
          const o = objCode(f);
          const ms = userMs();
          if (ms) {
            const tn = typeOfValue(o);
            let m = ms.find((x) => x.type === tn) || ms.find((x) => x.type && tn && x.type.split('<')[0] === tn.split('<')[0]) || (ms.length === 1 ? ms[0] : null);
            if (m) {
              let code = userVariants.get(m);
              if (!code) { code = callUser(m.info, node, scope, (ff) => rt._self); userVariants.set(m, code); }
              rt._self = o;
              return code(f);
            }
          }
          let kind = null;
          if (Array.isArray(o)) kind = 'array';
          else if (o instanceof Map) kind = 'map';
          else if (o && typeof o === 'object') kind = o.__k || (o.__type ? null : null);
          else if (typeof o === 'string' && !o.startsWith('#')) kind = 'str';
          else if (typeof o === 'string') kind = 'color';
          if (o && typeof o === 'object' && o.__type && mname === 'copy') return { ...o };
          if (!kind) {
            if (isNa(o)) return NaN; // method on na → na (Pine raises; we stay tolerant)
            throw new RuntimeErr(`لا توجد دالة '${mname}' لهذا النوع`);
          }
          const code = getVariant(kind);
          if (!code) throw new RuntimeErr(`الدالة '${kind}.${mname}' غير مدعومة`);
          rt._self = o;
          return code(f);
        };
      }
      err(node, 'استدعاء غير صالح');
    };

    const compileNew = (T, node, scope) => {
      const fields = T.fields;
      const codes = fields.map(() => null);
      node.args.forEach((a, i) => { codes[i] = C(a, scope); });
      for (const k in node.named) {
        const idx = fields.findIndex((fd) => fd.name === k);
        if (idx < 0) err(node, `النوع ${T.name} لا يملك الحقل '${k}'`);
        codes[idx] = C(node.named[k], scope);
      }
      return (f) => {
        const o = { __type: T.name };
        for (let k = 0; k < fields.length; k++) {
          const c = codes[k];
          o[fields[k].name] = c ? c(f) : fields[k].def ? fields[k].def(f) : NaN;
        }
        return o;
      };
    };

    const compileIdent = (node, scope) => {
      const vi = lookup(scope, node.name);
      if (vi) {
        const slot = vi.slot;
        if (vi.fn === scope.fn) return (f) => f.v[slot];
        if (vi.fn === rootInfo) return () => rt.S.root.v[slot];
        err(node, `لا يمكن الوصول إلى '${node.name}' من هنا`);
      }
      const name = node.name;
      if (V[name]) { const g = V[name]; return () => g(rt); }
      if (V4_ALIASES[name] && V[V4_ALIASES[name]]) { const g = V[V4_ALIASES[name]]; return () => g(rt); }
      if (name in K) { const k = K[name]; return () => k; }
      if (rt.userTypes[name] || rt.enums[name]) return () => name;
      if (rt.funcs[name] || B[name]) err(node, `'${name}' دالة — أضف الأقواس ()`);
      err(node, `معرف غير معروف '${name}' (Undeclared identifier)`);
    };

    const compileMember = (node, scope) => {
      const dn = dottedName(node, scope);
      if (dn) {
        if (V[dn]) { const g = V[dn]; return () => g(rt); }
        if (dn in K) { const k = K[dn]; return () => k; }
        const parts = dn.split('.');
        if (rt.enums[parts[0]] && parts.length === 2) {
          const e = rt.enums[parts[0]];
          if (!(parts[1] in e.values)) err(node, `القيمة '${parts[1]}' غير موجودة في ${parts[0]}`);
          const val = e.values[parts[1]];
          return () => val;
        }
        if (!lookup(scope, parts[0]) && /^(ta|math|str|color|syminfo|timeframe|barstate|strategy|chart|session|label|line|box|table|shape|location|size|position|plot|hline|display|format|extend|xloc|yloc|text|font|currency|dayofweek|order|barmerge|scale|adjustment|alert|request|input|earnings|dividends|splits)$/.test(parts[0])) {
          err(node, `'${dn}' غير مدعوم`);
        }
      }
      const objCode = C(node.object, scope);
      const prop = node.prop;
      return (f) => {
        const o = objCode(f);
        if (o == null || typeof o !== 'object') return NaN;
        const v = o[prop];
        return v === undefined ? NaN : v;
      };
    };

    const compileIndex = (node, scope) => {
      const idx = C(node.index, scope);
      const ob = node.object;
      if (ob.type === 'Ident') {
        const vi = lookup(scope, ob.name);
        if (vi) {
          vi.fn.hist.add(vi.slot);
          if (!vi.fn.histSlots.includes(vi.slot)) vi.fn.histSlots.push(vi.slot);
          const slot = vi.slot;
          const own = vi.fn === scope.fn;
          return (f) => {
            const fr = own ? f : rt.S.root;
            let n = idx(f);
            if (isNaN(n)) return NaN;
            n = Math.floor(n);
            if (n === 0) return fr.v[slot];
            return histRead(fr.h[slot], n);
          };
        }
        const src = SOURCES[ob.name];
        if (src) {
          return (f) => { let n = idx(f); if (isNaN(n)) return NaN; const k = rt.i - Math.floor(n); return k >= 0 && k <= rt.i ? rt[src][k] : NaN; };
        }
        if (ob.name === 'bar_index') return (f) => { const n = idx(f); const k = rt.i - Math.floor(n); return k >= 0 ? k : NaN; };
        if (V[ob.name] && /^(hl2|hlc3|ohlc4|hlcc4|time_close)$/.test(ob.name)) {
          const g = V[ob.name];
          return (f) => { const n = Math.floor(idx(f)); const k = rt.i - n; if (k < 0 || isNaN(k)) return NaN; const save = rt.i; rt.i = k; const r = g(rt); rt.i = save; return r; };
        }
      }
      // generic expression history buffer
      const objCode = C(ob, scope);
      const id = node.id;
      return (f) => {
        const v = objCode(f);
        let s = f.s[id];
        if (!s) s = f.s[id] = { h: [] };
        let n = idx(f);
        const h = s.h;
        let r;
        if (isNaN(n)) r = NaN;
        else { n = Math.floor(n); r = n === 0 ? v : histRead(h, n); }
        h.push(v);
        if (h.length > MAXH * 1.5) h.splice(0, h.length - MAXH);
        return r;
      };
    };

    const eq = (a, b) => {
      if (typeof a === 'number' && typeof b === 'number') return a === b;
      if (typeof a === 'boolean' || typeof b === 'boolean') return truthy(a) === truthy(b);
      return a === b;
    };

    const compileBinary = (node, scope) => {
      const L = C(node.left, scope), R = C(node.right, scope);
      switch (node.op) {
        case '+': return (f) => { const a = L(f), b = R(f); if (typeof a === 'string' || typeof b === 'string') return (isNa(a) && typeof a !== 'string' ? '' : a) + (isNa(b) && typeof b !== 'string' ? '' : b); return a + b; };
        case '-': return (f) => L(f) - R(f);
        case '*': return (f) => L(f) * R(f);
        case '/':
          if (isConstInt(node.left, scope) && isConstInt(node.right, scope) && rt.version < 6) return (f) => { const b = R(f); return b === 0 ? NaN : Math.trunc(L(f) / b); };
          return (f) => { const b = R(f); const a = L(f); return b === 0 ? (a === 0 ? NaN : (a > 0 ? Infinity : -Infinity)) : a / b; };
        case '%': return (f) => L(f) % R(f);
        case '<': return (f) => L(f) < R(f);
        case '>': return (f) => L(f) > R(f);
        case '<=': return (f) => L(f) <= R(f);
        case '>=': return (f) => L(f) >= R(f);
        case '==': return (f) => eq(L(f), R(f));
        case '!=': return (f) => { const a = L(f), b = R(f); if (typeof a === 'number' && typeof b === 'number' && (isNaN(a) || isNaN(b))) return false; return !eq(a, b); };
      }
      err(node, 'معامل غير معروف ' + node.op);
    };

    const compileExpr = (node, scope) => {
      switch (node.type) {
        case 'Num': { const v = node.value; return () => v; }
        case 'Str': { const v = node.value; return () => v; }
        case 'Bool': { const v = node.value; return () => v; }
        case 'Color': { const v = node.value; return () => v; }
        case 'Ident': return compileIdent(node, scope);
        case 'Member': return compileMember(node, scope);
        case 'Call': return compileCall(node, scope);
        case 'Index': return compileIndex(node, scope);
        case 'Binary': return compileBinary(node, scope);
        case 'Logical': {
          const L = C(node.left, scope), R = C(node.right, scope);
          const lazy = rt.version >= 6;
          if (node.op === 'and') return lazy ? (f) => truthy(L(f)) && truthy(R(f)) : (f) => { const a = truthy(L(f)); const b = truthy(R(f)); return a && b; };
          return lazy ? (f) => truthy(L(f)) || truthy(R(f)) : (f) => { const a = truthy(L(f)); const b = truthy(R(f)); return a || b; };
        }
        case 'Unary': {
          const A = C(node.arg, scope);
          if (node.op === '-') return (f) => -A(f);
          if (node.op === '+') return (f) => +A(f);
          return (f) => { const a = A(f); return typeof a === 'number' && isNaN(a) ? (rt.version >= 6 ? true : NaN) : !truthy(a); };
        }
        case 'Ternary': {
          const c = C(node.cond, scope), a = C(node.a, scope), b = C(node.b, scope);
          return (f) => (truthy(c(f)) ? a(f) : b(f));
        }
        case 'TupleLit': {
          const items = node.items.map((x) => C(x, scope));
          return (f) => items.map((c) => c(f));
        }
        case 'If': {
          const c = C(node.cond, scope);
          const then = compileBlock(node.then, scope);
          const els = node.els ? (node.els.type === 'If' ? C(node.els, scope) : compileBlock(node.els, scope)) : null;
          return (f) => (truthy(c(f)) ? then(f) : els ? els(f) : NaN);
        }
        case 'Switch': {
          const subj = node.subject ? C(node.subject, scope) : null;
          const cases = node.cases.map((cs) => ({ cond: cs.cond ? C(cs.cond, scope) : null, body: compileBlock(cs.body, scope) }));
          return (f) => {
            const sv = subj ? subj(f) : undefined;
            for (let k = 0; k < cases.length; k++) {
              const cs = cases[k];
              if (!cs.cond) return cs.body(f);
              const cv = cs.cond(f);
              if (subj ? eq(sv, cv) : truthy(cv)) return cs.body(f);
            }
            return NaN;
          };
        }
        case 'For': {
          const from = C(node.from, scope), to = C(node.to, scope), step = node.step ? C(node.step, scope) : null;
          const sc = { vars: new Map(), parent: scope, fn: scope.fn };
          const slot = scope.fn.nslots++;
          declare(sc, node.name, { slot, fn: scope.fn, typeName: 'int' });
          const body = compileBlock(node.body, sc, true);
          const dyn = rt.version >= 6;
          return (f) => {
            const a = from(f); let b = to(f);
            if (isNa(a) || isNa(b)) return NaN;
            let st = step ? Math.abs(step(f)) : 1;
            if (!st || isNaN(st)) st = 1;
            const down = b < a;
            let v = NaN, it = 0;
            for (let i = a; down ? i >= b : i <= b; i += down ? -st : st) {
              f.v[slot] = i;
              v = body(f);
              if (rt.brk === 1) { rt.brk = 0; break; }
              if (rt.brk === 2) rt.brk = 0;
              if (++it > LOOP_LIMIT) throw new RuntimeErr('حلقة طويلة جداً (loop limit)');
              if (dyn) { b = to(f); if (isNa(b)) break; }
            }
            return v;
          };
        }
        case 'ForIn': {
          const iter = C(node.iter, scope);
          const sc = { vars: new Map(), parent: scope, fn: scope.fn };
          const slots = node.names.map((nm) => { const slot = scope.fn.nslots++; declare(sc, nm, { slot, fn: scope.fn }); return slot; });
          const body = compileBlock(node.body, sc, true);
          return (f) => {
            const a = iter(f);
            let v = NaN;
            if (a instanceof Map) {
              for (const [k, x] of a) {
                if (slots.length === 2) { f.v[slots[0]] = k; f.v[slots[1]] = x; } else f.v[slots[0]] = x;
                v = body(f);
                if (rt.brk === 1) { rt.brk = 0; break; }
                if (rt.brk === 2) rt.brk = 0;
              }
              return v;
            }
            const arr = Array.isArray(a) ? a : null;
            if (!arr) return NaN;
            for (let k = 0; k < arr.length; k++) {
              if (slots.length === 2) { f.v[slots[0]] = k; f.v[slots[1]] = arr[k]; } else f.v[slots[0]] = arr[k];
              v = body(f);
              if (rt.brk === 1) { rt.brk = 0; break; }
              if (rt.brk === 2) rt.brk = 0;
            }
            return v;
          };
        }
        case 'While': {
          const c = C(node.cond, scope);
          const body = compileBlock(node.body, scope);
          return (f) => {
            let v = NaN, it = 0;
            while (truthy(c(f))) {
              v = body(f);
              if (rt.brk === 1) { rt.brk = 0; break; }
              if (rt.brk === 2) rt.brk = 0;
              if (++it > LOOP_LIMIT) throw new RuntimeErr('حلقة while طويلة جداً (loop limit)');
            }
            return v;
          };
        }
        default:
          if (STMT_TYPES.has(node.type)) return compileStmtInner(node, scope);
          err(node, 'عقدة غير معروفة ' + node.type);
      }
    };

    this._C = compileExpr;
    this.globalScope = globalScope;
    const prog = this.ast.body.map((s) => compileStmt(s, globalScope));
    const np = prog.length;
    this.code = (f) => { for (let k = 0; k < np; k++) { prog[k](f); rt.brk = 0; } };
  }

  // --------------------------------------------------------------- execution
  /** Execute bars [done, upTo). Returns this. */
  run(upTo = this.n) {
    const root = this.S.root;
    const hs = this.rootInfo.histSlots;
    for (let i = this.done; i < upTo; i++) {
      this.i = i;
      this.barCache = null;
      if (this.S.broker) brokerBarOpen(this, i);
      try {
        this.code(root);
      } catch (e) {
        this.fail(e, i);
      }
      if (hs.length) pushHist(root, hs);
      if (this.S.broker) brokerBarClose(this, i);
      this.done = i + 1;
    }
    return this;
  }

  fail(e, i) {
    if (e instanceof PineError) throw e;
    const pe = new PineError((e instanceof RuntimeErr ? '' : 'خطأ تشغيل: ') + (e.message || String(e)) + ` (الشمعة ${i})`, this.ln, 0);
    pe.runtime = true;
    pe.stack2 = e.stack;
    throw pe;
  }

  /** Run on the last (forming) bar without committing state, so it can be re-run on the next tick. */
  runForming() {
    const saved = structuredClone(this.S);
    const savedDone = this.done;
    const savedCache = this.cache;
    this.run(this.n);
    this.formingObjs = this.S.objs;
    this.formingBroker = this.S.broker;
    this.S = saved;
    this.done = savedDone;
    this.cache = savedCache;
    return this;
  }

  /** Extend with more bars (incremental run). bars must contain the old ones as prefix. */
  extend(bars) {
    this.setBars(bars);
    this.growOutputs();
  }

  growOutputs() {
    const n = this.n;
    const grow = (a) => { if (!a || a.length >= n) return a; const b = new Float64Array(Math.max(n, Math.floor(a.length * 1.5))).fill(NaN); b.set(a); return b; };
    for (const p of this.out.plots) p.values = grow(p.values);
    for (const p of this.out.shapes) p.values = grow(p.values);
    for (const p of this.out.candles) { p.o = grow(p.o); p.h = grow(p.h); p.l = grow(p.l); p.c = grow(p.c); }
    for (const p of this.out.fills) { if (p.tv) { p.tv = grow(p.tv); p.bv = grow(p.bv); } }
  }

  // ----------------------------------------------------- helpers for libraries
  srcVal(name, i = this.i) {
    switch (name) {
      case 'open': return this.o[i];
      case 'high': return this.h[i];
      case 'low': return this.l[i];
      case 'close': return this.c[i];
      case 'volume': return this.v[i];
      case 'hl2': return (this.h[i] + this.l[i]) / 2;
      case 'hlc3': return (this.h[i] + this.l[i] + this.c[i]) / 3;
      case 'ohlc4': return (this.o[i] + this.h[i] + this.l[i] + this.c[i]) / 4;
      case 'hlcc4': return (this.h[i] + this.l[i] + 2 * this.c[i]) / 4;
      default: return this.c[i];
    }
  }

  barClose(i) { return bucketEnd(this.t[i], this.tf, this.align); }

  output(id, factory) {
    let o = this.outById[id];
    if (!o) { o = factory(); o.id = id; this.outById[id] = o; }
    return o;
  }

  newArr() { return new Float64Array(this.n).fill(NaN); }

  // request.security support ------------------------------------------------
  security(nodeId, symbol, tfStr, exprCode, f, gaps, lookahead, subCapture) {
    const key = nodeId;
    let st = f.s['sec' + key];
    if (!st) {
      st = f.s['sec' + key] = {};
      const sameSym = !symbol || symbol === this.sym.name || symbol === this.tickerid() || symbol === this.sym.tickerid;
      let tf = tfStr ? parseTf(tfStr) : this.tf;
      if (!tf) throw new RuntimeErr(`إطار زمني غير صالح '${tfStr}'`);
      const ha = typeof symbol === 'string' && symbol.startsWith('HA:');
      if ((sameSym && !ha && tf.seconds === this.tf.seconds && tf.kind === this.tf.kind) || this.isSub) { st.mode = 'same'; }
      else {
        st.mode = 'other';
        st.tf = tf;
        st.symbol = sameSym ? this.sym.name : symbol;
        st.ha = ha;
      }
    }
    if (st.mode === 'same') {
      const v = exprCode(f);
      if (this.captures) (this.captures[nodeId] || (this.captures[nodeId] = []))[this.i] = v;
      return v;
    }
    if (!st.run) {
      const runKey = st.symbol + '|' + st.tf.period + '|' + (st.ha ? 'ha' : '');
      let sub = this.securityRuns[runKey];
      if (!sub) {
        const got = this.opts.getBars ? this.opts.getBars(st.ha ? st.symbol.slice(3) : st.symbol, st.tf, this.t[this.n - 1], st.ha) : null;
        if (!got || !got.bars || !got.bars.length) { st.mode = 'na'; this.warnings.push(`لا توجد بيانات للرمز ${st.symbol} — request.security يعيد na`); }
        else {
          sub = new PineRuntime({ ...this.opts, ast: this.ast, bars: got.bars, tf: st.tf, symbol: got.symbol || this.sym, isSub: true, captureIds: true, inputs: this.inputValues, maxBars: undefined });
          sub.run();
          this.securityRuns[runKey] = sub;
        }
      }
      if (st.mode === 'na') return NaN;
      st.run = sub;
      st.values = sub.captures[nodeId] || [];
      st.j = -1;
      st.ptrTime = -Infinity;
    }
    if (st.mode === 'na') return NaN;
    const sub = st.run;
    const i = this.i;
    let j;
    if (lookahead) {
      // HTF bar containing this bar's open time
      const t = this.t[i];
      j = st.j < 0 ? 0 : st.j;
      if (st.j >= 0 && sub.t[j] > t) j = 0;
      while (j + 1 < sub.n && sub.t[j + 1] <= t) j++;
      if (sub.t[j] > t) j = -1;
    } else {
      // last HTF bar whose close time <= this bar's close time
      const ct = this.barClose(i);
      j = st.j < 0 ? -1 : st.j;
      if (j >= 0 && sub.barClose(j) > ct) j = -1;
      while (j + 1 < sub.n && sub.barClose(j + 1) <= ct) j++;
    }
    const prevJ = st.j;
    st.j = j;
    if (j < 0) return NaN;
    if (gaps && j === prevJ) return NaN;
    const v = st.values[j];
    return v === undefined ? NaN : v;
  }

  securityLower(nodeId, symbol, tfStr, exprCode, f) {
    let st = f.s['secl' + nodeId];
    if (!st) {
      st = f.s['secl' + nodeId] = {};
      const tf = parseTf(tfStr);
      if (this.isSub || !tf) { st.mode = 'na'; }
      else {
        const got = this.opts.getBars ? this.opts.getBars(symbol || this.sym.name, tf, this.t[this.n - 1]) : null;
        if (!got || !got.bars.length) st.mode = 'na';
        else {
          const sub = new PineRuntime({ ...this.opts, ast: this.ast, bars: got.bars, tf, symbol: this.sym, isSub: true, captureIds: true, inputs: this.inputValues, maxBars: undefined });
          sub.run();
          st.sub = sub; st.values = sub.captures[nodeId] || []; st.j = 0;
        }
      }
    }
    if (st.mode === 'na') { if (this.isSub && this.captures) { const v = exprCode(f); (this.captures[nodeId] || (this.captures[nodeId] = []))[this.i] = v; } return []; }
    const sub = st.sub;
    const t0 = this.t[this.i], t1 = this.barClose(this.i);
    let j = st.j;
    while (j < sub.n && sub.t[j] < t0) j++;
    const out = [];
    while (j < sub.n && sub.t[j] < t1) { out.push(st.values[j]); j++; }
    st.j = j;
    return out;
  }

  tickerid() { return (this.sym.prefix || 'BTX') + ':' + this.sym.name; }

  // ------------------------------------------------------------------ results
  result() {
    return {
      decl: this.decl,
      out: this.out,
      objs: this.formingObjs || this.S.objs,
      broker: this.formingBroker || this.S.broker,
      inputs: this.inputDefs,
      logs: this.logs,
      warnings: this.warnings,
      alerts: this.alerts,
      n: this.n,
    };
  }
}

/** Convenience: compile + run a script over bars. */
export function runScript(source, opts) {
  const rt = new PineRuntime({ ...opts, source });
  rt.run();
  return rt;
}

export function scanSecuritySymbols(ast) {
  const out = new Set();
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === 'Call' && n.callee && ((n.callee.type === 'Member' && n.callee.prop === 'security' && n.callee.object.name === 'request') || (n.callee.type === 'Ident' && n.callee.name === 'security'))) {
      const a = n.args[0];
      if (a && a.type === 'Str') out.add(a.value.includes(':') ? a.value.split(':')[1] : a.value);
    }
    for (const k in n) if (typeof n[k] === 'object') walk(n[k]);
  })(ast.body);
  return [...out];
}

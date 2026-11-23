// Pine Script lexer + parser (v4 / v5 / v6 syntax) → AST
export class PineError extends Error {
  constructor(msg, line, col) { super(msg); this.line = line || 0; this.col = col || 0; }
}

const KEYWORDS = new Set(['if', 'else', 'for', 'while', 'break', 'continue', 'switch', 'var', 'varip', 'and', 'or', 'not', 'true', 'false', 'import']);
const OPS3 = [];
const OPS2 = [':=', '+=', '-=', '*=', '/=', '%=', '==', '!=', '<=', '>=', '=>'];
const OPS1 = '+-*/%<>=?:,()[].';
const CONT_END = new Set(['+', '-', '*', '/', '%', '==', '!=', '<', '>', '<=', '>=', '?', ':', '=', ':=', '+=', '-=', '*=', '/=', '%=', ',', '(', '[', 'and', 'or', 'not', '.']);
const CONT_START = new Set(['?', ':', 'and', 'or', '+', '*', '/', '%', '==', '!=', '<', '>', '<=', '>=', '.', ')', ']', '-']);
const BLOCK_KW = new Set(['if', 'else', 'for', 'while', 'switch']);

function tokenizeLine(raw, lineNo, out) {
  let i = 0, indent = 0;
  while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t')) { indent += raw[i] === '\t' ? 4 : 1; i++; }
  const L = raw.length;
  while (i < L) {
    const ch = raw[i];
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }
    if (ch === '/' && raw[i + 1] === '/') break;
    const col = i + 1;
    if ((ch >= '0' && ch <= '9') || (ch === '.' && raw[i + 1] >= '0' && raw[i + 1] <= '9')) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+\-]?\d+)?/.exec(raw.slice(i));
      const s = m[0];
      out.push({ t: 'num', v: parseFloat(s), isInt: !/[.eE]/.test(s), line: lineNo, col });
      i += s.length; continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1, s = '';
      while (j < L && raw[j] !== ch) {
        if (raw[j] === '\\' && j + 1 < L) {
          const e = raw[j + 1];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e === 'u' && /^[0-9a-fA-F]{4}$/.test(raw.slice(j + 2, j + 6)) ? String.fromCharCode(parseInt(raw.slice(j + 2, j + 6), 16)) : e;
          j += e === 'u' && /^[0-9a-fA-F]{4}$/.test(raw.slice(j + 2, j + 6)) ? 6 : 2;
        } else s += raw[j++];
      }
      if (j >= L) throw new PineError('نص غير مغلق (missing closing quote)', lineNo, col);
      out.push({ t: 'str', v: s, line: lineNo, col });
      i = j + 1; continue;
    }
    if (ch === '#') {
      const m = /^#([0-9a-fA-F]{8}|[0-9a-fA-F]{6})(?![0-9a-zA-Z])/.exec(raw.slice(i));
      if (m) { out.push({ t: 'color', v: m[1].length === 6 ? '#' + m[1].toLowerCase() + 'ff' : '#' + m[1].toLowerCase(), line: lineNo, col }); i += m[0].length; continue; }
      throw new PineError('لون غير صالح', lineNo, col);
    }
    if (/[A-Za-z_À-￿]/.test(ch)) {
      let j = i + 1;
      while (j < L && /[\wÀ-￿]/.test(raw[j])) j++;
      const w = raw.slice(i, j);
      out.push({ t: KEYWORDS.has(w) ? 'kw' : 'id', v: w, line: lineNo, col });
      i = j; continue;
    }
    const two = raw.substr(i, 2);
    if (OPS2.includes(two)) { out.push({ t: 'op', v: two, line: lineNo, col }); i += 2; continue; }
    if (OPS1.includes(ch)) { out.push({ t: 'op', v: ch, line: lineNo, col }); i++; continue; }
    if (ch === '@') { i++; continue; }
    throw new PineError(`رمز غير متوقع '${ch}'`, lineNo, col);
  }
  return indent;
}

function tokVal(t) { return t.t === 'op' || t.t === 'kw' ? t.v : null; }

function isBlockOpener(lt) {
  if (!lt.length) return false;
  const last = lt[lt.length - 1];
  if (last.t === 'op' && last.v === '=>') return true;
  const f = lt[0];
  if (f.t === 'kw' && BLOCK_KW.has(f.v)) return true;
  if (f.t === 'id' && (f.v === 'type' || f.v === 'enum') && lt.length === 2 && lt[1].t === 'id') return true;
  if (f.t === 'id' && f.v === 'export' && lt.length === 3 && (lt[1].v === 'type' || lt[1].v === 'enum')) return true;
  let depth = 0;
  for (const t of lt) {
    if (t.t === 'op') { if (t.v === '(' || t.v === '[') depth++; else if (t.v === ')' || t.v === ']') depth--; }
    if (depth === 0 && t.t === 'kw' && (t.v === 'if' || t.v === 'switch' || t.v === 'for' || t.v === 'while')) return true;
  }
  return false;
}

export function lex(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let version = 0;
  const vm = /\/\/\s*@version\s*=\s*(\d+)/.exec(src);
  if (vm) version = parseInt(vm[1], 10);
  const toks = [];
  const indents = [0];
  let cur = []; // tokens of current logical line
  let curIndent = 0, depth = 0;
  const flush = (nextIndent, lineNo) => {
    if (cur.length) {
      for (const t of cur) toks.push(t);
      toks.push({ t: 'nl', line: cur[cur.length - 1].line });
      cur = [];
    }
    if (nextIndent == null) return;
    const top = indents[indents.length - 1];
    if (nextIndent > top) { indents.push(nextIndent); toks.push({ t: 'indent', line: lineNo }); }
    else {
      while (nextIndent < indents[indents.length - 1]) { indents.pop(); toks.push({ t: 'dedent', line: lineNo }); }
      if (nextIndent > indents[indents.length - 1]) { indents.push(nextIndent); toks.push({ t: 'indent', line: lineNo }); }
    }
  };
  let pendingOpener = false;
  for (let li = 0; li < lines.length; li++) {
    const lt = [];
    const indent = tokenizeLine(lines[li], li + 1, lt);
    if (!lt.length) continue;
    let cont = false;
    if (cur.length) {
      const last = cur[cur.length - 1];
      const lv = tokVal(last);
      const fv = tokVal(lt[0]);
      const top = indents[indents.length - 1];
      if (depth > 0) cont = true;
      else if (lv && CONT_END.has(lv) && !(last.t === 'op' && last.v === '=>')) cont = true;
      else if (indent > curIndent && fv && CONT_START.has(fv) && !(fv === '-' && isBlockOpener(cur))) cont = true;
      else if (indent > top && !isBlockOpener(cur)) cont = true;
    }
    if (cont) {
      for (const t of lt) cur.push(t);
    } else {
      const opener = isBlockOpener(cur);
      const top = indents[indents.length - 1];
      if (cur.length) {
        // flush previous logical line, then handle this line's indentation
        for (const t of cur) toks.push(t);
        toks.push({ t: 'nl', line: cur[cur.length - 1].line });
        cur = [];
      }
      if (indent > top) {
        if (!opener && toks.length) throw new PineError('مسافة بادئة غير متوقعة (unexpected indentation)', li + 1, 1);
        indents.push(indent); toks.push({ t: 'indent', line: li + 1 });
      } else {
        while (indent < indents[indents.length - 1]) { indents.pop(); toks.push({ t: 'dedent', line: li + 1 }); }
        if (indent > indents[indents.length - 1]) { indents.push(indent); toks.push({ t: 'indent', line: li + 1 }); }
      }
      curIndent = indent;
      for (const t of lt) cur.push(t);
    }
    for (const t of lt) if (t.t === 'op') { if (t.v === '(' || t.v === '[') depth++; else if (t.v === ')' || t.v === ']') depth = Math.max(0, depth - 1); }
  }
  if (cur.length) { for (const t of cur) toks.push(t); toks.push({ t: 'nl', line: cur[cur.length - 1].line }); }
  const lastLine = lines.length;
  while (indents.length > 1) { indents.pop(); toks.push({ t: 'dedent', line: lastLine }); }
  toks.push({ t: 'eof', line: lastLine });
  return { toks, version };
}

// ----------------------------------------------------------------------------
const TYPE_NAMES = new Set(['int', 'float', 'bool', 'string', 'color', 'line', 'label', 'box', 'table', 'linefill', 'polyline', 'array', 'matrix', 'map', 'chart']);
const QUALIFIERS = new Set(['series', 'simple', 'const', 'input']);

export function parse(src) {
  const { toks, version } = lex(src);
  let p = 0;
  let nodeId = 0;
  const N = (type, tok, props) => ({ type, id: ++nodeId, line: tok ? tok.line : 0, col: tok ? tok.col : 0, ...props });
  const peek = (k = 0) => toks[Math.min(p + k, toks.length - 1)];
  const next = () => toks[p++];
  const isOp = (v, k = 0) => { const t = peek(k); return t.t === 'op' && t.v === v; };
  const isKw = (v, k = 0) => { const t = peek(k); return t.t === 'kw' && t.v === v; };
  const isId = (v, k = 0) => { const t = peek(k); return t.t === 'id' && (v == null || t.v === v); };
  const err = (msg, t = peek()) => { throw new PineError(msg, t.line, t.col); };
  const expectOp = (v) => { if (!isOp(v)) err(`متوقع '${v}' لكن وُجد '${peek().v ?? peek().t}'`); return next(); };
  const expectId = () => { if (peek().t !== 'id') err(`متوقع اسم لكن وُجد '${peek().v ?? peek().t}'`); return next(); };
  const skipNl = () => { while (peek().t === 'nl') p++; };

  function endStmt() {
    const t = peek();
    if (t.t === 'nl') { p++; return; }
    if (t.t === 'eof' || t.t === 'dedent') return;
    const prev = toks[p - 1];
    if (prev && (prev.t === 'dedent' || prev.t === 'nl')) return;
    err(`نهاية سطر متوقعة، وُجد '${t.v ?? t.t}'`);
  }

  // ---- types -----------------------------------------------------------
  function scanType(k) { // returns index after the type or -1
    let i = p + k;
    while (toks[i].t === 'id' && QUALIFIERS.has(toks[i].v) && toks[i + 1].t === 'id') i++;
    if (toks[i].t !== 'id') return -1;
    i++;
    while (toks[i].t === 'op' && toks[i].v === '.' && toks[i + 1].t === 'id') i += 2;
    if (toks[i].t === 'op' && toks[i].v === '<') {
      let d = 1; i++;
      while (d > 0) {
        const t = toks[i];
        if (t.t === 'eof' || t.t === 'nl') return -1;
        if (t.t === 'op' && t.v === '<') d++;
        else if (t.t === 'op' && t.v === '>') d--;
        else if (!(t.t === 'id' || (t.t === 'op' && (t.v === ',' || t.v === '.')))) return -1;
        i++;
      }
    }
    if (toks[i].t === 'op' && toks[i].v === '[' && toks[i + 1].t === 'op' && toks[i + 1].v === ']') i += 2;
    return i;
  }
  function parseType() {
    const start = p;
    while (peek().t === 'id' && QUALIFIERS.has(peek().v) && peek(1).t === 'id') p++;
    let name = expectId().v;
    while (isOp('.') && peek(1).t === 'id') { p++; name += '.' + next().v; }
    let args = null;
    if (isOp('<')) {
      p++; args = [];
      while (!isOp('>')) { args.push(parseType()); if (isOp(',')) p++; }
      p++;
    }
    let arr = false;
    if (isOp('[') && isOp(']', 1)) { p += 2; arr = true; }
    return { name, args, arr };
  }
  function typeStr(t) { if (!t) return null; if (t.arr) return 'array<' + t.name + '>'; if (t.args) return t.name + '<' + t.args.map(typeStr).join(',') + '>'; return t.name; }

  // ---- program ---------------------------------------------------------
  function parseProgram() {
    const body = [];
    skipNl();
    while (peek().t !== 'eof') {
      if (peek().t === 'dedent' || peek().t === 'indent') { p++; continue; }
      body.push(parseStatement());
      skipNl();
    }
    return { type: 'Program', body, version: version || 4, id: 0 };
  }

  function parseBlock() { // after header: NL INDENT stmts DEDENT
    const t0 = peek();
    if (peek().t === 'nl') p++;
    if (peek().t !== 'indent') err('متوقع كتلة بمسافة بادئة (expected indented block)');
    p++;
    const stmts = [];
    skipNl();
    while (peek().t !== 'dedent' && peek().t !== 'eof') { stmts.push(parseStatement()); skipNl(); }
    if (peek().t === 'dedent') p++;
    return N('Block', t0, { body: stmts });
  }

  function isFuncDecl() {
    if (peek().t !== 'id' || !isOp('(', 1)) return false;
    let i = p + 2, d = 1;
    while (d > 0) {
      const t = toks[i];
      if (t.t === 'eof') return false;
      if (t.t === 'op') { if (t.v === '(') d++; else if (t.v === ')') d--; }
      i++;
    }
    return toks[i].t === 'op' && toks[i].v === '=>';
  }

  function parseFuncDecl(isMethod, exported) {
    const nameTok = expectId();
    expectOp('(');
    const params = [];
    while (!isOp(')')) {
      let typeName = null;
      const after = scanType(0);
      if (after > 0 && toks[after].t === 'id') typeName = typeStr(parseType());
      const pn = expectId().v;
      let def = null;
      if (isOp('=')) { p++; def = parseExpr(); }
      params.push({ name: pn, typeName, def });
      if (isOp(',')) p++; else break;
    }
    expectOp(')');
    expectOp('=>');
    let body;
    if (peek().t === 'nl') body = parseBlock();
    else { const e = parseExpr(); body = N('Block', nameTok, { body: [N('ExprStmt', nameTok, { expr: e })] }); endStmt(); }
    return N('FuncDecl', nameTok, { name: nameTok.v, params, body, isMethod, exported });
  }

  function parseStatement() {
    const t = peek();
    let exported = false;
    if (t.t === 'id' && t.v === 'export' && (peek(1).t === 'id')) { p++; exported = true; }
    const t1 = peek();
    if (t1.t === 'kw' && t1.v === 'import') {
      p++;
      let path = '';
      while (peek().t !== 'nl' && peek().t !== 'eof' && !(isId('as'))) path += next().v;
      let alias = null;
      if (isId('as')) { p++; alias = expectId().v; }
      endStmt();
      return N('Import', t1, { path, alias });
    }
    if (t1.t === 'id' && t1.v === 'type' && peek(1).t === 'id' && peek(2).t === 'nl' && peek(3).t === 'indent') {
      p++; const name = next().v; p++; p++;
      const fields = [];
      skipNl();
      while (peek().t !== 'dedent' && peek().t !== 'eof') {
        if (isKw('varip') || isKw('var')) p++;
        const ft = typeStr(parseType());
        const fn = expectId().v;
        let def = null;
        if (isOp('=')) { p++; def = parseExpr(); }
        fields.push({ name: fn, typeName: ft, def });
        endStmt(); skipNl();
      }
      if (peek().t === 'dedent') p++;
      return N('TypeDecl', t1, { name, fields });
    }
    if (t1.t === 'id' && t1.v === 'enum' && peek(1).t === 'id' && peek(2).t === 'nl' && peek(3).t === 'indent') {
      p++; const name = next().v; p++; p++;
      const fields = [];
      skipNl();
      while (peek().t !== 'dedent' && peek().t !== 'eof') {
        const fn = expectId().v;
        let title = fn;
        if (isOp('=')) { p++; title = next().v; }
        fields.push({ name: fn, title });
        endStmt(); skipNl();
      }
      if (peek().t === 'dedent') p++;
      return N('EnumDecl', t1, { name, fields });
    }
    if (t1.t === 'id' && t1.v === 'method' && peek(1).t === 'id' && isOp('(', 2)) { p++; return parseFuncDecl(true, exported); }
    if (isFuncDecl()) return parseFuncDecl(false, exported);
    if (t1.t === 'kw' && (t1.v === 'var' || t1.v === 'varip')) {
      p++;
      let typeName = null;
      const after = scanType(0);
      if (after > 0 && toks[after].t === 'id' && toks[after + 1].t === 'op' && toks[after + 1].v === '=') typeName = typeStr(parseType());
      if (isOp('[')) return parseTupleDecl(t1.v);
      const nameTok = expectId();
      expectOp('=');
      const init = parseExpr();
      endStmt();
      return N('VarDecl', nameTok, { kind: t1.v, typeName, name: nameTok.v, init });
    }
    if (t1.t === 'kw' && t1.v === 'break') { p++; endStmt(); return N('Break', t1, {}); }
    if (t1.t === 'kw' && t1.v === 'continue') { p++; endStmt(); return N('Continue', t1, {}); }
    // typed declaration: Type name = expr
    if (t1.t === 'id') {
      const after = scanType(0);
      if (after > 0 && after > p + 0 && toks[after].t === 'id' && toks[after + 1].t === 'op' && toks[after + 1].v === '=' && after !== p + 1 - 1) {
        // make sure it is not "a = b" (single id) — scanType consumed at least one id and next is another id
        const typeName = typeStr(parseType());
        const nameTok = expectId();
        expectOp('=');
        const init = parseExpr();
        endStmt();
        return N('VarDecl', nameTok, { kind: null, typeName, name: nameTok.v, init });
      }
    }
    // tuple declaration
    if (isOp('[')) {
      let i = p + 1, ok = true;
      while (true) {
        if (toks[i].t !== 'id') { ok = false; break; }
        i++;
        if (toks[i].t === 'op' && toks[i].v === ',') { i++; continue; }
        if (toks[i].t === 'op' && toks[i].v === ']') { i++; break; }
        ok = false; break;
      }
      if (ok && toks[i].t === 'op' && (toks[i].v === '=' || toks[i].v === ':=')) return parseTupleDecl(null);
    }
    if (t1.t === 'id' && isOp('=', 1)) {
      p += 2;
      const init = parseExpr();
      endStmt();
      return N('VarDecl', t1, { kind: null, typeName: null, name: t1.v, init });
    }
    // assignment (possibly member chain)
    if (t1.t === 'id') {
      let i = p + 1;
      while (toks[i].t === 'op' && toks[i].v === '.' && toks[i + 1].t === 'id') i += 2;
      const at = toks[i];
      if (at.t === 'op' && [':=', '+=', '-=', '*=', '/=', '%='].includes(at.v)) {
        let target = N('Ident', t1, { name: t1.v }); p++;
        while (isOp('.')) { const dt = next(); const prop = expectId().v; target = N('Member', dt, { object: target, prop }); }
        const op = next().v;
        const value = parseExpr();
        endStmt();
        return N('Assign', t1, { target, op, value });
      }
    }
    const e = parseExpr();
    endStmt();
    return N('ExprStmt', t1, { expr: e });
  }

  function parseTupleDecl(kind) {
    const t0 = expectOp('[');
    const names = [];
    while (!isOp(']')) { names.push(expectId().v); if (isOp(',')) p++; }
    p++;
    const op = next().v;
    const init = parseExpr();
    endStmt();
    return N('TupleDecl', t0, { names, init, kind, reassign: op === ':=' });
  }

  // ---- expressions -------------------------------------------------------
  function parseExpr() { return parseTernary(); }
  function parseTernary() {
    const c = parseOr();
    if (isOp('?')) {
      const t = next();
      const a = parseTernary();
      expectOp(':');
      const b = parseTernary();
      return N('Ternary', t, { cond: c, a, b });
    }
    return c;
  }
  function parseOr() {
    let l = parseAnd();
    while (isKw('or')) { const t = next(); l = N('Logical', t, { op: 'or', left: l, right: parseAnd() }); }
    return l;
  }
  function parseAnd() {
    let l = parseEq();
    while (isKw('and')) { const t = next(); l = N('Logical', t, { op: 'and', left: l, right: parseEq() }); }
    return l;
  }
  function parseEq() {
    let l = parseRel();
    while (isOp('==') || isOp('!=')) { const t = next(); l = N('Binary', t, { op: t.v, left: l, right: parseRel() }); }
    return l;
  }
  function parseRel() {
    let l = parseAdd();
    while (isOp('<') || isOp('>') || isOp('<=') || isOp('>=')) { const t = next(); l = N('Binary', t, { op: t.v, left: l, right: parseAdd() }); }
    return l;
  }
  function parseAdd() {
    let l = parseMul();
    while (isOp('+') || isOp('-')) { const t = next(); l = N('Binary', t, { op: t.v, left: l, right: parseMul() }); }
    return l;
  }
  function parseMul() {
    let l = parseUnary();
    while (isOp('*') || isOp('/') || isOp('%')) { const t = next(); l = N('Binary', t, { op: t.v, left: l, right: parseUnary() }); }
    return l;
  }
  function parseUnary() {
    if (isOp('-') || isOp('+')) { const t = next(); return N('Unary', t, { op: t.v, arg: parseUnary() }); }
    if (isKw('not')) { const t = next(); return N('Unary', t, { op: 'not', arg: parseUnary() }); }
    return parsePostfix();
  }
  function genericAhead() { // at '<' after member .new → type args then '('
    let i = p, d = 0;
    if (!(toks[i].t === 'op' && toks[i].v === '<')) return false;
    do {
      const t = toks[i];
      if (t.t === 'op' && t.v === '<') d++;
      else if (t.t === 'op' && t.v === '>') d--;
      else if (!(t.t === 'id' || (t.t === 'op' && (t.v === ',' || t.v === '.' || t.v === '[' || t.v === ']')))) return false;
      i++;
    } while (d > 0 && i < toks.length);
    return toks[i].t === 'op' && toks[i].v === '(';
  }
  function parsePostfix() {
    let e = parsePrimary();
    for (;;) {
      if (isOp('(')) {
        const t = next();
        const { args, named } = parseArgs();
        e = N('Call', t, { callee: e, args, named, typeArgs: null });
      } else if (isOp('.') && peek(1).t === 'id') {
        const t = next(); const prop = next().v;
        e = N('Member', t, { object: e, prop });
      } else if (isOp('<') && e.type === 'Member' && /^new/.test(e.prop) && genericAhead()) {
        p++;
        const ta = [];
        while (!isOp('>')) { ta.push(typeStr(parseType())); if (isOp(',')) p++; }
        p++;
        const t = expectOp('(');
        const { args, named } = parseArgs();
        e = N('Call', t, { callee: e, args, named, typeArgs: ta });
      } else if (isOp('[')) {
        const t = next();
        const idx = parseExpr();
        expectOp(']');
        e = N('Index', t, { object: e, index: idx });
      } else break;
    }
    return e;
  }
  function parseArgs() {
    const args = [], named = {};
    while (!isOp(')')) {
      if (peek().t === 'id' && isOp('=', 1)) {
        const n = next().v; p++;
        named[n] = parseExpr();
      } else {
        if (Object.keys(named).length) { /* positional after named — tolerated */ }
        args.push(parseExpr());
      }
      if (isOp(',')) p++; else if (!isOp(')')) err(`متوقع ',' أو ')'`);
    }
    p++;
    return { args, named };
  }
  function parsePrimary() {
    const t = peek();
    if (t.t === 'num') { p++; return N('Num', t, { value: t.v, isInt: t.isInt }); }
    if (t.t === 'str') { p++; return N('Str', t, { value: t.v }); }
    if (t.t === 'color') { p++; return N('Color', t, { value: t.v }); }
    if (t.t === 'kw') {
      if (t.v === 'true' || t.v === 'false') { p++; return N('Bool', t, { value: t.v === 'true' }); }
      if (t.v === 'if') return parseIf();
      if (t.v === 'switch') return parseSwitch();
      if (t.v === 'for') return parseFor();
      if (t.v === 'while') return parseWhile();
    }
    if (t.t === 'id') { p++; return N('Ident', t, { name: t.v }); }
    if (t.t === 'op' && t.v === '(') { p++; const e = parseExpr(); expectOp(')'); return e; }
    if (t.t === 'op' && t.v === '[') {
      p++;
      const items = [];
      while (!isOp(']')) { items.push(parseExpr()); if (isOp(',')) p++; else break; }
      expectOp(']');
      return N('TupleLit', t, { items });
    }
    if (t.t === 'nl') err('تعبير غير مكتمل (incomplete expression)');
    err(`تعبير غير متوقع '${t.v ?? t.t}'`);
  }
  function parseIf() {
    const t = next();
    const cond = parseExpr();
    const then = parseBlock();
    let els = null;
    if (isKw('else')) {
      p++;
      if (isKw('if')) els = parseIf();
      else els = parseBlock();
    }
    return N('If', t, { cond, then, els });
  }
  function parseSwitch() {
    const t = next();
    let subject = null;
    if (peek().t !== 'nl') subject = parseExpr();
    if (peek().t === 'nl') p++;
    if (peek().t !== 'indent') err('متوقع حالات switch');
    p++;
    const cases = [];
    skipNl();
    while (peek().t !== 'dedent' && peek().t !== 'eof') {
      const ct = peek();
      let cond = null;
      if (isOp('=>')) p++;
      else { cond = parseExpr(); expectOp('=>'); }
      let body;
      if (peek().t === 'nl') body = parseBlock();
      else { const e = parseExpr(); body = N('Block', ct, { body: [N('ExprStmt', ct, { expr: e })] }); endStmt(); }
      cases.push({ cond, body });
      skipNl();
    }
    if (peek().t === 'dedent') p++;
    return N('Switch', t, { subject, cases });
  }
  function parseFor() {
    const t = next();
    if (isOp('[')) {
      p++; const a = expectId().v; expectOp(','); const b = expectId().v; expectOp(']');
      if (!isId('in')) err("متوقع 'in'");
      p++;
      const iter = parseExpr();
      const body = parseBlock();
      return N('ForIn', t, { names: [a, b], iter, body });
    }
    const vn = expectId().v;
    if (isId('in')) {
      p++;
      const iter = parseExpr();
      const body = parseBlock();
      return N('ForIn', t, { names: [vn], iter, body });
    }
    expectOp('=');
    const from = parseExpr();
    if (!isId('to')) err("متوقع 'to' في حلقة for");
    p++;
    const to = parseExpr();
    let step = null;
    if (isId('by')) { p++; step = parseExpr(); }
    const body = parseBlock();
    return N('For', t, { name: vn, from, to, step, body });
  }
  function parseWhile() {
    const t = next();
    const cond = parseExpr();
    const body = parseBlock();
    return N('While', t, { cond, body });
  }

  const prog = parseProgram();
  prog.nodeCount = nodeId;
  return prog;
}

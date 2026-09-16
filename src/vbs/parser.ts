import type { BinaryOp, CaseTest, ClassDecl, Expr, Param, ProcDecl, Program, Span, Stmt } from './ast';
import { tokenize, VbsSyntaxError, type Token } from './lexer';

export { VbsSyntaxError };

/** Keywords that close a block, and so can follow a statement without a separator. */
const BLOCK_ENDERS = new Set(['end', 'next', 'loop', 'wend', 'else', 'elseif', 'case']);

export function parse(src: string): Program {
  return new Parser(tokenize(src)).parseProgram();
}

class Parser {
  private pos = 0;
  private procs: ProcDecl[] = [];
  private classes: ClassDecl[] = [];

  constructor(private tokens: Token[]) {}

  // ---- token helpers ----
  private peek(offset = 0): Token { return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]; }
  private next(): Token { return this.tokens[this.pos++]; }
  private is(type: 'kw' | 'op' | 'ident' | 'eol' | 'eof', value?: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.type === type && (value === undefined || t.value === value);
  }
  private isKw(value: string, offset = 0) { return this.is('kw', value, offset); }
  private isOp(value: string, offset = 0) { return this.is('op', value, offset); }
  private accept(type: 'kw' | 'op' | 'ident' | 'eol', value?: string): Token | null {
    if (this.is(type, value)) return this.next();
    return null;
  }
  private expect(type: 'kw' | 'op' | 'ident' | 'eol' | 'num', value?: string): Token {
    const t = this.peek();
    if (t.type === type && (value === undefined || t.value === value)) return this.next();
    throw new VbsSyntaxError(`Expected ${value ?? type} but found ${this.describe(t)}`, t.span);
  }
  private describe(t: Token): string {
    if (t.type === 'eof') return 'end of script';
    if (t.type === 'eol') return t.value === ':' ? "':'" : 'end of line';
    return `'${t.raw}'`;
  }
  private error(msg: string, span?: Span): never { throw new VbsSyntaxError(msg, span ?? this.peek().span); }
  private skipEols() { while (this.is('eol')) this.next(); }
  private endStatement() {
    if (this.is('eof')) return;
    if (this.is('eol')) {
      // consume one statement terminator (extra blank lines are skipped by the block parser)
      this.next();
      return;
    }
    // VBScript lets a keyword that closes a block end the statement before it with no separator,
    // as in "Public Property Get State(): State = m_state End Property". Leave it for the block
    // parser to consume.
    if (this.peek().type === 'kw' && BLOCK_ENDERS.has(this.peek().value)) return;
    this.error(`Unexpected ${this.describe(this.peek())}`);
  }
  private spanFrom(start: Span): Span { return { start: start.start, end: this.tokens[this.pos - 1].span.end, line: start.line }; }
  private identName(): string {
    const t = this.peek();
    if (t.type === 'ident') { this.next(); return t.value; }
    // Some keywords are legal member/variable names in practice (e.g. "Get", "Step", "Default", "Error").
    if (t.type === 'kw' && ['get', 'let', 'step', 'default', 'error', 'property', 'next', 'stop', 'resume', 'explicit', 'preserve', 'in', 'to'].includes(t.value)) { this.next(); return t.value; }
    this.error(`Expected identifier but found ${this.describe(t)}`);
  }

  // ---- program ----
  parseProgram(): Program {
    const body = this.parseBlock(() => this.is('eof'));
    if (!this.is('eof')) this.error(`Unexpected ${this.describe(this.peek())}`);
    return { body, procs: this.procs, classes: this.classes };
  }

  private parseBlock(isEnd: () => boolean): Stmt[] {
    const stmts: Stmt[] = [];
    for (;;) {
      this.skipEols();
      if (this.is('eof') || isEnd()) return stmts;
      const s = this.parseStatement();
      if (s) stmts.push(s);
    }
  }

  private parseStatement(): Stmt | null {
    const t = this.peek();
    const span = t.span;
    if (t.type === 'kw') {
      switch (t.value) {
        case 'dim': this.next(); return this.parseDim(span);
        case 'redim': return this.parseRedim();
        case 'const': this.next(); return this.parseConst(span, 'public');
        case 'set': return this.parseAssignOrCall(true);
        case 'call': {
          this.next();
          const e = this.parsePostfix();
          this.endStatement();
          if (e.kind === 'call') return { kind: 'call', callee: e.callee, args: e.args, span: this.spanFrom(span) };
          return { kind: 'call', callee: e, args: [], span: this.spanFrom(span) };
        }
        case 'if': return this.parseIf();
        case 'for': return this.parseFor();
        case 'do': return this.parseDo();
        case 'while': return this.parseWhile();
        case 'select': return this.parseSelect();
        case 'with': return this.parseWith();
        case 'exit': {
          this.next();
          const w = this.next();
          if (!['sub', 'function', 'for', 'do', 'property'].includes(w.value)) this.error('Expected Sub, Function, For, Do or Property after Exit', w.span);
          this.endStatement();
          return { kind: 'exit', what: w.value as 'sub', span: this.spanFrom(span) };
        }
        case 'on': {
          this.next();
          this.expect('kw', 'error');
          if (this.accept('kw', 'resume')) { this.expect('kw', 'next'); this.endStatement(); return { kind: 'onerror', resumeNext: true, span: this.spanFrom(span) }; }
          this.expect('kw', 'goto');
          this.expect('num');
          this.endStatement();
          return { kind: 'onerror', resumeNext: false, span: this.spanFrom(span) };
        }
        case 'option': { this.next(); this.expect('kw', 'explicit'); this.endStatement(); return null; }
        case 'randomize': {
          this.next();
          if (!this.is('eol') && !this.is('eof')) this.parseExpr();
          this.endStatement();
          return { kind: 'randomize', span: this.spanFrom(span) };
        }
        case 'erase': { this.next(); const name = this.identName(); this.endStatement(); return { kind: 'erase', name, span: this.spanFrom(span) }; }
        case 'stop': { this.next(); this.endStatement(); return { kind: 'noop', span }; }
        case 'public': case 'private': {
          this.next();
          const access = t.value as 'public' | 'private';
          if (this.isKw('const')) { this.next(); return this.parseConst(span, access); }
          if (this.isKw('sub') || this.isKw('function') || this.isKw('default') || this.isKw('property')) {
            const proc = this.parseProc(access);
            this.procs.push(proc);
            return { kind: 'proc', proc, span: proc.span };
          }
          return this.parseDim(span);
        }
        case 'sub': case 'function': case 'default': case 'property': {
          const proc = this.parseProc('public');
          this.procs.push(proc);
          return { kind: 'proc', proc, span: proc.span };
        }
        case 'class': {
          const decl = this.parseClass();
          this.classes.push(decl);
          return { kind: 'class', decl, span: decl.span };
        }
        case 'end': case 'else': case 'elseif': case 'next': case 'loop': case 'wend': case 'case':
          this.error(`Unexpected '${t.raw}'`);
      }
    }
    if (t.type === 'ident' || (t.type === 'op' && t.value === '.')) return this.parseAssignOrCall(false);
    if (t.type === 'kw' && ['get', 'let', 'step', 'error', 'next', 'stop', 'resume'].includes(t.value)) return this.parseAssignOrCall(false);
    this.error(`Unexpected ${this.describe(t)}`);
  }

  private parseDim(span: Span): Stmt {
    const vars: { name: string; dims: Expr[] | null; span: Span }[] = [];
    do {
      const nt = this.peek();
      const name = this.identName();
      let dims: Expr[] | null = null;
      if (this.accept('op', '(')) {
        dims = [];
        if (!this.isOp(')')) {
          do { dims.push(this.parseExpr()); } while (this.accept('op', ','));
        }
        this.expect('op', ')');
      }
      vars.push({ name, dims, span: this.spanFrom(nt.span) });
    } while (this.accept('op', ','));
    this.endStatement();
    return { kind: 'dim', vars, span: this.spanFrom(span) };
  }

  private parseRedim(inline = false): Stmt {
    const span = this.next().span;
    const preserve = !!this.accept('kw', 'preserve');
    // "ReDim a(2), b(3), c(4)" declares several arrays in one statement
    const decls: { name: string; dims: Expr[] }[] = [];
    do {
      const name = this.identName();
      this.expect('op', '(');
      const dims: Expr[] = [];
      do { dims.push(this.parseExpr()); } while (this.accept('op', ','));
      this.expect('op', ')');
      decls.push({ name, dims });
    } while (this.accept('op', ','));
    if (!inline) this.endStatement();
    return { kind: 'redim', preserve, decls, span: this.spanFrom(span) };
  }

  private parseConst(span: Span, _access: string): Stmt {
    // Const a = 1, b = 2 declares several constants; represent extras as inline assignments
    const decls: { name: string; value: Expr }[] = [];
    do {
      const name = this.identName();
      this.expect('op', '=');
      decls.push({ name, value: this.parseExpr() });
    } while (this.accept('op', ','));
    this.endStatement();
    if (decls.length === 1) return { kind: 'const', name: decls[0].name, value: decls[0].value, span: this.spanFrom(span) };
    return { kind: 'constlist', decls, span: this.spanFrom(span) };
  }

  private parseAssignOrCall(isSet: boolean): Stmt {
    const span = this.peek().span;
    if (isSet) this.next();
    const target = this.parsePostfix();
    if (this.accept('op', '=')) {
      const value = this.parseExpr();
      this.endStatement();
      return { kind: 'assign', target, value, isSet, span: this.spanFrom(span) };
    }
    if (isSet) this.error("Expected '=' in Set statement");
    // Call statement without parentheses: "obj.Method arg1, arg2"
    let callee: Expr = target;
    let args: (Expr | null)[] = [];
    if (target.kind === 'call') {
      callee = target.callee;
      args = target.args;
    }
    if (!this.is('eol') && !this.is('eof')) {
      if (target.kind === 'call') {
        // "Foo (a), b" — the parenthesised part was the first argument
        if (args.length !== 1) this.error(`Unexpected ${this.describe(this.peek())}`);
        args = [args[0]];
        this.expect('op', ',');
      }
      args = args.concat(this.parseArgList(() => this.is('eol') || this.is('eof')));
    }
    this.endStatement();
    return { kind: 'call', callee, args, span: this.spanFrom(span) };
  }

  private parseArgList(isEnd: () => boolean): (Expr | null)[] {
    const args: (Expr | null)[] = [];
    if (isEnd()) return args;
    for (;;) {
      if (this.isOp(',')) { args.push(null); this.next(); continue; }
      args.push(this.parseExpr());
      if (this.accept('op', ',')) { if (isEnd()) { args.push(null); return args; } continue; }
      return args;
    }
  }

  private parseIf(): Stmt {
    const span = this.next().span;
    const cond = this.parseExpr();
    this.expect('kw', 'then');
    const branches: { cond: Expr; body: Stmt[] }[] = [];
    if (this.is('eol') && this.peek().value === '\n') {
      // Block form
      const body = this.parseBlock(() => this.isKw('elseif') || this.isKw('else') || this.isKw('end'));
      branches.push({ cond, body });
      let elseBody: Stmt[] | null = null;
      for (;;) {
        if (this.accept('kw', 'elseif')) {
          const c = this.parseExpr();
          this.expect('kw', 'then');
          const b = this.parseBlock(() => this.isKw('elseif') || this.isKw('else') || this.isKw('end'));
          branches.push({ cond: c, body: b });
          continue;
        }
        if (this.accept('kw', 'else')) {
          elseBody = this.parseBlock(() => this.isKw('end'));
          continue;
        }
        this.expect('kw', 'end');
        this.expect('kw', 'if');
        this.endStatement();
        return { kind: 'if', branches, elseBody, span: this.spanFrom(span) };
      }
    }
    // Single line form: If c Then s1 : s2 Else s3 : s4
    const body = this.parseInlineStatements();
    branches.push({ cond, body });
    let elseBody: Stmt[] | null = null;
    if (this.accept('kw', 'else')) elseBody = this.parseInlineStatements();
    if (this.isKw('end') && this.isKw('if', 1)) { this.next(); this.next(); }
    this.endStatement();
    return { kind: 'if', branches, elseBody, span: this.spanFrom(span) };
  }

  private parseInlineStatements(): Stmt[] {
    const stmts: Stmt[] = [];
    for (;;) {
      if (this.is('eol', ':')) { this.next(); continue; }
      if (this.is('eol') || this.is('eof') || this.isKw('else') || (this.isKw('end') && this.isKw('if', 1))) return stmts;
      // A statement consumes its terminator; inline statements share the line so re-check afterwards
      const before = this.pos;
      const s = this.parseInlineStatement();
      if (s) stmts.push(s);
      if (this.pos === before) this.error('Could not parse statement');
    }
  }

  // Parses one statement that ends at ':' , end-of-line or Else (without consuming an end-of-line)
  private parseInlineStatement(): Stmt | null {
    // Temporarily treat Else / End If as terminators by parsing with a bounded token view
    const t = this.peek();
    const span = t.span;
    if (t.type === 'kw' && t.value === 'exit') {
      this.next();
      const w = this.next();
      return { kind: 'exit', what: w.value as 'sub', span: this.spanFrom(span) };
    }
    if (t.type === 'kw' && t.value === 'if') {
      // nested single-line if
      this.next();
      const cond = this.parseExpr();
      this.expect('kw', 'then');
      const body = this.parseInlineStatements();
      let elseBody: Stmt[] | null = null;
      if (this.accept('kw', 'else')) elseBody = this.parseInlineStatements();
      // "If a Then If b Then c End If End If": the inner If closes itself, leaving the outer one its own End If
      if (this.isKw('end') && this.isKw('if', 1)) { this.next(); this.next(); }
      return { kind: 'if', branches: [{ cond, body }], elseBody, span: this.spanFrom(span) };
    }
    const isSet = t.type === 'kw' && t.value === 'set';
    if (isSet) this.next();
    else if (t.type === 'kw' && t.value === 'call') {
      this.next();
      const e = this.parsePostfix();
      if (e.kind === 'call') return { kind: 'call', callee: e.callee, args: e.args, span: this.spanFrom(span) };
      return { kind: 'call', callee: e, args: [], span: this.spanFrom(span) };
    } else if (t.type === 'kw' && t.value === 'redim') {
      return this.parseRedim(true);
    } else if (t.type === 'kw' && t.value === 'erase') {
      this.next();
      const name = this.identName();
      return { kind: 'erase', name, span: this.spanFrom(span) };
    } else if (t.type === 'kw' && t.value === 'dim') {
      this.next();
      const vars: { name: string; dims: Expr[] | null; span: Span }[] = [];
      do { const nt = this.peek(); const name = this.identName(); vars.push({ name, dims: null, span: nt.span }); } while (this.accept('op', ','));
      return { kind: 'dim', vars, span: this.spanFrom(span) };
    } else if (t.type === 'kw' && !['get', 'let', 'step', 'error', 'next', 'stop', 'resume'].includes(t.value)) {
      this.error(`Unexpected ${this.describe(t)} in single-line If`);
    }
    const target = this.parsePostfix();
    if (this.accept('op', '=')) {
      const value = this.parseExpr();
      return { kind: 'assign', target, value, isSet, span: this.spanFrom(span) };
    }
    let callee: Expr = target;
    let args: (Expr | null)[] = [];
    if (target.kind === 'call') { callee = target.callee; args = target.args; }
    const isEnd = () => this.is('eol') || this.is('eof') || this.isKw('else') || (this.isKw('end') && this.isKw('if', 1));
    if (!isEnd()) {
      if (target.kind === 'call') { this.expect('op', ','); }
      args = args.concat(this.parseArgList(isEnd));
    }
    return { kind: 'call', callee, args, span: this.spanFrom(span) };
  }

  private parseFor(): Stmt {
    const span = this.next().span;
    if (this.accept('kw', 'each')) {
      const varName = this.identName();
      this.expect('kw', 'in');
      const collection = this.parseExpr();
      this.endStatement();
      const body = this.parseBlock(() => this.isKw('next'));
      this.expect('kw', 'next');
      if (this.is('ident')) this.next();
      this.endStatement();
      return { kind: 'foreach', varName, collection, body, span: this.spanFrom(span) };
    }
    const varName = this.identName();
    this.expect('op', '=');
    const from = this.parseExpr();
    this.expect('kw', 'to');
    const to = this.parseExpr();
    let step: Expr | null = null;
    if (this.accept('kw', 'step')) step = this.parseExpr();
    this.endStatement();
    const body = this.parseBlock(() => this.isKw('next'));
    this.expect('kw', 'next');
    if (this.is('ident')) this.next();
    this.endStatement();
    return { kind: 'for', varName, from, to, step, body, span: this.spanFrom(span) };
  }

  private parseDo(): Stmt {
    const span = this.next().span;
    let preCond: { until: boolean; cond: Expr } | null = null;
    let postCond: { until: boolean; cond: Expr } | null = null;
    if (this.isKw('while') || this.isKw('until')) {
      const until = this.next().value === 'until';
      preCond = { until, cond: this.parseExpr() };
    }
    this.endStatement();
    const body = this.parseBlock(() => this.isKw('loop'));
    this.expect('kw', 'loop');
    if (this.isKw('while') || this.isKw('until')) {
      const until = this.next().value === 'until';
      postCond = { until, cond: this.parseExpr() };
    }
    this.endStatement();
    return { kind: 'do', preCond, postCond, body, span: this.spanFrom(span) };
  }

  private parseWhile(): Stmt {
    const span = this.next().span;
    const cond = this.parseExpr();
    this.endStatement();
    const body = this.parseBlock(() => this.isKw('wend'));
    this.expect('kw', 'wend');
    this.endStatement();
    return { kind: 'while', cond, body, span: this.spanFrom(span) };
  }

  private parseSelect(): Stmt {
    const span = this.next().span;
    this.expect('kw', 'case');
    const subject = this.parseExpr();
    this.endStatement();
    const cases: { tests: CaseTest[] | null; body: Stmt[] }[] = [];
    this.skipEols();
    while (this.accept('kw', 'case')) {
      let tests: CaseTest[] | null = null;
      if (this.accept('kw', 'else')) {
        tests = null;
      } else {
        tests = [];
        do {
          if (this.accept('kw', 'is')) {
            const opTok = this.next();
            if (opTok.type !== 'op' || !['=', '<>', '<', '>', '<=', '>='].includes(opTok.value)) this.error('Expected comparison operator after Is', opTok.span);
            tests.push({ kind: 'is', op: opTok.value as BinaryOp, expr: this.parseExpr() });
          } else {
            const lo = this.parseExpr();
            if (this.accept('kw', 'to')) tests.push({ kind: 'range', lo, hi: this.parseExpr() });
            else tests.push({ kind: 'eq', expr: lo });
          }
        } while (this.accept('op', ','));
      }
      if (this.is('eol', ':')) this.next();
      const body = this.parseBlock(() => this.isKw('case') || this.isKw('end'));
      cases.push({ tests, body });
      this.skipEols();
    }
    this.expect('kw', 'end');
    this.expect('kw', 'select');
    this.endStatement();
    return { kind: 'select', subject, cases, span: this.spanFrom(span) };
  }

  private parseWith(): Stmt {
    const span = this.next().span;
    const object = this.parseExpr();
    this.endStatement();
    const body = this.parseBlock(() => this.isKw('end') && this.isKw('with', 1));
    this.expect('kw', 'end');
    this.expect('kw', 'with');
    this.endStatement();
    return { kind: 'with', object, body, span: this.spanFrom(span) };
  }

  private parseProc(access: 'public' | 'private'): ProcDecl {
    const span = this.peek().span;
    const isDefault = !!this.accept('kw', 'default');
    let propertyKind: 'get' | 'let' | 'set' | undefined;
    let isFunction: boolean;
    if (this.accept('kw', 'property')) {
      const k = this.next();
      if (!['get', 'let', 'set'].includes(k.value)) this.error('Expected Get, Let or Set after Property', k.span);
      propertyKind = k.value as 'get';
      isFunction = propertyKind === 'get';
    } else {
      const k = this.next();
      if (k.value !== 'sub' && k.value !== 'function') this.error('Expected Sub or Function', k.span);
      isFunction = k.value === 'function';
    }
    const displayName = this.peek().raw;
    const name = this.identName();
    const params: Param[] = [];
    if (this.accept('op', '(')) {
      if (!this.isOp(')')) {
        do {
          const pt = this.peek();
          let byRef = true;
          if (this.accept('kw', 'byval')) byRef = false;
          else if (this.accept('kw', 'byref')) byRef = true;
          const pname = this.identName();
          if (this.accept('op', '(')) this.expect('op', ')');
          params.push({ name: pname, byRef, span: this.spanFrom(pt.span) });
        } while (this.accept('op', ','));
      }
      this.expect('op', ')');
    }
    this.endStatement();
    const body = this.parseBlock(() => this.isKw('end') && (this.isKw('sub', 1) || this.isKw('function', 1) || this.isKw('property', 1)));
    this.expect('kw', 'end');
    this.next();
    this.endStatement();
    return { name, displayName, isFunction, params, body, span: this.spanFrom(span), isDefault, access, propertyKind };
  }

  private parseClass(): ClassDecl {
    const span = this.next().span;
    const name = this.identName();
    this.endStatement();
    const members: ClassDecl['members'] = [];
    const procs: ProcDecl[] = [];
    for (;;) {
      this.skipEols();
      if (this.isKw('end') && this.isKw('class', 1)) { this.next(); this.next(); this.endStatement(); break; }
      const t = this.peek();
      let access: 'public' | 'private' = 'public';
      if (t.type === 'kw' && (t.value === 'public' || t.value === 'private')) {
        access = t.value;
        this.next();
      }
      if (this.isKw('sub') || this.isKw('function') || this.isKw('default') || this.isKw('property')) {
        procs.push(this.parseProc(access));
        continue;
      }
      if (this.accept('kw', 'dim') || t.type === 'ident' || (t.type === 'kw' && (t.value === 'public' || t.value === 'private'))) {
        const names: string[] = [];
        do {
          names.push(this.identName());
          if (this.accept('op', '(')) { if (!this.isOp(')')) { do { this.parseExpr(); } while (this.accept('op', ',')); } this.expect('op', ')'); }
        } while (this.accept('op', ','));
        this.endStatement();
        members.push({ kind: 'field', names, access });
        continue;
      }
      this.error(`Unexpected ${this.describe(t)} in class body`);
    }
    return { name, members, procs, span: this.spanFrom(span) };
  }

  // ---- expressions ----
  parseExpr(): Expr { return this.parseImp(); }

  private binaryLevel(next: () => Expr, ops: string[], type: 'kw' | 'op'): Expr {
    let left = next();
    for (;;) {
      const t = this.peek();
      if (t.type === type && ops.includes(t.value)) {
        this.next();
        const right = next();
        left = { kind: 'binary', op: t.value as BinaryOp, left, right, span: { start: left.span.start, end: right.span.end, line: left.span.line } };
      } else return left;
    }
  }

  private parseImp(): Expr { return this.binaryLevel(() => this.parseEqv(), ['imp'], 'kw'); }
  private parseEqv(): Expr { return this.binaryLevel(() => this.parseXor(), ['eqv'], 'kw'); }
  private parseXor(): Expr { return this.binaryLevel(() => this.parseOr(), ['xor'], 'kw'); }
  private parseOr(): Expr { return this.binaryLevel(() => this.parseAnd(), ['or'], 'kw'); }
  private parseAnd(): Expr { return this.binaryLevel(() => this.parseNot(), ['and'], 'kw'); }
  private parseNot(): Expr {
    const t = this.peek();
    if (t.type === 'kw' && t.value === 'not') {
      this.next();
      const operand = this.parseNot();
      return { kind: 'unary', op: 'not', operand, span: { start: t.span.start, end: operand.span.end, line: t.span.line } };
    }
    return this.parseComparison();
  }
  private parseComparison(): Expr {
    let left = this.parseConcat();
    for (;;) {
      const t = this.peek();
      if ((t.type === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.value)) || (t.type === 'kw' && t.value === 'is')) {
        this.next();
        const right = this.parseConcat();
        left = { kind: 'binary', op: t.value as BinaryOp, left, right, span: { start: left.span.start, end: right.span.end, line: left.span.line } };
      } else return left;
    }
  }
  private parseConcat(): Expr { return this.binaryLevel(() => this.parseAdditive(), ['&'], 'op'); }
  private parseAdditive(): Expr { return this.binaryLevel(() => this.parseMod(), ['+', '-'], 'op'); }
  private parseMod(): Expr { return this.binaryLevel(() => this.parseIntDiv(), ['mod'], 'kw'); }
  private parseIntDiv(): Expr { return this.binaryLevel(() => this.parseMultiplicative(), ['\\'], 'op'); }
  private parseMultiplicative(): Expr { return this.binaryLevel(() => this.parseUnary(), ['*', '/'], 'op'); }
  private parseUnary(): Expr {
    const t = this.peek();
    if (t.type === 'op' && (t.value === '-' || t.value === '+')) {
      this.next();
      const operand = this.parseUnary();
      return { kind: 'unary', op: t.value, operand, span: { start: t.span.start, end: operand.span.end, line: t.span.line } };
    }
    return this.parsePower();
  }
  private parsePower(): Expr {
    let left = this.parsePostfix();
    while (this.isOp('^')) {
      this.next();
      const right = this.parseUnary();
      left = { kind: 'binary', op: '^', left, right, span: { start: left.span.start, end: right.span.end, line: left.span.line } };
    }
    return left;
  }

  parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      if (this.isOp('.')) {
        this.next();
        const nt = this.peek();
        if (nt.type !== 'ident' && nt.type !== 'kw') this.error(`Expected member name after '.' but found ${this.describe(nt)}`);
        this.next();
        e = { kind: 'member', object: e, name: nt.value, span: { start: e.span.start, end: nt.span.end, line: e.span.line } };
        continue;
      }
      if (this.isOp('(')) {
        this.next();
        const args = this.parseArgList(() => this.isOp(')'));
        const close = this.expect('op', ')');
        e = { kind: 'call', callee: e, args, span: { start: e.span.start, end: close.span.end, line: e.span.line } };
        continue;
      }
      return e;
    }
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    switch (t.type) {
      case 'num': this.next(); return { kind: 'number', value: t.num!, span: t.span };
      case 'str': this.next(); return { kind: 'string', value: t.value, span: t.span };
      case 'ident': this.next(); return { kind: 'ident', name: t.value, span: t.span };
      case 'kw':
        switch (t.value) {
          case 'true': this.next(); return { kind: 'bool', value: true, span: t.span };
          case 'false': this.next(); return { kind: 'bool', value: false, span: t.span };
          case 'nothing': this.next(); return { kind: 'nothing', span: t.span };
          case 'empty': this.next(); return { kind: 'empty', span: t.span };
          case 'null': this.next(); return { kind: 'null', span: t.span };
          case 'new': { this.next(); const nameTok = this.expect('ident'); return { kind: 'new', className: nameTok.value, span: this.spanFrom(t.span) }; }
          case 'get': case 'let': case 'step': case 'error': case 'next': case 'stop': case 'resume': case 'default': case 'property': case 'in': case 'to':
            this.next(); return { kind: 'ident', name: t.value, span: t.span };
        }
        break;
      case 'op':
        if (t.value === '(') {
          this.next();
          const inner = this.parseExpr();
          this.expect('op', ')');
          // Keep the inner span: literal spans must cover exactly the literal text so the editor can rewrite them.
          return inner;
        }
        if (t.value === '.') {
          // ".Member" inside a With block
          return { kind: 'with', span: { start: t.span.start, end: t.span.start, line: t.span.line } };
        }
        break;
    }
    this.error(`Unexpected ${this.describe(t)} in expression`);
  }
}

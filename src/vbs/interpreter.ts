import type { CaseTest, ClassDecl, Expr, ProcDecl, Program, Span, Stmt } from './ast';
import { parse, VbsSyntaxError } from './parser';
import { hostCallContext } from './hostcontext';
import { createBuiltins, type Builtin } from './builtins';
import { formatNumber, isObjectValue, isNumericString, roundHalfEven, toBool, toNumber, toStr, typeName, VbArray, VbNull, VbNullType, VbsRuntimeError, type VbValue } from './values';

export { VbsRuntimeError, VbsSyntaxError };

class ExitSignal { constructor(public what: 'sub' | 'function' | 'for' | 'do' | 'property') {} }

export interface HostOptions {
  // Resolves CreateObject(progId)
  createObject?: (progId: string) => VbValue;
  // Extra global objects (e.g. FlexDMD) and functions
  globals?: Record<string, VbValue>;
  // Receives MsgBox / Debug output
  log?: (message: string) => void;
  // Statement budget to abort runaway loops
  maxStatements?: number;
}

export class ProcRef {
  constructor(public decl: ProcDecl, public self: ClassInstance | null) {}
  toString() { return `[Procedure ${this.decl.name}]`; }
}

export class ClassInstance {
  public fields = new Map<string, VbValue>();
  constructor(public decl: ClassDecl) {}
  toString() { return `[object ${this.decl.name}]`; }
}

class Scope {
  vars = new Map<string, VbValue>();
  constructor(public parent: Scope | null, public procName: string | null, public self: ClassInstance | null = null, public returnSlot: string | null = null) {}
  lookup(name: string): Scope | null {
    // VBScript has only two levels: procedure locals and globals
    if (this.vars.has(name)) return this;
    if (this.parent && this.parent.vars.has(name)) return this.parent;
    return null;
  }
}

interface ErrState { number: number; description: string; }

export class Interpreter {
  program: Program | null = null;
  source = '';
  private globalScope = new Scope(null, null);
  private procs = new Map<string, ProcDecl>();
  private classes = new Map<string, ClassDecl>();
  private builtins: Map<string, Builtin>;
  private withStack: VbValue[] = [];
  private onErrorResumeNext = false;
  private err: ErrState = { number: 0, description: '' };
  private statementCount = 0;
  private maxStatements: number;
  private log: (m: string) => void;
  private hostKeyCache = new WeakMap<object, Map<string, string>>();
  private currentSpan: Span | null = null;
  public abortRequested = false;

  constructor(private options: HostOptions = {}) {
    this.maxStatements = options.maxStatements ?? 2_000_000;
    this.log = options.log ?? (() => {});
    this.builtins = createBuiltins({
      log: this.log,
      createObject: (progId) => {
        if (!options.createObject) throw new VbsRuntimeError(`CreateObject is not available for '${progId}' in the previewer`, null, 429);
        return options.createObject(progId);
      },
      err: this.err,
      typeNameOf: (v) => this.typeNameOf(v),
      callValue: (v, args) => this.callValue(v, args),
    });
    for (const [k, v] of Object.entries(options.globals ?? {})) this.globalScope.vars.set(k.toLowerCase(), v);
  }

  // ---- public API ----

  run(source: string) {
    this.source = source;
    this.program = parse(source);
    this.procs.clear();
    this.classes.clear();
    for (const p of this.program.procs) this.procs.set(p.name, p);
    for (const c of this.program.classes) this.classes.set(c.name, c);
    this.statementCount = 0;
    this.abortRequested = false;
    this.execBlock(this.program.body, this.globalScope);
  }

  /** Lists user-defined procedures (Subs/Functions) so the UI can offer to invoke them. */
  listProcs(): ProcDecl[] { return [...this.procs.values()]; }

  hasProc(name: string): boolean { return this.procs.has(name.toLowerCase()); }

  /** Invokes a user procedure by name (used by the "Subs" panel). */
  callProc(name: string, args: VbValue[] = []): VbValue {
    const decl = this.procs.get(name.toLowerCase());
    if (!decl) throw new VbsRuntimeError(`Sub or Function not defined: ${name}`, null, 35);
    this.statementCount = 0;
    this.abortRequested = false;
    return this.invokeProc(decl, args, null, null);
  }

  /** Evaluates an expression in the global scope (used for argument entry in the UI). */
  evalExpression(source: string): VbValue {
    const prog = parse('__x__ = ' + source);
    const stmt = prog.body[0];
    if (!stmt || stmt.kind !== 'assign') throw new VbsSyntaxError('Invalid expression', { start: 0, end: source.length, line: 1 });
    return this.evalExpr(stmt.value, this.globalScope);
  }

  getGlobal(name: string): VbValue { return this.globalScope.vars.get(name.toLowerCase()); }
  setGlobal(name: string, value: VbValue) { this.globalScope.vars.set(name.toLowerCase(), value); }

  // ---- statements ----

  private execBlock(stmts: Stmt[], scope: Scope) {
    for (const s of stmts) this.execStmt(s, scope);
  }

  private tick(span: Span) {
    if (++this.statementCount > this.maxStatements) throw new VbsRuntimeError('Script exceeded its execution budget (possible infinite loop)', span, 1000);
    if (this.abortRequested) throw new VbsRuntimeError('Script aborted', span, 1001);
  }

  private execStmt(s: Stmt, scope: Scope) {
    this.tick(s.span);
    this.currentSpan = s.span;
    try {
      this.execStmtInner(s, scope);
    } catch (e) {
      if (e instanceof ExitSignal) throw e;
      const re = this.toRuntimeError(e, s.span);
      if (this.onErrorResumeNext && s.kind !== 'proc' && s.kind !== 'class') {
        this.err.number = re.number || 500;
        this.err.description = re.message;
        return;
      }
      throw re;
    }
  }

  private toRuntimeError(e: unknown, span: Span): VbsRuntimeError {
    if (e instanceof VbsRuntimeError) { if (!e.span) e.span = span; return e; }
    if (e instanceof VbsSyntaxError) return new VbsRuntimeError(e.message, e.span, 1002);
    const msg = e instanceof Error ? e.message : String(e);
    const re = new VbsRuntimeError(msg, span, 500);
    if (e instanceof Error && e.stack) re.stack = e.stack;
    return re;
  }

  private execStmtInner(s: Stmt, scope: Scope) {
    switch (s.kind) {
      case 'noop': case 'proc': case 'class': return;
      case 'dim':
        for (const v of s.vars) {
          if (v.dims) scope.vars.set(v.name, new VbArray(v.dims.map((d) => toInt(this.evalExpr(d, scope))), false));
          else if (!scope.vars.has(v.name)) scope.vars.set(v.name, undefined);
        }
        return;
      case 'redim': {
        const target = scope.lookup(s.name) ?? scope;
        const existing = target.vars.get(s.name);
        const dims = s.dims.map((d) => toInt(this.evalExpr(d, scope)));
        if (existing instanceof VbArray) existing.redim(dims, s.preserve);
        else target.vars.set(s.name, new VbArray(dims, true));
        return;
      }
      case 'const': scope.vars.set(s.name, this.evalExpr(s.value, scope)); return;
      case 'constlist': for (const d of s.decls) scope.vars.set(d.name, this.evalExpr(d.value, scope)); return;
      case 'assign': this.assign(s.target, this.evalExpr(s.value, scope), scope, s.value); return;
      case 'call': this.execCall(s.callee, s.args, scope, s.span); return;
      case 'if':
        for (const b of s.branches) {
          if (toBool(this.evalExpr(b.cond, scope))) { this.execBlock(b.body, scope); return; }
        }
        if (s.elseBody) this.execBlock(s.elseBody, scope);
        return;
      case 'for': {
        const from = toNumber(this.evalExpr(s.from, scope));
        const to = toNumber(this.evalExpr(s.to, scope));
        const step = s.step ? toNumber(this.evalExpr(s.step, scope)) : 1;
        if (step === 0) throw new VbsRuntimeError('For loop Step cannot be 0', s.span);
        const target = scope.lookup(s.varName) ?? scope;
        let i = from;
        try {
          while (step > 0 ? i <= to : i >= to) {
            this.tick(s.span);
            target.vars.set(s.varName, i);
            this.execBlock(s.body, scope);
            i = toNumber(target.vars.get(s.varName)) + step;
          }
        } catch (e) {
          if (e instanceof ExitSignal && e.what === 'for') return;
          throw e;
        }
        target.vars.set(s.varName, i);
        return;
      }
      case 'foreach': {
        const coll = this.evalExpr(s.collection, scope);
        const items = this.iterate(coll, s.span);
        const target = scope.lookup(s.varName) ?? scope;
        try {
          for (const item of items) {
            this.tick(s.span);
            target.vars.set(s.varName, item);
            this.execBlock(s.body, scope);
          }
        } catch (e) {
          if (e instanceof ExitSignal && e.what === 'for') return;
          throw e;
        }
        return;
      }
      case 'do': {
        try {
          for (;;) {
            this.tick(s.span);
            if (s.preCond) {
              const c = toBool(this.evalExpr(s.preCond.cond, scope));
              if (s.preCond.until ? c : !c) break;
            }
            this.execBlock(s.body, scope);
            if (s.postCond) {
              const c = toBool(this.evalExpr(s.postCond.cond, scope));
              if (s.postCond.until ? c : !c) break;
            }
          }
        } catch (e) {
          if (e instanceof ExitSignal && e.what === 'do') return;
          throw e;
        }
        return;
      }
      case 'while':
        while (toBool(this.evalExpr(s.cond, scope))) { this.tick(s.span); this.execBlock(s.body, scope); }
        return;
      case 'select': {
        const subject = this.evalExpr(s.subject, scope);
        for (const c of s.cases) {
          if (c.tests === null || c.tests.some((t) => this.caseMatches(subject, t, scope))) { this.execBlock(c.body, scope); return; }
        }
        return;
      }
      case 'with': {
        const obj = this.evalExpr(s.object, scope);
        this.withStack.push(obj);
        try { this.execBlock(s.body, scope); } finally { this.withStack.pop(); }
        return;
      }
      case 'exit': throw new ExitSignal(s.what);
      case 'onerror': this.onErrorResumeNext = s.resumeNext; if (!s.resumeNext) { this.err.number = 0; this.err.description = ''; } return;
      case 'randomize': return;
      case 'erase': {
        const target = scope.lookup(s.name);
        const arr = target?.vars.get(s.name);
        if (arr instanceof VbArray) arr.redim(arr.dims, false);
        return;
      }
    }
  }

  private caseMatches(subject: VbValue, t: CaseTest, scope: Scope): boolean {
    switch (t.kind) {
      case 'eq': return this.compare('=', subject, this.evalExpr(t.expr, scope));
      case 'range': return this.compare('>=', subject, this.evalExpr(t.lo, scope)) && this.compare('<=', subject, this.evalExpr(t.hi, scope));
      case 'is': return this.compare(t.op, subject, this.evalExpr(t.expr, scope));
    }
  }

  private iterate(coll: VbValue, span: Span): Iterable<VbValue> {
    if (coll instanceof VbArray) return coll.toList();
    if (Array.isArray(coll)) return coll;
    if (coll && typeof coll === 'object' && Symbol.iterator in (coll as object)) return coll as Iterable<VbValue>;
    throw new VbsRuntimeError(`Object is not a collection: ${typeName(coll)}`, span, 451);
  }

  // ---- assignment ----

  private assign(target: Expr, value: VbValue, scope: Scope, valueExpr: Expr | null) {
    switch (target.kind) {
      case 'ident': {
        // Assigning to the function name sets the return value
        if (scope.returnSlot && target.name === scope.procName) { scope.vars.set(scope.returnSlot, value); return; }
        if (scope.self && !scope.vars.has(target.name) && scope.self.fields.has(target.name)) { this.classSet(scope.self, target.name, [], value, scope); return; }
        const s = scope.lookup(target.name) ?? scope;
        s.vars.set(target.name, value);
        return;
      }
      case 'with': throw new VbsRuntimeError('Invalid assignment target', target.span);
      case 'member': {
        const obj = target.object.kind === 'with' ? this.currentWith(target.span) : this.evalExpr(target.object, scope);
        this.setMember(obj, target.name, [], value, scope, target.span, valueExpr);
        return;
      }
      case 'call': {
        // arr(i) = v   or   obj.prop(i) = v
        const args = target.args.map((a) => (a ? this.evalExpr(a, scope) : undefined));
        if (target.callee.kind === 'ident') {
          const s = scope.lookup(target.callee.name);
          const cur = s?.vars.get(target.callee.name);
          if (cur instanceof VbArray) { cur.set(args.map((a) => toInt(a)), value); return; }
          if (cur instanceof ClassInstance) { this.classSet(cur, 'default', args, value, scope); return; }
          throw new VbsRuntimeError(`Cannot assign to '${target.callee.name}(...)': it is not an array`, target.span, 13);
        }
        if (target.callee.kind === 'member') {
          const obj = target.callee.object.kind === 'with' ? this.currentWith(target.span) : this.evalExpr(target.callee.object, scope);
          const cur = this.getMember(obj, target.callee.name, [], scope, target.span);
          if (cur instanceof VbArray) { cur.set(args.map((a) => toInt(a)), value); return; }
          this.setMember(obj, target.callee.name, args, value, scope, target.span, valueExpr);
          return;
        }
        throw new VbsRuntimeError('Invalid assignment target', target.span);
      }
      default: throw new VbsRuntimeError('Invalid assignment target', target.span);
    }
  }

  // ---- expressions ----

  evalExpr(e: Expr, scope: Scope): VbValue {
    switch (e.kind) {
      case 'number': return e.value;
      case 'string': return e.value;
      case 'bool': return e.value;
      case 'nothing': return null;
      case 'empty': return undefined;
      case 'null': return VbNull;
      case 'with': return this.currentWith(e.span);
      case 'new': {
        const decl = this.classes.get(e.className);
        if (!decl) throw new VbsRuntimeError(`Class not defined: ${e.className}`, e.span, 429);
        return this.instantiate(decl);
      }
      case 'ident': return this.evalIdent(e.name, [], scope, e.span, false);
      case 'member': {
        const obj = e.object.kind === 'with' ? this.currentWith(e.span) : this.evalExpr(e.object, scope);
        return this.getMember(obj, e.name, [], scope, e.span);
      }
      case 'call': return this.evalCall(e, scope);
      case 'unary': {
        const v = this.evalExpr(e.operand, scope);
        if (e.op === '-') return -toNumber(v);
        if (e.op === '+') return toNumber(v);
        if (typeof v === 'boolean') return !v;
        if (v === undefined) return -1;
        if (v instanceof VbNullType) return VbNull;
        return ~toInt(v);
      }
      case 'binary': return this.evalBinary(e, scope);
    }
  }

  private currentWith(span: Span): VbValue {
    if (this.withStack.length === 0) throw new VbsRuntimeError("'.' used outside of a With block", span);
    return this.withStack[this.withStack.length - 1];
  }

  private evalBinary(e: Extract<Expr, { kind: 'binary' }>, scope: Scope): VbValue {
    const l = this.evalExpr(e.left, scope);
    const r = this.evalExpr(e.right, scope);
    switch (e.op) {
      case '&': return this.concatStr(l) + this.concatStr(r);
      case '+':
        if (typeof l === 'string' && typeof r === 'string') return l + r;
        if (typeof l === 'string' && r === undefined) return l;
        if (typeof r === 'string' && l === undefined) return r;
        if (l instanceof VbNullType || r instanceof VbNullType) return VbNull;
        if (typeof l === 'string' && !isNumericString(l)) throw new VbsRuntimeError(`Type mismatch: cannot add "${l}" (use & to concatenate strings)`, e.span, 13);
        if (typeof r === 'string' && !isNumericString(r)) throw new VbsRuntimeError(`Type mismatch: cannot add "${r}" (use & to concatenate strings)`, e.span, 13);
        return toNumber(l) + toNumber(r);
      case '-': return toNumber(l) - toNumber(r);
      case '*': return toNumber(l) * toNumber(r);
      case '/': {
        const d = toNumber(r);
        if (d === 0) throw new VbsRuntimeError('Division by zero', e.span, 11);
        return toNumber(l) / d;
      }
      case '\\': {
        const d = toInt(r);
        if (d === 0) throw new VbsRuntimeError('Division by zero', e.span, 11);
        return Math.trunc(toInt(l) / d);
      }
      case 'mod': {
        const d = toInt(r);
        if (d === 0) throw new VbsRuntimeError('Division by zero', e.span, 11);
        return toInt(l) % d;
      }
      case '^': return Math.pow(toNumber(l), toNumber(r));
      case '=': case '<>': case '<': case '>': case '<=': case '>=': return this.compare(e.op, l, r);
      case 'is': return this.sameObject(l, r);
      case 'and': case 'or': case 'xor': case 'eqv': case 'imp': {
        if (typeof l === 'boolean' && typeof r === 'boolean') {
          switch (e.op) {
            case 'and': return l && r;
            case 'or': return l || r;
            case 'xor': return l !== r;
            case 'eqv': return l === r;
            case 'imp': return !l || r;
          }
        }
        const a = toInt(l), b = toInt(r);
        switch (e.op) {
          case 'and': return a & b;
          case 'or': return a | b;
          case 'xor': return a ^ b;
          case 'eqv': return ~(a ^ b);
          case 'imp': return ~a | b;
        }
      }
    }
    throw new VbsRuntimeError(`Unsupported operator ${e.op}`, e.span);
  }

  private concatStr(v: VbValue): string {
    if (v instanceof VbNullType) return '';
    return toStr(v);
  }

  private sameObject(l: VbValue, r: VbValue): boolean {
    if (!isObjectValue(l) || !isObjectValue(r)) throw new VbsRuntimeError("'Is' requires object operands", this.currentSpan, 424);
    return l === r;
  }

  compare(op: string, l: VbValue, r: VbValue): boolean {
    let cmp: number;
    if (l instanceof VbNullType || r instanceof VbNullType) return false;
    if (typeof l === 'string' && typeof r === 'string') cmp = l < r ? -1 : l > r ? 1 : 0;
    else if (typeof l === 'string' || typeof r === 'string') {
      const ls = typeof l === 'string' ? l : null;
      const rs = typeof r === 'string' ? r : null;
      // A string compared with a number: numeric compare when the string is numeric; otherwise strings are "greater"
      if (ls !== null && rs === null) {
        if (r === undefined) cmp = ls === '' ? 0 : 1;
        else if (isNumericString(ls)) cmp = Math.sign(toNumber(ls) - toNumber(r));
        else cmp = 1;
      } else if (rs !== null && ls === null) {
        if (l === undefined) cmp = rs === '' ? 0 : -1;
        else if (isNumericString(rs)) cmp = Math.sign(toNumber(l) - toNumber(rs));
        else cmp = -1;
      } else cmp = 0;
    } else if (isObjectValue(l) || isObjectValue(r)) {
      if (op === '=') return l === r;
      if (op === '<>') return l !== r;
      throw new VbsRuntimeError('Type mismatch: cannot order objects', this.currentSpan, 13);
    } else {
      const a = toNumber(l), b = toNumber(r);
      cmp = a < b ? -1 : a > b ? 1 : 0;
    }
    switch (op) {
      case '=': return cmp === 0;
      case '<>': return cmp !== 0;
      case '<': return cmp < 0;
      case '>': return cmp > 0;
      case '<=': return cmp <= 0;
      case '>=': return cmp >= 0;
    }
    return false;
  }

  // ---- identifiers, members and calls ----

  private evalIdent(name: string, args: VbValue[], scope: Scope, span: Span, hasParens: boolean, argExprs: (Expr | null)[] = []): VbValue {
    if (name === 'me' && scope.self) return scope.self;
    const s = scope.lookup(name);
    if (s) {
      const v = s.vars.get(name);
      if (hasParens) {
        if (v instanceof VbArray) return v.get(args.map((a) => toInt(a)));
        if (v instanceof ProcRef) return this.invokeProc(v.decl, args, v.self, argExprs);
        if (v instanceof ClassInstance) return this.classGet(v, 'default', args, scope, span);
        if (args.length === 0) return v;
        if (v && typeof v === 'object') return this.hostIndex(v, args, span);
        throw new VbsRuntimeError(`'${name}' is not an array or procedure`, span, 13);
      }
      return v;
    }
    if (scope.self && scope.self.fields.has(name)) {
      const v = scope.self.fields.get(name);
      if (hasParens && v instanceof VbArray) return v.get(args.map((a) => toInt(a)));
      return v;
    }
    if (scope.self) {
      const m = this.findClassProc(scope.self.decl, name, 'get');
      if (m) return this.invokeProc(m, args, scope.self, argExprs);
    }
    const proc = this.procs.get(name);
    if (proc) return this.invokeProc(proc, args, null, argExprs);
    const builtin = this.builtins.get(name);
    if (builtin) return this.callBuiltin(builtin, name, args, span);
    if (hasParens || args.length > 0) throw new VbsRuntimeError(`Sub or Function not defined: '${name}'`, span, 35);
    // Undeclared variable read: VBScript returns Empty
    return undefined;
  }

  private callBuiltin(b: Builtin, name: string, args: VbValue[], span: Span): VbValue {
    try {
      return b(args);
    } catch (e) {
      if (e instanceof VbsRuntimeError) { if (!e.span) e.span = span; throw e; }
      throw new VbsRuntimeError(`${name}: ${e instanceof Error ? e.message : String(e)}`, span, 5);
    }
  }

  private evalCall(e: Extract<Expr, { kind: 'call' }>, scope: Scope): VbValue {
    const args = e.args.map((a) => (a ? this.evalExpr(a, scope) : undefined));
    const callee = e.callee;
    if (callee.kind === 'ident') return this.evalIdent(callee.name, args, scope, e.span, true, e.args);
    if (callee.kind === 'member') {
      const obj = callee.object.kind === 'with' ? this.currentWith(e.span) : this.evalExpr(callee.object, scope);
      return this.getMember(obj, callee.name, args, scope, e.span, e.args);
    }
    // f(1)(2): index into the result
    const base = this.evalExpr(callee, scope);
    if (base instanceof VbArray) return base.get(args.map((a) => toInt(a)));
    if (base instanceof ProcRef) return this.invokeProc(base.decl, args, base.self, e.args);
    if (base && typeof base === 'object') return this.hostIndex(base, args, e.span);
    throw new VbsRuntimeError('Value cannot be called or indexed', e.span, 13);
  }

  private execCall(callee: Expr, argExprs: (Expr | null)[], scope: Scope, span: Span) {
    const args = argExprs.map((a) => (a ? this.evalExpr(a, scope) : undefined));
    if (callee.kind === 'ident') {
      // A statement like "x" where x is a variable holding a procedure reference, or a Sub call
      const s = scope.lookup(callee.name);
      if (s && !(s.vars.get(callee.name) instanceof ProcRef)) {
        if (args.length === 0) return; // evaluating a bare variable as a statement is a no-op
        throw new VbsRuntimeError(`'${callee.name}' is a variable, not a Sub`, span, 13);
      }
      this.evalIdent(callee.name, args, scope, span, args.length > 0, argExprs);
      return;
    }
    if (callee.kind === 'member') {
      const obj = callee.object.kind === 'with' ? this.currentWith(span) : this.evalExpr(callee.object, scope);
      this.getMember(obj, callee.name, args, scope, span, argExprs);
      return;
    }
    this.evalExpr(callee, scope);
  }

  private hostIndex(obj: object, args: VbValue[], span: Span): VbValue {
    if (Array.isArray(obj)) return obj[toInt(args[0])];
    const fn = (obj as { vbIndex?: (args: VbValue[]) => VbValue }).vbIndex;
    if (typeof fn === 'function') return fn.call(obj, args);
    throw new VbsRuntimeError('Object does not support indexing', span, 438);
  }

  private getMember(obj: VbValue, name: string, args: VbValue[], scope: Scope, span: Span, argExprs: (Expr | null)[] = []): VbValue {
    if (obj === null || obj === undefined) throw new VbsRuntimeError(`Object required: cannot read '${name}' of ${obj === null ? 'Nothing' : 'Empty'}`, span, 424);
    if (obj instanceof ClassInstance) return this.classGet(obj, name, args, scope, span, argExprs);
    if (obj instanceof VbArray || typeof obj !== 'object') throw new VbsRuntimeError(`Object required: '${typeName(obj)}' has no member '${name}'`, span, 424);
    const key = this.hostKey(obj, name);
    if (key === undefined) throw new VbsRuntimeError(`Object doesn't support this property or method: '${name}'`, span, 438);
    const host = obj as Record<string, unknown>;
    const v = host[key];
    if (typeof v === 'function') {
      this.fillHostContext(argExprs, scope);
      try {
        return this.wrapHostResult((v as (...a: VbValue[]) => unknown).apply(obj, args), span);
      } catch (e) {
        throw this.hostError(e, name, span);
      } finally {
        hostCallContext.argSpans = [];
      }
    }
    if (args.length > 0) {
      if (v instanceof VbArray) return v.get(args.map((a) => toInt(a)));
      if (v && typeof v === 'object') return this.hostIndex(v as object, args, span);
      throw new VbsRuntimeError(`Property '${name}' cannot be indexed`, span, 13);
    }
    return this.wrapHostResult(v, span);
  }

  private setMember(obj: VbValue, name: string, args: VbValue[], value: VbValue, scope: Scope, span: Span, valueExpr: Expr | null) {
    if (obj === null || obj === undefined) throw new VbsRuntimeError(`Object required: cannot set '${name}' of ${obj === null ? 'Nothing' : 'Empty'}`, span, 424);
    if (obj instanceof ClassInstance) { this.classSet(obj, name, args, value, scope); return; }
    if (obj instanceof VbArray || typeof obj !== 'object') throw new VbsRuntimeError(`Object required: '${typeName(obj)}' has no member '${name}'`, span, 424);
    const key = this.hostKey(obj, name);
    if (key === undefined) throw new VbsRuntimeError(`Object doesn't support this property or method: '${name}'`, span, 438);
    if (args.length > 0) throw new VbsRuntimeError(`Indexed property assignment is not supported for '${name}'`, span, 438);
    this.fillHostContext([valueExpr], scope);
    try {
      (obj as Record<string, unknown>)[key] = value;
    } catch (e) {
      throw this.hostError(e, name, span);
    } finally {
      hostCallContext.argSpans = [];
    }
  }

  private hostError(e: unknown, name: string, span: Span): VbsRuntimeError {
    if (e instanceof VbsRuntimeError) { if (!e.span) e.span = span; return e; }
    const re = new VbsRuntimeError(`${name}: ${e instanceof Error ? e.message : String(e)}`, span, 500);
    if (e instanceof Error && e.stack) re.stack = e.stack;
    return re;
  }

  private wrapHostResult(v: unknown, span: Span): VbValue {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'object') return v as VbValue;
    throw new VbsRuntimeError(`Unsupported host value of type ${typeof v}`, span);
  }

  private fillHostContext(argExprs: (Expr | null)[], scope: Scope) {
    hostCallContext.argSpans = argExprs.map((a) => literalSpan(a));
    hostCallContext.statementSpan = this.currentSpan;
    hostCallContext.procName = scope.procName;
  }

  private hostKey(obj: object, name: string): string | undefined {
    let map = this.hostKeyCache.get(obj);
    if (!map) {
      map = new Map();
      // Instance own properties, then prototype chain (accessors and methods). Later (base) entries don't override.
      let o: object | null = obj;
      while (o && o !== Object.prototype && o !== Function.prototype) {
        for (const k of Object.getOwnPropertyNames(o)) {
          if (k === 'constructor' || k.startsWith('_') || k.startsWith('vb')) continue;
          const lk = k.toLowerCase();
          if (!map.has(lk)) map.set(lk, k);
        }
        o = Object.getPrototypeOf(o);
      }
      this.hostKeyCache.set(obj, map);
    }
    return map.get(name);
  }

  // ---- user procedures ----

  private invokeProc(decl: ProcDecl, args: VbValue[], self: ClassInstance | null, argExprs: (Expr | null)[] | null): VbValue {
    if (args.length > decl.params.length) throw new VbsRuntimeError(`Wrong number of arguments for '${decl.name}': expected ${decl.params.length}, got ${args.length}`, this.currentSpan, 450);
    const scope = new Scope(this.globalScope, decl.name, self, decl.isFunction ? '__return__' : null);
    for (let i = 0; i < decl.params.length; i++) scope.vars.set(decl.params[i].name, i < args.length ? args[i] : undefined);
    if (decl.isFunction) scope.vars.set('__return__', undefined);
    const savedWith = this.withStack;
    this.withStack = [];
    const savedSpan = this.currentSpan;
    try {
      this.execBlock(decl.body, scope);
    } catch (e) {
      if (e instanceof ExitSignal && (e.what === 'sub' || e.what === 'function' || e.what === 'property')) { /* normal exit */ } else throw e;
    } finally {
      this.withStack = savedWith;
      this.currentSpan = savedSpan;
    }
    return decl.isFunction ? scope.vars.get('__return__') : undefined;
  }

  private callValue(v: VbValue, args: VbValue[]): VbValue {
    if (v instanceof ProcRef) return this.invokeProc(v.decl, args, v.self, null);
    if (typeof v === 'string') {
      const decl = this.procs.get(v.toLowerCase());
      if (decl) return this.invokeProc(decl, args, null, null);
    }
    throw new VbsRuntimeError('Value is not a procedure', this.currentSpan, 13);
  }

  getProcRef(name: string): ProcRef | null {
    const decl = this.procs.get(name.toLowerCase());
    return decl ? new ProcRef(decl, null) : null;
  }

  // ---- classes ----

  private instantiate(decl: ClassDecl): ClassInstance {
    const inst = new ClassInstance(decl);
    for (const m of decl.members) for (const n of m.names) inst.fields.set(n, undefined);
    const init = this.findClassProc(decl, 'class_initialize', 'any');
    if (init) this.invokeProc(init, [], inst, null);
    return inst;
  }

  private findClassProc(decl: ClassDecl, name: string, kind: 'get' | 'let' | 'set' | 'any'): ProcDecl | null {
    for (const p of decl.procs) {
      if (p.name !== name) continue;
      if (kind === 'any') return p;
      if (kind === 'get' && (p.propertyKind === undefined || p.propertyKind === 'get')) return p;
      if ((kind === 'let' || kind === 'set') && (p.propertyKind === 'let' || p.propertyKind === 'set')) return p;
    }
    if (name === 'default') for (const p of decl.procs) if (p.isDefault) return p;
    return null;
  }

  private classGet(inst: ClassInstance, name: string, args: VbValue[], scope: Scope, span: Span, argExprs: (Expr | null)[] = []): VbValue {
    if (inst.fields.has(name)) {
      const v = inst.fields.get(name);
      if (args.length > 0 && v instanceof VbArray) return v.get(args.map((a) => toInt(a)));
      return v;
    }
    const p = this.findClassProc(inst.decl, name, 'get');
    if (p) return this.invokeProc(p, args, inst, argExprs);
    throw new VbsRuntimeError(`Object doesn't support this property or method: '${name}'`, span, 438);
  }

  private classSet(inst: ClassInstance, name: string, args: VbValue[], value: VbValue, _scope: Scope) {
    const p = this.findClassProc(inst.decl, name, 'let');
    if (p) { this.invokeProc(p, [...args, value], inst, null); return; }
    if (inst.fields.has(name)) { inst.fields.set(name, value); return; }
    throw new VbsRuntimeError(`Object doesn't support this property or method: '${name}'`, this.currentSpan, 438);
  }

  private typeNameOf(v: VbValue): string {
    if (v instanceof ClassInstance) return v.decl.name;
    return typeName(v);
  }
}

function toInt(v: VbValue): number { return roundHalfEven(toNumber(v)); }

/** Returns the span of a numeric literal expression (optionally negated), or null for anything else. */
export function literalSpan(e: Expr | null): Span | null {
  if (!e) return null;
  if (e.kind === 'number') return e.span;
  if (e.kind === 'unary' && (e.op === '-' || e.op === '+') && e.operand.kind === 'number') return e.span;
  return null;
}

export { formatNumber, toBool, toNumber, toStr, typeName, VbArray, VbNull, VbNullType, type VbValue };

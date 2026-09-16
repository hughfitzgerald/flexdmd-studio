// AST for the VBScript subset understood by FlexDMD Studio.
// Every node carries a source span so runtime errors and the WYSIWYG editor can point back to the script text.

export interface Span {
  start: number; // absolute character offset (inclusive)
  end: number; // absolute character offset (exclusive)
  line: number; // 1-based line of the start
}

export type Expr =
  | { kind: 'number'; value: number; span: Span }
  | { kind: 'string'; value: string; span: Span }
  | { kind: 'bool'; value: boolean; span: Span }
  | { kind: 'nothing'; span: Span }
  | { kind: 'empty'; span: Span }
  | { kind: 'null'; span: Span }
  | { kind: 'ident'; name: string; span: Span }
  | { kind: 'with'; span: Span } // the implicit object of the innermost With block
  | { kind: 'member'; object: Expr; name: string; span: Span }
  | { kind: 'call'; callee: Expr; args: (Expr | null)[]; span: Span } // f(a,b) / a(1) / obj.m(x)
  | { kind: 'new'; className: string; span: Span }
  | { kind: 'unary'; op: '-' | 'not' | '+'; operand: Expr; span: Span }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; span: Span };

export type BinaryOp =
  | '^' | '*' | '/' | '\\' | 'mod' | '+' | '-' | '&'
  | '=' | '<>' | '<' | '>' | '<=' | '>=' | 'is'
  | 'and' | 'or' | 'xor' | 'eqv' | 'imp';

export type CaseTest =
  | { kind: 'eq'; expr: Expr }
  | { kind: 'range'; lo: Expr; hi: Expr }
  | { kind: 'is'; op: BinaryOp; expr: Expr };

export interface Param {
  name: string;
  byRef: boolean;
  span: Span;
}

export type Stmt =
  | { kind: 'dim'; vars: { name: string; dims: Expr[] | null; span: Span }[]; span: Span }
  | { kind: 'redim'; preserve: boolean; decls: { name: string; dims: Expr[] }[]; span: Span }
  | { kind: 'const'; name: string; value: Expr; span: Span }
  | { kind: 'constlist'; decls: { name: string; value: Expr }[]; span: Span }
  | { kind: 'assign'; target: Expr; value: Expr; isSet: boolean; span: Span }
  | { kind: 'call'; callee: Expr; args: (Expr | null)[]; span: Span }
  | { kind: 'if'; branches: { cond: Expr; body: Stmt[] }[]; elseBody: Stmt[] | null; span: Span }
  | { kind: 'for'; varName: string; from: Expr; to: Expr; step: Expr | null; body: Stmt[]; span: Span }
  | { kind: 'foreach'; varName: string; collection: Expr; body: Stmt[]; span: Span }
  | { kind: 'do'; preCond: { until: boolean; cond: Expr } | null; postCond: { until: boolean; cond: Expr } | null; body: Stmt[]; span: Span }
  | { kind: 'while'; cond: Expr; body: Stmt[]; span: Span }
  | { kind: 'select'; subject: Expr; cases: { tests: CaseTest[] | null; body: Stmt[] }[]; span: Span }
  | { kind: 'with'; object: Expr; body: Stmt[]; span: Span }
  | { kind: 'exit'; what: 'sub' | 'function' | 'for' | 'do' | 'property'; span: Span }
  | { kind: 'onerror'; resumeNext: boolean; span: Span }
  | { kind: 'proc'; proc: ProcDecl; span: Span }
  | { kind: 'class'; decl: ClassDecl; span: Span }
  | { kind: 'randomize'; span: Span }
  | { kind: 'erase'; name: string; span: Span }
  | { kind: 'noop'; span: Span };

export interface ProcDecl {
  name: string; // lower-cased (VBScript is case-insensitive)
  displayName: string; // as written in the script
  isFunction: boolean;
  params: Param[];
  body: Stmt[];
  span: Span;
  isDefault?: boolean;
  access?: 'public' | 'private';
  propertyKind?: 'get' | 'let' | 'set';
}

export interface ClassDecl {
  name: string;
  members: { kind: 'field'; names: string[]; access: 'public' | 'private' }[];
  procs: ProcDecl[];
  span: Span;
}

export interface Program {
  body: Stmt[];
  procs: ProcDecl[];
  classes: ClassDecl[];
}

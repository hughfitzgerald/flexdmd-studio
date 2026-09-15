import type { Span } from './ast';

export type TokenType = 'num' | 'str' | 'ident' | 'kw' | 'op' | 'eol' | 'eof';

export interface Token {
  type: TokenType;
  value: string; // keywords/identifiers/operators are lower-cased; strings hold the unescaped value
  raw: string;
  num?: number;
  span: Span;
}

export class VbsSyntaxError extends Error {
  constructor(message: string, public span: Span) {
    super(message);
    this.name = 'VbsSyntaxError';
  }
}

const KEYWORDS = new Set([
  'and', 'as', 'byref', 'byval', 'call', 'case', 'class', 'const', 'default', 'dim', 'do', 'each', 'else', 'elseif',
  'empty', 'end', 'eqv', 'erase', 'error', 'exit', 'explicit', 'false', 'for', 'function', 'get', 'goto', 'if', 'imp',
  'in', 'is', 'let', 'loop', 'mod', 'new', 'next', 'not', 'nothing', 'null', 'on', 'option', 'or', 'preserve',
  'private', 'property', 'public', 'randomize', 'redim', 'rem', 'resume', 'select', 'set', 'step', 'stop', 'sub',
  'then', 'to', 'true', 'until', 'wend', 'while', 'with', 'xor',
]);

const THREE_OPS = ['>=<'];
const TWO_OPS = ['<>', '<=', '>=', '=<', '=>', '><'];
const ONE_OPS = '+-*/\\^&=<>(),.:';

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;

  const push = (type: TokenType, value: string, start: number, end: number, num?: number) => {
    tokens.push({ type, value, raw: src.slice(start, end), num, span: { start, end, line } });
  };

  while (i < n) {
    const c = src[i];
    // Line continuation: underscore followed by optional spaces and a newline
    if (c === '_' && (i === 0 || /[\s]/.test(src[i - 1]))) {
      let j = i + 1;
      while (j < n && (src[j] === ' ' || src[j] === '\t')) j++;
      if (j < n && (src[j] === '\r' || src[j] === '\n')) {
        if (src[j] === '\r' && src[j + 1] === '\n') j++;
        i = j + 1;
        line++;
        continue;
      }
    }
    if (c === ' ' || c === '\t' || c === '\f' || c === '\v') { i++; continue; }
    if (c === '\r' || c === '\n') {
      const start = i;
      if (c === '\r' && src[i + 1] === '\n') i++;
      i++;
      push('eol', '\n', start, i);
      line++;
      continue;
    }
    if (c === "'") {
      while (i < n && src[i] !== '\r' && src[i] !== '\n') i++;
      continue;
    }
    if (c === ':') {
      push('eol', ':', i, i + 1);
      i++;
      continue;
    }
    if (c === '"') {
      const start = i;
      i++;
      let value = '';
      for (;;) {
        if (i >= n || src[i] === '\r' || src[i] === '\n') {
          throw new VbsSyntaxError('Unterminated string', { start, end: i, line });
        }
        if (src[i] === '"') {
          if (src[i + 1] === '"') { value += '"'; i += 2; continue; }
          i++;
          break;
        }
        value += src[i++];
      }
      push('str', value, start, i);
      continue;
    }
    if (c === '&' && (src[i + 1] === 'H' || src[i + 1] === 'h')) {
      const start = i;
      i += 2;
      while (i < n && /[0-9a-fA-F]/.test(src[i])) i++;
      if (src[i] === '&') i++;
      let hex = src.slice(start + 2, i).replace('&', '');
      let v = parseInt(hex, 16);
      // VBScript: &HFFFF is -1 (16 bit) when 4 digits, &HFFFFFFFF is -1 (32 bit)
      if (hex.length <= 4 && v >= 0x8000) v -= 0x10000;
      else if (hex.length <= 8 && v >= 0x80000000) v -= 0x100000000;
      push('num', src.slice(start, i), start, i, v);
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const start = i;
      while (i < n && /[0-9]/.test(src[i])) i++;
      if (src[i] === '.') { i++; while (i < n && /[0-9]/.test(src[i])) i++; }
      if ((src[i] === 'e' || src[i] === 'E') && /[0-9+\-]/.test(src[i + 1] ?? '')) {
        i++;
        if (src[i] === '+' || src[i] === '-') i++;
        while (i < n && /[0-9]/.test(src[i])) i++;
      }
      const raw = src.slice(start, i);
      push('num', raw, start, i, parseFloat(raw));
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++;
      const raw = src.slice(start, i);
      const lower = raw.toLowerCase();
      if (lower === 'rem') {
        while (i < n && src[i] !== '\r' && src[i] !== '\n') i++;
        continue;
      }
      push(KEYWORDS.has(lower) ? 'kw' : 'ident', lower, start, i);
      continue;
    }
    if (c === '[') {
      // [escaped identifier]
      const start = i;
      const close = src.indexOf(']', i);
      if (close < 0) throw new VbsSyntaxError('Unterminated [identifier]', { start, end: i + 1, line });
      i = close + 1;
      push('ident', src.slice(start + 1, close).toLowerCase(), start, i);
      continue;
    }
    let matched = false;
    for (const op of THREE_OPS) if (src.startsWith(op, i)) { push('op', op, i, i + 3); i += 3; matched = true; break; }
    if (matched) continue;
    for (const op of TWO_OPS) {
      if (src.startsWith(op, i)) {
        const norm = op === '=<' ? '<=' : op === '=>' ? '>=' : op === '><' ? '<>' : op;
        push('op', norm, i, i + 2); i += 2; matched = true; break;
      }
    }
    if (matched) continue;
    if (ONE_OPS.includes(c)) { push('op', c, i, i + 1); i++; continue; }
    throw new VbsSyntaxError(`Unexpected character '${c}'`, { start: i, end: i + 1, line });
  }
  push('eol', '\n', n, n);
  push('eof', '', n, n);
  return tokens;
}

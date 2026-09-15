import { formatNumber, isNumericString, roundHalfEven, toBool, toNumber, toStr, typeName, VbArray, VbNull, VbNullType, VbsRuntimeError, type VbValue } from './values';

export type Builtin = (args: VbValue[]) => VbValue;

export interface BuiltinHost {
  log: (m: string) => void;
  createObject: (progId: string) => VbValue;
  err: { number: number; description: string };
  typeNameOf: (v: VbValue) => string;
  callValue: (v: VbValue, args: VbValue[]) => VbValue;
}

// VBScript packs colors as BGR longs: RGB(r,g,b) = r + g*256 + b*65536
export function vbRGB(r: number, g: number, b: number): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.trunc(v)));
  return c(r) | (c(g) << 8) | (c(b) << 16);
}

class ErrObject {
  constructor(private state: { number: number; description: string }) {}
  get Number() { return this.state.number; }
  get Description() { return this.state.description; }
  get Source() { return 'FlexDMD Studio'; }
  Clear() { this.state.number = 0; this.state.description = ''; }
  Raise(num: VbValue, _src?: VbValue, desc?: VbValue) { throw new VbsRuntimeError(desc === undefined ? `Error ${toStr(num)}` : toStr(desc), null, toNumber(num)); }
}

export function createBuiltins(host: BuiltinHost): Map<string, Builtin> {
  const m = new Map<string, Builtin>();
  const def = (name: string, fn: Builtin) => m.set(name.toLowerCase(), fn);
  const constant = (name: string, value: VbValue) => def(name, () => value);
  const num = (args: VbValue[], i: number, name: string) => {
    if (i >= args.length || args[i] === undefined && i >= args.length) throw new VbsRuntimeError(`Missing argument ${i + 1} for ${name}`, null, 450);
    return toNumber(args[i]);
  };
  const str = (args: VbValue[], i: number) => (args[i] instanceof VbNullType ? '' : toStr(args[i]));
  const optNum = (args: VbValue[], i: number, dflt: number) => (i < args.length && args[i] !== undefined ? toNumber(args[i]) : dflt);

  // ---- constants ----
  constant('vbCrLf', '\r\n'); constant('vbCr', '\r'); constant('vbLf', '\n'); constant('vbNewLine', '\r\n');
  constant('vbTab', '\t'); constant('vbNullString', ''); constant('vbNullChar', '\0'); constant('vbFormFeed', '\f'); constant('vbBack', '\b'); constant('vbVerticalTab', '\v');
  constant('vbTrue', -1); constant('vbFalse', 0);
  constant('vbBlack', 0x000000); constant('vbRed', 0x0000ff); constant('vbGreen', 0x00ff00); constant('vbYellow', 0x00ffff);
  constant('vbBlue', 0xff0000); constant('vbMagenta', 0xff00ff); constant('vbCyan', 0xffff00); constant('vbWhite', 0xffffff);
  constant('vbEmpty', 0); constant('vbNull', 1); constant('vbInteger', 2); constant('vbLong', 3); constant('vbSingle', 4); constant('vbDouble', 5);
  constant('vbString', 8); constant('vbObject', 9); constant('vbBoolean', 11); constant('vbArray', 8192);
  constant('vbBinaryCompare', 0); constant('vbTextCompare', 1);
  constant('vbOKOnly', 0); constant('vbOK', 1);
  constant('vbSunday', 1); constant('vbMonday', 2);
  constant('vbGeneralDate', 0); constant('vbLongDate', 1); constant('vbShortDate', 2); constant('vbLongTime', 3); constant('vbShortTime', 4);
  constant('vbUseDefault', -2);
  const errObj = new ErrObject(host.err);
  constant('Err', errObj);

  // ---- objects ----
  def('CreateObject', (a) => host.createObject(str(a, 0)));
  def('GetObject', (a) => host.createObject(str(a, 0)));
  def('MsgBox', (a) => { host.log('MsgBox: ' + str(a, 0)); return 1; });
  def('InputBox', () => '');
  def('GetRef', (a) => a[0]);
  def('Eval', (a) => a[0]);
  def('Execute', () => undefined);
  def('ExecuteGlobal', () => undefined);

  // ---- math ----
  def('Abs', (a) => Math.abs(num(a, 0, 'Abs')));
  def('Atn', (a) => Math.atan(num(a, 0, 'Atn')));
  def('Cos', (a) => Math.cos(num(a, 0, 'Cos')));
  def('Sin', (a) => Math.sin(num(a, 0, 'Sin')));
  def('Tan', (a) => Math.tan(num(a, 0, 'Tan')));
  def('Exp', (a) => Math.exp(num(a, 0, 'Exp')));
  def('Log', (a) => Math.log(num(a, 0, 'Log')));
  def('Sqr', (a) => Math.sqrt(num(a, 0, 'Sqr')));
  def('Int', (a) => Math.floor(num(a, 0, 'Int')));
  def('Fix', (a) => Math.trunc(num(a, 0, 'Fix')));
  def('Sgn', (a) => Math.sign(num(a, 0, 'Sgn')));
  def('Round', (a) => {
    const v = num(a, 0, 'Round');
    const digits = optNum(a, 1, 0);
    const f = Math.pow(10, digits);
    return roundHalfEven(v * f) / f;
  });
  let seed = 0.5;
  def('Rnd', () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; });
  def('Randomize', () => undefined);
  def('Timer', () => (Date.now() % 86400000) / 1000);
  def('Now', () => new Date().toLocaleString());
  def('Date', () => new Date().toLocaleDateString());
  def('Time', () => new Date().toLocaleTimeString());
  def('Year', () => new Date().getFullYear());
  def('Month', () => new Date().getMonth() + 1);
  def('Day', () => new Date().getDate());
  def('Hour', () => new Date().getHours());
  def('Minute', () => new Date().getMinutes());
  def('Second', () => new Date().getSeconds());

  // ---- conversion ----
  const clamp = (v: number, lo: number, hi: number, what: string) => { if (v < lo || v > hi) throw new VbsRuntimeError(`Overflow: ${what}`, null, 6); return v; };
  def('CInt', (a) => clamp(roundHalfEven(num(a, 0, 'CInt')), -32768, 32767, 'CInt'));
  def('CLng', (a) => clamp(roundHalfEven(num(a, 0, 'CLng')), -2147483648, 2147483647, 'CLng'));
  def('CByte', (a) => clamp(roundHalfEven(num(a, 0, 'CByte')), 0, 255, 'CByte'));
  def('CDbl', (a) => num(a, 0, 'CDbl'));
  def('CSng', (a) => num(a, 0, 'CSng'));
  def('CCur', (a) => num(a, 0, 'CCur'));
  def('CStr', (a) => str(a, 0));
  def('CBool', (a) => toBool(a[0]));
  def('CDate', (a) => a[0]);
  def('Hex', (a) => { const v = roundHalfEven(num(a, 0, 'Hex')); return (v < 0 ? (v >>> 0) : v).toString(16).toUpperCase(); });
  def('Oct', (a) => { const v = roundHalfEven(num(a, 0, 'Oct')); return (v < 0 ? (v >>> 0) : v).toString(8); });
  def('Chr', (a) => String.fromCharCode(roundHalfEven(num(a, 0, 'Chr'))));
  def('ChrW', (a) => String.fromCharCode(roundHalfEven(num(a, 0, 'ChrW'))));
  def('Asc', (a) => { const s = str(a, 0); if (!s.length) throw new VbsRuntimeError('Invalid procedure call: Asc of empty string', null, 5); return s.charCodeAt(0); });
  def('AscW', (a) => { const s = str(a, 0); if (!s.length) throw new VbsRuntimeError('Invalid procedure call: AscW of empty string', null, 5); return s.charCodeAt(0); });
  def('RGB', (a) => vbRGB(num(a, 0, 'RGB'), num(a, 1, 'RGB'), num(a, 2, 'RGB')));

  // ---- type inspection ----
  def('IsEmpty', (a) => a[0] === undefined);
  def('IsNull', (a) => a[0] instanceof VbNullType);
  def('IsNothing', (a) => a[0] === null);
  def('IsObject', (a) => a[0] === null || (typeof a[0] === 'object' && !(a[0] instanceof VbArray) && !(a[0] instanceof VbNullType)));
  def('IsArray', (a) => a[0] instanceof VbArray);
  def('IsNumeric', (a) => typeof a[0] === 'number' || typeof a[0] === 'boolean' || (typeof a[0] === 'string' && isNumericString(a[0])));
  def('IsDate', () => false);
  def('TypeName', (a) => host.typeNameOf(a[0]));
  def('VarType', (a) => {
    const v = a[0];
    if (v === undefined) return 0; if (v instanceof VbNullType) return 1; if (typeof v === 'boolean') return 11;
    if (typeof v === 'string') return 8; if (typeof v === 'number') return Number.isInteger(v) ? (Math.abs(v) <= 32767 ? 2 : 3) : 5;
    if (v instanceof VbArray) return 8204; return 9;
  });

  // ---- arrays ----
  def('Array', (a) => VbArray.fromList(a));
  def('LBound', () => 0);
  def('UBound', (a) => {
    const arr = a[0];
    if (!(arr instanceof VbArray)) throw new VbsRuntimeError('UBound: argument is not an array', null, 13);
    const dim = optNum(a, 1, 1);
    return arr.dims[dim - 1];
  });
  def('Split', (a) => {
    const s = str(a, 0);
    const delim = a.length > 1 && a[1] !== undefined ? str(a, 1) : ' ';
    const count = optNum(a, 2, -1);
    let parts = delim === '' ? [s] : s.split(delim);
    if (count >= 0 && parts.length > count) parts = [...parts.slice(0, count - 1), parts.slice(count - 1).join(delim)];
    return VbArray.fromList(parts);
  });
  def('Join', (a) => {
    const arr = a[0];
    if (!(arr instanceof VbArray)) throw new VbsRuntimeError('Join: argument is not an array', null, 13);
    const delim = a.length > 1 && a[1] !== undefined ? str(a, 1) : ' ';
    return arr.toList().map((v) => toStr(v)).join(delim);
  });
  def('Filter', (a) => {
    const arr = a[0];
    if (!(arr instanceof VbArray)) throw new VbsRuntimeError('Filter: argument is not an array', null, 13);
    const needle = str(a, 1);
    const include = a.length > 2 && a[2] !== undefined ? toBool(a[2]) : true;
    return VbArray.fromList(arr.toList().filter((v) => toStr(v).includes(needle) === include));
  });

  // ---- strings ----
  def('Len', (a) => (a[0] instanceof VbNullType ? VbNull : str(a, 0).length));
  def('Left', (a) => str(a, 0).slice(0, Math.max(0, roundHalfEven(num(a, 1, 'Left')))));
  def('Right', (a) => { const s = str(a, 0); const n = Math.max(0, roundHalfEven(num(a, 1, 'Right'))); return n === 0 ? '' : s.slice(-n); });
  def('Mid', (a) => {
    const s = str(a, 0);
    const start = roundHalfEven(num(a, 1, 'Mid'));
    if (start < 1) throw new VbsRuntimeError('Invalid procedure call: Mid start must be >= 1', null, 5);
    if (a.length > 2 && a[2] !== undefined) return s.substr(start - 1, Math.max(0, roundHalfEven(toNumber(a[2]))));
    return s.slice(start - 1);
  });
  def('UCase', (a) => str(a, 0).toUpperCase());
  def('LCase', (a) => str(a, 0).toLowerCase());
  def('Trim', (a) => str(a, 0).replace(/^ +| +$/g, ''));
  def('LTrim', (a) => str(a, 0).replace(/^ +/, ''));
  def('RTrim', (a) => str(a, 0).replace(/ +$/, ''));
  def('Space', (a) => ' '.repeat(Math.max(0, roundHalfEven(num(a, 0, 'Space')))));
  def('String', (a) => { const n = Math.max(0, roundHalfEven(num(a, 0, 'String'))); const c = typeof a[1] === 'number' ? String.fromCharCode(a[1]) : str(a, 1).charAt(0); return c.repeat(n); });
  def('StrReverse', (a) => [...str(a, 0)].reverse().join(''));
  def('Replace', (a) => {
    const s = str(a, 0), find = str(a, 1), rep = str(a, 2);
    const start = optNum(a, 3, 1);
    const count = optNum(a, 4, -1);
    const compare = optNum(a, 5, 0);
    if (find === '') return s.slice(start - 1);
    let out = s.slice(start - 1);
    let n = 0;
    let idx = 0;
    const hay = compare === 1 ? out.toLowerCase() : out;
    const needle = compare === 1 ? find.toLowerCase() : find;
    let result = '';
    while (count < 0 || n < count) {
      const p = hay.indexOf(needle, idx);
      if (p < 0) break;
      result += out.slice(idx, p) + rep;
      idx = p + find.length;
      n++;
    }
    return result + out.slice(idx);
  });
  def('InStr', (a) => {
    // InStr([start,] string1, string2 [, compare])
    let i = 0;
    let start = 1;
    if (typeof a[0] === 'number' && a.length >= 3) { start = roundHalfEven(a[0]); i = 1; }
    const s = str(a, i), needle = str(a, i + 1);
    const compare = optNum(a, i + 2, 0);
    if (start < 1) throw new VbsRuntimeError('Invalid procedure call: InStr start must be >= 1', null, 5);
    const hay = compare === 1 ? s.toLowerCase() : s;
    const nd = compare === 1 ? needle.toLowerCase() : needle;
    if (nd === '') return start;
    const p = hay.indexOf(nd, start - 1);
    return p < 0 ? 0 : p + 1;
  });
  def('InStrRev', (a) => {
    const s = str(a, 0), needle = str(a, 1);
    const start = optNum(a, 2, -1);
    const compare = optNum(a, 3, 0);
    const hay = compare === 1 ? s.toLowerCase() : s;
    const nd = compare === 1 ? needle.toLowerCase() : needle;
    const from = start < 0 ? hay.length : start;
    const p = hay.lastIndexOf(nd, from - nd.length);
    return p < 0 ? 0 : p + 1;
  });
  def('StrComp', (a) => {
    let x = str(a, 0), y = str(a, 1);
    if (optNum(a, 2, 0) === 1) { x = x.toLowerCase(); y = y.toLowerCase(); }
    return x < y ? -1 : x > y ? 1 : 0;
  });
  def('FormatNumber', (a) => {
    const v = num(a, 0, 'FormatNumber');
    const digits = optNum(a, 1, 2);
    const useGrouping = optNum(a, 3, -2) !== 0;
    const s = v.toFixed(digits < 0 ? 2 : digits);
    if (!useGrouping) return s;
    const [ip, fp] = s.split('.');
    const grouped = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fp !== undefined ? `${grouped}.${fp}` : grouped;
  });
  def('FormatPercent', (a) => (num(a, 0, 'FormatPercent') * 100).toFixed(optNum(a, 1, 2)) + '%');
  def('FormatCurrency', (a) => '$' + num(a, 0, 'FormatCurrency').toFixed(optNum(a, 1, 2)));
  def('FormatDateTime', (a) => str(a, 0));
  def('Escape', (a) => encodeURIComponent(str(a, 0)));
  def('Unescape', (a) => decodeURIComponent(str(a, 0)));
  def('ScriptEngine', () => 'VBScript');
  def('ScriptEngineMajorVersion', () => 5);
  def('ScriptEngineMinorVersion', () => 8);

  return m;
}

export { formatNumber, typeName };

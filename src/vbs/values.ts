import type { Span } from './ast';

// ---- Runtime value model ----
// number | string | boolean          → VBScript numeric/string/boolean variants
// undefined                          → Empty
// null                               → Nothing (object reference not set)
// VbNull                             → Null
// VbArray                            → arrays (single or multi dimensional)
// other objects                      → host objects (FlexDMD actors...), class instances, procedure references

export class VbNullType { toString() { return 'Null'; } }
export const VbNull = new VbNullType();

export type VbValue = number | string | boolean | undefined | null | VbNullType | VbArray | object;

export class VbsRuntimeError extends Error {
  constructor(message: string, public span: Span | null = null, public number = 500) {
    super(message);
    this.name = 'VbsRuntimeError';
  }
}

export class VbArray {
  // Upper bounds per dimension (VBScript arrays are 0-based with inclusive upper bounds)
  public dims: number[];
  public data: VbValue[];
  public dynamic: boolean;
  constructor(dims: number[], dynamic = false) {
    this.dims = dims.slice();
    this.dynamic = dynamic;
    this.data = new Array(this.size()).fill(undefined);
  }
  static fromList(values: VbValue[]): VbArray {
    const a = new VbArray([values.length - 1], true);
    a.data = values.slice();
    return a;
  }
  size(): number { return this.dims.reduce((acc, d) => acc * (d + 1), 1); }
  index(indices: number[]): number {
    if (indices.length !== this.dims.length) throw new VbsRuntimeError(`Wrong number of dimensions: expected ${this.dims.length}, got ${indices.length}`, null, 9);
    let idx = 0;
    for (let i = 0; i < indices.length; i++) {
      const ix = Math.trunc(indices[i]);
      if (ix < 0 || ix > this.dims[i]) throw new VbsRuntimeError(`Subscript out of range: ${ix} (0..${this.dims[i]})`, null, 9);
      idx = idx * (this.dims[i] + 1) + ix;
    }
    return idx;
  }
  get(indices: number[]): VbValue { return this.data[this.index(indices)]; }
  set(indices: number[], value: VbValue) { this.data[this.index(indices)] = value; }
  redim(dims: number[], preserve: boolean) {
    if (!preserve) {
      this.dims = dims.slice();
      this.data = new Array(this.size()).fill(undefined);
      return;
    }
    if (dims.length !== this.dims.length) throw new VbsRuntimeError('ReDim Preserve cannot change the number of dimensions', null, 9);
    const old = this.data;
    const oldDims = this.dims;
    this.dims = dims.slice();
    this.data = new Array(this.size()).fill(undefined);
    // Only the last dimension may change with Preserve; copy overlapping range
    const count = Math.min(old.length, this.data.length);
    if (dims.length === 1) { for (let i = 0; i < count; i++) this.data[i] = old[i]; return; }
    const oldStride = oldDims[oldDims.length - 1] + 1;
    const newStride = dims[dims.length - 1] + 1;
    const rows = old.length / oldStride;
    for (let r = 0; r < rows; r++) for (let c = 0; c < Math.min(oldStride, newStride); c++) this.data[r * newStride + c] = old[r * oldStride + c];
  }
  toList(): VbValue[] { return this.data.slice(); }
}

// ---- Conversions ----

export function typeName(v: VbValue): string {
  if (v === undefined) return 'Empty';
  if (v === null) return 'Nothing';
  if (v instanceof VbNullType) return 'Null';
  if (typeof v === 'boolean') return 'Boolean';
  if (typeof v === 'string') return 'String';
  if (typeof v === 'number') return Number.isInteger(v) ? (Math.abs(v) <= 32767 ? 'Integer' : 'Long') : 'Double';
  if (v instanceof VbArray) return 'Variant()';
  const ctor = (v as object).constructor?.name;
  return ctor || 'Object';
}

export function isObjectValue(v: VbValue): boolean {
  return v === null || (typeof v === 'object' && !(v instanceof VbArray) && !(v instanceof VbNullType));
}

export function toNumber(v: VbValue, what = 'value'): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? -1 : 0;
  if (v === undefined) return 0;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return 0;
    if (/^&h[0-9a-f]+$/i.test(s)) return parseInt(s.slice(2), 16);
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return parseFloat(s);
    throw new VbsRuntimeError(`Type mismatch: cannot convert "${v}" to a number`, null, 13);
  }
  if (v instanceof VbNullType) throw new VbsRuntimeError('Invalid use of Null', null, 94);
  if (v === null) throw new VbsRuntimeError('Object variable not set', null, 91);
  throw new VbsRuntimeError(`Type mismatch: expected a number for ${what} but got ${typeName(v)}`, null, 13);
}

export function toInt(v: VbValue): number {
  const n = toNumber(v);
  // VBScript rounds half to even when converting to integer (banker's rounding)
  return roundHalfEven(n);
}

export function roundHalfEven(n: number): number {
  const f = Math.floor(n);
  const diff = n - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

export function toBool(v: VbValue): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v === undefined) return false;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
    return toNumber(v) !== 0;
  }
  if (v instanceof VbNullType) throw new VbsRuntimeError('Invalid use of Null', null, 94);
  if (v === null) return false; // Not really allowed in VBScript, but makes "If obj Then" tolerant
  throw new VbsRuntimeError(`Type mismatch: expected a boolean but got ${typeName(v)}`, null, 13);
}

export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  if (!Number.isFinite(n)) return String(n);
  // VBScript prints up to 15 significant digits
  let s = parseFloat(n.toPrecision(15)).toString();
  if (s.startsWith('0.')) s = s.slice(1); // VBScript prints .5 for 0.5
  else if (s.startsWith('-0.')) s = '-' + s.slice(2);
  return s;
}

export function toStr(v: VbValue): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (v === undefined) return '';
  if (v instanceof VbNullType) return 'Null';
  if (v === null) throw new VbsRuntimeError('Object variable not set', null, 91);
  if (v instanceof VbArray) throw new VbsRuntimeError('Type mismatch: cannot convert an array to a string', null, 13);
  if (typeof (v as { toString?: unknown }).toString === 'function' && (v as object).toString !== Object.prototype.toString) return String(v);
  throw new VbsRuntimeError(`Type mismatch: cannot convert ${typeName(v)} to a string`, null, 13);
}

export function isNumericString(s: string): boolean {
  const t = s.trim();
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) || /^&h[0-9a-f]+$/i.test(t);
}

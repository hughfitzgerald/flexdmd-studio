// Scripting.Dictionary, the one CreateObject a table script cannot do without.
//
// Frameworks built on top of VPX use it for everything: event tables, player state, machine
// variables. Standing in for it would leave all of that empty, so the previewer implements it.
import { toStr, VbArray, VbsRuntimeError, type VbValue } from './values';

/** Binary (case sensitive) is VBScript's default; 1 is text, which compares strings case-insensitively. */
const TEXT_COMPARE = 1;

export class VbDictionary {
  private _map = new Map<unknown, VbValue>();
  private _mode = 0;

  private keyOf(key: VbValue): unknown {
    if (this._mode === TEXT_COMPARE && typeof key === 'string') return key.toLowerCase();
    return key;
  }

  get CompareMode(): number { return this._mode; }
  set CompareMode(v: number) {
    if (this._map.size > 0) throw new VbsRuntimeError('CompareMode cannot change once the dictionary has entries', null, 5);
    this._mode = Math.trunc(Number(v));
  }

  get Count(): number { return this._map.size; }

  Add(key: VbValue, value: VbValue): void {
    const k = this.keyOf(key);
    if (this._map.has(k)) throw new VbsRuntimeError(`This key is already associated with an element of this collection: '${toStr(key)}'`, null, 457);
    this._map.set(k, value);
  }

  Exists(key: VbValue): boolean { return this._map.has(this.keyOf(key)); }

  /** Reading a key that is not there adds it as Empty, which is what VBScript does. */
  Item(key: VbValue): VbValue {
    const k = this.keyOf(key);
    if (!this._map.has(k)) this._map.set(k, undefined);
    return this._map.get(k);
  }

  Remove(key: VbValue): void {
    const k = this.keyOf(key);
    if (!this._map.has(k)) throw new VbsRuntimeError(`Element not found: '${toStr(key)}'`, null, 32811);
    this._map.delete(k);
  }

  RemoveAll(): void { this._map.clear(); }

  Keys(): VbArray { return VbArray.fromList([...this._map.keys()] as VbValue[]); }

  Items(): VbArray { return VbArray.fromList([...this._map.values()]); }

  /** Renaming a key in place, as VBScript's Key property does. */
  Key(oldKey: VbValue, newKey: VbValue): void {
    const from = this.keyOf(oldKey);
    if (!this._map.has(from)) throw new VbsRuntimeError(`Element not found: '${toStr(oldKey)}'`, null, 32811);
    const value = this._map.get(from);
    this._map.delete(from);
    this._map.set(this.keyOf(newKey), value);
  }

  // ---- hooks the interpreter uses for d(key) and d.Item(key) = value ----

  /** d(key) */
  vbIndex(args: VbValue[]): VbValue { return this.Item(args[0]); }

  /** d(key) = value and d.Item(key) = value */
  vbSetIndexed(name: string, args: VbValue[], value: VbValue): boolean {
    const n = name.toLowerCase();
    if (n === 'item' || n === '') { this._map.set(this.keyOf(args[0]), value); return true; }
    if (n === 'key') { this.Key(args[0], value); return true; }
    return false;
  }

  /** For Each over a dictionary walks its keys. */
  [Symbol.iterator](): Iterator<VbValue> { return (this._map.keys() as Iterable<VbValue>)[Symbol.iterator](); }

  toString() { return '[object Dictionary]'; }
}

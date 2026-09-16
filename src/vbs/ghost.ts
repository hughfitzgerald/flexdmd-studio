// Stand-ins for everything a table script touches that the previewer does not provide:
// table objects, lights, timers, sound, and whatever framework the table is built on.
//
// A Ghost absorbs any use. Reading a property, calling a method or indexing it yields another
// Ghost; assigning to it does nothing; and in a value context it behaves exactly like Empty
// (0, "", False). That lets a whole table script run so the FlexDMD parts of it can be previewed,
// without anyone having to hand-write stubs.
//
// Only identifiers the script never declares become ghosts. A typo on a real actor
// (lbl.SetAlignedPositon) still raises an error, so mistakes in the DMD code are not swallowed.

export class Ghost {
  constructor(readonly path: string) {}
  toString() { return ''; }
}

export class GhostRegistry {
  /** When false the interpreter reports unknown identifiers as errors instead of stubbing them. */
  enabled = true;
  private _counts = new Map<string, number>();
  private _cache = new Map<string, Ghost>();

  /** Records a use and returns the stand-in for that path. */
  touch(path: string): Ghost {
    this._counts.set(path, (this._counts.get(path) ?? 0) + 1);
    let g = this._cache.get(path);
    if (!g) { g = new Ghost(path); this._cache.set(path, g); }
    return g;
  }

  member(target: Ghost, name: string, called: boolean): Ghost {
    return this.touch(`${target.path}.${name}${called ? '()' : ''}`);
  }

  /** What was stubbed, most used first. */
  list(): { path: string; count: number }[] {
    return [...this._counts.entries()].map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
  }

  get size() { return this._counts.size; }
  clear() { this._counts.clear(); this._cache.clear(); }
}

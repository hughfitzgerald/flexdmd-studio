// The set of .vbs files that make up what gets run.
//
// Table DMD code is often split across files — a config file listing the scenes, a scenes file with
// the builders and tickers, and a harness that stands in for the table's own glue. Running means
// concatenating the included files, so a line number in the combined source has to be traced back
// to the file it came from.

export interface ProjectFile {
  path: string;
  content: string;
  /** Included files are concatenated, in this order, to form the script that runs */
  included: boolean;
  /** True when the file came from the opened folder rather than being the scratch buffer */
  fromDisk: boolean;
}

export interface SourceMapEntry { path: string; startLine: number; lineCount: number; startChar: number; charCount: number; }

export interface BuiltSource { text: string; map: SourceMapEntry[]; }

export const SCRATCH = 'scene.vbs';

export class Project {
  files: ProjectFile[] = [];
  activePath = SCRATCH;

  constructor(scratchContent: string) {
    this.files.push({ path: SCRATCH, content: scratchContent, included: true, fromDisk: false });
  }

  get active(): ProjectFile {
    return this.files.find((f) => f.path === this.activePath) ?? this.files[0];
  }

  get(path: string): ProjectFile | undefined { return this.files.find((f) => f.path === path); }

  setActive(path: string) { if (this.get(path)) this.activePath = path; }

  /** Replaces the disk-backed files, keeping the scratch buffer and any include choices already made. */
  setDiskFiles(loaded: { path: string; content: string }[]) {
    const previous = new Map(this.files.map((f) => [f.path, f]));
    const scratch = this.files.filter((f) => !f.fromDisk);
    const disk = loaded.map((l) => ({
      path: l.path,
      content: l.content,
      // A file the user has seen before keeps its choice; new ones start excluded so opening a
      // folder full of table scripts does not suddenly try to run all of them.
      included: previous.get(l.path)?.included ?? false,
      fromDisk: true,
    }));
    this.files = [...scratch, ...disk];
    if (!this.get(this.activePath)) this.activePath = this.files[0].path;
  }

  setContent(path: string, content: string) {
    const f = this.get(path);
    if (f) f.content = content;
  }

  toggle(path: string, included: boolean) {
    const f = this.get(path);
    if (f) f.included = included;
  }

  move(path: string, delta: number) {
    const i = this.files.findIndex((f) => f.path === path);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.files.length) return;
    const [f] = this.files.splice(i, 1);
    this.files.splice(j, 0, f);
  }

  get included(): ProjectFile[] { return this.files.filter((f) => f.included); }

  /** The script that runs, plus where each part of it came from. */
  build(): BuiltSource {
    const parts: string[] = [];
    const map: SourceMapEntry[] = [];
    let line = 1;
    let char = 0;
    for (const f of this.included) {
      const lineCount = f.content.split('\n').length;
      map.push({ path: f.path, startLine: line, lineCount, startChar: char, charCount: f.content.length });
      parts.push(f.content);
      line += lineCount;
      char += f.content.length + 1; // the newline join() inserts between files
    }
    return { text: parts.join('\n'), map };
  }

  /** Maps a line in the combined source back to a file and its line number. */
  static locate(map: SourceMapEntry[], line: number): { path: string; line: number } | null {
    for (const e of map) {
      if (line >= e.startLine && line < e.startLine + e.lineCount) return { path: e.path, line: line - e.startLine + 1 };
    }
    return null;
  }
}

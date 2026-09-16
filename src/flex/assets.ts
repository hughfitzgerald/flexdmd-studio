// Ported from FlexDMD (https://github.com/vbousquet/flexdmd), Copyright 2019 Vincent Bousquet,
// licensed under the Apache License 2.0. TypeScript translation of FlexDMD/AssetManager.cs and FlexDMD/BitmapFilter.cs, modified
// from the original. See the NOTICE file at the repository root.
// Assets come from two places: the resources bundled with FlexDMD ("FlexDMD.Resources.xxx", served from ./FlexDMD.Resources/)
// and a project folder the user opened in the browser (plain files: png/jpg/bmp/gif/mp4/fnt).
// Loading is asynchronous, but scripts are synchronous: a request for an asset that is not loaded yet throws
// AssetPendingError; the runner waits for loadPending() and re-runs the script.
import { parseGIF, decompressFrames } from 'gifuct-js';
import { fromArgbHex, WHITE, type Color } from './color';
import { Font, parseBmFont, toCanvas, type BitmapFontData } from './font';
import type { GifData } from './animated';

export const BUILTIN_RESOURCES = [
  'bm_army-12.fnt', 'bm_army-12.png', 'colors.png', 'teeny_tiny_pixls-5.fnt', 'teeny_tiny_pixls-5.png',
  'udmd-f12by24.fnt', 'udmd-f12by24.png', 'udmd-f14by26.fnt', 'udmd-f14by26.png', 'udmd-f4by5.fnt', 'udmd-f4by5.png',
  'udmd-f5by7.fnt', 'udmd-f5by7.png', 'udmd-f6by12.fnt', 'udmd-f6by12.png', 'udmd-f7by13.fnt', 'udmd-f7by13.png',
  'udmd-f7by5.fnt', 'udmd-f7by5.png', 'zx_spectrum-7.fnt', 'zx_spectrum-7.png', 'dmds/black.png',
];

/** Stand-in used when a .fnt the script names is not in the opened folder */
const FALLBACK_FONT = 'udmd-f5by7.fnt';

export type AssetType = 'image' | 'video' | 'gif' | 'font' | 'unknown';
export type SrcType = 'file' | 'flex' | 'vpx';

export interface BitmapFilter { name: string; apply(src: HTMLCanvasElement): HTMLCanvasElement; }

export interface AssetSrc {
  id: string;
  srcType: SrcType;
  path: string; // resource name (flex), relative path (file) or vpx name
  assetType: AssetType;
  filters: BitmapFilter[];
  fontTint: Color;
  fontBorderTint: Color;
  fontBorderSize: number;
}

export class AssetPendingError extends Error {
  constructor(public path: string) { super(`Asset is still loading: ${path}`); this.name = 'AssetPendingError'; }
}

export class AssetLoadError extends Error {
  constructor(message: string) { super(message); this.name = 'AssetLoadError'; }
}

interface RawEntry {
  state: 'loading' | 'ready' | 'error';
  promise: Promise<void>;
  error?: string;
  image?: HTMLCanvasElement;
  text?: string;
  gif?: GifData;
  video?: HTMLVideoElement;
}

export class AssetManager {
  /** FlexDMD.ProjectFolder as set by the script */
  basePath = './';
  tableFile: string | null = null;
  /** Used by video actors to follow the preview clock */
  clockRunning = false;
  /** Base URL for the bundled resources */
  builtinBase = './FlexDMD.Resources/';
  private _files = new Map<string, File>();
  private _fileUrls = new Map<File, string>();
  private _raw = new Map<string, RawEntry>();
  private _bitmaps = new Map<string, HTMLCanvasElement>();
  private _fonts = new Map<string, Font>();
  private _pending = new Set<Promise<void>>();
  /**
   * When a file is missing, stand in for it rather than failing the whole script. Previewing a
   * table whose artwork you do not have is the common case, and seeing the layout with placeholders
   * beats seeing nothing. Every substitution is logged.
   */
  substituteMissing = true;
  private _warned = new Set<string>();
  onLog: (level: 'info' | 'warn' | 'error', message: string) => void = () => {};

  // ---- project folder ----

  setProjectFiles(files: Iterable<File>, stripRoot = true) {
    for (const url of this._fileUrls.values()) URL.revokeObjectURL(url);
    this._fileUrls.clear();
    this._files.clear();
    for (const f of files) {
      let rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      rel = normalizePath(rel);
      if (stripRoot && rel.includes('/')) rel = rel.substring(rel.indexOf('/') + 1);
      this._files.set(rel.toLowerCase(), f);
    }
    this.invalidateProjectAssets();
  }

  addProjectFile(relPath: string, file: File) {
    this._files.set(normalizePath(relPath).toLowerCase(), file);
    this.invalidateProjectAssets();
  }

  get projectFiles(): ReadonlyMap<string, File> { return this._files; }

  private invalidateProjectAssets() {
    this._warned.clear();
    for (const k of [...this._raw.keys()]) if (k.startsWith('file:')) this._raw.delete(k);
    for (const k of [...this._bitmaps.keys()]) if (!k.startsWith('FlexDMD.Resources.')) this._bitmaps.delete(k);
    for (const k of [...this._fonts.keys()]) if (!k.startsWith('FlexDMD.Resources.')) this._fonts.delete(k);
  }

  /** Finds a project file for a script path, trying the project folder prefix and a few lenient fallbacks. */
  findProjectFile(path: string): { file: File; key: string } | null {
    const p = normalizePath(path).toLowerCase();
    const base = normalizePath(this.basePath).toLowerCase();
    const candidates = [normalizePath(base + '/' + p), p];
    for (const c of [...candidates]) {
      // Allow the opened folder to be the project folder itself (e.g. ProjectFolder = "./MyTable/")
      const parts = c.split('/');
      for (let i = 1; i < parts.length; i++) candidates.push(parts.slice(i).join('/'));
    }
    for (const c of candidates) {
      const f = this._files.get(c);
      if (f) return { file: f, key: c };
    }
    // Last resort: suffix match on the file name
    const suffix = '/' + p.split('/').pop();
    for (const [k, f] of this._files) if (k.endsWith(suffix) || k === suffix.substring(1)) return { file: f, key: k };
    return null;
  }

  fileUrl(file: File): string {
    let u = this._fileUrls.get(file);
    if (!u) { u = URL.createObjectURL(file); this._fileUrls.set(file, u); }
    return u;
  }

  // ---- source resolution (port of AssetManager.ResolveSrc) ----

  resolveSrc(src: string, baseSrc: AssetSrc | null = null): AssetSrc {
    src = String(src);
    if (src.includes('|')) throw new Error("'|' is not allowed inside file names as it is the separator for image sequences");
    const parts = src.split('&');
    if (baseSrc) {
      if (baseSrc.srcType === 'flex') parts[0] = 'FlexDMD.Resources.' + parts[0];
      else if (baseSrc.srcType === 'vpx') parts[0] = 'VPX.' + parts[0];
      else if (baseSrc.srcType === 'file') parts[0] = joinPath(dirName(baseSrc.path), parts[0]);
    }
    const def: AssetSrc = { id: parts.join('&'), srcType: 'file', path: '', assetType: 'unknown', filters: [], fontTint: WHITE, fontBorderTint: WHITE, fontBorderSize: 0 };
    let ext = parts[0].length > 4 ? parts[0].slice(-4).toLowerCase() : '';
    if (parts[0].startsWith('FlexDMD.Resources.')) {
      def.srcType = 'flex';
      def.path = parts[0];
    } else if (parts[0].startsWith('VPX.')) {
      def.srcType = 'vpx';
      def.path = parts[0].substring(4);
      ext = '';
      def.assetType = 'image';
    } else {
      def.srcType = 'file';
      def.path = normalizePath(parts[0]);
    }
    if (ext === '.png' || ext === '.jpg' || ext === 'jpeg' || ext === '.bmp') def.assetType = 'image';
    else if (ext === '.wmv' || ext === '.avi' || ext === '.mp4') def.assetType = 'video';
    else if (ext === '.gif') def.assetType = 'gif';
    else if (ext === '.fnt') def.assetType = 'font';
    if (def.assetType === 'image') {
      for (const definition of parts.slice(1)) {
        if (definition.startsWith('dmd=') && Number.isInteger(+definition.substring(4))) def.filters.push(dotFilter(+definition.substring(4)));
        else if (definition.startsWith('dmd2=') && Number.isInteger(+definition.substring(5))) def.filters.push(dotFilter(+definition.substring(5)));
        else if (definition.startsWith('add')) def.filters.push(additiveFilter());
        else if (definition.startsWith('region=')) { const r = definition.substring(7).split(',').map((v) => parseInt(v, 10)); def.filters.push(regionFilter(r[0], r[1], r[2], r[3])); }
        else if (definition.startsWith('pad=')) { const r = definition.substring(4).split(',').map((v) => parseInt(v, 10)); def.filters.push(padFilter(r[0], r[1], r[2], r[3])); }
        else this.onLog('error', `Unsupported Bitmap parameter in ${src}: ${definition}`);
      }
    } else if (def.assetType === 'font') {
      for (const definition of parts.slice(1)) {
        if (definition.startsWith('tint=')) def.fontTint = fromArgbHex(definition.substring(5));
        else if (definition.startsWith('border_tint=')) def.fontBorderTint = fromArgbHex(definition.substring(12));
        else if (definition.startsWith('border_size=')) def.fontBorderSize = parseInt(definition.substring(12), 10) || 0;
        else this.onLog('error', `Unsupported Font parameter in ${src}: ${definition}`);
      }
    } else if (def.assetType === 'unknown') {
      this.onLog('error', `Failed to resolve asset '${src}': unknown asset type`);
    }
    return def;
  }

  // ---- raw loading ----

  private rawKey(src: AssetSrc, path = src.path): string { return `${src.srcType}:${path}`; }

  private urlFor(src: AssetSrc, path: string): string {
    if (src.srcType === 'flex') {
      const name = path.startsWith('FlexDMD.Resources.') ? path.substring('FlexDMD.Resources.'.length) : path;
      const res = BUILTIN_RESOURCES.find((r) => r.replace(/\//g, '.') === name);
      if (!res) throw new AssetLoadError(`Unknown FlexDMD resource: ${path}`);
      return this.builtinBase + res;
    }
    if (src.srcType === 'vpx') throw new AssetLoadError(`VPX embedded resources ('VPX.${path}') are not supported by FlexDMD Studio. Use a file from the project folder instead.`);
    const found = this.findProjectFile(path);
    if (!found) throw new AssetLoadError(this._files.size === 0 ? `File '${path}' not found: open the project folder containing your assets (toolbar > Open folder)` : `File '${path}' not found in the opened project folder`);
    return this.fileUrl(found.file);
  }

  private ensureRaw(src: AssetSrc, path: string, kind: 'image' | 'text' | 'gif' | 'video'): RawEntry {
    const key = this.rawKey(src, path);
    let entry = this._raw.get(key);
    if (entry) {
      if (entry.state === 'loading') { this._pending.add(entry.promise); throw new AssetPendingError(path); }
      if (entry.state === 'error') throw new AssetLoadError(entry.error ?? `Failed to load ${path}`);
      return entry;
    }
    let url: string;
    try { url = this.urlFor(src, path); } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._raw.set(key, { state: 'error', error: msg, promise: Promise.resolve() });
      throw e;
    }
    const e: RawEntry = { state: 'loading', promise: Promise.resolve() };
    e.promise = this.load(url, kind, path).then((r) => { Object.assign(e, r); e.state = 'ready'; }).catch((err) => { e.state = 'error'; e.error = err instanceof Error ? err.message : String(err); this.onLog('error', e.error); });
    this._raw.set(key, e);
    this._pending.add(e.promise);
    throw new AssetPendingError(path);
  }

  private async load(url: string, kind: 'image' | 'text' | 'gif' | 'video', path: string): Promise<Partial<RawEntry>> {
    switch (kind) {
      case 'text': {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Failed to load '${path}' (${r.status})`);
        return { text: await r.text() };
      }
      case 'image': {
        const img = new window.Image();
        img.decoding = 'async';
        await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error(`Failed to decode image '${path}'`)); img.src = url; });
        return { image: toCanvas(img) };
      }
      case 'gif': {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Failed to load '${path}' (${r.status})`);
        return { gif: decodeGif(await r.arrayBuffer()) };
      }
      case 'video': {
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.preload = 'auto';
        v.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => {
          v.onloadeddata = () => resolve();
          v.onerror = () => reject(new Error(`Failed to load video '${path}' (only MP4/H.264 is supported by browsers)`));
          v.src = url;
          v.load();
        });
        return { video: v };
      }
    }
  }

  // ---- typed getters ----

  getBitmap(src: AssetSrc): HTMLCanvasElement {
    const cached = this._bitmaps.get(src.id);
    if (cached) return cached;
    if (src.assetType !== 'image') throw new AssetLoadError(`'${src.path}' is not an image`);
    let raw: RawEntry;
    try {
      raw = this.ensureRaw(src, src.path, 'image');
    } catch (e) {
      if (e instanceof AssetPendingError || !this.substituteMissing) throw e;
      this.warnMissing(src.path, 'image');
      const ph = placeholderBitmap();
      this._bitmaps.set(src.id, ph);
      return ph;
    }
    let bmp = raw.image!;
    for (const f of src.filters) bmp = f.apply(bmp);
    this._bitmaps.set(src.id, bmp);
    return bmp;
  }

  getGif(src: AssetSrc): GifData {
    if (src.assetType !== 'gif') throw new AssetLoadError(`'${src.path}' is not a GIF`);
    try {
      return this.ensureRaw(src, src.path, 'gif').gif!;
    } catch (e) {
      if (e instanceof AssetPendingError || !this.substituteMissing) throw e;
      this.warnMissing(src.path, 'animation');
      return AssetManager.placeholderGif();
    }
  }

  /** A single still frame, used when an animation or video file is not there. */
  static placeholderGif(): GifData {
    const frame = placeholderBitmap();
    return { width: frame.width, height: frame.height, frames: [frame], delays: [1] };
  }

  getVideo(src: AssetSrc): HTMLVideoElement {
    if (src.assetType !== 'video') throw new AssetLoadError(`'${src.path}' is not a video`);
    return this.ensureRaw(src, src.path, 'video').video!;
  }

  getFont(src: AssetSrc): Font {
    const cached = this._fonts.get(src.id);
    if (cached) return cached;
    if (src.assetType !== 'font') throw new AssetLoadError(`'${src.path}' is not a bitmap font (.fnt)`);
    let raw: RawEntry;
    try {
      raw = this.ensureRaw(src, src.path, 'text');
    } catch (e) {
      if (e instanceof AssetPendingError || !this.substituteMissing) throw e;
      this.warnMissing(src.path, 'font');
      // A bundled font of a similar size keeps the layout readable while the real one is missing
      const sub = this.resolveSrc(`FlexDMD.Resources.${FALLBACK_FONT}&tint=${src.id.split('tint=')[1]?.split('&')[0] ?? 'FFFFFFFF'}`);
      const font = this.getFont(sub);
      this._fonts.set(src.id, font);
      return font;
    }
    let data: BitmapFontData;
    try { data = parseBmFont(raw.text!); } catch (e) { throw new AssetLoadError(`Invalid font '${src.path}': ${e instanceof Error ? e.message : e}`); }
    const pages = data.pages.map((p) => {
      const pageSrc = this.resolveSrc(p, src);
      return this.ensureRaw(pageSrc, pageSrc.path, 'image').image!;
    });
    const font = new Font(data, pages, src.fontTint, src.fontBorderTint, src.fontBorderSize, src.id);
    this._fonts.set(src.id, font);
    return font;
  }

  // ---- pending management ----

  get hasPending(): boolean { return this._pending.size > 0; }

  async loadPending(): Promise<void> {
    while (this._pending.size > 0) {
      const batch = [...this._pending];
      this._pending.clear();
      await Promise.all(batch);
    }
  }

  /** Warms the cache with the resources bundled with FlexDMD so the first run needs no reload. */
  async preloadBuiltins(): Promise<void> {
    for (const r of BUILTIN_RESOURCES) {
      const src = this.resolveSrc('FlexDMD.Resources.' + r.replace(/\//g, '.'));
      try { this.ensureRaw(src, src.path, src.assetType === 'font' ? 'text' : 'image'); } catch (e) { if (!(e instanceof AssetPendingError)) throw e; }
    }
    await this.loadPending();
  }

  private warnMissing(path: string, kind: string) {
    if (this._warned.has(path)) return;
    this._warned.add(path);
    this.onLog('warn', `Missing ${kind} '${path}': using a placeholder. Open the folder that holds it to see the real thing.`);
  }

  /** Files the script asked for that were not found, in the order they were first missed. */
  get missing(): string[] { return [...this._warned]; }

  listLoaded(): string[] { return [...this._raw.entries()].filter(([, e]) => e.state === 'ready').map(([k]) => k); }
}

// ---- helpers ----

export function normalizePath(p: string): string {
  let s = p.replace(/\\/g, '/');
  while (s.startsWith('./')) s = s.substring(2);
  s = s.replace(/\/+/g, '/');
  // resolve "a/../b"
  const out: string[] = [];
  for (const part of s.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') { out.pop(); continue; }
    out.push(part);
  }
  return out.join('/');
}
function dirName(p: string): string { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.substring(0, i); }
function joinPath(a: string, b: string): string { return normalizePath(a ? a + '/' + b : b); }

// ---- bitmap filters (port of BitmapFilter.cs) ----

function newCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  return [c, c.getContext('2d')!];
}

function regionFilter(x: number, y: number, width: number, height: number): BitmapFilter {
  return {
    name: `region=${x},${y},${width},${height}`,
    apply(src) { const [c, g] = newCanvas(width, height); g.drawImage(src, x, y, width, height, 0, 0, width, height); return c; },
  };
}

function padFilter(left: number, top: number, right: number, bottom: number): BitmapFilter {
  return {
    name: `pad=${left},${top},${right},${bottom}`,
    apply(src) { const [c, g] = newCanvas(src.width + left + right, src.height + top + bottom); g.drawImage(src, left, top); return c; },
  };
}

function dotFilter(dotSize: number): BitmapFilter {
  return {
    name: `dmd=${dotSize}`,
    apply(src) {
      const dw = Math.floor(src.width / dotSize), dh = Math.floor(src.height / dotSize);
      const s = src.getContext('2d')!.getImageData(0, 0, src.width, src.height).data;
      const [c, g] = newCanvas(dw, dh);
      const out = g.createImageData(Math.max(1, dw), Math.max(1, dh));
      const d = out.data;
      const bright = 1 + (dotSize * dotSize) / 1.8;
      for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) {
          let r = 0, gg = 0, b = 0, a = 0;
          for (let i = 0; i < dotSize; i++) for (let j = 0; j < dotSize; j++) {
            const p = ((y * dotSize + j) * src.width + (x * dotSize + i)) * 4;
            r += s[p]; gg += s[p + 1]; b += s[p + 2]; a += s[p + 3];
          }
          const o = (y * dw + x) * 4;
          d[o] = Math.min(r / bright, 255) | 0; d[o + 1] = Math.min(gg / bright, 255) | 0; d[o + 2] = Math.min(b / bright, 255) | 0; d[o + 3] = Math.min(a / bright, 255) | 0;
        }
      }
      g.putImageData(out, 0, 0);
      return c;
    },
  };
}

function additiveFilter(): BitmapFilter {
  return {
    name: 'add',
    apply(src) {
      const [c, g] = newCanvas(src.width, src.height);
      const img = src.getContext('2d')!.getImageData(0, 0, src.width, src.height);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 64 && d[i + 1] < 64 && d[i + 2] < 64) d[i + 3] = 0;
      g.putImageData(img, 0, 0);
      return c;
    },
  };
}

/** A visible stand-in for artwork that is not there, so a missing file reads as missing. */
function placeholderBitmap(): HTMLCanvasElement {
  const [c, g] = newCanvas(16, 16);
  g.fillStyle = '#301030';
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#a020a0';
  for (let y = 0; y < 16; y += 8) for (let x = 0; x < 16; x += 8) if (((x + y) / 8) % 2 === 0) g.fillRect(x, y, 8, 8);
  return c;
}

// ---- GIF decoding with full frame compositing ----

function decodeGif(buffer: ArrayBuffer): GifData {
  const gif = parseGIF(buffer);
  const frames = decompressFrames(gif, true);
  const width = gif.lsd.width, height = gif.lsd.height;
  const out: HTMLCanvasElement[] = [];
  const delays: number[] = [];
  const [work, wg] = newCanvas(width, height);
  const [patchCanvas, pg] = newCanvas(width, height);
  let previous: ImageData | null = null;
  for (const f of frames) {
    const dims = f.dims;
    if (f.disposalType === 3) previous = wg.getImageData(0, 0, width, height);
    patchCanvas.width = dims.width; patchCanvas.height = dims.height;
    pg.putImageData(new ImageData(new Uint8ClampedArray(f.patch), dims.width, dims.height), 0, 0);
    wg.drawImage(patchCanvas, dims.left, dims.top);
    const [snap, sg] = newCanvas(width, height);
    sg.drawImage(work, 0, 0);
    out.push(snap);
    // GDI+ reads the frame delay in 1/100 s; browsers treat 0 as "as fast as possible" which we clamp to 10 ms
    delays.push(Math.max(0.01, f.delay / 1000));
    if (f.disposalType === 2) wg.clearRect(dims.left, dims.top, dims.width, dims.height);
    else if (f.disposalType === 3 && previous) wg.putImageData(previous, 0, 0);
  }
  if (out.length === 0) throw new Error('GIF has no frames');
  return { width, height, frames: out, delays };
}

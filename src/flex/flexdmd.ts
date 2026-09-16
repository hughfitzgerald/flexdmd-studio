// Ported from FlexDMD (https://github.com/vbousquet/flexdmd), Copyright 2019 Vincent Bousquet,
// licensed under the Apache License 2.0. TypeScript translation of FlexDMD/FlexDMD.cs, modified
// from the original. See the NOTICE file at the repository root.
import { VbArray } from '../vbs/values';
import { AssetManager, AssetLoadError, AssetPendingError } from './assets';
import { Frame, Group } from './actor';
import { Image } from './image';
import { Label } from './label';
import { GIFImage, ImageSequence, VideoActor, type AnimatedActor } from './animated';
import { fromOle, toArgbHex, toOle, type Color } from './color';
import type { Font } from './font';

export enum RenderMode { DMD_GRAY_2 = 0, DMD_GRAY_4 = 1, DMD_RGB = 2 }
export const RenderModeNames = ['Gray 2 bits (4 shades)', 'Gray 4 bits (16 shades)', 'RGB'];

export type LogLevel = 'info' | 'warn' | 'error';

export class FlexDMD {
  readonly AssetManager = new AssetManager();
  private _stage: Group;
  private _frame: HTMLCanvasElement;
  private _ctx: CanvasRenderingContext2D;
  private _runtimeVersion = 1008;
  private _width = 128;
  private _height = 32;
  private _color: Color = { r: 0xff, g: 0x58, b: 0x20, a: 255 };
  private _renderMode: RenderMode = RenderMode.DMD_GRAY_4;
  private _run = false;
  private _gameName = '';
  Show = true;
  Clear = false;
  /** Simulated time in seconds since the last reset */
  time = 0;
  onLog: (level: LogLevel, message: string) => void = () => {};

  constructor() {
    this._stage = new Group({ RuntimeVersion: this._runtimeVersion, warn: (m) => this.onLog('warn', m) }, 'Stage');
    // Group keeps a reference to the flex descriptor; keep RuntimeVersion live
    Object.defineProperty(this._stage.flex, 'RuntimeVersion', { get: () => this._runtimeVersion });
    this._frame = document.createElement('canvas');
    this._frame.width = this._width;
    this._frame.height = this._height;
    this._ctx = this._frame.getContext('2d', { alpha: false, willReadFrequently: true })!;
    this._ctx.fillStyle = '#000';
    this._ctx.fillRect(0, 0, this._width, this._height);
    this._stage.SetSize(this._width, this._height);
    this._stage.OnStage = true;
    this.AssetManager.onLog = (l, m) => this.onLog(l, m);
  }

  // ---- script-facing properties ----
  get Version() { return 1009; }
  get RuntimeVersion() { return this._runtimeVersion; }
  set RuntimeVersion(v: number) { this._runtimeVersion = Math.trunc(Number(v)); }
  get Run() { return this._run; }
  set Run(v: boolean) { this._run = !!v; }
  get GameName() { return this._gameName; }
  set GameName(v: string) { this._gameName = String(v); }
  get Width() { return this._width; }
  set Width(v: number) { const w = Math.trunc(Number(v)); if (w < 1 || w === this._width) return; this._width = w; this.resize(); }
  get Height() { return this._height; }
  set Height(v: number) { const h = Math.trunc(Number(v)); if (h < 1 || h === this._height) return; this._height = h; this.resize(); }
  get Color() { return toOle(this._color); }
  set Color(v: number) { this._color = fromOle(Number(v)); }
  get color(): Color { return this._color; }
  get RenderMode() { return this._renderMode; }
  set RenderMode(v: number) {
    const m = Math.trunc(Number(v));
    if (m > 2) { this.onLog('warn', `Segment render modes (RenderMode=${m}) are not supported by the previewer; using RGB`); this._renderMode = RenderMode.DMD_RGB; return; }
    this._renderMode = m as RenderMode;
  }
  get ProjectFolder() { return this.AssetManager.basePath; }
  set ProjectFolder(v: string) { this.AssetManager.basePath = String(v); }
  get TableFile() { return this.AssetManager.tableFile ?? ''; }
  set TableFile(v: string) { this.AssetManager.tableFile = String(v); }
  get Stage() { return this._stage; }
  set Segments(_v: unknown) { /* segment displays are not previewed */ }
  get DmdPixels() { return VbArray.fromList(Array.from(this.luminance())); }
  get DmdColoredPixels() {
    const d = this._ctx.getImageData(0, 0, this._width, this._height).data;
    const out: number[] = new Array(this._width * this._height);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) out[p] = (d[i + 2] << 16) + (d[i + 1] << 8) + d[i];
    return VbArray.fromList(out);
  }

  LockRenderThread() {}
  UnlockRenderThread() {}

  NewGroup(name: string) { return new Group(this._stage.flex, String(name)); }
  NewFrame(name: string) { const f = new Frame(String(name)); return f; }
  NewLabel(name: string, font: Font, text: string) {
    if (font !== null && (typeof font !== 'object' || typeof (font as Font).drawText !== 'function')) throw new Error('NewLabel: font must be created with FlexDMD.NewFont');
    return new Label(this, font, text === undefined || text === null ? '' : String(text), String(name));
  }
  NewImage(name: string, image: string) { return new Image(this.AssetManager, String(image), String(name)); }
  NewVideo(name: string, path: string): AnimatedActor | null {
    path = String(path);
    try {
      if (path.includes('|')) return new ImageSequence(this.AssetManager, path, String(name));
      const src = this.AssetManager.resolveSrc(path);
      if (src.assetType === 'video') {
        try {
          return new VideoActor(this.AssetManager, path, String(name));
        } catch (e) {
          if (e instanceof AssetPendingError || !this.AssetManager.substituteMissing) throw e;
          // Scripts do "group.AddActor FlexDMD.NewVideo(...)" without checking, so returning
          // Nothing for a file that is simply not here would stop the whole scene being built.
          this.onLog('warn', `Missing video '${src.path}': using a placeholder.`);
          return new GIFImage(this.AssetManager, path, String(name), AssetManager.placeholderGif());
        }
      }
      if (src.assetType === 'gif') return new GIFImage(this.AssetManager, path, String(name));
      if (src.assetType === 'image') return new ImageSequence(this.AssetManager, path, String(name));
      this.onLog('error', `NewVideo('${name}', '${path}'): unsupported video type, returning Nothing`);
    } catch (e) {
      if (e instanceof AssetPendingError) throw e;
      // FlexDMD silently returns Nothing when a video fails to load; we do the same but log it
      this.onLog('error', `NewVideo('${name}', '${path}') failed: ${e instanceof Error ? e.message : e}`);
    }
    return null;
  }
  NewFont(font: string, tint: number, borderTint: number, borderSize: number): Font {
    const id = `${font}&tint=${toArgbHex(fromOle(Number(tint)))}&border_size=${Math.trunc(Number(borderSize))}&border_tint=${toArgbHex(fromOle(Number(borderTint)))}`;
    return this.AssetManager.getFont(this.AssetManager.resolveSrc(id));
  }
  NewUltraDMD(): never { throw new Error('The UltraDMD API is not supported by FlexDMD Studio (FlexDMD scene API only)'); }

  // ---- preview API ----

  get frame(): HTMLCanvasElement { return this._frame; }

  private resize() {
    this._frame.width = this._width;
    this._frame.height = this._height;
    this._ctx = this._frame.getContext('2d', { alpha: false, willReadFrequently: true })!;
    this._ctx.fillStyle = '#000';
    this._ctx.fillRect(0, 0, this._width, this._height);
    this._stage.SetSize(this._width, this._height);
  }

  /** Restores the script-facing properties to FlexDMD's defaults and clears the stage (used before re-running a script) */
  resetToDefaults() {
    this._runtimeVersion = 1008;
    this._color = { r: 0xff, g: 0x58, b: 0x20, a: 255 };
    this._renderMode = RenderMode.DMD_GRAY_4;
    this._run = false;
    this.Show = true;
    this.Clear = false;
    this.AssetManager.basePath = './';
    this.AssetManager.tableFile = null;
    if (this._width !== 128 || this._height !== 32) { this._width = 128; this._height = 32; this.resize(); }
    this.reset();
  }

  /** Clears the stage and the frame (used when re-running a script) */
  reset() {
    this._stage.RemoveAll();
    this._stage.ClearActions();
    this._stage.Visible = true;
    this.time = 0;
    this._ctx.fillStyle = '#000';
    this._ctx.fillRect(0, 0, this._width, this._height);
  }

  /** One iteration of the render loop: update actors and draw the stage into the frame */
  step(secondsElapsed: number) {
    const g = this._ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.Clear) { g.fillStyle = '#000'; g.fillRect(0, 0, this._width, this._height); }
    this._stage.Update(secondsElapsed);
    this._stage.Draw(g);
    this.time += secondsElapsed;
  }

  /** Draws the stage without advancing time (used after direct edits while paused) */
  redraw() {
    const g = this._ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.Clear) { g.fillStyle = '#000'; g.fillRect(0, 0, this._width, this._height); }
    this._stage.Draw(g);
  }

  private luminance(): Uint8Array {
    const d = this._ctx.getImageData(0, 0, this._width, this._height).data;
    const out = new Uint8Array(this._width * this._height);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      let v = Math.trunc(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      if (v > 255) v = 255;
      out[p] = v;
    }
    return out;
  }

  /** The frame as it would appear on the DMD, after render mode processing (gray levels tinted with Color) */
  output(): ImageData {
    const w = this._width, h = this._height;
    const src = this._ctx.getImageData(0, 0, w, h);
    if (this._renderMode === RenderMode.DMD_RGB) return src;
    const d = src.data;
    const out = new ImageData(w, h);
    const o = out.data;
    const shift = this._renderMode === RenderMode.DMD_GRAY_2 ? 6 : 4;
    const levels = this._renderMode === RenderMode.DMD_GRAY_2 ? 3 : 15;
    const c = this._color;
    for (let i = 0; i < d.length; i += 4) {
      let v = Math.trunc(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      if (v > 255) v = 255;
      const shade = (v >> shift) / levels;
      o[i] = Math.round(c.r * shade); o[i + 1] = Math.round(c.g * shade); o[i + 2] = Math.round(c.b * shade); o[i + 3] = 255;
    }
    return out;
  }
}

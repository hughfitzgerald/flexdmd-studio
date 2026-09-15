// Port of FlexDMD/Actors/Image.cs
import { Actor, type Ctx } from './actor';
import { align, Alignment, scale, Scaling } from './layout';
import type { AssetManager, AssetSrc } from './assets';

export type Bitmap = HTMLCanvasElement;

export class Image extends Actor {
  private _src: AssetSrc;
  private _prefWidth: number;
  private _prefHeight: number;
  private _bitmap: Bitmap | null = null;
  private _scaling: Scaling = Scaling.Stretch;
  private _alignment: Alignment = Alignment.Center;

  constructor(private _manager: AssetManager, path: string, name = '') {
    super(name);
    this._src = _manager.resolveSrc(path);
    this._bitmap = _manager.getBitmap(this._src);
    this._prefWidth = this._bitmap.width;
    this._prefHeight = this._bitmap.height;
    this.Pack();
    this._bitmap = null;
  }

  get typeName(): string { return 'Image'; }
  get assetId(): string { return this._src.id; }
  get PrefWidth() { return this._prefWidth; }
  get PrefHeight() { return this._prefHeight; }
  get Scaling() { return this._scaling; }
  set Scaling(v: number) { this._scaling = Math.trunc(Number(v)) as Scaling; }
  get Alignment() { return this._alignment; }
  set Alignment(v: number) { this._alignment = Math.trunc(Number(v)) as Alignment; }

  get Bitmap(): Bitmap {
    if (!this._bitmap) this._bitmap = this._manager.getBitmap(this._src);
    return this._bitmap;
  }
  set Bitmap(v: Bitmap) {
    if (!(v instanceof HTMLCanvasElement)) throw new Error('Bitmap must be a bitmap obtained from another image');
    this._bitmap = v;
  }

  protected onStageStateChanged() {
    this._bitmap = this.OnStage ? this._manager.getBitmap(this._src) : null;
  }

  Draw(g: Ctx) {
    if (this.Visible && this._bitmap) drawScaled(g, this._bitmap, this._scaling, this._alignment, this.PrefWidth, this.PrefHeight, this.X, this.Y, this.Width, this.Height);
  }
}

export function drawScaled(g: Ctx, bitmap: CanvasImageSource, scaling: Scaling, alignment: Alignment, prefW: number, prefH: number, X: number, Y: number, W: number, H: number) {
  const [w, h] = scale(scaling, prefW, prefH, W, H);
  const [x, y] = align(alignment, w, h, W, H);
  const dw = Math.trunc(w), dh = Math.trunc(h);
  if (dw <= 0 || dh <= 0) return;
  g.imageSmoothingEnabled = dw !== prefW || dh !== prefH;
  g.drawImage(bitmap, Math.trunc(X + x), Math.trunc(Y + y), dw, dh);
}

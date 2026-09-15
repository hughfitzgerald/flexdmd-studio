// Ported from FlexDMD (https://github.com/vbousquet/flexdmd), Copyright 2019 Vincent Bousquet,
// licensed under the Apache License 2.0. TypeScript translation of FlexDMD/Actors/Label.cs, modified
// from the original. See the NOTICE file at the repository root.
import { Actor, type Ctx } from './actor';
import { align, Alignment } from './layout';
import type { Font } from './font';

export class Label extends Actor {
  private _font: Font | null = null;
  private _text = '';
  private _lines: string[] = [''];
  private _textWidth = 0;
  private _textHeight = 0;
  private _alignment: Alignment = Alignment.Center;
  AutoPack: boolean;

  constructor(private _flex: { RuntimeVersion: number }, font: Font | null, text: string, name = '') {
    super(name);
    this.AutoPack = _flex.RuntimeVersion <= 1008;
    this._font = font;
    this.Text = text;
    this.Pack();
  }

  get typeName(): string { return 'Label'; }
  get PrefWidth() { return this._textWidth; }
  get PrefHeight() { return this._textHeight; }
  get Alignment() { return this._alignment; }
  set Alignment(v: number) { this._alignment = Math.trunc(Number(v)) as Alignment; }

  get Text() { return this._text; }
  set Text(value: unknown) {
    const newText = value === null || value === undefined ? '' : String(value).replace(/\r\n|\n\r|\n|\r/g, '\r\n');
    if (this._text !== newText) {
      this._text = newText;
      this._lines = newText.split('\n');
      this.updateBounds();
    }
  }
  get Font(): Font | null { return this._font; }
  set Font(f: Font | null) {
    if (f && typeof (f as Font).drawText !== 'function') throw new Error('Font must be created with FlexDMD.NewFont');
    if (this._font !== f) { this._font = f; this.updateBounds(); }
  }

  private updateBounds() {
    if (this._text === null || !this._font) return;
    const size = this._font.measure(this._text);
    this._textWidth = size.width;
    this._textHeight = size.height;
    if (this.AutoPack) this.Pack();
  }

  Draw(g: Ctx) {
    super.Draw(g);
    if (!this.Visible || !this._font || this._text === null) return;
    const snap = this._flex.RuntimeVersion <= 1008 ? Math.trunc : Math.floor;
    const a = this._alignment;
    if (this._lines.length > 1 && a !== Alignment.Left && a !== Alignment.BottomLeft && a !== Alignment.TopLeft) {
      let [, y] = align(a, this.PrefWidth, this.PrefHeight, this.Width, this.Height);
      for (const line of this._lines) {
        const [lx] = align(a, this._font.measure(line).width, this.PrefHeight, this.Width, this.Height);
        this._font.drawText(g, snap(this.X + lx), snap(this.Y + y), line);
        y += this._font.lineHeight;
      }
    } else {
      const [x, y] = align(a, this.PrefWidth, this.PrefHeight, this.Width, this.Height);
      this._font.drawText(g, snap(this.X + x), snap(this.Y + y), this._text);
    }
  }
}

// Port of FlexDMD/BMFonts (AngelCode BMFont text format) and FlexDMD/Actors/Font.cs (tinting and outlines)
import { colorsEqual, WHITE, type Color } from './color';
import type { Ctx } from './actor';

export interface BmChar { id: number; x: number; y: number; width: number; height: number; xoffset: number; yoffset: number; xadvance: number; page: number; }

export interface BitmapFontData {
  face: string;
  lineHeight: number;
  base: number;
  pages: string[];
  chars: Map<number, BmChar>;
  kernings: Map<number, number>; // key = first * 65536 + second
}

export function parseBmFont(text: string): BitmapFontData {
  const data: BitmapFontData = { face: '', lineHeight: 0, base: 0, pages: [], chars: new Map(), kernings: new Map() };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const sp = line.indexOf(' ');
    const tag = sp < 0 ? line : line.slice(0, sp);
    const attrs = parseAttrs(sp < 0 ? '' : line.slice(sp + 1));
    switch (tag) {
      case 'info': data.face = attrs.face ?? ''; break;
      case 'common': data.lineHeight = int(attrs.lineHeight); data.base = int(attrs.base); break;
      case 'page': data.pages[int(attrs.id)] = attrs.file ?? ''; break;
      case 'char':
        data.chars.set(int(attrs.id), { id: int(attrs.id), x: int(attrs.x), y: int(attrs.y), width: int(attrs.width), height: int(attrs.height), xoffset: int(attrs.xoffset), yoffset: int(attrs.yoffset), xadvance: int(attrs.xadvance), page: int(attrs.page) });
        break;
      case 'kerning': data.kernings.set(int(attrs.first) * 65536 + int(attrs.second), int(attrs.amount)); break;
    }
  }
  if (data.pages.length === 0) throw new Error('Invalid BMFont file: no page defined');
  return data;
}

function int(v: string | undefined): number { return v === undefined ? 0 : parseInt(v, 10) || 0; }

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)=("([^"]*)"|\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = m[3] !== undefined ? m[3] : m[2];
  return out;
}

export class Font {
  readonly chars: Map<number, BmChar>;
  readonly textures: HTMLCanvasElement[];
  readonly lineHeight: number;

  constructor(public readonly data: BitmapFontData, pages: (HTMLImageElement | HTMLCanvasElement)[], public readonly tint: Color, public readonly borderTint: Color, public readonly borderSize: number, public readonly id: string) {
    this.lineHeight = data.lineHeight;
    this.chars = new Map(data.chars);
    this.textures = pages.map((p) => toCanvas(p));
    if (borderSize > 0) {
      this.textures = this.textures.map((t) => outline(t, tint, borderTint));
      // Adjust to add a padding between characters to account for the outline
      for (const [k, c] of this.chars) this.chars.set(k, { ...c, xadvance: c.xadvance + 2 });
    } else if (!colorsEqual(tint, WHITE)) {
      this.textures = this.textures.map((t) => tintCanvas(t, tint));
    }
  }

  getKerning(previous: number, current: number): number { return this.data.kernings.get(previous * 65536 + current) ?? 0; }

  private resolveChar(code: number): BmChar | null {
    let c = this.chars.get(code);
    if (c) return c;
    if (code >= 97 && code <= 122) {
      const upper = this.chars.get(code - 32);
      if (upper) { this.chars.set(code, upper); return upper; }
    }
    const space = this.chars.get(32);
    if (space) { this.chars.set(code, space); return space; }
    return null;
  }

  /** Port of Font.DrawText: draws glyphs at integer positions */
  drawText(g: Ctx | null, x: number, y: number, text: string) {
    let prev = 32;
    const startX = x;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      if (ch === 10) { x = startX; y += this.lineHeight; prev = 10; continue; }
      if (ch === 13) continue;
      const data = this.resolveChar(ch);
      if (!data) continue;
      const kerning = this.getKerning(prev, ch);
      if (g && data.width > 0 && data.height > 0) {
        g.drawImage(this.textures[data.page], data.x, data.y, data.width, data.height, Math.trunc(x + data.xoffset + kerning), Math.trunc(y + data.yoffset), data.width, data.height);
      }
      x += data.xadvance + kerning;
      prev = ch;
    }
  }

  /** Port of BitmapFont.MeasureFont */
  measure(text: string): { width: number; height: number } {
    if (!text) return { width: 0, height: 0 };
    // perform missing character swapping before measuring text
    this.drawText(null, 0, 0, text);
    let previous = 32;
    let currentLineWidth = 0;
    let currentLineHeight = this.lineHeight;
    let blockWidth = 0;
    const lineHeights: number[] = [];
    const length = text.length;
    for (let i = 0; i < length; i++) {
      const ch = text.charCodeAt(i);
      if (ch === 10 || ch === 13) {
        if (ch === 10 || i + 1 === length || text.charCodeAt(i + 1) !== 10) {
          lineHeights.push(currentLineHeight);
          blockWidth = Math.max(blockWidth, currentLineWidth);
          currentLineWidth = 0;
          currentLineHeight = this.lineHeight;
        }
      } else {
        const data = this.chars.get(ch);
        if (data) {
          const width = data.xadvance + this.getKerning(previous, ch);
          currentLineWidth += width;
          currentLineHeight = Math.max(currentLineHeight, data.height + data.yoffset);
        }
        previous = ch;
      }
    }
    if (currentLineHeight !== 0) lineHeights.push(currentLineHeight);
    for (let i = 0; i < lineHeights.length - 1; i++) lineHeights[i] = this.lineHeight;
    let blockHeight = 0;
    for (const h of lineHeights) blockHeight += h;
    return { width: Math.max(currentLineWidth, blockWidth), height: blockHeight };
  }
}

export function toCanvas(img: HTMLImageElement | HTMLCanvasElement): HTMLCanvasElement {
  if (img instanceof HTMLCanvasElement) return img;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return c;
}

function tintCanvas(src: HTMLCanvasElement, tint: Color): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const dst = document.createElement('canvas');
  dst.width = w; dst.height = h;
  const sctx = src.getContext('2d')!;
  const img = sctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = (d[i] * tint.r) / 255 | 0;
    d[i + 1] = (d[i + 1] * tint.g) / 255 | 0;
    d[i + 2] = (d[i + 2] * tint.b) / 255 | 0;
    d[i + 3] = (d[i + 3] * tint.a) / 255 | 0;
  }
  dst.getContext('2d')!.putImageData(img, 0, 0);
  return dst;
}

/** Port of the outline rendering in Font.cs: 1px border drawn into the glyph padding, then the tinted glyph on top. */
function outline(src: HTMLCanvasElement, tint: Color, borderTint: Color): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const s = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const out = new ImageData(w, h);
  const d = out.data;
  const setBorder = (x: number, y: number) => {
    const p = (y * w + x) * 4;
    d[p] = borderTint.r; d[p + 1] = borderTint.g; d[p + 2] = borderTint.b; d[p + 3] = borderTint.a;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (s[(y * w + x) * 4 + 3] > 0) {
        if (x > 0) { if (y > 0) setBorder(x - 1, y - 1); setBorder(x - 1, y); if (y < h - 1) setBorder(x - 1, y + 1); }
        if (y > 0) setBorder(x, y - 1);
        if (y < h - 1) setBorder(x, y + 1);
        if (x < w - 1) { if (y > 0) setBorder(x + 1, y - 1); setBorder(x + 1, y); if (y < h - 1) setBorder(x + 1, y + 1); }
      }
    }
  }
  for (let i = 0; i < s.length; i += 4) {
    if (s[i + 3] === 0) continue;
    d[i] = (s[i] * tint.r) / 255 | 0;
    d[i + 1] = (s[i + 1] * tint.g) / 255 | 0;
    d[i + 2] = (s[i + 2] * tint.b) / 255 | 0;
    d[i + 3] = (s[i + 3] * tint.a) / 255 | 0;
  }
  const dst = document.createElement('canvas');
  dst.width = w; dst.height = h;
  dst.getContext('2d')!.putImageData(out, 0, 0);
  return dst;
}

// Colors travel through the script API as OLE colors (VBScript RGB(): r + g*256 + b*65536).
// Inside the engine they are {r,g,b,a} records.

export interface Color { r: number; g: number; b: number; a: number; }

export function fromOle(v: number): Color {
  const n = Math.trunc(v) >>> 0;
  return { r: n & 0xff, g: (n >> 8) & 0xff, b: (n >> 16) & 0xff, a: 255 };
}

export function toOle(c: Color): number { return c.r | (c.g << 8) | (c.b << 16); }

// C# Color.ToArgb() formatted as X8 (used in font asset ids)
export function toArgbHex(c: Color): string {
  return (((c.a << 24) | (c.r << 16) | (c.g << 8) | c.b) >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

export function fromArgbHex(hex: string): Color {
  const n = parseInt(hex, 16) >>> 0;
  return { a: (n >>> 24) & 0xff, r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function cssColor(c: Color): string { return `rgba(${c.r},${c.g},${c.b},${c.a / 255})`; }

export const BLACK: Color = { r: 0, g: 0, b: 0, a: 255 };
export const WHITE: Color = { r: 255, g: 255, b: 255, a: 255 };

export function colorsEqual(a: Color, b: Color): boolean { return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a; }

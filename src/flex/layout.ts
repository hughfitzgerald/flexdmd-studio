// Port of FlexDMD/Actors/Layout.cs (itself adapted from LibGDX Scaling)

export enum Scaling { Fit = 0, Fill = 1, FillX = 2, FillY = 3, Stretch = 4, StretchX = 5, StretchY = 6, None = 7 }

export enum Alignment { TopLeft = 0, Top = 1, TopRight = 2, Left = 3, Center = 4, Right = 5, BottomLeft = 6, Bottom = 7, BottomRight = 8 }

export const ScalingNames = ['Fit', 'Fill', 'FillX', 'FillY', 'Stretch', 'StretchX', 'StretchY', 'None'];
export const AlignmentNames = ['TopLeft', 'Top', 'TopRight', 'Left', 'Center', 'Right', 'BottomLeft', 'Bottom', 'BottomRight'];

export function scale(mode: Scaling, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): [number, number] {
  switch (mode) {
    case Scaling.Fit: {
      const targetRatio = targetHeight / targetWidth;
      const sourceRatio = sourceHeight / sourceWidth;
      const s = targetRatio > sourceRatio ? targetWidth / sourceWidth : targetHeight / sourceHeight;
      return [sourceWidth * s, sourceHeight * s];
    }
    case Scaling.Fill: {
      const targetRatio = targetHeight / targetWidth;
      const sourceRatio = sourceHeight / sourceWidth;
      const s = targetRatio < sourceRatio ? targetWidth / sourceWidth : targetHeight / sourceHeight;
      return [sourceWidth * s, sourceHeight * s];
    }
    case Scaling.FillX: { const s = targetWidth / sourceWidth; return [sourceWidth * s, sourceHeight * s]; }
    case Scaling.FillY: { const s = targetHeight / sourceHeight; return [sourceWidth * s, sourceHeight * s]; }
    case Scaling.Stretch: return [targetWidth, targetHeight];
    case Scaling.StretchX: return [targetWidth, sourceHeight];
    case Scaling.StretchY: return [sourceWidth, targetHeight];
    case Scaling.None: return [sourceWidth, sourceHeight];
    default: return [0, 0];
  }
}

export function align(mode: Alignment, width: number, height: number, containerWidth: number, containerHeight: number): [number, number] {
  let x: number, y: number;
  switch (mode) {
    case Alignment.TopLeft: case Alignment.Left: case Alignment.BottomLeft: x = 0; break;
    case Alignment.Top: case Alignment.Center: case Alignment.Bottom: x = (containerWidth - width) * 0.5; break;
    case Alignment.TopRight: case Alignment.Right: case Alignment.BottomRight: x = containerWidth - width; break;
    default: x = 0;
  }
  switch (mode) {
    case Alignment.TopLeft: case Alignment.Top: case Alignment.TopRight: y = 0; break;
    case Alignment.Left: case Alignment.Center: case Alignment.Right: y = (containerHeight - height) * 0.5; break;
    case Alignment.BottomLeft: case Alignment.Bottom: case Alignment.BottomRight: y = containerHeight - height; break;
    default: y = 0;
  }
  return [x, y];
}

// Emulates the C# (float) → (int) cast used when drawing (truncation toward zero)
export function cint(v: number): number { return Math.trunc(v); }

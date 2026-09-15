// Writes geometry changes made in the preview back into the script literals that produced them.
import type { Span } from '../vbs/ast';
import type { Actor } from '../flex/actor';
import { Alignment } from '../flex/layout';

export interface GeometryEdit { span: Span; text: string; }

export interface Geometry { x: number; y: number; w: number; h: number; }

export function fmtNum(v: number): string {
  const r = Math.round(v * 100) / 100;
  if (Number.isInteger(r)) return String(r);
  return String(r);
}

/** True when both position coordinates can be written back to the script */
export function canEditPosition(actor: Actor): boolean {
  const b = actor._binding;
  if (b.alignedX !== undefined || b.alignedY !== undefined) return !!(b.alignedX && b.alignedY);
  return !!(b.x && b.y);
}

export function canEditSize(actor: Actor): boolean {
  const b = actor._binding;
  return !!(b.width && b.height);
}

/** Describes why a value cannot be edited, for the UI */
export function bindingStatus(actor: Actor): { position: string | null; size: string | null } {
  const b = actor._binding;
  let position: string | null = null;
  let size: string | null = null;
  if (b.alignedX !== undefined || b.alignedY !== undefined) {
    if (!b.alignedX || !b.alignedY) position = 'SetAlignedPosition was called with computed values (not literals)';
  } else if (!b.x && !b.y && b.positionStmt === undefined) position = 'position was never set from the script (defaults to 0,0)';
  else if (!b.x || !b.y) position = 'position was set from computed values (not literals)';
  if (!b.width && !b.height && b.sizeStmt === undefined) size = 'size comes from the asset/text (Pack); add SetSize to make it editable';
  else if (!b.width || !b.height) size = 'size was set from computed values (not literals)';
  return { position, size };
}

/**
 * Computes the literal replacements to move/resize an actor. Coordinates are in the actor's parent space.
 * Returns the edits plus a list of what could not be written back.
 */
export function geometryEdits(actor: Actor, g: Partial<Geometry>): { edits: GeometryEdit[]; unbound: string[] } {
  const b = actor._binding;
  const edits: GeometryEdit[] = [];
  const unbound: string[] = [];
  const w = g.w ?? actor.Width;
  const h = g.h ?? actor.Height;
  if (g.w !== undefined || g.h !== undefined) {
    if (b.width && b.height) {
      edits.push({ span: b.width, text: fmtNum(w) });
      edits.push({ span: b.height, text: fmtNum(h) });
    } else unbound.push('size');
  }
  if (g.x !== undefined || g.y !== undefined) {
    const x = g.x ?? actor.X;
    const y = g.y ?? actor.Y;
    if (b.alignedX !== undefined || b.alignedY !== undefined) {
      if (b.alignedX && b.alignedY && b.alignment !== undefined) {
        // Inverse of SetAlignedPosition, using the (possibly new) size
        let ax = x, ay = y;
        switch (b.alignment) {
          case Alignment.Bottom: case Alignment.Center: case Alignment.Top: ax = x + w * 0.5; break;
          case Alignment.BottomRight: case Alignment.Right: case Alignment.TopRight: ax = x + w; break;
        }
        switch (b.alignment) {
          case Alignment.BottomLeft: case Alignment.Bottom: case Alignment.BottomRight: ay = y + h; break;
          case Alignment.Left: case Alignment.Center: case Alignment.Right: ay = y + h * 0.5; break;
        }
        edits.push({ span: b.alignedX, text: fmtNum(ax) });
        edits.push({ span: b.alignedY, text: fmtNum(ay) });
      } else unbound.push('position');
    } else if (b.x && b.y) {
      edits.push({ span: b.x, text: fmtNum(x) });
      edits.push({ span: b.y, text: fmtNum(y) });
    } else unbound.push('position');
  }
  return { edits, unbound };
}

/** Updates the actor's binding spans after the editor replaced the literals (same order as geometryEdits output) */
export function rebind(actor: Actor, g: Partial<Geometry>, newSpans: Span[]) {
  const b = actor._binding;
  let i = 0;
  if (g.w !== undefined || g.h !== undefined) {
    if (b.width && b.height) { b.width = newSpans[i++]; b.height = newSpans[i++]; }
  }
  if (g.x !== undefined || g.y !== undefined) {
    if (b.alignedX !== undefined || b.alignedY !== undefined) {
      if (b.alignedX && b.alignedY) { b.alignedX = newSpans[i++]; b.alignedY = newSpans[i++]; }
    } else if (b.x && b.y) { b.x = newSpans[i++]; b.y = newSpans[i++]; }
  }
}

/** All literal spans bound to an actor (for highlighting in the editor) */
export function boundSpans(actor: Actor): Span[] {
  const b = actor._binding;
  return [b.x, b.y, b.width, b.height, b.alignedX, b.alignedY].filter((s): s is Span => !!s);
}

// DMD preview canvas: scaled output with a dot mask, plus selection, drag and resize of actors.
import { Actor, Group } from '../flex/actor';
import type { FlexDMD } from '../flex/flexdmd';
import type { Geometry } from './codegen';

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export interface PreviewEvents {
  onSelect: (actor: Actor | null) => void;
  /** phase 'move' while dragging (live), 'end' on mouse up */
  onGeometryChange: (actor: Actor, geometry: Geometry, phase: 'move' | 'end') => void;
  onTogglePlay: () => void;
}

interface DragState {
  actor: Actor;
  mode: 'move' | Handle;
  startMouse: { x: number; y: number };
  startGeom: Geometry; // parent-space
  parentOrigin: { x: number; y: number };
  moved: boolean;
}

export class Preview {
  private ctx: CanvasRenderingContext2D;
  private buf: HTMLCanvasElement;
  private bufCtx: CanvasRenderingContext2D;
  private mask: HTMLCanvasElement | null = null;
  private maskKey = '';
  scale = 4;
  dots = true;
  selected: Actor | null = null;
  hovered: Actor | null = null;
  private drag: DragState | null = null;
  private lastOutput: ImageData | null = null;
  canEdit: (actor: Actor) => { position: boolean; size: boolean } = () => ({ position: false, size: false });

  constructor(public canvas: HTMLCanvasElement, private flex: FlexDMD, private ev: PreviewEvents) {
    this.ctx = canvas.getContext('2d')!;
    this.buf = document.createElement('canvas');
    this.bufCtx = this.buf.getContext('2d')!;
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    canvas.addEventListener('mouseleave', () => { if (!this.drag) { this.hovered = null; this.redraw(); } });
    canvas.addEventListener('keydown', (e) => this.onKey(e));
    canvas.addEventListener('dblclick', (e) => { const a = this.hitTest(this.toDmd(e)); if (a) this.select(a, true); });
  }

  fit(maxWidth: number, maxHeight: number) {
    const w = this.flex.Width, h = this.flex.Height;
    const s = Math.max(1, Math.min(12, Math.floor(Math.min(maxWidth / w, maxHeight / h))));
    if (s !== this.scale || this.canvas.width !== w * s || this.canvas.height !== h * s) {
      this.scale = s;
      this.canvas.width = w * s;
      this.canvas.height = h * s;
      this.canvas.style.width = `${w * s}px`;
      this.canvas.style.height = `${h * s}px`;
      this.redraw();
    }
  }

  draw(output: ImageData) {
    this.lastOutput = output;
    this.redraw();
  }

  private redraw() {
    const out = this.lastOutput;
    const g = this.ctx;
    const w = this.flex.Width, h = this.flex.Height, s = this.scale;
    if (this.canvas.width !== w * s || this.canvas.height !== h * s) this.fit(this.canvas.width, this.canvas.height);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#000';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (out) {
      if (this.buf.width !== out.width || this.buf.height !== out.height) { this.buf.width = out.width; this.buf.height = out.height; }
      this.bufCtx.putImageData(out, 0, 0);
      g.imageSmoothingEnabled = false;
      g.drawImage(this.buf, 0, 0, out.width * s, out.height * s);
    }
    if (this.dots && s >= 3) g.drawImage(this.getMask(w, h, s), 0, 0);
    this.drawSelection(g);
  }

  private getMask(w: number, h: number, s: number): HTMLCanvasElement {
    const key = `${w}x${h}x${s}`;
    if (this.mask && this.maskKey === key) return this.mask;
    const m = document.createElement('canvas');
    m.width = w * s; m.height = h * s;
    const c = m.getContext('2d')!;
    c.fillStyle = '#000';
    c.fillRect(0, 0, m.width, m.height);
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = '#fff';
    const r = s * 0.44;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { c.beginPath(); c.arc(x * s + s / 2, y * s + s / 2, r, 0, Math.PI * 2); c.fill(); }
    this.mask = m;
    this.maskKey = key;
    return m;
  }

  private drawSelection(g: CanvasRenderingContext2D) {
    const s = this.scale;
    if (this.hovered && this.hovered !== this.selected && this.hovered.OnStage) {
      const b = this.hovered.absoluteBounds();
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.strokeRect(b.x * s + 0.5, b.y * s + 0.5, b.w * s, b.h * s);
      g.setLineDash([]);
    }
    const a = this.selected;
    if (!a || !a.OnStage) return;
    const b = a.absoluteBounds();
    const x = b.x * s, y = b.y * s, w = b.w * s, h = b.h * s;
    g.strokeStyle = '#3b82f6';
    g.lineWidth = 2;
    g.strokeRect(x, y, w, h);
    const edit = this.canEdit(a);
    if (edit.size) {
      g.fillStyle = '#fff';
      g.strokeStyle = '#3b82f6';
      g.lineWidth = 1;
      for (const hd of HANDLES) {
        const p = this.handlePos(hd, x, y, w, h);
        g.fillRect(p.x - 4, p.y - 4, 8, 8);
        g.strokeRect(p.x - 4 + 0.5, p.y - 4 + 0.5, 8, 8);
      }
    }
    const label = `${a.Name || '(unnamed)'}  ${fmt(a.X)},${fmt(a.Y)}  ${fmt(a.Width)}×${fmt(a.Height)}`;
    g.font = '11px -apple-system, Segoe UI, sans-serif';
    const tw = g.measureText(label).width + 8;
    const ly = y > 16 ? y - 16 : y + h + 2;
    g.fillStyle = 'rgba(59,130,246,0.9)';
    g.fillRect(Math.min(x, this.canvas.width - tw), ly, tw, 14);
    g.fillStyle = '#fff';
    g.fillText(label, Math.min(x, this.canvas.width - tw) + 4, ly + 11);
  }

  private handlePos(h: Handle, x: number, y: number, w: number, hh: number) {
    const cx = x + w / 2, cy = y + hh / 2;
    switch (h) {
      case 'nw': return { x, y };
      case 'n': return { x: cx, y };
      case 'ne': return { x: x + w, y };
      case 'e': return { x: x + w, y: cy };
      case 'se': return { x: x + w, y: y + hh };
      case 's': return { x: cx, y: y + hh };
      case 'sw': return { x, y: y + hh };
      case 'w': return { x, y: cy };
    }
  }

  select(actor: Actor | null, notify = true) {
    this.selected = actor;
    this.redraw();
    if (notify) this.ev.onSelect(actor);
  }

  private toDmd(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (this.canvas.width / r.width) / this.scale, y: (e.clientY - r.top) * (this.canvas.height / r.height) / this.scale };
  }

  private toCanvas(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (this.canvas.width / r.width), y: (e.clientY - r.top) * (this.canvas.height / r.height) };
  }

  /** Finds the top-most visible actor under a stage coordinate (leaf actors first, then their groups) */
  hitTest(p: { x: number; y: number }): Actor | null {
    const visit = (group: Group, ox: number, oy: number): Actor | null => {
      for (let i = group.Children.length - 1; i >= 0; i--) {
        const c = group.Children[i];
        if (!c.Visible) continue;
        const x = ox + c.X, y = oy + c.Y;
        if (c instanceof Group) {
          const inner = visit(c, x, y);
          if (inner) return inner;
        }
        if (p.x >= x && p.x < x + c.Width && p.y >= y && p.y < y + c.Height && c.Width > 0 && c.Height > 0) return c;
      }
      return null;
    };
    return visit(this.flex.Stage, 0, 0);
  }

  private handleAt(p: { x: number; y: number }): Handle | null {
    const a = this.selected;
    if (!a || !a.OnStage || !this.canEdit(a).size) return null;
    const s = this.scale;
    const b = a.absoluteBounds();
    for (const hd of HANDLES) {
      const hp = this.handlePos(hd, b.x * s, b.y * s, b.w * s, b.h * s);
      if (Math.abs(p.x - hp.x) <= 6 && Math.abs(p.y - hp.y) <= 6) return hd;
    }
    return null;
  }

  private onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    this.canvas.focus();
    const cp = this.toCanvas(e);
    const dp = this.toDmd(e);
    const handle = this.handleAt(cp);
    let actor: Actor | null;
    let mode: DragState['mode'];
    if (handle) { actor = this.selected; mode = handle; }
    else {
      actor = this.hitTest(dp);
      mode = 'move';
      if (actor !== this.selected) this.select(actor);
    }
    if (!actor) return;
    const b = actor.absoluteBounds();
    const parentOrigin = { x: b.x - actor.X, y: b.y - actor.Y };
    this.drag = { actor, mode, startMouse: dp, startGeom: { x: actor.X, y: actor.Y, w: actor.Width, h: actor.Height }, parentOrigin, moved: false };
    e.preventDefault();
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.drag) {
      if (e.target !== this.canvas) return;
      const cp = this.toCanvas(e);
      const handle = this.handleAt(cp);
      const h = handle ? this.hitTest(this.toDmd(e)) : this.hitTest(this.toDmd(e));
      this.canvas.style.cursor = handle ? cursorFor(handle) : h ? 'move' : 'crosshair';
      if (h !== this.hovered) { this.hovered = h; this.redraw(); }
      return;
    }
    const d = this.drag;
    const p = this.toDmd(e);
    const dx = Math.round(p.x - d.startMouse.x), dy = Math.round(p.y - d.startMouse.y);
    if (dx === 0 && dy === 0 && !d.moved) return;
    d.moved = true;
    const geom = this.applyDrag(d, dx, dy);
    this.ev.onGeometryChange(d.actor, geom, 'move');
    this.redraw();
  }

  private applyDrag(d: DragState, dx: number, dy: number): Geometry {
    const g0 = d.startGeom;
    const edit = this.canEdit(d.actor);
    if (d.mode === 'move') return { x: g0.x + dx, y: g0.y + dy, w: g0.w, h: g0.h };
    let { x, y, w, h } = g0;
    const m = d.mode;
    if (m.includes('e')) w = Math.max(1, g0.w + dx);
    if (m.includes('s')) h = Math.max(1, g0.h + dy);
    if (m.includes('w')) { const nw = Math.max(1, g0.w - dx); x = g0.x + (g0.w - nw); w = nw; }
    if (m.includes('n')) { const nh = Math.max(1, g0.h - dy); y = g0.y + (g0.h - nh); h = nh; }
    if (!edit.position) { x = g0.x; y = g0.y; }
    return { x, y, w, h };
  }

  private onMouseUp(e: MouseEvent) {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    if (!d.moved) return;
    const p = this.toDmd(e);
    const geom = this.applyDrag(d, Math.round(p.x - d.startMouse.x), Math.round(p.y - d.startMouse.y));
    this.ev.onGeometryChange(d.actor, geom, 'end');
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === ' ') { e.preventDefault(); this.ev.onTogglePlay(); return; }
    if (e.key === 'Escape') { this.select(null); return; }
    const a = this.selected;
    if (!a) return;
    const step = e.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const dlt = delta[e.key];
    if (!dlt) return;
    e.preventDefault();
    const geom = { x: a.X + dlt[0], y: a.Y + dlt[1], w: a.Width, h: a.Height };
    this.ev.onGeometryChange(a, geom, 'end');
  }
}

function cursorFor(h: Handle): string {
  switch (h) {
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'nw': case 'se': return 'nwse-resize';
  }
}

function fmt(v: number): string { return Number.isInteger(v) ? String(v) : v.toFixed(1); }

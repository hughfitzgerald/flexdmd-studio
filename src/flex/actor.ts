// Ported from FlexDMD (https://github.com/vbousquet/flexdmd), Copyright 2019 Vincent Bousquet,
// licensed under the Apache License 2.0. TypeScript translation of FlexDMD/Actors/Actor.cs, Group.cs and Frame.cs, modified
// from the original. See the NOTICE file at the repository root.
// cs and Frame.cs
import type { Span } from '../vbs/ast';
import { hostCallContext } from '../vbs/hostcontext';
import { Action, ActionFactory } from './actions';
import { Alignment } from './layout';
import { BLACK, cssColor, fromOle, toOle, type Color } from './color';

export type Ctx = CanvasRenderingContext2D;

/** Where in the script a geometry value came from (for WYSIWYG editing). */
export interface GeometryBinding {
  /** Literal spans for X/Y/Width/Height as last set by SetBounds/SetPosition/SetSize/property assignment */
  x?: Span | null; y?: Span | null; width?: Span | null; height?: Span | null;
  /** Set when the position came from SetAlignedPosition: the literal spans and the alignment used */
  alignedX?: Span | null; alignedY?: Span | null; alignment?: Alignment;
  /** The statement that set the position/size */
  positionStmt?: Span | null; sizeStmt?: Span | null;
  /** Name of the Sub the value was set from (null at top level) */
  procName?: string | null;
}

let nextActorId = 1;

export class Actor {
  readonly _id = nextActorId++;
  private _actions: Action[] = [];
  private _onStage = false;
  _parent: Group | null = null;
  _binding: GeometryBinding = {};
  _x = 0; _y = 0; _width = 0; _height = 0;

  Name = '';
  Visible = true;
  FillParent = false;
  ClearBackground = false;
  readonly ActionFactory: ActionFactory;

  constructor(name = '') {
    this.Name = name;
    this.ActionFactory = new ActionFactory(this);
  }

  get X() { return this._x; }
  set X(v: number) { this._x = num(v, 'X'); this._binding.x = ctxSpan(0); this._binding.alignedX = undefined; this._binding.procName = hostCallContext.procName; }
  get Y() { return this._y; }
  set Y(v: number) { this._y = num(v, 'Y'); this._binding.y = ctxSpan(0); this._binding.alignedY = undefined; this._binding.procName = hostCallContext.procName; }
  get Width() { return this._width; }
  set Width(v: number) { this._width = num(v, 'Width'); this._binding.width = ctxSpan(0); }
  get Height() { return this._height; }
  set Height(v: number) { this._height = num(v, 'Height'); this._binding.height = ctxSpan(0); }

  get PrefWidth(): number { return 0; }
  get PrefHeight(): number { return 0; }
  get Parent(): Group | null { return this._parent; }
  get OnStage() { return this._onStage; }
  set OnStage(v: boolean) {
    if (v !== this._onStage) { this._onStage = v; this.onStageStateChanged(); }
  }
  protected onStageStateChanged() {}

  get typeName(): string { return 'Actor'; }

  Remove() { if (this._parent) this._parent.RemoveActor(this); }
  Pack() { this._width = this.PrefWidth; this._height = this.PrefHeight; }

  SetBounds(x: number, y: number, width: number, height: number) {
    this._x = num(x, 'x'); this._y = num(y, 'y'); this._width = num(width, 'width'); this._height = num(height, 'height');
    Object.assign(this._binding, { x: ctxSpan(0), y: ctxSpan(1), width: ctxSpan(2), height: ctxSpan(3), alignedX: undefined, alignedY: undefined, positionStmt: hostCallContext.statementSpan, sizeStmt: hostCallContext.statementSpan, procName: hostCallContext.procName });
  }
  SetPosition(x: number, y: number) {
    this._x = num(x, 'x'); this._y = num(y, 'y');
    Object.assign(this._binding, { x: ctxSpan(0), y: ctxSpan(1), alignedX: undefined, alignedY: undefined, positionStmt: hostCallContext.statementSpan, procName: hostCallContext.procName });
  }
  SetAlignedPosition(x: number, y: number, alignment: Alignment) {
    x = num(x, 'x'); y = num(y, 'y');
    const a = Math.trunc(Number(alignment)) as Alignment;
    switch (a) {
      case Alignment.BottomLeft: case Alignment.Left: case Alignment.TopLeft: this._x = x; break;
      case Alignment.Bottom: case Alignment.Center: case Alignment.Top: this._x = x - this._width * 0.5; break;
      case Alignment.BottomRight: case Alignment.Right: case Alignment.TopRight: this._x = x - this._width; break;
    }
    switch (a) {
      case Alignment.BottomLeft: case Alignment.Bottom: case Alignment.BottomRight: this._y = y - this._height; break;
      case Alignment.Left: case Alignment.Center: case Alignment.Right: this._y = y - this._height * 0.5; break;
      case Alignment.TopLeft: case Alignment.Top: case Alignment.TopRight: this._y = y; break;
    }
    Object.assign(this._binding, { x: undefined, y: undefined, alignedX: ctxSpan(0), alignedY: ctxSpan(1), alignment: a, positionStmt: hostCallContext.statementSpan, procName: hostCallContext.procName });
  }
  SetSize(width: number, height: number) {
    this._width = num(width, 'width'); this._height = num(height, 'height');
    Object.assign(this._binding, { width: ctxSpan(0), height: ctxSpan(1), sizeStmt: hostCallContext.statementSpan });
  }

  AddAction(action: Action) {
    if (!(action instanceof Action)) throw new Error('AddAction expects an Action created with ActionFactory');
    this._actions.push(action);
  }
  ClearActions() { this._actions = []; }
  get actions(): readonly Action[] { return this._actions; }

  Update(secondsElapsed: number) {
    if (!this._onStage) throw new Error('Update was called on an actor which is not on stage.');
    // Same loop as FlexDMD: a finished action is removed without adjusting the index, so the action that
    // followed it is only updated on the next frame. Reproduced so timings match the real thing.
    for (let i = 0; i < this._actions.length; i++) {
      if (this._actions[i].update(secondsElapsed)) this._actions.splice(i, 1);
    }
    if (this.FillParent && this._parent) { this._x = 0; this._y = 0; this._width = this._parent.Width; this._height = this._parent.Height; }
  }

  Draw(g: Ctx) {
    if (!this._onStage) throw new Error('Draw was called on an actor which is not on stage.');
    if (this.Visible && this.ClearBackground) {
      g.fillStyle = '#000';
      g.fillRect(this._x, this._y, this._width, this._height);
    }
  }

  /** Path from the stage root, e.g. "Stage/Score/Label" (used to keep the selection across re-runs) */
  path(): string {
    const names: string[] = [];
    let a: Actor | null = this;
    while (a) { names.unshift(a.Name); a = a._parent; }
    return names.join('/');
  }

  /** Absolute (stage) coordinates of this actor's bounds */
  absoluteBounds(): { x: number; y: number; w: number; h: number } {
    let x = this._x, y = this._y;
    let p = this._parent;
    while (p) { x += p._x; y += p._y; p = p._parent; }
    return { x, y, w: this._width, h: this._height };
  }
}

export class Group extends Actor {
  Children: Actor[] = [];
  Clip = false;
  constructor(public readonly flex: { RuntimeVersion: number; warn: (m: string) => void }, name = '') { super(name); }

  get typeName(): string { return 'Group'; }
  get ChildCount() { return this.Children.length; }
  get Root(): Group { let root: Group = this; while (root._parent) root = root._parent; return root; }

  protected onStageStateChanged() { for (const c of this.Children) c.OnStage = this.OnStage; }

  Get(name: string): Actor | null {
    name = String(name);
    if (this.Name === name) return this;
    if (this.flex.RuntimeVersion <= 1008) {
      for (const child of this.Children) {
        if (child.Name === name) return child;
        if (child instanceof Group) { const found = child.Get(name); if (found) return found; }
      }
    } else {
      const pos = name.indexOf('/');
      if (pos < 0) {
        for (const child of this.Children) if (child.Name === name) return child;
      } else if (pos === 0) {
        return this.Root.Get(name.substring(1));
      } else {
        const groupName = name.substring(0, pos);
        for (const child of this.Children) if (child instanceof Group && child.Name === groupName) return child.Get(name.substring(pos + 1));
      }
    }
    this.flex.warn(`Actor '${name}' not found in children of '${this.Name}'`);
    return null;
  }
  HasChild(name: string) { return this.Get(name) !== null; }
  GetGroup(name: string) { return this.typed(name, 'Group'); }
  GetFrame(name: string) { return this.typed(name, 'Frame'); }
  GetLabel(name: string) { return this.typed(name, 'Label'); }
  GetVideo(name: string) { return this.typed(name, 'Video'); }
  GetImage(name: string) { return this.typed(name, 'Image'); }
  private typed(name: string, type: string): Actor | null {
    const a = this.Get(name);
    if (a && a.typeName !== type && !(type === 'Video' && a.typeName === 'ImageSequence')) throw new Error(`Actor '${name}' is a ${a.typeName}, not a ${type}`);
    return a;
  }
  AddActor(child: Actor) {
    if (!(child instanceof Actor)) throw new Error('AddActor expects an actor');
    child.Remove();
    child._parent = this;
    this.Children.push(child);
    child.OnStage = this.OnStage;
  }
  AddActorAt(child: Actor, index: number) {
    child.Remove();
    child._parent = this;
    this.Children.splice(Math.trunc(index), 0, child);
    child.OnStage = this.OnStage;
  }
  RemoveActor(child: Actor) {
    child._parent = null;
    const i = this.Children.indexOf(child);
    if (i >= 0) this.Children.splice(i, 1);
    child.OnStage = false;
  }
  RemoveAll() {
    for (const c of this.Children) { c._parent = null; c.OnStage = false; }
    this.Children = [];
  }
  Update(delta: number) {
    super.Update(delta);
    if (!this.OnStage) return;
    let i = 0;
    while (i < this.Children.length) {
      const child = this.Children[i];
      child.Update(delta);
      if (i < this.Children.length && child === this.Children[i]) i++;
    }
  }
  Draw(g: Ctx) {
    if (!this.Visible) return;
    g.save();
    g.translate(this._x, this._y);
    if (this.Clip) { g.beginPath(); g.rect(0, 0, this._width, this._height); g.clip(); }
    // FlexDMD calls base.Draw after translating, so a group with ClearBackground fills at (2X, 2Y) in parent space.
    // Reproduced faithfully so the preview matches the real thing.
    if (this.ClearBackground) { g.fillStyle = '#000'; g.fillRect(this._x, this._y, this._width, this._height); }
    for (const child of this.Children) child.Draw(g);
    g.restore();
  }
}

export class Frame extends Actor {
  private _thickness = 2;
  private _borderColor: Color = { r: 255, g: 255, b: 255, a: 255 };
  private _fillColor: Color = BLACK;
  Fill = false;

  get typeName(): string { return 'Frame'; }
  get Thickness() { return this._thickness; }
  set Thickness(v: number) { this._thickness = Math.trunc(num(v, 'Thickness')); }
  get BorderColor() { return toOle(this._borderColor); }
  set BorderColor(v: number) { this._borderColor = fromOle(num(v, 'BorderColor')); }
  get FillColor() { return toOle(this._fillColor); }
  set FillColor(v: number) { this._fillColor = fromOle(num(v, 'FillColor')); }

  Draw(g: Ctx) {
    super.Draw(g);
    if (!this.Visible) return;
    const t = this._thickness;
    if (this.Fill) {
      g.fillStyle = cssColor(this._fillColor);
      g.fillRect(this._x + t, this._y + t, this._width - 2 * t, this._height - 2 * t);
    }
    if (t > 0) {
      g.fillStyle = cssColor(this._borderColor);
      g.fillRect(this._x, this._y, this._width, t);
      g.fillRect(this._x, this._y + this._height - t, this._width, t);
      g.fillRect(this._x, this._y + t, t, this._height - 2 * t);
      g.fillRect(this._x + this._width - t, this._y + t, t, this._height - 2 * t);
    }
  }
}

function num(v: unknown, what: string): number {
  if (typeof v === 'boolean') return v ? -1 : 0;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (Number.isNaN(n)) throw new Error(`Expected a number for ${what}`);
  return n;
}

function ctxSpan(i: number): Span | null { return hostCallContext.argSpans[i] ?? null; }

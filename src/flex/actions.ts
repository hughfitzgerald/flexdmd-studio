// Ported from FlexDMD (https://github.com/vbousquet/flexdmd), Copyright 2019 Vincent Bousquet,
// licensed under the Apache License 2.0. TypeScript translation of FlexDMD/Actors/Actions.cs, modified
// from the original. See the NOTICE file at the repository root.
// Actions are updated once per frame and return true when finished.
import { ease, Interpolation } from './ease';
import type { Actor, Group } from './actor';
import type { AnimatedActor } from './animated';

export abstract class Action {
  /** Returns true when the action is complete. */
  abstract update(secondsElapsed: number): boolean;
  /** Human readable description for the inspector */
  abstract describe(): string;
}

export class RepeatAction extends Action {
  private _n = 0;
  constructor(private _action: Action, private _count: number) { super(); }
  update(dt: number): boolean {
    if (this._action.update(dt)) {
      this._n++;
      if (this._n === this._count) { this._n = 0; return true; }
    }
    return false;
  }
  describe() { return `Repeat(${this._count < 0 ? 'forever' : this._count}) { ${this._action.describe()} }`; }
}

export class SequenceAction extends Action {
  private _actions: Action[] = [];
  private _pos = 0;
  Add(action: Action): SequenceAction { this._actions.push(action); return this; }
  update(dt: number): boolean {
    if (this._pos >= this._actions.length) { this._pos = 0; return true; }
    while (this._actions[this._pos].update(dt)) {
      this._pos++;
      if (this._pos >= this._actions.length) { this._pos = 0; return true; }
    }
    return false;
  }
  describe() { return `Sequence[${this._actions.map((a) => a.describe()).join(', ')}]`; }
}

export class ParallelAction extends Action {
  private _actions: Action[] = [];
  private _runMask: boolean[] = [];
  Add(action: Action): ParallelAction { this._actions.push(action); this._runMask.push(true); return this; }
  update(dt: number): boolean {
    let alive = false;
    for (let i = 0; i < this._actions.length; i++) {
      if (this._runMask[i]) {
        if (this._actions[i].update(dt)) this._runMask[i] = false;
        else alive = true;
      }
    }
    if (!alive) { this._runMask.fill(true); return true; }
    return false;
  }
  describe() { return `Parallel[${this._actions.map((a) => a.describe()).join(', ')}]`; }
}

export class ShowAction extends Action {
  constructor(private _target: Actor, private _visible: boolean) { super(); }
  update(): boolean { this._target.Visible = this._visible; return true; }
  describe() { return `Show(${this._visible})`; }
}

export class BlinkAction extends Action {
  private _n = 0;
  private _time = 0;
  constructor(private _target: Actor, private _secondsShow: number, private _secondsHide: number, private _repeat: number) { super(); }
  update(dt: number): boolean {
    this._time += dt;
    if (this._target.Visible && this._time > this._secondsShow) {
      this._time -= this._secondsShow;
      this._target.Visible = false;
      this._n++;
      if (this._repeat >= 0 && this._n > this._repeat) return true;
    } else if (!this._target.Visible && this._time > this._secondsHide) {
      this._time -= this._secondsHide;
      this._target.Visible = true;
    }
    return false;
  }
  describe() { return `Blink(${this._secondsShow}, ${this._secondsHide}, ${this._repeat})`; }
}

export class AddToAction extends Action {
  constructor(private _target: Actor, private _parent: Group, private _add: boolean) { super(); }
  update(): boolean { if (this._add) this._parent.AddActor(this._target); else this._parent.RemoveActor(this._target); return true; }
  describe() { return this._add ? `AddTo(${this._parent.Name})` : `RemoveFrom(${this._parent.Name})`; }
}

export class RemoveFromParentAction extends Action {
  constructor(private _target: Actor) { super(); }
  update(): boolean { this._target.Remove(); return true; }
  describe() { return 'RemoveFromParent'; }
}

export class AddChildAction extends Action {
  constructor(private _target: Group, private _child: Actor, private _add: boolean) { super(); }
  update(): boolean { if (this._add) this._target.AddActor(this._child); else this._target.RemoveActor(this._child); return true; }
  describe() { return `${this._add ? 'AddChild' : 'RemoveChild'}(${this._child.Name})`; }
}

export class SeekAction extends Action {
  constructor(private _target: AnimatedActor, private _position: number) { super(); }
  update(): boolean { this._target.Seek(this._position); return true; }
  describe() { return `Seek(${this._position})`; }
}

export class WaitAction extends Action {
  private _time = 0;
  constructor(private _secondsToWait: number) { super(); }
  update(dt: number): boolean {
    this._time += dt;
    if (this._time >= this._secondsToWait) { this._time = 0; return true; }
    return false;
  }
  describe() { return `Wait(${this._secondsToWait})`; }
}

export class DelayedAction extends Action {
  private _time = 0;
  constructor(private _secondsToWait: number, private _action: Action) { super(); }
  update(dt: number): boolean {
    this._time += dt;
    if (this._time >= this._secondsToWait && this._action.update(dt)) { this._time = 0; return true; }
    return false;
  }
  describe() { return `Delayed(${this._secondsToWait}, ${this._action.describe()})`; }
}

/** Tween base emulating Glide's Tweener: linear time over Duration, eased, then applied to the target. */
export abstract class TweenAction extends Action {
  private _time = -1; // -1: not started
  private _from: number[] = [];
  Ease: Interpolation = Interpolation.Linear;
  constructor(protected _target: Actor, protected _duration: number) { super(); }
  protected abstract begin(): number[]; // returns start values
  protected abstract end(): number[]; // returns target values
  protected abstract apply(values: number[]): void;
  update(dt: number): boolean {
    if (this._time < 0) { this._time = 0; this._from = this.begin(); }
    this._time += dt;
    let t = this._duration <= 0 ? 1 : Math.min(1, this._time / this._duration);
    const e = ease(this.Ease, t);
    const to = this.end();
    this.apply(this._from.map((f, i) => f + (to[i] - f) * e));
    if (t >= 1) { this._time = -1; return true; }
    return false;
  }
}

export class MoveToAction extends TweenAction {
  constructor(target: Actor, private _x: number, private _y: number, duration: number) { super(target, duration); }
  protected begin() { return [this._target.X, this._target.Y]; }
  protected end() { return [this._x, this._y]; }
  protected apply(v: number[]) { this._target.X = v[0]; this._target.Y = v[1]; }
  describe() { return `MoveTo(${this._x}, ${this._y}, ${this._duration}s${this.Ease ? ', ' + Interpolation[this.Ease] : ''})`; }
}

/** The IActionFactory exposed to scripts as actor.ActionFactory */
export class ActionFactory {
  constructor(private _target: Actor) {}
  Wait(secondsToWait: number) { return new WaitAction(Number(secondsToWait)); }
  Delayed(secondsToWait: number, action: Action) { return new DelayedAction(Number(secondsToWait), checkAction(action)); }
  Parallel() { return new ParallelAction(); }
  Sequence() { return new SequenceAction(); }
  Repeat(action: Action, count: number) { return new RepeatAction(checkAction(action), Math.trunc(Number(count))); }
  Blink(secondsShow: number, secondsHide: number, repeat: number) { return new BlinkAction(this._target, Number(secondsShow), Number(secondsHide), Math.trunc(Number(repeat))); }
  Show(visible: boolean) { return new ShowAction(this._target, !!visible); }
  AddTo(parent: Group) { return new AddToAction(this._target, checkGroup(parent), true); }
  RemoveFromParent() { return new RemoveFromParentAction(this._target); }
  AddChild(child: Actor) { return new AddChildAction(checkGroup(this._target), checkActor(child), true); }
  RemoveChild(child: Actor) { return new AddChildAction(checkGroup(this._target), checkActor(child), false); }
  Seek(pos: number) {
    const t = this._target as unknown as AnimatedActor;
    if (typeof t.Seek !== 'function') throw new Error('Seek action requires a video actor');
    return new SeekAction(t, Number(pos));
  }
  MoveTo(x: number, y: number, duration: number) { return new MoveToAction(this._target, Number(x), Number(y), Number(duration)); }
}

function checkAction(a: unknown): Action {
  if (!(a instanceof Action)) throw new Error('Expected an Action (created with an ActionFactory)');
  return a;
}
function checkActor(a: unknown): Actor {
  if (!a || typeof (a as Actor).Draw !== 'function') throw new Error('Expected an actor (Group, Image, Label, Frame or Video)');
  return a as Actor;
}
function checkGroup(g: unknown): Group {
  if (!g || typeof (g as Group).AddActor !== 'function') throw new Error('Expected a Group actor');
  return g as Group;
}

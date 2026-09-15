// Ported from FlexDMD (https://github.com/vbousquet/flexdmd), Copyright 2019 Vincent Bousquet,
// licensed under the Apache License 2.0. TypeScript translation of FlexDMD/Actors/AnimatedActor.cs, ImageSequence.cs, GIFImage.cs and Video.cs, modified
// from the original. See the NOTICE file at the repository root.
// cs, GIFImage.cs and Video.cs
import { Actor, type Ctx } from './actor';
import { Alignment, Scaling } from './layout';
import { drawScaled, Image } from './image';
import type { AssetManager } from './assets';

export abstract class AnimatedActor extends Actor {
  protected _frameTime = 0; // Timestamp of the currently displayed frame
  protected _frameDuration = 0; // Duration of the currently displayed frame
  protected _time = 0; // Time of the video
  protected _endOfAnimation = false;
  private _scaling: Scaling = Scaling.Stretch;
  private _alignment: Alignment = Alignment.Center;
  Paused = false;
  Loop = true;
  PlaySpeed = 1.0;

  get typeName(): string { return 'Video'; }
  abstract get Length(): number;
  get Scaling() { return this._scaling; }
  set Scaling(v: number) { this._scaling = Math.trunc(Number(v)) as Scaling; }
  get Alignment() { return this._alignment; }
  set Alignment(v: number) { this._alignment = Math.trunc(Number(v)) as Alignment; }
  get time() { return this._time; }

  Update(delta: number) {
    super.Update(delta);
    if (!this.Visible) return;
    if (!this.Paused) this.advance(delta * Number(this.PlaySpeed));
  }

  Seek(posInSeconds: number) {
    this.rewind();
    this.advance(Number(posInSeconds));
  }

  private advance(delta: number) {
    this._time += delta;
    let guard = 0;
    while (!this._endOfAnimation && this._time >= this._frameTime + this._frameDuration) {
      this.readNextFrame();
      if (++guard > 100000) { this._endOfAnimation = true; break; }
    }
    if (this._endOfAnimation && this.Loop) {
      const length = this._frameTime + this._frameDuration;
      this._time = length > 0 ? this._time % length : 0;
      this.rewind();
    }
  }

  protected rewind() {
    this._time = 0;
    this._frameTime = 0;
    this._endOfAnimation = false;
  }

  protected abstract readNextFrame(): void;
}

export class ImageSequence extends AnimatedActor {
  private _fps: number;
  private _frame = 0;
  private _frames: Image[] = [];

  constructor(manager: AssetManager, paths: string, name = '', fps = 30, loop = true) {
    super(name);
    this._fps = fps;
    this.Loop = loop;
    for (const path of paths.split('|')) this._frames.push(new Image(manager, path));
    this._frame = 0;
    this._frameDuration = 1.0 / fps;
    this.Pack();
  }

  get typeName(): string { return 'ImageSequence'; }
  get PrefWidth() { return this._frames[0].Width; }
  get PrefHeight() { return this._frames[0].Height; }
  get Length() { return this._frames.length * this._frameDuration; }
  get FPS() { return this._fps; }
  set FPS(v: number) { v = Number(v); if (this._fps === v) return; this._fps = v; this._frameDuration = 1.0 / v; }
  get frameIndex() { return this._frame; }

  protected onStageStateChanged() { for (const f of this._frames) f.OnStage = this.OnStage; }
  protected rewind() { super.rewind(); this._frame = 0; }
  protected readNextFrame() {
    if (this._frame === this._frames.length - 1) this._endOfAnimation = true;
    else { this._frame++; this._frameTime = this._frame * this._frameDuration; }
  }
  Draw(g: Ctx) {
    super.Draw(g);
    if (!this.Visible) return;
    const f = this._frames[this._frame];
    f.Scaling = this.Scaling;
    f.Alignment = this.Alignment;
    f.SetBounds(this.X, this.Y, this.Width, this.Height);
    f.Draw(g);
  }
}

export interface GifData { width: number; height: number; frames: HTMLCanvasElement[]; delays: number[]; }

export class GIFImage extends AnimatedActor {
  private _gif: GifData;
  private _pos = 0;
  private _length = 0;

  constructor(manager: AssetManager, path: string, name = '') {
    super(name);
    this._gif = manager.getGif(manager.resolveSrc(path));
    for (const d of this._gif.delays) this._length += d;
    this.rewind();
    this.Pack();
  }

  get typeName(): string { return 'Video'; }
  get PrefWidth() { return this._gif.width; }
  get PrefHeight() { return this._gif.height; }
  get Length() { return this._length; }
  get frameIndex() { return this._pos; }

  protected rewind() { super.rewind(); this._pos = 0; this._frameDuration = this._gif.delays[0] ?? 0; }
  protected readNextFrame() {
    if (this._pos >= this._gif.delays.length - 1) this._endOfAnimation = true;
    else {
      this._pos++;
      this._frameTime = 0;
      for (let i = 0; i < this._pos; i++) this._frameTime += this._gif.delays[i];
      this._frameDuration = this._gif.delays[this._pos];
    }
  }
  Draw(g: Ctx) {
    if (!this.Visible) return;
    const frame = this._gif.frames[this._pos];
    if (frame) drawScaled(g, frame, this.Scaling, this.Alignment, this.PrefWidth, this.PrefHeight, this.X, this.Y, this.Width, this.Height);
  }
}

/** MP4 video backed by an HTMLVideoElement. Playback follows the preview clock (play/pause) rather than frame stepping. */
export class VideoActor extends AnimatedActor {
  private _video: HTMLVideoElement;
  constructor(private _manager: AssetManager, path: string, name = '') {
    super(name);
    this._video = _manager.getVideo(_manager.resolveSrc(path));
    this.Pack();
  }
  get typeName(): string { return 'Video'; }
  get PrefWidth() { return this._video.videoWidth; }
  get PrefHeight() { return this._video.videoHeight; }
  get Length() { return Number.isFinite(this._video.duration) ? this._video.duration : 0; }
  get video() { return this._video; }

  protected readNextFrame() { this._endOfAnimation = true; }

  Update(delta: number) {
    Actor.prototype.Update.call(this, delta);
    const v = this._video;
    const shouldPlay = this.OnStage && this.Visible && !this.Paused && this._manager.clockRunning;
    v.loop = !!this.Loop;
    const rate = Number(this.PlaySpeed) || 1;
    if (v.playbackRate !== rate) { try { v.playbackRate = rate; } catch { /* unsupported rate */ } }
    if (shouldPlay && v.paused) void v.play().catch(() => {});
    else if (!shouldPlay && !v.paused) v.pause();
  }
  Seek(posInSeconds: number) { this._video.currentTime = Number(posInSeconds); }
  protected onStageStateChanged() { if (!this.OnStage) this._video.pause(); }
  Draw(g: Ctx) {
    if (!this.Visible || this._video.readyState < 2) return;
    drawScaled(g, this._video, this.Scaling, this.Alignment, this.PrefWidth, this.PrefHeight, this.X, this.Y, this.Width, this.Height);
  }
}

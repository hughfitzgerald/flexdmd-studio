// Runs scripts against the FlexDMD engine and drives the preview clock.
import { Interpreter, VbsRuntimeError, VbsSyntaxError, VbArray, type VbValue } from '../vbs/interpreter';
import type { Span } from '../vbs/ast';
import { FlexDMD, type LogLevel } from '../flex/flexdmd';
import { AssetPendingError } from '../flex/assets';
import type { ProcDecl } from '../vbs/ast';

export interface ScriptError { message: string; line: number | null; span: Span | null; }

export interface RunnerEvents {
  onLog: (level: LogLevel, message: string, span?: Span | null) => void;
  onFrame: (output: ImageData) => void;
  onRunFinished: (error: ScriptError | null, procs: ProcDecl[]) => void;
  onPlayStateChange: (playing: boolean) => void;
}

const MAX_RELOADS = 12;

export class Runner {
  readonly flex = new FlexDMD();
  interp: Interpreter | null = null;
  /** Source of the last successful run (bindings refer to it) */
  lastRunSource: string | null = null;
  private _playing = true;
  speed = 1;
  private _lastFrame = 0;
  private _raf = 0;
  private _runId = 0;
  private _running = false;
  frameCount = 0;
  fps = 0;
  private _fpsAcc = 0;
  private _fpsTime = 0;
  /** Set when the preview should redraw although time is not advancing (e.g. while dragging an actor) */
  dirty = false;

  constructor(private ev: RunnerEvents) {
    this.flex.onLog = (l, m) => ev.onLog(l, m);
    this.flex.AssetManager.clockRunning = this._playing;
  }

  get playing() { return this._playing; }
  set playing(v: boolean) {
    if (this._playing === v) return;
    this._playing = v;
    this.flex.AssetManager.clockRunning = v;
    this.ev.onPlayStateChange(v);
  }

  get isRunning() { return this._running; }

  start() {
    const loop = (t: number) => {
      this._raf = requestAnimationFrame(loop);
      const dt = this._lastFrame ? Math.min(0.1, (t - this._lastFrame) / 1000) : 1 / 60;
      this._lastFrame = t;
      this.frame(dt);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() { cancelAnimationFrame(this._raf); }

  private frame(dt: number) {
    if (this._running) return; // a script run is in progress (waiting for assets)
    if (this._playing) {
      try {
        this.flex.step(dt * this.speed);
      } catch (e) {
        this.playing = false;
        this.ev.onLog('error', `Render loop error: ${e instanceof Error ? e.message : e}`);
      }
      this.frameCount++;
      this._fpsAcc++;
      this._fpsTime += dt;
      if (this._fpsTime >= 0.5) { this.fps = Math.round(this._fpsAcc / this._fpsTime); this._fpsAcc = 0; this._fpsTime = 0; }
    } else if (this.dirty) {
      try { this.flex.redraw(); } catch { /* ignore while paused */ }
    }
    this.dirty = false;
    this.ev.onFrame(this.flex.output());
  }

  /** Advances exactly one frame while paused */
  stepOnce() {
    this.playing = false;
    try { this.flex.step(1 / 60); } catch (e) { this.ev.onLog('error', `Render loop error: ${e instanceof Error ? e.message : e}`); }
    this.ev.onFrame(this.flex.output());
  }

  /**
   * Runs a script from scratch. Assets load asynchronously: when the script touches an asset that is not loaded yet
   * the run is retried after the pending loads complete.
   */
  async run(source: string): Promise<ScriptError | null> {
    const id = ++this._runId;
    this._running = true;
    let error: ScriptError | null = null;
    try {
      for (let attempt = 0; attempt < MAX_RELOADS; attempt++) {
        const flex = this.flex;
        flex.resetToDefaults();
        flex.GameName = 'FlexDMD Studio';
        flex.Run = true;
        const interp = new Interpreter({
          // Table1 is a stub so table-style init code (Table1.Filename & ".vpx") runs in the preview
          globals: { FlexDMD: flex, Table1: { Filename: 'Table1', Name: 'Table1' } },
          createObject: (progId) => {
            if (progId.toLowerCase() === 'flexdmd.flexdmd') return flex;
            throw new VbsRuntimeError(`CreateObject("${progId}") is not available in the previewer`, null, 429);
          },
          log: (m) => this.ev.onLog('info', m),
        });
        this.interp = interp;
        try {
          interp.run(source);
          error = null;
          break;
        } catch (e) {
          if (e instanceof VbsRuntimeError && /Asset is still loading/.test(e.message) || e instanceof AssetPendingError || (e instanceof VbsRuntimeError && flex.AssetManager.hasPending)) {
            await flex.AssetManager.loadPending();
            if (id !== this._runId) return null; // superseded by a newer run
            continue;
          }
          error = toScriptError(e);
          break;
        }
      }
      if (this.flex.AssetManager.hasPending) {
        // Assets requested but not needed synchronously (e.g. a video); let them finish in the background
        void this.flex.AssetManager.loadPending();
      }
    } finally {
      if (id === this._runId) {
        this._running = false;
        this.lastRunSource = error ? null : source;
        this.flex.AssetManager.clockRunning = this._playing;
        this.ev.onRunFinished(error, this.interp?.listProcs() ?? []);
      }
    }
    return error;
  }

  /** Invokes a Sub/Function of the current script with VBScript-literal arguments ("1, "text", True") */
  callSub(name: string, argsText: string): ScriptError | null {
    if (!this.interp) return { message: 'No script is loaded', line: null, span: null };
    try {
      let args: VbValue[] = [];
      if (argsText.trim()) {
        const arr = this.interp.evalExpression(`Array(${argsText})`);
        args = arr instanceof VbArray ? arr.toList() : [arr];
      }
      const t0 = performance.now();
      this.interp.callProc(name, args);
      this.ev.onLog('info', `${name}(${argsText}) executed in ${(performance.now() - t0).toFixed(1)} ms`);
      this.dirty = true;
      return null;
    } catch (e) {
      if (this.flex.AssetManager.hasPending) {
        void this.flex.AssetManager.loadPending().then(() => this.ev.onLog('warn', `${name}: an asset was still loading; run the Sub again`));
      }
      return toScriptError(e);
    }
  }
}

export function toScriptError(e: unknown): ScriptError {
  if (e instanceof VbsRuntimeError || e instanceof VbsSyntaxError) return { message: e.message, line: e.span?.line ?? null, span: e.span ?? null };
  return { message: e instanceof Error ? e.message : String(e), line: null, span: null };
}

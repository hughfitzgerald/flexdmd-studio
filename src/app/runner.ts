// Runs scripts against the FlexDMD engine and drives the preview clock.
import { Interpreter, VbsRuntimeError, VbsSyntaxError, VbArray, GhostRegistry, type VbValue } from '../vbs/interpreter';
import type { Span } from '../vbs/ast';
import { FlexDMD, type LogLevel } from '../flex/flexdmd';
import { constantGlobals } from '../flex/constants';
import { VbDictionary } from '../vbs/dictionary';
import { SceneEntry } from './sceneentry';
import { AssetPendingError } from '../flex/assets';
import type { ProcDecl } from '../vbs/ast';

export interface ScriptError { message: string; line: number | null; span: Span | null; }

/** Top-level statements that failed and were skipped, when the runner is standing in for a table. */
export interface SkippedStatement { message: string; line: number | null; }

/** Subs the studio calls for you: one after a run, one on every frame. */
export interface EntryPoints {
  /** Called once after the script runs, e.g. "DMD_Init" or "Table1_Init" */
  onRun: string;
  /** Called before every frame, e.g. "DmdTick_Score(Nothing)" — this is the table's DMD timer */
  perFrame: string;
}

export interface RunnerEvents {
  onLog: (level: LogLevel, message: string, span?: Span | null) => void;
  onFrame: (output: ImageData) => void;
  onRunFinished: (error: ScriptError | null, procs: ProcDecl[]) => void;
  onPlayStateChange: (playing: boolean) => void;
  /** Reports an error raised by the per-frame Sub; ticking stops until the next run */
  onTickError: (error: ScriptError) => void;
}

const MAX_RELOADS = 12;

export class Runner {
  readonly flex = new FlexDMD();
  readonly ghosts = new GhostRegistry();
  /** Handed to a Builder that expects its framework to pass it one; its SetScene shows the scene. */
  readonly sceneEntry: SceneEntry;
  interp: Interpreter | null = null;
  entryPoints: EntryPoints = { onRun: '', perFrame: '' };
  /** Frame counter exposed to scripts as FlexFrame, the way table DMD timers count frames */
  flexFrame = 0;
  private _tickBroken = false;
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
  /** Table setup the previewer could not run; the DMD code after it still ran */
  skipped: SkippedStatement[] = [];

  constructor(private ev: RunnerEvents) {
    this.sceneEntry = new SceneEntry(this.flex, this.ghosts);
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
        this.runPerFrameSub();
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

  /**
   * Runs the script's per-frame Sub, standing in for the table's DMD timer. Errors stop the
   * ticking rather than repeating sixty times a second; the next run clears that.
   */
  private runPerFrameSub() {
    const call = this.entryPoints.perFrame.trim();
    if (!call || !this.interp || this._tickBroken) return;
    this.flexFrame++;
    this.interp.setGlobal('FlexFrame', this.flexFrame);
    const err = this.callParsed(call);
    if (err) {
      this._tickBroken = true;
      this.ev.onTickError(err);
    }
  }

  /** Runs a "Name" or "Name(arg, arg)" call written in an entry-point field. */
  callParsed(call: string): ScriptError | null {
    const m = call.trim().match(/^(\w+)\s*(?:\((.*)\))?\s*$/);
    if (!m) return { message: `Not a Sub call: ${call}`, line: null, span: null };
    const [, name, argText] = m;
    // A Builder or Ticker named on its own, but declared with arguments, is one a framework would
    // have called with an entry. Hand it the studio's stand-in so its scene reaches the display.
    if ((argText === undefined || argText.trim() === '') && this.interp && this.interp.procParams(name) > 0) {
      return this.callSubValues(name, [this.sceneEntry]);
    }
    return this.callSub(name, argText ?? '');
  }

  /** Invokes a Sub with values the studio already holds, rather than with text to evaluate. */
  callSubValues(name: string, args: VbValue[]): ScriptError | null {
    if (!this.interp) return { message: 'No script is loaded', line: null, span: null };
    try {
      this.interp.callProc(name, args);
      this.dirty = true;
      return null;
    } catch (e) {
      if (this.flex.AssetManager.hasPending) void this.flex.AssetManager.loadPending();
      return toScriptError(e);
    }
  }

  /** Advances exactly one frame while paused */
  stepOnce() {
    this.playing = false;
    try { this.runPerFrameSub(); this.flex.step(1 / 60); } catch (e) { this.ev.onLog('error', `Render loop error: ${e instanceof Error ? e.message : e}`); }
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
        this.ghosts.clear();
        this.skipped = [];
        this.flexFrame = 0;
        this._tickBroken = false;
        const interp = new Interpreter({
          // FlexFrame is the frame counter table DMD timers count on; the studio advances it.
          // Everything else a table script reaches for (Table1, lights, timers) is stood in for.
          globals: { ...constantGlobals(), FlexDMD: flex, FlexFrame: 0, Studio: this.sceneEntry },
          ghosts: this.ghosts,
          // Only while standing in for a table: a broken line of playfield setup should not stop
          // the DMD code below it from being previewed.
          onTopLevelError: this.ghosts.enabled
            ? (e) => { if (this.skipped.length < 200) this.skipped.push({ message: e.message, line: e.span?.line ?? null }); }
            : undefined,
          createObject: (progId) => {
            if (progId.toLowerCase() === 'flexdmd.flexdmd') return flex;
            // Frameworks keep their event tables and player state in dictionaries, so this one is real
            if (progId.toLowerCase() === 'scripting.dictionary') return new VbDictionary();
            if (this.ghosts.enabled) return this.ghosts.touch(`CreateObject("${progId}")`);
            throw new VbsRuntimeError(`CreateObject("${progId}") is not available in the previewer`, null, 429);
          },
          log: (m) => this.ev.onLog('info', m),
        });
        this.interp = interp;
        try {
          interp.run(source);
          const init = this.entryPoints.onRun.trim();
          if (init) {
            const e = this.callParsed(init);
            if (e) { error = e; break; }
          }
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

  /**
   * Runs a fragment against the loaded script's state, leaving the stage as it is. This is what
   * "run the selection" does, so a single scene inside a large file can be poked at in isolation.
   */
  runSnippet(source: string): ScriptError | null {
    if (!this.interp) return { message: 'No script is loaded', line: null, span: null };
    try {
      this.interp.runFragment(source);
      this.dirty = true;
      return null;
    } catch (e) {
      if (this.flex.AssetManager.hasPending) void this.flex.AssetManager.loadPending();
      return toScriptError(e);
    }
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

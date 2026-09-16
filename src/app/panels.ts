// Subs, Assets, Log and Help panels
import type { ProcDecl } from '../vbs/ast';
import type { AssetManager } from '../flex/assets';

export class SubsPanel {
  private argValues = new Map<string, string>();
  constructor(private el: HTMLElement, private onCall: (name: string, args: string) => void) {}
  render(procs: ProcDecl[]) {
    this.el.replaceChildren();
    if (procs.length === 0) {
      this.el.innerHTML = '<div class="muted">No Sub or Function defined in the script.<br><br>Define one (for example <code>Sub ShowJackpot(score)</code>) and it appears here as a button, so you can trigger the animations your table would trigger on game events.</div>';
      return;
    }
    for (const p of procs) {
      const row = document.createElement('div');
      row.className = 'sub-row';
      const btn = document.createElement('button');
      btn.textContent = `${p.isFunction ? 'ƒ ' : ''}${p.displayName}`;
      btn.title = `Call ${p.displayName} (defined at line ${p.span.line})`;
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = p.params.length ? p.params.map((x) => x.name).join(', ') : '(no arguments)';
      input.disabled = p.params.length === 0;
      input.value = this.argValues.get(p.name) ?? '';
      input.addEventListener('input', () => this.argValues.set(p.name, input.value));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.onCall(p.name, input.value); });
      btn.addEventListener('click', () => this.onCall(p.name, input.value));
      row.append(btn, input);
      this.el.appendChild(row);
    }
    const hint = document.createElement('div');
    hint.className = 'muted';
    hint.style.marginTop = '8px';
    hint.textContent = 'Arguments are VBScript literals separated by commas, e.g. 1500000, "Player 1", True';
    this.el.appendChild(hint);
  }
}

export class AssetsPanel {
  constructor(private el: HTMLElement, private assets: AssetManager) {}
  render() {
    const files = [...this.assets.projectFiles.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const loaded = this.assets.listLoaded();
    const parts: string[] = [];
    parts.push(`<div class="muted">Project folder: ${files.length ? `${files.length} file(s)` : 'none opened. Use "Open folder" to load the folder with your images, fonts and videos. Paths in the script resolve against it (FlexDMD.ProjectFolder is honoured).'}</div>`);
    if (files.length) {
      const list = files.filter(([k]) => /\.(png|jpe?g|bmp|gif|mp4|fnt|ogg|mp3|wav)$/i.test(k)).slice(0, 500).map(([k, f]) => `<li>${esc(k)} <span class="muted">${fmtSize(f.size)}</span></li>`).join('');
      parts.push(`<ul class="asset-list">${list}</ul>`);
    }
    parts.push(`<h4>Loaded assets (${loaded.length})</h4><ul class="asset-list">${loaded.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>`);
    parts.push(`<h4>Bundled FlexDMD resources</h4><div class="muted">Use them as <code>FlexDMD.Resources.&lt;name&gt;</code>: teeny_tiny_pixls-5.fnt, udmd-f4by5.fnt, udmd-f5by7.fnt, udmd-f6by12.fnt, udmd-f7by13.fnt, udmd-f7by5.fnt, udmd-f12by24.fnt, udmd-f14by26.fnt, bm_army-12.fnt, zx_spectrum-7.fnt, dmds.black.png, colors.png</div>`);
    this.el.innerHTML = parts.join('');
  }
}

export interface LogEntry { level: 'info' | 'warn' | 'error'; message: string; line: number | null; time: number; }

export class LogPanel {
  private entries: LogEntry[] = [];
  errorCount = 0;
  constructor(private el: HTMLElement, private badge: HTMLElement, private onReveal: (line: number) => void) {}
  clear() { this.entries = []; this.errorCount = 0; this.render(); }
  add(level: LogEntry['level'], message: string, line: number | null = null) {
    // collapse repeated identical messages (asset warnings are emitted per frame otherwise)
    const last = this.entries[this.entries.length - 1];
    if (last && last.message === message && last.level === level) return;
    this.entries.push({ level, message, line, time: performance.now() });
    if (this.entries.length > 500) this.entries.shift();
    if (level === 'error') this.errorCount++;
    this.render();
  }
  private render() {
    this.badge.hidden = this.errorCount === 0;
    this.badge.textContent = String(this.errorCount);
    this.el.replaceChildren();
    if (this.entries.length === 0) { this.el.innerHTML = '<div class="muted">No messages.</div>'; return; }
    for (const e of this.entries.slice().reverse()) {
      const div = document.createElement('div');
      div.className = `log-line ${e.level}`;
      div.textContent = e.message;
      if (e.line) {
        const a = document.createElement('a');
        a.textContent = ` (line ${e.line})`;
        a.addEventListener('click', () => this.onReveal(e.line!));
        div.appendChild(a);
      }
      this.el.appendChild(div);
    }
  }
}

export function renderHelp(el: HTMLElement) {
  el.innerHTML = `<div class="help">
<h3>What this is</h3>
<p>A browser re-implementation of the FlexDMD scene engine (actors, actions, bitmap fonts, render modes) with a VBScript interpreter,
so you can write the DMD part of a table script on any OS and watch it run. Scripts you write here run unchanged in FlexDMD / Visual Pinball.</p>

<h3>Three ways to use it</h3>
<ul>
<li><b>A scene on its own.</b> A <code>FlexDMD</code> object is pre-created with <code>Run = True</code>, so you can write scene code straight
away, like the FlexDMDUI design tab. Start from the Samples menu.</li>
<li><b>A whole table script.</b> Paste or open one. Everything it reaches for that this is not — the table, lights, timers, sound, the
framework — is stood in for, and any line of setup that still fails is skipped and listed. Set <b>On run</b> to the table's init Sub
(often <code>Table1_Init</code>) to build its DMD.</li>
<li><b>Files out of a larger project.</b> Open the folder and tick the files you want in the <b>Files</b> tab. Frameworks usually split the
DMD across a config file and a scenes file, with the glue elsewhere; <code>examples/studio-harness.vbs</code> in this repository is that glue,
ready to copy and edit.</li>
</ul>

<h3>The run bar</h3>
<ul>
<li><b>On run</b> — a Sub called once after the script runs, for the table's or framework's init.</li>
<li><b>Each frame</b> — a Sub called before every frame, standing in for the table's DMD timer. <code>FlexFrame</code> counts up for it, so
tickers that key on frame numbers work. An error here stops the ticking rather than repeating it sixty times a second.</li>
<li><b>Stub unknowns</b> — on by default. Turn it off to have every unknown name reported as an error, which is what you want while
debugging your own scene code. The <b>Stubs</b> tab lists what was stood in for.</li>
<li><b>Insert constants</b> — pastes the <code>FlexDMD_Align_*</code> / <code>FlexDMD_RenderMode_*</code> block tables use, so your script stays
portable. The studio defines those names anyway, with or without the block.</li>
</ul>

<h3>Editing</h3>
<ul>
<li><kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> runs. <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> runs just the selected lines on top of
what is already loaded, without resetting the stage — the quick way to poke at one scene inside a big file.</li>
<li><kbd>Ctrl/Cmd</kbd>+<kbd>/</kbd> comments or uncomments the selection.</li>
<li>Completion knows the FlexDMD API: type <code>FlexDMD.</code> or a dot after an actor, and in an enum position
(<code>.Alignment =</code>, <code>.Scaling =</code>, <code>.RenderMode =</code>, <code>.Ease =</code>, or the third argument of
<code>SetAlignedPosition</code>) it offers the named constants.</li>
<li>A bare enum number is labelled with what it means; click the label to write the constant instead.</li>
<li>Above a few thousand lines, auto-run switches itself off — use Run.</li>
</ul>

<h3>Preview</h3>
<ul>
<li><b>Pause / Step / Restart / Speed</b> control the simulated clock (actions, videos and the per-frame Sub follow it).</li>
<li>Click an actor to select it; drag to move, use the handles to resize. The literals in the script
(<code>SetBounds</code>, <code>SetPosition</code>, <code>SetAlignedPosition</code>, <code>SetSize</code>, <code>X = …</code>) update live and are
highlighted. Values that are computed are shown read-only. With several files loaded, only literals in the file you are editing can be dragged.</li>
<li>Arrow keys nudge the selection (Shift = 10 px). <kbd>Space</kbd> pauses. <kbd>Esc</kbd> deselects.</li>
<li><b>Subs</b> lists every Sub and Function in the script as a button, so you can fire game events and watch the animation.</li>
<li><b>Sound</b>: pick an audio file from the project folder; it restarts with the script and follows pause and speed, to line animations
up with a soundtrack.</li>
</ul>

<h3>Assets</h3>
<p>Click <b>Open folder</b> and pick the folder holding your PNG/JPG/GIF/MP4 and <code>.fnt</code> files. Script paths resolve against it,
honouring <code>FlexDMD.ProjectFolder</code>. Image options work as in FlexDMD: <code>image.png&amp;dmd=2</code>, <code>&amp;add</code>,
<code>&amp;region=x,y,w,h</code>, <code>&amp;pad=l,t,r,b</code>; image sequences with <code>a.png|b.png|c.png</code>.
A file that is not there is replaced by a placeholder and reported in the Log, so a table whose artwork you do not have still previews.
VPX-embedded resources (<code>VPX.name</code>) and WMV/AVI are not supported in the browser.</p>

<h3>Fidelity notes</h3>
<p>The engine is a line-by-line port of the C# actors, which the C++ port in Visual Pinball standalone also follows, and its quirks are
reproduced on purpose. The one that bites most: a counted <code>ActionFactory.Blink</code> leaves its actor hidden when it ends and never
resets its counter, so inside a <code>Repeat</code> the actor barely appears after the first pass. Build blinks from
<code>Wait</code>/<code>Show</code> inside a <code>Repeat</code> instead. GIF frame delays of 0 are clamped to 10 ms, and video timing follows
the browser rather than the engine's frame stepping.</p>
</div>`;
}

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtSize(n: number): string { return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`; }

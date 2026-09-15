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
<h3>Script model</h3>
<p>Like FlexDMDUI, a <code>FlexDMD</code> object is pre-created with <code>Run = True</code>; <code>CreateObject("FlexDMD.FlexDMD")</code> returns the same object,
so table-style initialisation code also works. Everything else is plain FlexDMD API: <code>NewGroup</code>, <code>NewImage</code>, <code>NewLabel</code>, <code>NewFont</code>,
<code>NewVideo</code>, <code>NewFrame</code>, <code>ActionFactory</code> (Wait, Delayed, Sequence, Parallel, Repeat, Blink, Show, AddTo, RemoveFromParent, AddChild, RemoveChild, Seek, MoveTo).</p>
<h3>Assets</h3>
<p>Click <b>Open folder</b> and pick the folder that holds your PNG/JPG/GIF/MP4/FNT files. Script paths resolve against it, honouring <code>FlexDMD.ProjectFolder</code>.
Image options work as in FlexDMD: <code>image.png&amp;dmd=2</code>, <code>&amp;add</code>, <code>&amp;region=x,y,w,h</code>, <code>&amp;pad=l,t,r,b</code>; image sequences with <code>a.png|b.png|c.png</code>.
VPX-embedded resources (<code>VPX.name</code>) and WMV/AVI videos are not supported in the browser.</p>
<h3>Preview</h3>
<ul>
<li><b>Pause / Step / Restart / Speed</b> control the simulated clock (actions and videos follow it).</li>
<li>Click an actor to select it; drag to move, use the handles to resize. The literals in the script (<code>SetBounds</code>, <code>SetPosition</code>, <code>SetAlignedPosition</code>, <code>SetSize</code>, <code>X = …</code>) update live and are highlighted in the editor. Values that are computed (variables, expressions) are shown read-only.</li>
<li>Arrow keys nudge the selection (Shift = 10 px). <kbd>Space</kbd> pauses. <kbd>Esc</kbd> deselects. <kbd>Ctrl/Cmd+Enter</kbd> runs.</li>
<li><b>Subs</b> tab: every Sub/Function in your script becomes a button so you can fire game events (jackpot, ball lost…) and watch the animation.</li>
<li><b>Sound</b>: pick an audio file from the project folder; it restarts with the script and follows pause/speed, to line up animations with a soundtrack.</li>
</ul>
<h3>Render modes</h3>
<p><code>FlexDMD.RenderMode</code> 0 = 4 shades, 1 = 16 shades (default), 2 = RGB; gray modes are tinted with <code>FlexDMD.Color</code>. Segment display modes are not previewed.</p>
<h3>Fidelity notes</h3>
<p>The engine is a line-by-line port of the C# actors (also the reference for the C++ port in Visual Pinball standalone/BGFX). Known differences: GIF frame delays of 0 are clamped to 10 ms; video timing follows the browser's video element rather than frame stepping.</p>
</div>`;
}

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtSize(n: number): string { return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`; }

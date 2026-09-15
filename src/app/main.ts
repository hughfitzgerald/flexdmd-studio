import './styles.css';
import { ScriptEditor } from './editor';
import { Runner, type ScriptError } from './runner';
import { Preview } from './preview';
import { Inspector } from './inspector';
import { AssetsPanel, LogPanel, SubsPanel, renderHelp } from './panels';
import { SAMPLES } from './samples';
import { boundSpans, canEditPosition, canEditSize, geometryEdits, rebind, type Geometry } from './codegen';
import type { Actor } from '../flex/actor';
import { RenderModeNames } from '../flex/flexdmd';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const STORAGE_KEY = 'flexdmd-studio.script';

// ---- panels ----
const logPanel = new LogPanel($('#tab-log'), $('#log-badge'), (line) => editor.revealLine(line));
const subsPanel = new SubsPanel($('#tab-subs'), (name, args) => callSub(name, args));
renderHelp($('#tab-help'));

// ---- runner ----
let autoRun = true;
let runTimer = 0;
const runner = new Runner({
  onLog: (level, message, span) => logPanel.add(level, message, span?.line ?? null),
  onFrame: (output) => { preview.draw(output); tickUi(); },
  onRunFinished: (error, procs) => {
    subsPanel.render(procs);
    assetsPanel.render();
    showError(error);
    updateInfo();
    if (!error) syncAudio(true);
    // keep the selection on the actor with the same name after a re-run
    if (selectedPath !== null) {
      const a = findByPath(selectedPath);
      preview.select(a, false);
      inspector.selected = a;
      editor.setBoundSpans(a ? boundSpans(a) : []);
    }
  },
  onPlayStateChange: (playing) => {
    $('#btn-play').textContent = playing ? '⏸ Pause' : '▶ Play';
    syncAudio(false);
  },
});
const assetsPanel = new AssetsPanel($('#tab-assets'), runner.flex.AssetManager);

// ---- editor ----
const initial = localStorage.getItem(STORAGE_KEY) ?? SAMPLES[1].source;
const editor = new ScriptEditor($('#editor'), initial, {
  onChange: (text) => {
    localStorage.setItem(STORAGE_KEY, text);
    if (autoRun) scheduleRun();
  },
  onRunRequest: () => runNow(),
});

// ---- preview ----
let selectedPath: string | null = null;
const preview = new Preview($('#preview'), runner.flex, {
  onSelect: (actor) => selectActor(actor),
  onGeometryChange: (actor, geom, phase) => applyGeometry(actor, geom, phase),
  onTogglePlay: () => { runner.playing = !runner.playing; },
});
preview.canEdit = (a) => ({ position: canEditPosition(a), size: canEditSize(a) });

const inspector = new Inspector($('#actor-tree'), $('#actor-props'), runner.flex, {
  onSelect: (actor) => { preview.select(actor, false); selectActor(actor); },
  onGeometryInput: (actor, field, value) => {
    const g: Geometry = { x: actor.X, y: actor.Y, w: actor.Width, h: actor.Height };
    if (field === 'x') g.x = value; else if (field === 'y') g.y = value; else if (field === 'w') g.w = value; else g.h = value;
    applyGeometry(actor, g, 'end');
  },
  onRevealSpan: (line) => editor.revealLine(line),
});

function selectActor(actor: Actor | null) {
  inspector.selected = actor;
  selectedPath = actor ? actor.path() : null;
  editor.setBoundSpans(actor ? boundSpans(actor) : []);
  if (actor) {
    const line = actor._binding.positionStmt?.line ?? actor._binding.sizeStmt?.line;
    if (line) editor.revealLine(line);
    switchTab('inspector');
  }
  inspector.refresh();
}

function findByPath(path: string): Actor | null {
  const stage = runner.flex.Stage;
  const visit = (g: typeof stage): Actor | null => {
    for (const c of g.Children) {
      if (c.path() === path) return c;
      if ('Children' in c) { const f = visit(c as typeof stage); if (f) return f; }
    }
    return null;
  };
  return visit(stage);
}

// ---- WYSIWYG write-back ----
let dragEditsPending = false;
function applyGeometry(actor: Actor, geom: Geometry, phase: 'move' | 'end') {
  // Make sure the bindings refer to the current document
  if (runner.lastRunSource !== null && runner.lastRunSource !== editor.text && !dragEditsPending) {
    status('Script changed since last run: run it before dragging', 'error');
    return;
  }
  const changed: Partial<Geometry> = {};
  if (geom.x !== actor.X || geom.y !== actor.Y) { changed.x = geom.x; changed.y = geom.y; }
  if (geom.w !== actor.Width || geom.h !== actor.Height) { changed.w = geom.w; changed.h = geom.h; }
  if (Object.keys(changed).length === 0) { if (phase === 'end' && dragEditsPending) finishDrag(); return; }
  const { edits, unbound } = geometryEdits(actor, changed);
  if (unbound.length) status(`Cannot edit ${unbound.join(' and ')} of '${actor.Name}': not set from literals in the script`, 'error');
  // Live update the actor so the preview follows even when paused
  if (changed.x !== undefined && !unbound.includes('position')) { actor._x = changed.x; actor._y = changed.y!; }
  if (changed.w !== undefined && !unbound.includes('size')) { actor._width = changed.w; actor._height = changed.h!; }
  runner.dirty = true;
  if (edits.length) {
    const newSpans = editor.replaceSpans(edits, true);
    rebind(actor, changed, newSpans);
    editor.setBoundSpans(boundSpans(actor));
    dragEditsPending = true;
    localStorage.setItem(STORAGE_KEY, editor.text);
    runner.lastRunSource = editor.text;
  }
  if (phase === 'end') finishDrag();
  inspector.refresh();
}

function finishDrag() {
  if (!dragEditsPending) return;
  dragEditsPending = false;
  status('Script updated from preview', 'ok');
  // Re-run so that everything derived from the literals (aligned positions, Subs) is consistent
  if (autoRun) scheduleRun(50);
}

// ---- running ----
function scheduleRun(delay = 350) {
  clearTimeout(runTimer);
  runTimer = window.setTimeout(() => void runNow(), delay);
}

async function runNow() {
  clearTimeout(runTimer);
  logPanel.clear();
  editor.setErrorLine(null);
  status('Running…');
  const t0 = performance.now();
  const err = await runner.run(editor.text);
  if (!err) status(`Ran in ${(performance.now() - t0).toFixed(0)} ms`, 'ok');
  inspector.refresh();
}

function showError(err: ScriptError | null) {
  if (!err) return;
  editor.setErrorLine(err.line);
  logPanel.add('error', err.message, err.line);
  status(err.line ? `Line ${err.line}: ${err.message}` : err.message, 'error');
  switchTab('log');
}

function callSub(name: string, args: string) {
  const err = runner.callSub(name, args);
  if (err) { logPanel.add('error', `${name}: ${err.message}`, err.line); status(`${name}: ${err.message}`, 'error'); switchTab('log'); }
  else status(`Called ${name}`, 'ok');
  switchTab('subs');
  inspector.refresh();
}

// ---- UI plumbing ----
function status(text: string, kind: '' | 'ok' | 'error' = '') {
  const el = $('#status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

function switchTab(name: string) {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#tabs nav button')) b.classList.toggle('active', b.dataset.tab === name);
  for (const t of document.querySelectorAll<HTMLElement>('#tabs .tab')) t.classList.toggle('active', t.id === `tab-${name}`);
}
for (const b of document.querySelectorAll<HTMLButtonElement>('#tabs nav button')) b.addEventListener('click', () => switchTab(b.dataset.tab!));

let uiTick = 0;
function tickUi() {
  if (++uiTick % 10 === 0) { inspector.refresh(); updateInfo(); }
}

function updateInfo() {
  const f = runner.flex;
  $('#preview-info').textContent = `${f.Width}×${f.Height}  ·  ${RenderModeNames[f.RenderMode]}  ·  t = ${f.time.toFixed(2)} s  ·  ${runner.fps} fps  ·  ×${preview.scale}${runner.playing ? '' : '  ·  paused'}`;
}

function fitPreview() {
  const wrap = $('#preview-wrap');
  const maxW = wrap.clientWidth - 24;
  const maxH = Math.max(120, Math.min(360, window.innerHeight * 0.35));
  preview.fit(maxW, maxH);
}
window.addEventListener('resize', fitPreview);
new ResizeObserver(fitPreview).observe($('#side-pane'));

$('#btn-run').addEventListener('click', () => void runNow());
$('#btn-play').addEventListener('click', () => { runner.playing = !runner.playing; });
$('#btn-step').addEventListener('click', () => { runner.stepOnce(); updateInfo(); });
$('#btn-restart').addEventListener('click', () => { void runNow(); });
$<HTMLSelectElement>('#sel-speed').addEventListener('change', (e) => { runner.speed = Number((e.target as HTMLSelectElement).value); syncAudio(false); });
$<HTMLInputElement>('#chk-dots').addEventListener('change', (e) => { preview.dots = (e.target as HTMLInputElement).checked; });
$<HTMLInputElement>('#chk-autorun').addEventListener('change', (e) => { autoRun = (e.target as HTMLInputElement).checked; });

// Samples
const sampleSel = $<HTMLSelectElement>('#sel-sample');
SAMPLES.forEach((s, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = s.name; sampleSel.appendChild(o); });
sampleSel.addEventListener('change', () => {
  const s = SAMPLES[Number(sampleSel.value)];
  if (!s) return;
  if (editor.text.trim() && editor.text !== initial && !confirm('Replace the current script with the sample?')) { sampleSel.value = ''; return; }
  editor.setText(s.source);
  sampleSel.value = '';
  void runNow();
});

// Files
$('#btn-open-folder').addEventListener('click', () => $<HTMLInputElement>('#file-folder').click());
$<HTMLInputElement>('#file-folder').addEventListener('change', (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;
  loadProjectFiles([...files]);
});
$('#btn-open-script').addEventListener('click', () => $<HTMLInputElement>('#file-script').click());
$<HTMLInputElement>('#file-script').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  editor.setText(await f.text());
  void runNow();
});
$('#btn-save-script').addEventListener('click', () => {
  const blob = new Blob([editor.text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'flexdmd-scene.vbs';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

function loadProjectFiles(files: File[]) {
  runner.flex.AssetManager.setProjectFiles(files);
  const root = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/')[0];
  status(`Loaded ${files.length} file(s)${root ? ` from ${root}` : ''}`, 'ok');
  assetsPanel.render();
  refreshSoundList(files);
  void runNow();
}

// Drag & drop a folder or files anywhere
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const items = e.dataTransfer?.items;
  if (!items) return;
  const files: File[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const f = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      Object.defineProperty(f, 'webkitRelativePath', { value: prefix + f.name });
      files.push(f);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const entries: FileSystemEntry[] = [];
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (batch.length === 0) break;
        entries.push(...batch);
      }
      for (const en of entries) await walk(en, prefix + entry.name + '/');
    }
  };
  const single = items.length === 1 ? items[0].webkitGetAsEntry() : null;
  if (single?.isFile && /\.(vbs|txt)$/i.test(single.name)) {
    const f = items[0].getAsFile();
    if (f) { editor.setText(await f.text()); void runNow(); }
    return;
  }
  for (const it of Array.from(items)) {
    const entry = it.webkitGetAsEntry();
    if (entry) await walk(entry, entry.isDirectory ? '' : 'drop/');
  }
  if (files.length) loadProjectFiles(files);
});

// Sound track synced to the preview clock
const audio = new Audio();
const soundSel = $<HTMLSelectElement>('#sel-sound');
function refreshSoundList(files: File[]) {
  soundSel.replaceChildren();
  const none = document.createElement('option'); none.value = ''; none.textContent = 'none'; soundSel.appendChild(none);
  for (const f of files) {
    if (!/\.(ogg|mp3|wav|m4a)$/i.test(f.name)) continue;
    const o = document.createElement('option');
    o.value = runner.flex.AssetManager.fileUrl(f);
    o.textContent = f.name;
    soundSel.appendChild(o);
  }
}
soundSel.addEventListener('change', () => { audio.src = soundSel.value; syncAudio(true); });
function syncAudio(restart: boolean) {
  if (!audio.src || !soundSel.value) { audio.pause(); return; }
  if (restart) audio.currentTime = 0;
  try { audio.playbackRate = runner.speed; } catch { /* unsupported rate */ }
  if (runner.playing) void audio.play().catch(() => {}); else audio.pause();
}

// Splitter
const splitter = $('#splitter');
splitter.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const pane = $('#editor-pane');
  const startX = e.clientX, startW = pane.getBoundingClientRect().width;
  const move = (ev: MouseEvent) => { pane.style.width = `${Math.max(240, startW + ev.clientX - startX)}px`; fitPreview(); };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

// ---- boot ----
(async () => {
  status('Loading fonts…');
  try { await runner.flex.AssetManager.preloadBuiltins(); } catch (e) { logPanel.add('error', `Failed to preload resources: ${e instanceof Error ? e.message : e}`); }
  fitPreview();
  runner.start();
  await runNow();
})();

// Expose for debugging / automated tests
(window as unknown as { studio: unknown }).studio = { runner, editor, preview, inspector };

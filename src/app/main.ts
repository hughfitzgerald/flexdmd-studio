import './styles.css';
import { ScriptEditor } from './editor';
import { Runner, type ScriptError } from './runner';
import { Preview } from './preview';
import { Inspector } from './inspector';
import { AssetsPanel, LogPanel, SubsPanel, renderHelp } from './panels';
import { FilesPanel, StubsPanel } from './filespanel';
import { Project, SCRATCH, type SourceMapEntry } from './project';
import { SAMPLES } from './samples';
import { boundSpans, canEditPosition, canEditSize, geometryEdits, rebind, type Geometry } from './codegen';
import type { Actor } from '../flex/actor';
import type { Span } from '../vbs/ast';
import { RenderModeNames } from '../flex/flexdmd';
import { constBlock } from '../flex/constants';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const STORAGE_KEY = 'flexdmd-studio.script';
const SETTINGS_KEY = 'flexdmd-studio.settings';
/** Above this many lines, re-running on every keystroke is more annoying than useful */
const AUTORUN_LINE_LIMIT = 4000;

interface Settings { onRun: string; perFrame: string; stub: boolean; autoRun: boolean; }
function readSettings(): Partial<Settings> {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'); } catch { return {}; }
}
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private window */ } }

// Someone who has never used the studio in this browser gets the flagship sample as a landing
// page, run bar fields and all, so the first thing they see is it animating. Anyone with a saved
// script or settings keeps exactly what they had; readSettings() spread last wins per key.
const isFreshUser = localStorage.getItem(STORAGE_KEY) === null;
const DEFAULT_SAMPLE = SAMPLES[0];
const settings: Settings = {
  onRun: isFreshUser ? (DEFAULT_SAMPLE.onRun ?? '') : '',
  perFrame: isFreshUser ? (DEFAULT_SAMPLE.perFrame ?? '') : '',
  stub: true,
  autoRun: true,
  ...readSettings(),
};

// ---- project ----
const project = new Project(localStorage.getItem(STORAGE_KEY) ?? DEFAULT_SAMPLE.source);
let sourceMap: SourceMapEntry[] = [];

// ---- panels ----
const logPanel = new LogPanel($('#tab-log'), $('#log-badge'), (line) => revealCombinedLine(line));
const subsPanel = new SubsPanel($('#tab-subs'), (name, args) => callSub(name, args));
renderHelp($('#tab-help'));

// ---- runner ----
let runTimer = 0;
const runner = new Runner({
  onLog: (level, message, span) => logPanel.add(level, message, span?.line ?? null),
  onFrame: (output) => { preview.draw(output); tickUi(); },
  onRunFinished: (error, procs) => {
    subsPanel.render(procs);
    assetsPanel.render();
    stubsPanel.render(runner.lastRunSource ?? project.build().text);
    showError(error);
    updateInfo();
    if (!error) syncAudio(true);
    if (selectedPath !== null) {
      const a = findByPath(selectedPath);
      preview.select(a, false);
      inspector.selected = a;
      editor.setBoundSpans(a ? toEditorSpans(boundSpans(a)) : []);
    }
  },
  onPlayStateChange: (playing) => {
    $('#btn-play').textContent = playing ? '⏸ Pause' : '▶ Play';
    syncAudio(false);
  },
  onTickError: (err) => {
    const where = describe(err);
    logPanel.add('error', `Per-frame Sub failed, ticking stopped: ${err.message}`, err.line);
    status(`${where}${err.message}`, 'error');
    switchTab('log');
  },
});
runner.entryPoints = { onRun: settings.onRun, perFrame: settings.perFrame };
runner.ghosts.enabled = settings.stub;
const assetsPanel = new AssetsPanel($('#tab-assets'), runner.flex.AssetManager);
const stubsPanel = new StubsPanel($('#tab-stubs'), $('#stub-badge'), runner.ghosts);

// ---- editor ----
const editor = new ScriptEditor($('#editor'), project.active.content, {
  onChange: (text) => {
    project.setContent(project.activePath, text);
    if (project.activePath === SCRATCH) {
      try { localStorage.setItem(STORAGE_KEY, text); } catch { /* private window */ }
    }
    if (settings.autoRun && !tooBigForAutoRun()) scheduleRun();
  },
  onRunRequest: () => void runNow(),
  onRunSelection: (text) => void runSelection(text),
});

function tooBigForAutoRun(): boolean {
  return project.included.reduce((n, f) => n + f.content.split('\n').length, 0) > AUTORUN_LINE_LIMIT;
}

// ---- preview ----
let selectedPath: string | null = null;
const preview = new Preview($('#preview'), runner.flex, {
  onSelect: (actor) => selectActor(actor),
  onGeometryChange: (actor, geom, phase) => applyGeometry(actor, geom, phase),
  onTogglePlay: () => { runner.playing = !runner.playing; },
});
preview.canEdit = (a) => ({ position: canEditPosition(a) && spansInActiveFile(a), size: canEditSize(a) && spansInActiveFile(a) });

const inspector = new Inspector($('#actor-tree'), $('#actor-props'), runner.flex, {
  onSelect: (actor) => { preview.select(actor, false); selectActor(actor); },
  onGeometryInput: (actor, field, value) => {
    const g: Geometry = { x: actor.X, y: actor.Y, w: actor.Width, h: actor.Height };
    if (field === 'x') g.x = value; else if (field === 'y') g.y = value; else if (field === 'w') g.w = value; else g.h = value;
    applyGeometry(actor, g, 'end');
  },
  onRevealSpan: (line) => revealCombinedLine(line),
});

// ---- mapping between the combined script and the file being edited ----

function activeEntry(): SourceMapEntry | undefined {
  return sourceMap.find((e) => e.path === project.activePath);
}

/** True when every literal bound to this actor sits in the file currently open in the editor. */
function spansInActiveFile(actor: Actor): boolean {
  const e = activeEntry();
  if (!e) return false;
  return boundSpans(actor).every((s) => s.start >= e.startChar && s.end <= e.startChar + e.charCount);
}

function toEditorSpans(spans: Span[]): Span[] {
  const e = activeEntry();
  if (!e) return [];
  return spans.filter((s) => s.start >= e.startChar && s.end <= e.startChar + e.charCount)
    .map((s) => ({ start: s.start - e.startChar, end: s.end - e.startChar, line: s.line - e.startLine + 1 }));
}

/** Where a line of the combined script actually lives. */
function describe(err: ScriptError): string {
  if (!err.line) return '';
  const at = Project.locate(sourceMap, err.line);
  if (!at) return `Line ${err.line}: `;
  return project.included.length > 1 ? `${at.path} line ${at.line}: ` : `Line ${at.line}: `;
}

function revealCombinedLine(line: number) {
  const at = Project.locate(sourceMap, line);
  if (!at) { editor.revealLine(line); return; }
  if (at.path !== project.activePath) openFile(at.path);
  editor.revealLine(at.line);
}

function selectActor(actor: Actor | null) {
  inspector.selected = actor;
  selectedPath = actor ? actor.path() : null;
  editor.setBoundSpans(actor ? toEditorSpans(boundSpans(actor)) : []);
  if (actor) {
    const line = actor._binding.positionStmt?.line ?? actor._binding.sizeStmt?.line;
    if (line) revealCombinedLine(line);
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
  const entry = activeEntry();
  if (!entry) return;
  if (runner.lastRunSource !== null && runner.lastRunSource !== project.build().text && !dragEditsPending) {
    status('Script changed since last run: run it before dragging', 'error');
    return;
  }
  const changed: Partial<Geometry> = {};
  if (geom.x !== actor.X || geom.y !== actor.Y) { changed.x = geom.x; changed.y = geom.y; }
  if (geom.w !== actor.Width || geom.h !== actor.Height) { changed.w = geom.w; changed.h = geom.h; }
  if (Object.keys(changed).length === 0) { if (phase === 'end' && dragEditsPending) finishDrag(); return; }
  const { edits, unbound } = geometryEdits(actor, changed);
  if (unbound.length) status(`Cannot edit ${unbound.join(' and ')} of '${actor.Name}': not set from literals in the script`, 'error');
  if (changed.x !== undefined && !unbound.includes('position')) { actor._x = changed.x; actor._y = changed.y!; }
  if (changed.w !== undefined && !unbound.includes('size')) { actor._width = changed.w; actor._height = changed.h!; }
  runner.dirty = true;
  if (edits.length) {
    const outside = edits.find((e) => e.span.start < entry.startChar || e.span.end > entry.startChar + entry.charCount);
    if (outside) {
      const at = Project.locate(sourceMap, outside.span.line);
      status(`That literal is in ${at?.path ?? 'another file'}: open it to drag this actor`, 'error');
      return;
    }
    // The editor holds one file; bindings are offsets into the combined script, so shift both ways.
    const local = edits.map((e) => ({ text: e.text, span: { ...e.span, start: e.span.start - entry.startChar, end: e.span.end - entry.startChar } }));
    const newLocal = editor.replaceSpans(local, true);
    rebind(actor, changed, newLocal.map((s) => ({ ...s, start: s.start + entry.startChar, end: s.end + entry.startChar })));
    editor.setBoundSpans(toEditorSpans(boundSpans(actor)));
    dragEditsPending = true;
    project.setContent(project.activePath, editor.text);
    if (project.activePath === SCRATCH) { try { localStorage.setItem(STORAGE_KEY, editor.text); } catch { /* private window */ } }
    runner.lastRunSource = project.build().text;
  }
  if (phase === 'end') finishDrag();
  inspector.refresh();
}

function finishDrag() {
  if (!dragEditsPending) return;
  dragEditsPending = false;
  status('Script updated from preview', 'ok');
  if (settings.autoRun && !tooBigForAutoRun()) scheduleRun(50);
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
  const built = project.build();
  sourceMap = built.map;
  const t0 = performance.now();
  const err = await runner.run(built.text);
  for (const sk of runner.skipped) logPanel.add('warn', `Skipped ${describe({ message: '', line: sk.line, span: null })}${sk.message}`, sk.line);
  if (!err) {
    const stubs = runner.ghosts.size;
    const skipped = runner.skipped.length;
    status(`Ran in ${(performance.now() - t0).toFixed(0)} ms${stubs ? ` · ${stubs} stubbed` : ''}${skipped ? ` · ${skipped} line(s) skipped` : ''}`, skipped ? '' : 'ok');
  }
  inspector.refresh();
  filesPanel.render();
}

/** Runs a highlighted block on top of whatever is already loaded, without resetting the stage. */
async function runSelection(text: string) {
  if (!text.trim()) return;
  if (!runner.interp) { await runNow(); return; }
  const err = runner.runSnippet(text);
  if (err) {
    logPanel.add('error', `Selection: ${err.message}`, null);
    status(`Selection: ${err.message}`, 'error');
    switchTab('log');
  } else {
    status(`Ran ${text.trim().split('\n').length} selected line(s)`, 'ok');
  }
  stubsPanel.render(runner.lastRunSource ?? project.build().text);
  inspector.refresh();
}

function showError(err: ScriptError | null) {
  if (!err) return;
  const at = err.line ? Project.locate(sourceMap, err.line) : null;
  if (at && at.path !== project.activePath) openFile(at.path);
  editor.setErrorLine(at ? at.line : err.line);
  logPanel.add('error', describe(err) + err.message, err.line);
  status(describe(err) + err.message, 'error');
  switchTab('log');
}

function callSub(name: string, args: string) {
  const err = runner.callSub(name, args);
  if (err) { logPanel.add('error', `${name}: ${err.message}`, err.line); status(`${name}: ${err.message}`, 'error'); switchTab('log'); }
  else { status(`Called ${name}`, 'ok'); switchTab('subs'); }
  stubsPanel.render(runner.lastRunSource ?? project.build().text);
  inspector.refresh();
}

// ---- files ----
const filesPanel = new FilesPanel($('#tab-files'), project, {
  onOpen: (path) => openFile(path),
  onToggle: (path, included) => { project.toggle(path, included); filesPanel.render(); void runNow(); },
  onMove: (path, delta) => { project.move(path, delta); filesPanel.render(); void runNow(); },
  onOpenFolder: () => $<HTMLInputElement>('#file-folder').click(),
});

function openFile(path: string) {
  if (path === project.activePath) return;
  project.setActive(path);
  editor.setText(project.active.content);
  $('#file-label').textContent = project.files.length > 1 ? `editing ${path}` : '';
  filesPanel.render();
  if (inspector.selected) editor.setBoundSpans(toEditorSpans(boundSpans(inspector.selected)));
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
  const frame = runner.entryPoints.perFrame.trim() ? `  ·  FlexFrame ${runner.flexFrame}` : '';
  $('#preview-info').textContent = `${f.Width}×${f.Height}  ·  ${RenderModeNames[f.RenderMode]}  ·  t = ${f.time.toFixed(2)} s${frame}  ·  ${runner.fps} fps  ·  ×${preview.scale}${runner.playing ? '' : '  ·  paused'}`;
}

function fitPreview() {
  const wrap = $('#preview-wrap');
  preview.fit(wrap.clientWidth - 24, Math.max(120, Math.min(360, window.innerHeight * 0.35)));
}
window.addEventListener('resize', fitPreview);
new ResizeObserver(fitPreview).observe($('#side-pane'));

$('#btn-run').addEventListener('click', () => void runNow());
$('#btn-play').addEventListener('click', () => { runner.playing = !runner.playing; });
$('#btn-step').addEventListener('click', () => { runner.stepOnce(); updateInfo(); });
$('#btn-restart').addEventListener('click', () => { void runNow(); });
$<HTMLSelectElement>('#sel-speed').addEventListener('change', (e) => { runner.speed = Number((e.target as HTMLSelectElement).value); syncAudio(false); });
$<HTMLInputElement>('#chk-dots').addEventListener('change', (e) => { preview.dots = (e.target as HTMLInputElement).checked; });

const autoRunBox = $<HTMLInputElement>('#chk-autorun');
autoRunBox.checked = settings.autoRun;
autoRunBox.addEventListener('change', () => { settings.autoRun = autoRunBox.checked; saveSettings(); });

// Entry points: the Subs a framework expects to be called once and every frame
const onRunInput = $<HTMLInputElement>('#in-onrun');
const perFrameInput = $<HTMLInputElement>('#in-perframe');
onRunInput.value = settings.onRun;
perFrameInput.value = settings.perFrame;
/** Sets both entry-point fields (and the input boxes showing them) at once. */
function setEntryPoints(onRun: string, perFrame: string) {
  onRunInput.value = onRun;
  perFrameInput.value = perFrame;
  settings.onRun = onRun;
  settings.perFrame = perFrame;
  runner.entryPoints = { onRun, perFrame };
  saveSettings();
}
onRunInput.addEventListener('change', () => { setEntryPoints(onRunInput.value, perFrameInput.value); void runNow(); });
perFrameInput.addEventListener('change', () => { setEntryPoints(onRunInput.value, perFrameInput.value); void runNow(); });

const stubBox = $<HTMLInputElement>('#chk-stub');
stubBox.checked = settings.stub;
stubBox.addEventListener('change', () => {
  settings.stub = stubBox.checked;
  runner.ghosts.enabled = settings.stub;
  saveSettings();
  void runNow();
});

$('#btn-consts').addEventListener('click', () => {
  editor.insertAtTop(constBlock() + '\n');
  status('FlexDMD constants inserted', 'ok');
});

// Samples
const sampleSel = $<HTMLSelectElement>('#sel-sample');
SAMPLES.forEach((s, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = s.name; sampleSel.appendChild(o); });
sampleSel.addEventListener('change', () => {
  const s = SAMPLES[Number(sampleSel.value)];
  if (!s) return;
  if (editor.text.trim() && !confirm(`Replace ${project.activePath} with the sample?`)) { sampleSel.value = ''; return; }
  editor.setText(s.source);
  // A sample fully determines the run bar: samples that need no entry points (most of them, which
  // call their own Subs directly) clear whatever was set for the last one.
  setEntryPoints(s.onRun ?? '', s.perFrame ?? '');
  sampleSel.value = '';
  void runNow();
});

// Files
$('#btn-open-folder').addEventListener('click', () => $<HTMLInputElement>('#file-folder').click());
$<HTMLInputElement>('#file-folder').addEventListener('change', (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (files && files.length) void loadProjectFiles([...files]);
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
  a.download = project.activePath;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

async function loadProjectFiles(files: File[]) {
  runner.flex.AssetManager.setProjectFiles(files);
  // Script files become part of the project; the rest are assets
  const scripts = files.filter((f) => /\.vbs$/i.test(f.name));
  const loaded = await Promise.all(scripts.map(async (f) => ({
    path: ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name,
    content: await f.text(),
  })));
  project.setDiskFiles(loaded);
  const root = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/')[0];
  status(`Loaded ${files.length} file(s)${root ? ` from ${root}` : ''}${scripts.length ? `, ${scripts.length} script(s)` : ''}`, 'ok');
  assetsPanel.render();
  filesPanel.render();
  refreshSoundList(files);
  if (scripts.length) switchTab('files');
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
  if (files.length) void loadProjectFiles(files);
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
  filesPanel.render();
  stubsPanel.render(runner.lastRunSource ?? project.build().text);
  fitPreview();
  runner.start();
  await runNow();
})();

// Expose for debugging / automated tests
(window as unknown as { studio: unknown }).studio = { runner, editor, preview, inspector, project };

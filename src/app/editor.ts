import { EditorView, basicSetup } from 'codemirror';
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, keymap, type DecorationSet } from '@codemirror/view';
import { indentWithTab, toggleComment } from '@codemirror/commands';
import { vbsLanguage, enumLabels } from './vbslang';
import type { Span } from '../vbs/ast';

const setErrorLine = StateEffect.define<number | null>();
const setBoundSpans = StateEffect.define<Span[]>();

const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrorLine)) {
        if (e.value === null) return Decoration.none;
        const line = tr.state.doc.line(Math.min(Math.max(1, e.value), tr.state.doc.lines));
        return Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(line.from)]);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const boundField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setBoundSpans)) {
        const marks = e.value.filter((s) => s.end > s.start && s.end <= tr.state.doc.length).sort((a, b) => a.start - b.start)
          .map((s) => Decoration.mark({ class: 'cm-bound-literal' }).range(s.start, s.end));
        return Decoration.set(marks);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const darkTheme = EditorView.theme({
  '&': { backgroundColor: '#1b1d22', color: '#d8dbe2' },
  '.cm-content': { caretColor: '#fff' },
  '.cm-gutters': { backgroundColor: '#1b1d22', color: '#6b7280', borderRight: '1px solid #383c46' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.06)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgba(59,130,246,0.35) !important' },
  '.cm-cursor': { borderLeftColor: '#fff' },
  '.tok-keyword': { color: '#c792ea' },
  '.tok-string': { color: '#c3e88d' },
  '.tok-number': { color: '#f78c6c' },
  '.tok-comment': { color: '#6b7280', fontStyle: 'italic' },
  '.cm-enum-label': { color: '#7dd3fc', background: 'rgba(125,211,252,0.12)', borderRadius: '3px', padding: '0 4px', marginLeft: '4px', fontSize: '11px', cursor: 'pointer' },
  '.tok-variableName': { color: '#d8dbe2' },
}, { dark: true });

export interface ScriptEditorOptions {
  onChange: (text: string) => void;
  onRunRequest: () => void;
  /** Ctrl/Cmd+Shift+Enter: run just the selected lines on top of what is already loaded */
  onRunSelection?: (text: string) => void;
}

/** The selected text, expanded to whole lines; the current line when nothing is selected. */
function selectedLines(view: EditorView): string {
  const { from, to } = view.state.selection.main;
  const start = view.state.doc.lineAt(from).from;
  const end = view.state.doc.lineAt(to).to;
  return view.state.doc.sliceString(start, end);
}

export class ScriptEditor {
  readonly view: EditorView;
  private _suppress = 0;

  constructor(parent: HTMLElement, initial: string, private opts: ScriptEditorOptions) {
    const extensions: Extension[] = [
      basicSetup,
      keymap.of([
        { key: 'Mod-Enter', run: () => { opts.onRunRequest(); return true; } },
        { key: 'Mod-Shift-Enter', run: (v) => { opts.onRunSelection?.(selectedLines(v)); return true; } },
        { key: 'Mod-/', run: toggleComment },
        indentWithTab,
      ]),
      vbsLanguage,
      enumLabels,
      darkTheme,
      errorLineField,
      boundField,
      EditorView.updateListener.of((u) => { if (u.docChanged && this._suppress === 0) opts.onChange(u.state.doc.toString()); }),
    ];
    this.view = new EditorView({ state: EditorState.create({ doc: initial, extensions }), parent });
  }

  get text(): string { return this.view.state.doc.toString(); }

  setText(text: string) {
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } });
  }

  /** Puts text at the very top of the document (used for the constants block). */
  insertAtTop(text: string) {
    this.view.dispatch({ changes: { from: 0, insert: text } });
  }

  setErrorLine(line: number | null) { this.view.dispatch({ effects: setErrorLine.of(line) }); }
  setBoundSpans(spans: Span[]) { this.view.dispatch({ effects: setBoundSpans.of(spans) }); }

  revealLine(line: number) {
    const l = this.view.state.doc.line(Math.min(Math.max(1, line), this.view.state.doc.lines));
    this.view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
    this.view.focus();
  }

  /**
   * Replaces several spans at once (offsets relative to the current document) and returns the spans of the
   * inserted texts so callers can keep editing the same literals while dragging.
   * When `silent` is true the change listener is not notified (used during drags).
   */
  replaceSpans(edits: { span: Span; text: string }[], silent = false): Span[] {
    const sorted = edits.map((e, i) => ({ ...e, i })).sort((a, b) => a.span.start - b.span.start);
    const result: Span[] = new Array(edits.length);
    let delta = 0;
    for (const e of sorted) {
      const start = e.span.start + delta;
      result[e.i] = { start, end: start + e.text.length, line: e.span.line };
      delta += e.text.length - (e.span.end - e.span.start);
    }
    if (silent) this._suppress++;
    try {
      this.view.dispatch({ changes: sorted.map((e) => ({ from: e.span.start, to: e.span.end, insert: e.text })) });
    } finally {
      if (silent) this._suppress--;
    }
    return result;
  }
}

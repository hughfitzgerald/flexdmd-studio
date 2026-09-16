// VBScript language support for the editor: comments, FlexDMD-aware completion, and labels that
// show what a bare enum number means.
import { StreamLanguage } from '@codemirror/language';
import { vbScript } from '@codemirror/legacy-modes/mode/vbscript';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { ENUMS, constantGlobals, enumFor, labelFor } from '../flex/constants';

// ---- what can be completed ----

const FLEXDMD_MEMBERS: [string, string][] = [
  ['Stage', 'the root Group, sized to the DMD'],
  ['NewGroup(name)', 'Group'], ['NewFrame(name)', 'Frame'], ['NewLabel(name, font, text)', 'Label'],
  ['NewImage(name, path)', 'Image'], ['NewVideo(name, path)', 'Video, GIF or image sequence'],
  ['NewFont(path, tint, borderTint, borderSize)', 'Font'],
  ['LockRenderThread', 'pair around stage changes'], ['UnlockRenderThread', 'pair around stage changes'],
  ['Width', 'DMD width in dots'], ['Height', 'DMD height in dots'],
  ['RenderMode', '0 gray-2, 1 gray-4, 2 RGB'], ['Color', 'tint for the gray render modes'],
  ['Clear', 'clear the frame before each draw'], ['Run', 'start/stop rendering'],
  ['GameName', ''], ['TableFile', ''], ['ProjectFolder', 'base folder for file assets'],
  ['RuntimeVersion', '1008 (default) or 1009'],
  ['DmdPixels', 'luminance of the last frame'], ['DmdColoredPixels', 'RGB of the last frame'],
];

const ACTOR_MEMBERS: [string, string][] = [
  ['Name', ''], ['X', ''], ['Y', ''], ['Width', ''], ['Height', ''], ['Visible', ''],
  ['SetBounds x, y, w, h', ''], ['SetPosition x, y', ''], ['SetAlignedPosition x, y, alignment', ''], ['SetSize w, h', ''],
  ['Pack', 'size to the natural size'], ['PrefWidth', ''], ['PrefHeight', ''],
  ['FillParent', ''], ['ClearBackground', ''], ['Remove', ''],
  ['ActionFactory', 'builds actions'], ['AddAction action', ''], ['ClearActions', ''],
  // Group
  ['AddActor actor', 'Group'], ['RemoveActor actor', 'Group'], ['RemoveAll', 'Group'], ['Clip', 'Group'],
  ['ChildCount', 'Group'], ['HasChild(name)', 'Group'],
  ['GetGroup(name)', 'Group'], ['GetLabel(name)', 'Group'], ['GetImage(name)', 'Group'],
  ['GetFrame(name)', 'Group'], ['GetVideo(name)', 'Group'],
  // Label
  ['Text', 'Label'], ['Font', 'Label'], ['Alignment', 'Label, Image, Video'], ['AutoPack', 'Label'],
  // Image / Video
  ['Bitmap', 'Image'], ['Scaling', 'Image, Video'],
  ['Loop', 'Video'], ['Paused', 'Video'], ['PlaySpeed', 'Video'], ['Length', 'Video'], ['Seek pos', 'Video'],
  // Frame
  ['Thickness', 'Frame'], ['BorderColor', 'Frame'], ['Fill', 'Frame'], ['FillColor', 'Frame'],
];

const ACTION_MEMBERS: [string, string][] = [
  ['Wait(seconds)', ''], ['Delayed(seconds, action)', ''], ['Sequence()', ''], ['Parallel()', ''],
  ['Repeat(action, count)', 'count -1 repeats forever'], ['Blink(show, hide, repeat)', 'only safe endless or one-shot'],
  ['Show(visible)', ''], ['MoveTo(x, y, seconds)', 'set .Ease for easing'],
  ['AddTo(group)', ''], ['RemoveFromParent()', ''], ['AddChild(actor)', ''], ['RemoveChild(actor)', ''], ['Seek(pos)', ''],
];

const opt = (label: string, detail: string, type: string): Completion => {
  // "SetBounds x, y, w, h" completes as the name; the rest is a hint of what it takes
  const name = label.split(/[\s(]/)[0];
  return { label: name, detail: label === name ? detail : label.slice(name.length).trim() + (detail ? '  ' + detail : ''), type };
};

const GLOBAL_OPTIONS: Completion[] = [
  ...Object.keys(constantGlobals()).map((n) => ({ label: n, type: 'constant' })),
  { label: 'FlexDMD', type: 'variable', detail: 'the DMD' },
  { label: 'FlexFrame', type: 'variable', detail: 'frame counter advanced by the studio' },
  ...['vbWhite', 'vbBlack', 'vbRed', 'vbGreen', 'vbBlue', 'vbYellow', 'vbCyan', 'vbMagenta', 'vbCrLf', 'vbTab'].map((n) => ({ label: n, type: 'constant' })),
  ...['RGB', 'FormatNumber', 'CStr', 'CInt', 'CLng', 'Int', 'Abs', 'Len', 'Left', 'Right', 'Mid', 'UCase', 'LCase', 'Trim', 'Replace', 'InStr', 'Split', 'Join', 'Array', 'UBound', 'IsObject', 'IsEmpty', 'TypeName'].map((n) => ({ label: n, type: 'function' })),
];

/** Offers the constants of an enum, and the raw numbers as a fallback. */
function enumOptions(name: string): Completion[] {
  const e = enumFor(name);
  if (!e) return [];
  return e.values.map(([n, v]) => ({ label: e.prefix + n, detail: String(v), type: 'enum', boost: 1 }));
}

export function flexCompletions(ctx: CompletionContext): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);

  // ".Alignment = " / ".Ease = " / ".RenderMode = " / ".Scaling = "
  const prop = /\.(\w+)\s*=\s*([A-Za-z_]\w*)?$/.exec(before);
  if (prop) {
    const options = enumOptions(prop[1]);
    if (options.length) return { from: ctx.pos - (prop[2]?.length ?? 0), options };
  }
  // the third argument of SetAlignedPosition is an Alignment
  const aligned = /SetAlignedPosition\s+[^,]+,[^,]+,\s*([A-Za-z_]\w*)?$/i.exec(before);
  if (aligned) return { from: ctx.pos - (aligned[1]?.length ?? 0), options: enumOptions('Alignment') };

  // member access
  const dot = /(\w+)\s*\.\s*(\w*)$/.exec(before);
  if (dot) {
    const target = dot[1].toLowerCase();
    const from = ctx.pos - dot[2].length;
    if (target === 'flexdmd') return { from, options: FLEXDMD_MEMBERS.map(([l, d]) => opt(l, d, 'property')) };
    if (target.includes('actionfactory') || /\baf\b|factory/.test(target)) return { from, options: ACTION_MEMBERS.map(([l, d]) => opt(l, d, 'method')) };
    // any other object: offer the union of actor members, which is what most variables hold here
    return { from, options: ACTOR_MEMBERS.map(([l, d]) => opt(l, d, 'property')) };
  }

  const word = ctx.matchBefore(/[A-Za-z_]\w*/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  return { from: word.from, options: GLOBAL_OPTIONS };
}

// ---- labels on bare enum numbers ----

class EnumLabel extends WidgetType {
  constructor(readonly text: string, readonly replacement: string, readonly from: number, readonly to: number) { super(); }
  eq(other: EnumLabel) { return other.text === this.text && other.from === this.from; }
  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'cm-enum-label';
    span.textContent = this.text;
    span.title = `Click to write ${this.replacement}`;
    span.onmousedown = (e) => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.from, to: this.to, insert: this.replacement } });
    };
    return span;
  }
  ignoreEvent() { return false; }
}

// Same positions the completion source knows about: an enum property, or SetAlignedPosition's third argument.
const PROP_RE = /\.(Alignment|Scaling|RenderMode|Ease)\s*=\s*(-?\d+)/gi;
const ALIGNED_RE = /SetAlignedPosition\s+[^,\n]+,[^,\n]+,\s*(-?\d+)/gi;

function buildEnumLabels(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const marks: { pos: number; deco: Decoration }[] = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    const add = (e: ReturnType<typeof enumFor>, numStr: string, start: number, end: number) => {
      if (!e) return;
      const label = labelFor(e, Number(numStr));
      if (!label) return;
      marks.push({ pos: end, deco: Decoration.widget({ widget: new EnumLabel(label, e.prefix + label, start, end), side: 1 }) });
    };
    let m: RegExpExecArray | null;
    PROP_RE.lastIndex = 0;
    while ((m = PROP_RE.exec(text))) {
      const numStart = from + m.index + m[0].lastIndexOf(m[2]);
      add(enumFor(m[1]), m[2], numStart, numStart + m[2].length);
    }
    ALIGNED_RE.lastIndex = 0;
    while ((m = ALIGNED_RE.exec(text))) {
      const numStart = from + m.index + m[0].lastIndexOf(m[1]);
      add(enumFor('Alignment'), m[1], numStart, numStart + m[1].length);
    }
  }
  marks.sort((a, b) => a.pos - b.pos);
  for (const mk of marks) builder.add(mk.pos, mk.pos, mk.deco);
  return builder.finish();
}

export const enumLabels = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildEnumLabels(view); }
    update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = buildEnumLabels(u.view); }
  },
  { decorations: (v) => v.decorations },
);

/** VBScript with the comment token set (so Ctrl/Cmd+/ works) and FlexDMD completions attached. */
export const vbsLanguage = StreamLanguage.define({
  ...vbScript,
  languageData: {
    commentTokens: { line: "'" },
    autocomplete: flexCompletions,
    closeBrackets: { brackets: ['(', '"'] },
  },
});

export { ENUMS };

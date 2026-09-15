// Actor tree and property panel
import { Actor, Group, Frame } from '../flex/actor';
import { Label } from '../flex/label';
import { Image } from '../flex/image';
import { AnimatedActor, GIFImage, ImageSequence, VideoActor } from '../flex/animated';
import { AlignmentNames, ScalingNames } from '../flex/layout';
import type { FlexDMD } from '../flex/flexdmd';
import { bindingStatus } from './codegen';

export interface InspectorEvents {
  onSelect: (actor: Actor | null) => void;
  onGeometryInput: (actor: Actor, field: 'x' | 'y' | 'w' | 'h', value: number) => void;
  onRevealSpan: (line: number) => void;
}

export class Inspector {
  selected: Actor | null = null;
  private lastTreeKey = '';
  private lastPropsKey = '';

  constructor(private treeEl: HTMLElement, private propsEl: HTMLElement, private flex: FlexDMD, private ev: InspectorEvents) {}

  /** Cheap structural signature so we only rebuild the DOM when something changed */
  private treeKey(): string {
    const parts: string[] = [];
    const visit = (a: Actor, depth: number) => {
      parts.push(`${depth}:${a._id}:${a.Name}:${a.Visible ? 1 : 0}:${r(a.X)},${r(a.Y)},${r(a.Width)},${r(a.Height)}`);
      if (a instanceof Group) for (const c of a.Children) visit(c, depth + 1);
    };
    visit(this.flex.Stage, 0);
    return parts.join('|') + `|sel:${this.selected?._id ?? ''}`;
  }

  refresh() {
    const key = this.treeKey();
    if (key !== this.lastTreeKey) {
      this.lastTreeKey = key;
      this.treeEl.replaceChildren(this.renderNode(this.flex.Stage));
    }
    this.refreshProps();
  }

  private renderNode(a: Actor): HTMLElement {
    const wrap = document.createElement('div');
    const row = document.createElement('div');
    row.className = 'tree-node' + (a === this.selected ? ' selected' : '') + (a.Visible ? '' : ' hidden-actor');
    row.innerHTML = `<span class="name">${esc(a.Name || '(unnamed)')}</span><span class="type">${a.typeName}</span><span class="bounds">${r(a.X)},${r(a.Y)} ${r(a.Width)}×${r(a.Height)}</span>`;
    row.addEventListener('click', () => this.ev.onSelect(a === this.selected ? null : a));
    wrap.appendChild(row);
    if (a instanceof Group && a.Children.length) {
      const kids = document.createElement('div');
      kids.className = 'tree-children';
      for (const c of a.Children) kids.appendChild(this.renderNode(c));
      wrap.appendChild(kids);
    }
    return wrap;
  }

  private refreshProps() {
    const a = this.selected;
    if (!a) {
      if (this.lastPropsKey !== 'none') { this.lastPropsKey = 'none'; this.propsEl.innerHTML = '<div class="muted">Select an actor in the preview or in the tree.<br><br>Drag it to move, use the handles to resize: the script literals update live. Arrow keys nudge (Shift = 10 px).</div>'; }
      return;
    }
    if (document.activeElement && this.propsEl.contains(document.activeElement)) return; // don't clobber an input being edited
    const status = bindingStatus(a);
    const rows: string[] = [];
    const geomInput = (field: 'x' | 'y' | 'w' | 'h', label: string, value: number, unbound: string | null) =>
      `<tr><td>${label}</td><td><input type="number" step="1" data-field="${field}" value="${r(value)}" ${unbound ? 'disabled' : ''}>${unbound ? `<div class="unbound">${esc(unbound)}</div>` : ''}</td></tr>`;
    rows.push(`<tr><td>Name</td><td>${esc(a.Name)}</td></tr>`);
    rows.push(`<tr><td>Type</td><td>${a.typeName}</td></tr>`);
    rows.push(geomInput('x', 'X', a.X, status.position));
    rows.push(geomInput('y', 'Y', a.Y, status.position));
    rows.push(geomInput('w', 'Width', a.Width, status.size));
    rows.push(geomInput('h', 'Height', a.Height, status.size));
    rows.push(`<tr><td>Pref size</td><td>${r(a.PrefWidth)} × ${r(a.PrefHeight)}</td></tr>`);
    rows.push(`<tr><td>Visible</td><td>${a.Visible}${a.FillParent ? ' (FillParent)' : ''}${a.ClearBackground ? ' (ClearBackground)' : ''}</td></tr>`);
    if (a._binding.positionStmt) rows.push(`<tr><td>Set at</td><td><a href="#" data-line="${a._binding.positionStmt.line}">line ${a._binding.positionStmt.line}</a>${a._binding.procName ? ` in Sub ${esc(a._binding.procName)}` : ''}</td></tr>`);
    if (a instanceof Label) {
      rows.push(`<tr><td>Text</td><td>${esc(String(a.Text)).replace(/\r\n/g, "<br>")}</td></tr>`);
      rows.push(`<tr><td>Alignment</td><td>${AlignmentNames[a.Alignment]} (${a.Alignment})</td></tr>`);
      rows.push(`<tr><td>Font</td><td>${a.Font ? esc(shortId(a.Font.id)) : 'none'}</td></tr>`);
      rows.push(`<tr><td>AutoPack</td><td>${a.AutoPack}</td></tr>`);
    } else if (a instanceof Image) {
      rows.push(`<tr><td>Asset</td><td>${esc(a.assetId)}</td></tr>`);
      rows.push(`<tr><td>Scaling</td><td>${ScalingNames[a.Scaling]} (${a.Scaling})</td></tr>`);
      rows.push(`<tr><td>Alignment</td><td>${AlignmentNames[a.Alignment]} (${a.Alignment})</td></tr>`);
    } else if (a instanceof AnimatedActor) {
      rows.push(`<tr><td>Length</td><td>${a.Length.toFixed(2)} s</td></tr>`);
      rows.push(`<tr><td>Time</td><td>${a.time.toFixed(2)} s${a instanceof ImageSequence || a instanceof GIFImage ? ` (frame ${a.frameIndex})` : ''}</td></tr>`);
      rows.push(`<tr><td>Loop / Paused</td><td>${a.Loop} / ${a.Paused} (speed ${a.PlaySpeed})</td></tr>`);
      rows.push(`<tr><td>Scaling</td><td>${ScalingNames[a.Scaling]} (${a.Scaling})</td></tr>`);
      rows.push(`<tr><td>Alignment</td><td>${AlignmentNames[a.Alignment]} (${a.Alignment})</td></tr>`);
      if (a instanceof VideoActor) rows.push(`<tr><td>Video</td><td>${a.video.videoWidth}×${a.video.videoHeight}, readyState ${a.video.readyState}</td></tr>`);
    } else if (a instanceof Frame) {
      rows.push(`<tr><td>Thickness</td><td>${a.Thickness}</td></tr>`);
      rows.push(`<tr><td>Fill</td><td>${a.Fill}</td></tr>`);
    } else if (a instanceof Group) {
      rows.push(`<tr><td>Children</td><td>${a.ChildCount}${a.Clip ? ', clipped' : ''}</td></tr>`);
    }
    const actions = a.actions.map((x) => `<li>${esc(x.describe())}</li>`).join('');
    const html = `<div class="props"><table>${rows.join('')}</table><h4>Actions (${a.actions.length})</h4>${actions ? `<ul>${actions}</ul>` : '<div class="muted">none</div>'}</div>`;
    if (html === this.lastPropsKey) return;
    this.lastPropsKey = html;
    this.propsEl.innerHTML = html;
    for (const input of this.propsEl.querySelectorAll<HTMLInputElement>('input[data-field]')) {
      input.addEventListener('change', () => this.ev.onGeometryInput(a, input.dataset.field as 'x', Number(input.value)));
    }
    for (const link of this.propsEl.querySelectorAll<HTMLAnchorElement>('a[data-line]')) {
      link.addEventListener('click', (e) => { e.preventDefault(); this.ev.onRevealSpan(Number(link.dataset.line)); });
    }
  }
}

function r(v: number): string { return Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString(); }
function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function shortId(id: string): string { return id.replace('FlexDMD.Resources.', '').replace(/&tint=FFFFFFFF/, '').replace(/&border_size=0&border_tint=[0-9A-F]+/, ''); }

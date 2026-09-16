// The Files and Stubs tabs.
import type { Project } from './project';
import type { GhostRegistry } from '../vbs/ghost';

export interface FilesPanelEvents {
  onOpen: (path: string) => void;
  onToggle: (path: string, included: boolean) => void;
  onMove: (path: string, delta: number) => void;
  onOpenFolder: () => void;
}

export class FilesPanel {
  constructor(private el: HTMLElement, private project: Project, private ev: FilesPanelEvents) {}

  render() {
    this.el.replaceChildren();
    const intro = document.createElement('div');
    intro.className = 'muted';
    intro.style.marginBottom = '8px';
    intro.innerHTML = 'Ticked files are joined, top to bottom, into the script that runs. Click a name to edit it. '
      + 'Use this when the DMD code is split up, for example a config file listing the scenes and a second file holding the builders and tickers.';
    this.el.appendChild(intro);

    for (const f of this.project.files) {
      const row = document.createElement('div');
      row.className = 'file-row' + (f.path === this.project.activePath ? ' active' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = f.included;
      cb.title = 'Include this file when running';
      cb.addEventListener('change', () => this.ev.onToggle(f.path, cb.checked));
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = f.path;
      name.title = 'Edit this file';
      name.addEventListener('click', () => this.ev.onOpen(f.path));
      const lines = document.createElement('span');
      lines.className = 'lines';
      lines.textContent = `${f.content.split('\n').length} lines`;
      const up = document.createElement('button');
      up.textContent = '↑'; up.title = 'Load earlier';
      up.addEventListener('click', () => this.ev.onMove(f.path, -1));
      const down = document.createElement('button');
      down.textContent = '↓'; down.title = 'Load later';
      down.addEventListener('click', () => this.ev.onMove(f.path, 1));
      row.append(cb, name, lines, up, down);
      this.el.appendChild(row);
    }

    const btn = document.createElement('button');
    btn.textContent = '📁 Open folder';
    btn.style.marginTop = '8px';
    btn.addEventListener('click', () => this.ev.onOpenFolder());
    this.el.appendChild(btn);
  }
}

export class StubsPanel {
  constructor(private el: HTMLElement, private badge: HTMLElement, private ghosts: GhostRegistry) {}

  render(source = '') {
    const entries = this.ghosts.list();
    this.badge.hidden = entries.length === 0;
    this.badge.textContent = String(entries.length);
    this.el.replaceChildren();
    const intro = document.createElement('div');
    intro.className = 'muted';
    intro.style.marginBottom = '8px';
    intro.innerHTML = this.ghosts.enabled
      ? 'Names the script uses that the previewer does not provide — table objects, lights, timers, sound, framework calls. '
        + 'Each one is stood in for: reading it gives an empty value, calling it does nothing, so the FlexDMD code around it still runs. '
        + 'Untick <b>Stub unknowns</b> in the run bar to have them reported as errors instead.'
      : 'Stubbing is off, so an unknown name is an error. Tick <b>Stub unknowns</b> in the run bar to let a whole table script run.';
    this.el.appendChild(intro);
    if (entries.length === 0) {
      const none = document.createElement('div');
      none.className = 'muted';
      none.textContent = 'Nothing was stubbed on the last run.';
      this.el.appendChild(none);
      return;
    }
    for (const e of entries) {
      const row = document.createElement('div');
      row.className = 'stub-row';
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = `×${e.count}`;
      const path = document.createElement('span');
      path.textContent = e.path;
      row.append(count, path);
      // A plain name that the script also assigns to is a variable set inside a Sub with no
      // top-level Dim — usually because the Dim lives in a file that is not loaded.
      if (/^\w+$/.test(e.path) && new RegExp(`(^|\\n)\\s*(Set\\s+)?${e.path}\\s*=`, 'i').test(source)) {
        const hint = document.createElement('span');
        hint.className = 'muted';
        hint.textContent = `— assigned in a Sub; add "Dim ${e.path}" at the top level to share it`;
        row.appendChild(hint);
      }
      this.el.appendChild(row);
    }
  }
}

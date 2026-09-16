// The object the studio hands to a scene Builder that expects its framework to supply one.
//
// Frameworks call a Builder with an "entry" and the Builder hands its finished scene back through
// it, so with no framework loaded the scene is built and then dropped. This stands in for that
// entry: SetScene puts the scene on the DMD, which is what a preview wants, and every other field
// a Builder might read is stood in for rather than being an error.
import type { FlexDMD } from '../flex/flexdmd';
import type { GhostRegistry } from '../vbs/ghost';
import type { VbValue } from '../vbs/values';

export class SceneEntry {
  constructor(private _flex: FlexDMD, private _ghosts: GhostRegistry) {}

  /** What a Builder calls to hand back its scene. */
  SetScene(scene: unknown): void {
    const stage = this._flex.Stage;
    const actor = scene as { Draw?: unknown };
    if (!actor || typeof actor.Draw !== 'function') throw new Error('SetScene expects a scene built with FlexDMD.NewGroup');
    this._flex.LockRenderThread();
    stage.RemoveAll();
    stage.AddActor(scene as Parameters<typeof stage.AddActor>[0]);
    this._flex.UnlockRenderThread();
  }

  /** Builders skip the work when the scene already exists; in a preview it never does. */
  get HasScene(): boolean { return false; }

  get Scene(): unknown { return this._flex.Stage.Children[0] ?? null; }

  toString() { return '[object StudioEntry]'; }

  /** Any other field a framework's entry would carry reads as empty rather than failing. */
  vbFallback(name: string): VbValue {
    return this._ghosts.touch(`Studio.${name}`);
  }
}

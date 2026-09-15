import { describe, expect, it } from 'vitest';
import { Actor, Group } from '../src/flex/actor';
import { Interpolation } from '../src/flex/ease';
import { Alignment, Scaling, align, scale } from '../src/flex/layout';
import { geometryEdits } from '../src/app/codegen';
import { Interpreter } from '../src/vbs/interpreter';

const flexStub = { RuntimeVersion: 1008, warn: () => {} };

function stage(): Group {
  const s = new Group(flexStub, 'Stage');
  s.SetSize(128, 32);
  s.OnStage = true;
  return s;
}

describe('actions', () => {
  it('runs a Sequence of Wait / Show / MoveTo with the FlexDMD frame semantics', () => {
    const s = stage();
    const a = new Actor('a');
    a.SetBounds(0, 0, 10, 10);
    s.AddActor(a);
    const af = a.ActionFactory;
    const seq = af.Sequence();
    seq.Add(af.Wait(0.5));
    seq.Add(af.Show(false));
    seq.Add(af.Wait(0.5));
    seq.Add(af.Show(true));
    const move = af.MoveTo(100, 0, 1);
    move.Ease = Interpolation.Linear;
    seq.Add(move);
    a.AddAction(af.Repeat(seq, 2));
    const dt = 1 / 60;
    let t = 0;
    const step = () => { s.Update(dt); t += dt; };
    for (let i = 0; i < 30; i++) step();
    expect(a.Visible).toBe(true);
    step(); // 0.516 s: wait finished and Show(false) executes in the same update (SequenceAction loops)
    expect(a.Visible).toBe(false);
    for (let i = 0; i < 31; i++) step();
    expect(a.Visible).toBe(true);
    for (let i = 0; i < 30; i++) step();
    expect(a.X).toBeGreaterThan(40);
    expect(a.X).toBeLessThan(60);
    for (let i = 0; i < 31; i++) step();
    expect(a.X).toBe(100);
    // Second repetition restarts the sequence from the beginning
    for (let i = 0; i < 40; i++) step();
    expect(a.Visible).toBe(false);
    expect(a.actions.length).toBe(1);
    for (let i = 0; i < 200; i++) step();
    expect(a.actions.length).toBe(0);
  });

  it('Blink toggles visibility and completes after the repeat count', () => {
    const s = stage();
    const a = new Actor('b');
    s.AddActor(a);
    a.AddAction(a.ActionFactory.Blink(0.1, 0.1, 1));
    for (let i = 0; i < 7; i++) s.Update(1 / 60);
    expect(a.Visible).toBe(false);
    for (let i = 0; i < 6; i++) s.Update(1 / 60);
    expect(a.Visible).toBe(true);
    for (let i = 0; i < 7; i++) s.Update(1 / 60);
    expect(a.Visible).toBe(false);
    expect(a.actions.length).toBe(0);
  });

  it('AddChild / RemoveChild and RemoveFromParent manipulate the tree', () => {
    const s = stage();
    const scene = new Group(flexStub, 'scene');
    const child = new Actor('child');
    s.AddActor(scene);
    const af = scene.ActionFactory;
    const seq = af.Sequence();
    seq.Add(af.AddChild(child));
    seq.Add(af.Wait(0.1));
    seq.Add(af.RemoveChild(child));
    seq.Add(af.RemoveFromParent());
    scene.AddAction(seq);
    s.Update(1 / 60);
    expect(scene.Children).toContain(child);
    expect(child.OnStage).toBe(true);
    for (let i = 0; i < 8; i++) s.Update(1 / 60);
    expect(scene.Children).not.toContain(child);
    expect(s.Children).not.toContain(scene);
    expect(scene.OnStage).toBe(false);
  });
});

describe('layout', () => {
  it('scales and aligns like LibGDX', () => {
    expect(scale(Scaling.Fit, 64, 64, 128, 32)).toEqual([32, 32]);
    expect(scale(Scaling.Fill, 64, 64, 128, 32)).toEqual([128, 128]);
    expect(scale(Scaling.Stretch, 64, 64, 128, 32)).toEqual([128, 32]);
    expect(align(Alignment.Center, 32, 32, 128, 32)).toEqual([48, 0]);
    expect(align(Alignment.BottomRight, 10, 5, 128, 32)).toEqual([118, 27]);
  });

  it('SetAlignedPosition uses the current size', () => {
    const a = new Actor();
    a.SetSize(20, 10);
    a.SetAlignedPosition(64, 16, Alignment.Center);
    expect([a.X, a.Y]).toEqual([54, 11]);
    a.SetAlignedPosition(128, 32, Alignment.BottomRight);
    expect([a.X, a.Y]).toEqual([108, 22]);
  });

  it('Group.Get supports paths with RuntimeVersion 1009', () => {
    const flex = { RuntimeVersion: 1009, warn: () => {} };
    const root = new Group(flex, 'Stage');
    const g = new Group(flex, 'g');
    const leaf = new Actor('leaf');
    g.AddActor(leaf);
    root.AddActor(g);
    expect(root.Get('g/leaf')).toBe(leaf);
    expect(g.Get('/g/leaf')).toBe(leaf);
    expect(root.Get('leaf')).toBeNull();
  });
});

describe('script literal bindings', () => {
  it('records literal spans from SetAlignedPosition and writes moved positions back', () => {
    const s = stage();
    const src = 'Set a = Stage.Get("a")\na.SetSize 20, 10\na.SetAlignedPosition 64, 16, 4\nb = 3\na.X = b';
    const a = new Actor('a');
    s.AddActor(a);
    const it = new Interpreter({ globals: { Stage: s } });
    it.run(src);
    // a.X = b is computed: the x binding is null, the aligned binding was reset
    expect(a._binding.x).toBeNull();
    expect(a._binding.alignedX).toBeUndefined();
    // Re-run without the computed assignment
    const src2 = 'Set a = Stage.Get("a")\na.SetSize 20, 10\na.SetAlignedPosition 64, 16, 4';
    const a2 = new Actor('a');
    const s2 = stage();
    s2.AddActor(a2);
    new Interpreter({ globals: { Stage: s2 } }).run(src2);
    expect(a2._binding.alignedX).toEqual({ start: src2.indexOf('64'), end: src2.indexOf('64') + 2, line: 3 });
    expect(a2._binding.width).toEqual({ start: src2.indexOf('20'), end: src2.indexOf('20') + 2, line: 2 });
    const { edits, unbound } = geometryEdits(a2, { x: 60, y: 20 });
    expect(unbound).toEqual([]);
    expect(edits.map((e) => e.text)).toEqual(['70', '25']); // center of a 20x10 box at (60,20)
    const size = geometryEdits(a2, { w: 40, h: 12 });
    expect(size.edits.map((e) => e.text)).toEqual(['40', '12']);
  });

  it('binds negative literals including the sign', () => {
    const s = stage();
    const a = new Actor('a');
    s.AddActor(a);
    const src = 'Stage.Get("a").SetPosition -100, 10';
    new Interpreter({ globals: { Stage: s } }).run(src);
    expect(a._binding.x).toEqual({ start: src.indexOf('-100'), end: src.indexOf('-100') + 4, line: 1 });
    expect(a.X).toBe(-100);
  });
});

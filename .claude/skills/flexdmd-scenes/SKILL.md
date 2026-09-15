---
name: flexdmd-scenes
description: Write, fix and integrate FlexDMD DMD scenes and animations for Visual Pinball tables — VBScript code that drives the FlexDMD scene API (Stage, groups, images, labels, frames, videos, bitmap fonts, ActionFactory sequences, MoveTo/Blink/Wait tweens, render modes). Use this skill whenever a request involves a pinball table's DMD or "dot matrix display", FlexDMD, score/jackpot/attract/multiball displays, UltraDMD replacement, VPX table script DMD code, or previewing DMD scenes in FlexDMD Studio — even if the user only says "make the DMD show X" or "animate the score", and even when they paste a whole table script that happens to contain DMD code.
---

# FlexDMD scenes and animations

FlexDMD is the DMD renderer used by Visual Pinball tables (Windows via the COM object, macOS/Linux via the C++
port in VPX standalone/BGFX). Table authors drive it from the table's VBScript. This skill is about writing that
script: the scene graph, the timing model, the API surface, and the conventions that keep the code working in the
real engine. The reference for everything here is the C# source in `FlexDMD/` (actors in `FlexDMD/Actors/`,
interface in `FlexDMD/IFlexDMD.cs`); when in doubt about a behaviour, read it rather than guess.

## Mental model (read this before writing anything)

- **A stage of actors.** `FlexDMD.Stage` is the root group (sized to the DMD). You add actors to it: `Group`,
  `Image`, `Label` (bitmap font text), `Frame` (rectangle), `Video` (MP4, animated GIF or `a.png|b.png` image
  sequence). Groups nest and translate their children. Draw order is child order; there is no z-index.
- **Actions animate actors.** Every actor has an `ActionFactory` that builds actions: `Wait`, `Delayed`, `Show`,
  `Blink`, `MoveTo` (tween with `Ease`), `AddTo`, `RemoveFromParent`, `AddChild`, `RemoveChild`, `Seek`, and the
  composites `Sequence`, `Parallel`, `Repeat`. All of them reset themselves when they finish, so they can run
  again inside a `Repeat` — except a counted `Blink`, which must not be used in anything that repeats (see
  pitfalls #11 for the Wait/Show replacement). `actor.AddAction action` starts it. Actions run one frame at a time
  at 60 fps, but **only while the actor is on stage** (reachable from `Stage`). An action added to a detached
  group never starts.
- **The frame persists.** The stage is drawn over the previous frame; nothing is cleared unless
  `FlexDMD.Clear = True` (set it, or draw an opaque background image/`ClearBackground` group). Forgetting this
  is the number one cause of "ghost" pixels.
- **Sizes come from content unless you set them.** `NewImage` packs to the bitmap size, `NewLabel` to the text
  size (with the default `RuntimeVersion` 1008 a label re-packs whenever `Text` changes). `SetAlignedPosition`
  uses the *current* size, so set text/size first, then position.
- **The renderer runs in its own thread** (in the COM version). Wrap every stage modification made from table
  code (timers, hit events) in `FlexDMD.LockRenderThread` / `FlexDMD.UnlockRenderThread`.
- **VBScript call syntax.** A Sub call takes no parentheses: `scene.AddActor lbl`, `lbl.SetAlignedPosition 64, 16, 4`.
  A function call in an expression uses them: `Set lbl = FlexDMD.NewLabel("Score", font, "0")`. `Set` is
  required for object assignment. Enums are passed as integers (see the cheat sheet below).

## Workflow

1. **Pin down the display.** Width/height (128×32 is the norm; 128×36, 192×64 and 256×64 exist), render mode
   (`0` 4 shades, `1` 16 shades, `2` RGB) and the DMD color for monochrome modes. Ask only if the script does not
   already say; otherwise default to 128×32 RGB for original tables.
2. **List the scenes and the events that trigger them** (attract loop, score update, jackpot, ball lost, bonus
   count, mode start...). Each scene becomes a `Group` built once in an init Sub, or built on demand by a Sub
   that adds it to the stage and schedules its own removal.
3. **Write the code following the conventions below.** Prefer the built-in fonts unless the table ships its
   own `.fnt`. Keep scene construction, per-event updates and cleanup in separate Subs.
4. **Verify before handing it over.** If FlexDMD Studio is available (this repo's `FlexDMDStudio/`, or the
   hosted copy on GitHub Pages), run the scene there: it executes the same API in the browser and flags syntax
   and runtime errors with line numbers. From the command line (needs `npm install` and `npm run build` in
   `FlexDMDStudio/` once, and a Chromium; set `CHROMIUM_PATH` if Playwright's is not installed):
   `node FlexDMDStudio/scripts/check-script.mjs scene.vbs --call DMD_Init --call "Jackpot(1500000)" --shots 0.5,2.5`
   runs the script headlessly, calls the listed Subs in order, steps the simulated clock, prints errors and the
   actor tree (absolute bounds, visibility, pending actions) and saves screenshots at the requested times. The
   studio pre-creates `FlexDMD` (and a `Table1` stub with `Filename`); other table objects, timers and
   `PlaySound` do not exist there, so keep them out of the DMD Subs or behind `If Not FlexDMD Is Nothing`.
   Fix everything the checker reports; a script that errors in the studio errors in VPX too.
5. **Integrate.** For a table, the DMD code lives in the table script: a `DMD_Init` Sub called from
   `Table1_Init`, scene Subs called from game logic, and `FlexDMD.Run = False` in `Table1_Exit`. Guard every
   FlexDMD call with `If Not FlexDMD Is Nothing Then` so the table still runs where FlexDMD is not installed.

## Conventions that keep scripts working

- Create fonts once (`Set fontScore = FlexDMD.NewFont(...)`) and reuse them; each `NewFont` call re-tints the
  font texture.
- Give every actor a unique name and fetch it back with the typed getters (`scene.GetLabel("Score")`) rather than
  keeping dozens of variables. Never give a group and one of its descendants the same name (a group called
  "Score" holding a label called "Score" makes `GetLabel("Score")` fail: the recursive lookup finds the group
  first). Suffix scene groups, e.g. `ScoreScene`, `JackpotScene`.
- Set `FlexDMD.Clear = True` unless the scene deliberately relies on persistence, or make the first child of each
  scene a full-size black image (`FlexDMD.Resources.dmds.black.png` sized `SetSize FlexDMD.Width, FlexDMD.Height`).
- For monochrome tables draw in white/grays: the render mode converts luminance to the DMD color.
- Timed scenes remove themselves: build a `Sequence` of `Wait(seconds)` then `RemoveFromParent` on the scene
  group and add the group to the stage. Don't rely on table timers to remove DMD scenes.
- Repeating attract loops are `Repeat(sequence, -1)` on a container group that swaps child scenes with
  `AddChild`/`RemoveChild`.
- Keep positions and sizes as numeric literals in `SetBounds`/`SetPosition`/`SetAlignedPosition`/`SetSize`
  calls where possible: that is what makes them draggable in FlexDMD Studio and easy for the author to tweak.
- Don't use the UltraDMD compatibility API (`NewUltraDMD`) for new work; the scene API does everything it does and
  more.

## Cheat sheet (numbers you will need)

- **Alignment** (`SetAlignedPosition`, `Label.Alignment`, `Image.Alignment`): 0 TopLeft, 1 Top, 2 TopRight,
  3 Left, 4 Center, 5 Right, 6 BottomLeft, 7 Bottom, 8 BottomRight.
- **Scaling** (`Image.Scaling`, `Video.Scaling`): 0 Fit, 1 Fill, 2 FillX, 3 FillY, 4 Stretch (default), 5 StretchX,
  6 StretchY, 7 None.
- **RenderMode**: 0 DMD_GRAY_2, 1 DMD_GRAY_4 (default), 2 DMD_RGB.
- **Interpolation** (`MoveTo(...).Ease`): 0 Linear, 1-3 Elastic In/Out/InOut, 4-6 Quad, 7-9 Cube, 10-12 Quart,
  13-15 Quint, 16-18 Sine, 19-21 Bounce, 22-24 Circ, 25-27 Expo, 28-30 Back (each In/Out/InOut).
- **Colors**: `RGB(r, g, b)` or `vbWhite`, `vbRed`... (`vb*` constants are BGR longs; `RGB()` handles that).
- **Assets**: `FlexDMD.Resources.<font>.fnt` for bundled fonts (`teeny_tiny_pixls-5`, `udmd-f4by5`, `udmd-f5by7`,
  `udmd-f6by12`, `udmd-f7by13`, `udmd-f7by5`, `udmd-f12by24`, `udmd-f14by26`, `bm_army-12`, `zx_spectrum-7`),
  `FlexDMD.Resources.dmds.black.png`; project files relative to `FlexDMD.ProjectFolder`; `VPX.<imagename>` for
  images embedded in the table. Image options: `&dmd=2` (downsample dot-pattern art), `&add` (dark pixels become
  transparent), `&region=x,y,w,h`, `&pad=l,t,r,b`.

Full API with every property and method: `references/api.md`. Ready-made recipes (score layout, attract loop,
jackpot flash, scrolling text, video/GIF backgrounds, table integration): `references/patterns.md`. Engine
quirks that bite (on-stage rule, clear behaviour, label packing, Get semantics, font borders):
`references/pitfalls.md`. Read the relevant file before writing a non-trivial scene; the cost is small and
the mistakes it prevents are the ones users actually report.

## Minimal complete example

```vbscript
' Scene shown for 3 seconds when a jackpot is scored (call Jackpot 1500000)
Dim fontBig
Set fontBig = FlexDMD.NewFont("FlexDMD.Resources.udmd-f7by13.fnt", vbWhite, vbWhite, 0)

Sub Jackpot(value)
    Dim scene, lbl, af, seq
    Set scene = FlexDMD.NewGroup("Jackpot")
    scene.SetSize FlexDMD.Width, FlexDMD.Height
    scene.ClearBackground = True
    Set lbl = FlexDMD.NewLabel("Text", fontBig, "JACKPOT" & vbCrLf & FormatNumber(value, 0))
    lbl.SetBounds 0, 0, 128, 32          ' full-size box, text centered inside (Alignment defaults to 4)
    scene.AddActor lbl
    Dim lf, blink
    Set lf = lbl.ActionFactory              ' flash the text: Wait/Show in a Repeat, never a counted af.Blink
    Set blink = lf.Sequence()
    blink.Add lf.Wait(0.15)
    blink.Add lf.Show(False)
    blink.Add lf.Wait(0.1)
    blink.Add lf.Show(True)
    lbl.AddAction lf.Repeat(blink, 4)
    Set af = scene.ActionFactory
    Set seq = af.Sequence()
    seq.Add af.Wait(3)
    seq.Add af.RemoveFromParent()
    scene.AddAction seq
    FlexDMD.LockRenderThread
    FlexDMD.Stage.AddActor scene         ' actions start now that the group is on stage
    FlexDMD.UnlockRenderThread
End Sub
```

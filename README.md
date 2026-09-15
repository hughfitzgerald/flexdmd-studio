# FlexDMD Studio

A browser-based editor and live previewer for [FlexDMD](../docs/README.md) scenes. Write the DMD part of a
table script in one pane and watch it run in the other, on macOS, Linux or Windows, with no .NET, no COM
registration and no Visual Pinball required.

![FlexDMD Studio](../docs/media/flexdmd-studio.png)

It re-implements the FlexDMD scene engine in TypeScript (actors, actions, bitmap fonts, image filters, render
modes) and runs your VBScript through a built-in interpreter. The C# sources in `../FlexDMD` are the reference
(they are also what the C++ port in Visual Pinball standalone/BGFX follows), so scripts written here run unchanged
in FlexDMD.

## Running it

```sh
cd FlexDMDStudio
npm install
npm run dev        # opens http://localhost:5173
```

`npm run build` produces a static site in `dist/` that can be served from anywhere (or opened through
`npm run preview`). `npm test` runs the interpreter and engine unit tests; `npm run typecheck` runs the TypeScript
compiler.

### Hosting on GitHub Pages

The app is fully static, so the repository ships a workflow (`.github/workflows/studio-pages.yml`) that builds it
and publishes it to GitHub Pages. To enable it on your fork:

1. In the repository settings, open **Pages** and set **Source** to **GitHub Actions**.
2. Push to `master` (any change under `FlexDMDStudio/`), or run the workflow manually from the **Actions** tab,
   where you can also pick another branch to deploy.

The site is then served at `https://<user>.github.io/<repo>/`. Everything runs in the browser: scripts stay in
your browser's local storage and project folders are read locally, nothing is uploaded.

## Using it

- **Script pane** (left): a `FlexDMD` object is pre-created with `Run = True`, exactly like the FlexDMDUI design
  tab. `CreateObject("FlexDMD.FlexDMD")` returns that same object, so table-style initialisation code works too.
  The script re-runs automatically as you type (toggle *Auto-run*, or press <kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd>).
- **Preview** (right): the DMD frame after render mode processing (`RenderMode` 0/1 = 4/16 shades tinted with
  `FlexDMD.Color`, 2 = RGB), with an optional dot mask. *Pause*, *Step*, *Restart* and *Speed* drive the simulated
  clock that actions, GIFs and image sequences follow.
- **WYSIWYG editing**: click an actor to select it, drag to move, use the handles to resize. The literals in the
  script that produced its position and size (`SetBounds`, `SetPosition`, `SetAlignedPosition`, `SetSize`,
  `X = 10`...) are rewritten live and highlighted in the editor. Values that come from variables or expressions are
  shown read-only with an explanation in the Inspector. Arrow keys nudge the selection (<kbd>Shift</kbd> = 10 px).
- **Inspector**: the actor tree with live bounds, the properties of the selected actor and its pending actions.
- **Subs**: every `Sub`/`Function` in the script becomes a button, with a field for arguments written as VBScript
  literals (`1500000, "PLAYER 1", True`). Use it to fire the game events your table would fire.
- **Assets**: click *Open folder* (or drop a folder on the page) to load the folder holding your PNG/JPG/BMP/GIF/MP4
  and `.fnt` files. Script paths resolve against it, honouring `FlexDMD.ProjectFolder`. Image options work as in
  FlexDMD: `img.png&dmd=2`, `&add`, `&region=x,y,w,h`, `&pad=l,t,r,b`, and `a.png|b.png|c.png` sequences. The
  fonts bundled with FlexDMD are available under their usual `FlexDMD.Resources.` names.
- **Sound**: pick an audio file (ogg/mp3/wav) from the project folder; it restarts with the script and follows
  pause and speed, so you can line animations up with a soundtrack even though FlexDMD itself plays no sound.

## What is and is not supported

Supported: the whole FlexDMD scene API (`NewGroup`, `NewFrame`, `NewLabel`, `NewImage`, `NewVideo`, `NewFont`,
`Stage`, all actor properties, `ActionFactory` with Wait, Delayed, Sequence, Parallel, Repeat, Blink, Show, AddTo,
RemoveFromParent, AddChild, RemoveChild, Seek and MoveTo with all easing modes), `RuntimeVersion` 1008/1009
semantics (label AutoPack, `Group.Get` paths), `Clear`, `DmdPixels`/`DmdColoredPixels`.

Not supported: the UltraDMD compatibility API, VPX-embedded resources (`VPX.name`), segment display render modes,
WMV/AVI videos (browsers only decode MP4). MP4 playback follows the browser's video element rather than the
engine's frame stepping. GIF frame delays of 0 are clamped to 10 ms.

The VBScript interpreter covers the language as used in table scripts: `Dim/ReDim/Const`, `Set`, `Sub/Function`
with `Exit`, `If/ElseIf/Else`, `For/For Each`, `Do/Loop`, `While/Wend`, `Select Case`, `With`, `Class` with
properties, `On Error Resume Next`, `Err`, arrays, the usual string/math/conversion functions, `RGB()` and the `vb*`
constants. Table objects (`Table1`, timers, `PlaySound`...) do not exist here; keep the DMD code self-contained or
stub them with your own Subs.

## Layout of the code

```
src/vbs/    VBScript lexer, parser and tree-walking interpreter (no DOM dependency)
src/flex/   Port of the FlexDMD engine: actor.ts (Actor/Group/Frame), label.ts, image.ts, animated.ts
            (ImageSequence, GIF, video), font.ts (BMFont + tint/outline), actions.ts, ease.ts, layout.ts,
            assets.ts (asset manager and bitmap filters), flexdmd.ts (root object, render step, render modes)
src/app/    The editor UI: CodeMirror editor, preview canvas with drag/resize, inspector, panels, runner
tests/      Vitest unit tests for the interpreter and the engine
scripts/    Playwright smoke tests, and check-script.mjs: runs a .vbs headlessly, calls Subs, steps the clock,
            dumps the actor tree and saves screenshots (used by the flexdmd-scenes Claude skill to verify scripts)
```

The engine and interpreter are plain TypeScript modules with no UI dependency, so the same core can later be hosted
in a VS Code webview extension ("preview selection" from a full table script) without changes.

Every geometry call made from a script records the source span of the numeric literals it received
(`src/vbs/hostcontext.ts`); `src/app/codegen.ts` turns a drag in the preview into replacements of those literals,
which keeps the script as the single source of truth.

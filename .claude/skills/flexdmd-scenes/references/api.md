# FlexDMD scene API reference

Source of truth: `FlexDMD/IFlexDMD.cs` (COM interface) and `FlexDMD/Actors/*.cs`. Everything below is the
1.9.x API; the C++ port in Visual Pinball standalone/BGFX implements the same surface.

## Contents
1. FlexDMD object (properties, factory methods)
2. Common actor members
3. Group
4. Image
5. Label and fonts
6. Frame
7. Video (MP4 / GIF / image sequence)
8. ActionFactory and actions
9. Asset naming and options
10. Enums

## 1. FlexDMD object

Obtained with `Set FlexDMD = CreateObject("FlexDMD.FlexDMD")` (returns `Nothing` if not installed).

| Member | Type | Notes |
|---|---|---|
| `Version` | int, read-only | 1009 for 1.9.x (major*1000+minor) |
| `RuntimeVersion` | int | Behaviour switch. Default 1008 (backward compatible). Set `1009` before creating actors to get: no label AutoPack, path-based `Group.Get`, floor-based text placement |
| `Run` | bool | Starts/stops the render thread. Set `True` after configuring size/mode; set `False` in `Table1_Exit` |
| `Show` | bool | Shows/hides the DMD window (default True) |
| `GameName` | string | Used by DmdDevice to store per-table window position. Always set it |
| `Width`, `Height` | int | DMD size in dots (default 128×32). Set before `Run = True` |
| `Color` | OLE color | Tint for monochrome render modes (default RGB(255,88,32)) |
| `RenderMode` | int | 0 GRAY_2, 1 GRAY_4 (default), 2 RGB. Values 3+ are segment displays (not covered here) |
| `ProjectFolder` | string | Base folder for file assets (default `./`, relative to VPX's table folder) |
| `TableFile` | string | Path of the .vpx used to resolve `VPX.xxx` assets (`Table1.Filename & ".vpx"`) |
| `Clear` | bool | Clear the frame to black before each draw (default False!) |
| `DmdPixels` | byte array | Luminance of the last frame (for in-table DMD rendering via a timer) |
| `DmdColoredPixels` | long array | RGB of the last frame |
| `Segments` | array, write | Segment display data (not used for dot matrix) |
| `Stage` | Group | Root group, sized to the DMD |
| `LockRenderThread()` / `UnlockRenderThread()` | | Pair around stage changes made from table code |
| `NewGroup(name)` | Group | |
| `NewFrame(name)` | Frame | |
| `NewLabel(name, font, text)` | Label | `font` from `NewFont` |
| `NewImage(name, path)` | Image | Throws if the asset cannot be loaded |
| `NewVideo(name, path)` | Video | Returns `Nothing` on failure (always check) |
| `NewFont(path, tint, borderTint, borderSize)` | Font | `borderSize` is 0 or 1 only |
| `NewUltraDMD()` | | Legacy UltraDMD compatibility API; avoid for new code |

## 2. Common actor members (Group, Image, Label, Frame, Video)

| Member | Notes |
|---|---|
| `Name` | string, used by `Get*` lookups |
| `X`, `Y`, `Width`, `Height` | floats, relative to the parent group |
| `Visible` | bool (default True). Invisible actors still update their actions |
| `FillParent` | bool: on every update, bounds = parent bounds |
| `ClearBackground` | bool: fill own bounds with black before drawing |
| `PrefWidth`, `PrefHeight` | read-only natural size (bitmap size, text size) |
| `Pack()` | size = preferred size |
| `SetBounds x, y, w, h` / `SetPosition x, y` / `SetSize w, h` | |
| `SetAlignedPosition x, y, alignment` | positions the actor so that its anchor (per Alignment) sits at x, y. Uses the current size |
| `Remove()` | detach from parent |
| `ActionFactory` | see section 8 |
| `AddAction action` / `ClearActions()` | actions run only while the actor is on stage |

## 3. Group

| Member | Notes |
|---|---|
| `Clip` | bool: clip children to the group's bounds (default False) |
| `ChildCount` | |
| `HasChild(name)` | |
| `GetGroup(name)`, `GetFrame(name)`, `GetLabel(name)`, `GetVideo(name)`, `GetImage(name)` | Lookup. With RuntimeVersion ≤ 1008 the search is recursive (first match, depth-first, the group itself if its own name matches). With 1009+ it is by path: `"child"`, `"sub/child"`, `"/Stage/scene/child"` |
| `AddActor actor` | appends (moves the actor if it had another parent) |
| `RemoveActor actor` | |
| `RemoveAll()` | |

## 4. Image

| Member | Notes |
|---|---|
| `Bitmap` | get/set the bitmap. Setting from another image's `Bitmap` swaps artwork without re-layout (`img.Bitmap = FlexDMD.NewImage("", "other.png").Bitmap`) |
| `Scaling` | int, default 4 Stretch (bitmap stretched to the actor bounds) |
| `Alignment` | int, default 4 Center (placement inside the bounds when the scaled bitmap is smaller) |

Images pack to their bitmap size on creation. Drawing snaps to integer dots.

## 5. Label and fonts

| Member | Notes |
|---|---|
| `Text` | string; `vbCrLf` (or any newline) starts a new line |
| `Font` | Font object |
| `Alignment` | int, default 4 Center: where the text block sits inside the label bounds. Multi-line text is aligned line by line for center/right |
| `AutoPack` | bool. True by default with RuntimeVersion ≤ 1008: the label resizes to the text whenever `Text` or `Font` changes, so `SetBounds` is overwritten by the next `Text =`. False with 1009 |

Text placement rounds down to whole dots. `PrefWidth/PrefHeight` are the measured text size.

Fonts are AngelCode BMFont files (`.fnt` + page `.png`). `NewFont(path, tint, borderTint, borderSize)`:
- `tint` multiplies the glyph color (use `vbWhite` for the font's own colors, or e.g. `RGB(255,180,0)` for orange).
- `borderSize = 1` draws a 1-dot outline in `borderTint` (requires 1 dot of padding in the font, true for the bundled ones) and adds 2 dots of advance per character.
- Bundled fonts and their line heights: `teeny_tiny_pixls-5` (6), `udmd-f4by5`, `udmd-f5by7`, `udmd-f6by12`, `udmd-f7by5`, `udmd-f7by13` (14), `udmd-f12by24`, `udmd-f14by26`, `bm_army-12`, `zx_spectrum-7`. Lower-case letters fall back to upper case when the font has none.

## 6. Frame

| Member | Notes |
|---|---|
| `Thickness` | int, default 2 (0 for no border) |
| `BorderColor` | OLE color, default white |
| `Fill` | bool, default False |
| `FillColor` | OLE color, default black (drawn inside the border) |

## 7. Video (AnimatedActor)

Created by `NewVideo(name, path)`: `.mp4/.wmv/.avi` file, `.gif` (frame delays honoured), or an image sequence
`"f1.png|f2.png|f3.png"` (30 fps, loops). `NewVideo` returns `Nothing` on error.

| Member | Notes |
|---|---|
| `Length` | seconds, read-only |
| `Loop` | bool, default True |
| `Paused` | bool |
| `PlaySpeed` | float, default 1 |
| `Seek seconds` | |
| `Scaling`, `Alignment` | as Image |

Videos only advance while visible and on stage. Single images passed to `NewVideo` become a one-frame sequence.

## 8. ActionFactory and actions

Get it from any actor: `Set af = actor.ActionFactory`. Actions built from an actor's factory target that actor
(except the container/timing actions). Add with `actor.AddAction action`. An action reports itself complete
and is removed; composites can be reused after completion (they reset).

| Factory method | Effect |
|---|---|
| `Wait(seconds)` | completes after the delay |
| `Delayed(seconds, action)` | runs `action` after the delay |
| `Sequence()` | composite; `.Add action` returns the composite, runs children in order |
| `Parallel()` | composite; runs children together, completes when all complete |
| `Repeat(action, count)` | repeats `count` times; `-1` = forever |
| `Blink(secondsShow, secondsHide, repeat)` | toggles `Visible`; `repeat` cycles, `-1` = forever |
| `Show(visible)` | sets `Visible` |
| `AddTo(group)` | adds the target actor to `group` |
| `RemoveFromParent()` | detaches the target actor |
| `AddChild(actor)` / `RemoveChild(actor)` | on a group target: adds/removes a child |
| `Seek(seconds)` | on a video target: seeks |
| `MoveTo(x, y, seconds)` | tween X/Y; returns an ITweenAction with `Ease` (Interpolation int) |

Timing runs at the render frame rate (60 fps). A completed `Wait` and the following action in a `Sequence`
execute in the same frame.

## 9. Asset naming and options

- `FlexDMD.Resources.<name>`: bundled resources (fonts and `dmds.black.png`, `colors.png`).
- `VPX.<image name>`: an image imported into the table (needs `FlexDMD.TableFile`).
- Anything else: a file path relative to `FlexDMD.ProjectFolder` (use forward slashes; a folder next to the table such as `"./MyTable/"`).
- Options appended with `&` to image paths: `dmd=N` (downsample by N with brightness compensation, for artwork drawn at N× dot size), `dmd2=N` (same, offset variant), `add` (pixels darker than 64 become transparent), `region=x,y,w,h` (crop), `pad=l,t,r,b` (transparent padding).
- Image sequences: `"a.png|b.png|c.png"` (options apply per element: `"a.png&dmd=2|b.png&dmd=2"`).
- `|` is not allowed in single file names.

## 10. Enums (pass as integers)

- Alignment: 0 TopLeft, 1 Top, 2 TopRight, 3 Left, 4 Center, 5 Right, 6 BottomLeft, 7 Bottom, 8 BottomRight
- Scaling: 0 Fit, 1 Fill, 2 FillX, 3 FillY, 4 Stretch, 5 StretchX, 6 StretchY, 7 None
- RenderMode: 0 DMD_GRAY_2, 1 DMD_GRAY_4, 2 DMD_RGB
- Interpolation: 0 Linear, 1 ElasticIn, 2 ElasticOut, 3 ElasticInOut, 4 QuadIn, 5 QuadOut, 6 QuadInOut, 7 CubeIn, 8 CubeOut, 9 CubeInOut, 10 QuartIn, 11 QuartOut, 12 QuartInOut, 13 QuintIn, 14 QuintOut, 15 QuintInOut, 16 SineIn, 17 SineOut, 18 SineInOut, 19 BounceIn, 20 BounceOut, 21 BounceInOut, 22 CircIn, 23 CircOut, 24 CircInOut, 25 ExpoIn, 26 ExpoOut, 27 ExpoInOut, 28 BackIn, 29 BackOut, 30 BackInOut

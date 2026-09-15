# FlexDMD scene recipes

All snippets assume `FlexDMD` exists and `Run = True`. Enum values: see `api.md` §10.

## Table integration skeleton

```vbscript
Const cGameName = "MyTable"
Dim FlexDMD, fontScore, fontSmall, ScoreScene

Sub DMD_Init
    Set FlexDMD = CreateObject("FlexDMD.FlexDMD")
    If FlexDMD Is Nothing Then Exit Sub          ' table keeps working without a DMD
    With FlexDMD
        .GameName = cGameName
        .TableFile = Table1.Filename & ".vpx"    ' enables "VPX.imagename" assets
        .ProjectFolder = "./" & cGameName & "/"  ' optional: folder with png/gif/mp4/fnt files
        .RenderMode = 2                          ' RGB (0 = 4 shades, 1 = 16 shades)
        .Width = 128
        .Height = 32
        .Clear = True
        .Run = True
    End With
    Set fontScore = FlexDMD.NewFont("FlexDMD.Resources.udmd-f7by13.fnt", vbWhite, vbWhite, 0)
    Set fontSmall = FlexDMD.NewFont("FlexDMD.Resources.udmd-f5by7.fnt", vbWhite, vbWhite, 0)
    BuildScoreScene
    FlexDMD.LockRenderThread
    FlexDMD.Stage.AddActor ScoreScene
    FlexDMD.UnlockRenderThread
End Sub

Sub Table1_Init
    DMD_Init
End Sub

Sub Table1_Exit
    If Not FlexDMD Is Nothing Then FlexDMD.Run = False
End Sub
```

Every scene Sub called from game logic follows the same shape: `If FlexDMD Is Nothing Then Exit Sub`, build or
update actors, and wrap stage changes in `LockRenderThread`/`UnlockRenderThread`.

## Score layout (labels with fixed boxes)

```vbscript
Sub BuildScoreScene
    Set ScoreScene = FlexDMD.NewGroup("Score")
    ScoreScene.SetSize 128, 32
    Dim lbl
    Set lbl = FlexDMD.NewLabel("Score", fontScore, "0")
    lbl.AutoPack = False                 ' keep the box we give it
    lbl.SetBounds 0, 2, 128, 14          ' full width box, text centered by Alignment (default 4)
    ScoreScene.AddActor lbl
    Set lbl = FlexDMD.NewLabel("Player", fontSmall, "PLAYER 1")
    lbl.AutoPack = False
    lbl.SetBounds 2, 23, 60, 8
    lbl.Alignment = 3                    ' Left
    ScoreScene.AddActor lbl
    Set lbl = FlexDMD.NewLabel("Ball", fontSmall, "BALL 1")
    lbl.AutoPack = False
    lbl.SetBounds 66, 23, 60, 8
    lbl.Alignment = 5                    ' Right
    ScoreScene.AddActor lbl
End Sub

Sub UpdateScore(player, score, ball)
    If FlexDMD Is Nothing Then Exit Sub
    FlexDMD.LockRenderThread
    ScoreScene.GetLabel("Score").Text = FormatNumber(score, 0)
    ScoreScene.GetLabel("Player").Text = "PLAYER " & player
    ScoreScene.GetLabel("Ball").Text = "BALL " & ball
    FlexDMD.UnlockRenderThread
End Sub
```

With fixed boxes and `AutoPack = False`, text changes never move the layout. If you prefer `SetAlignedPosition`
with AutoPack on, call it again after every `Text =`.

## Timed overlay scene (jackpot, extra ball, mode start)

```vbscript
Sub ShowMessage(line1, line2, seconds)
    If FlexDMD Is Nothing Then Exit Sub
    Dim scene, lbl, af, seq
    Set scene = FlexDMD.NewGroup("Message")
    scene.SetSize 128, 32
    scene.ClearBackground = True          ' opaque, hides the score underneath
    Set lbl = FlexDMD.NewLabel("Text", fontScore, line1 & vbCrLf & line2)
    lbl.AutoPack = False
    lbl.SetBounds 0, 0, 128, 32
    scene.AddActor lbl
    Set af = scene.ActionFactory
    Set seq = af.Sequence()
    seq.Add af.Wait(seconds)
    seq.Add af.RemoveFromParent()
    scene.AddAction seq
    FlexDMD.LockRenderThread
    FlexDMD.Stage.AddActor scene
    FlexDMD.UnlockRenderThread
End Sub
```

Stacked overlays draw in the order they were added; the latest is on top. To replace a running message, name
the group and remove the previous one first: `If FlexDMD.Stage.HasChild("Message") Then FlexDMD.Stage.GetGroup("Message").Remove`.

## Flash / blink emphasis

Build a counted blink out of `Wait`/`Show` inside a `Repeat`. `ActionFactory.Blink` with a count leaves the actor
hidden when it ends and never resets its counter, so it misbehaves on the second pass of any loop (pitfalls #11):

```vbscript
Set af = lbl.ActionFactory
Dim blink
Set blink = af.Sequence()
blink.Add af.Wait(0.12)     ' visible
blink.Add af.Show(False)
blink.Add af.Wait(0.08)     ' hidden
blink.Add af.Show(True)
lbl.AddAction af.Repeat(blink, 6)   ' 6 flashes, ends visible, safe to run again
```

An endless blink is the one counted-free form that is always safe, because it never completes:

```vbscript
lbl.AddAction af.Blink(0.4, 0.4, -1)
```

## Slide in, hold, slide out (MoveTo with easing)

```vbscript
Dim title, af, seq, mv
Set title = FlexDMD.NewLabel("Title", fontScore, "MULTIBALL")
title.SetPosition -100, 10                 ' start off screen (label already packed to its text)
scene.AddActor title
Set af = title.ActionFactory
Set seq = af.Sequence()
Set mv = af.MoveTo(20, 10, 0.6) : mv.Ease = 20      ' BounceOut
seq.Add mv
seq.Add af.Wait(1.5)
Set mv = af.MoveTo(140, 10, 0.4) : mv.Ease = 4      ' QuadIn
seq.Add mv
title.AddAction seq
```

Because `MoveTo` targets absolute coordinates, centre a label of unknown width with
`title.SetAlignedPosition 64, 16, 4 : Set mv = af.MoveTo(title.X, title.Y, 0.6)` after computing the final
position, then move it off screen with `SetPosition` before adding the action.

## Scrolling text (marquee)

```vbscript
Dim lbl, w
Set lbl = FlexDMD.NewLabel("Scroll", fontSmall, "WELCOME TO THE MACHINE   ")
w = lbl.Width
lbl.SetPosition 128, 12
scene.Clip = True
scene.AddActor lbl
lbl.AddAction lbl.ActionFactory.Repeat(lbl.ActionFactory.MoveTo(-w, 12, (128 + w) / 40), -1)
```

`Repeat` restarts the tween from the current position, so add `af.Sequence()` with a `MoveTo(128, 12, 0)` reset
step first if the loop should jump back: `seq.Add af.MoveTo(128, 12, 0) : seq.Add af.MoveTo(-w, 12, dur)`.

## Attract loop (scenes cycling forever)

```vbscript
Dim attract, af, seq
Set attract = FlexDMD.NewGroup("Attract")
attract.SetSize 128, 32
Set af = attract.ActionFactory
Set seq = af.Sequence()
seq.Add af.AddChild(sceneLogo)     : seq.Add af.Wait(4) : seq.Add af.RemoveChild(sceneLogo)
seq.Add af.AddChild(sceneHighScore): seq.Add af.Wait(4) : seq.Add af.RemoveChild(sceneHighScore)
seq.Add af.AddChild(sceneCredits)  : seq.Add af.Wait(3) : seq.Add af.RemoveChild(sceneCredits)
attract.AddAction af.Repeat(seq, -1)
FlexDMD.Stage.AddActor attract
```

Each child scene needs an opaque background (or `FlexDMD.Clear = True`) so the previous one disappears.
Stop the attract mode with `attract.Remove` (and `attract.ClearActions` if it will be reused).

## Background video / GIF with text on top

```vbscript
Dim vid
Set vid = FlexDMD.NewVideo("Back", "intro.gif")        ' or "intro.mp4", or "f1.png|f2.png|f3.png"
If Not vid Is Nothing Then
    vid.SetBounds 0, 0, 128, 32
    vid.Scaling = 0                                    ' Fit; 4 = Stretch
    vid.Loop = True
    scene.AddActor vid                                 ' first child = bottom layer
End If
scene.AddActor lbl                                     ' text drawn on top
```

A one-shot video that removes its scene when done: `seq.Add af.Wait(vid.Length)` then `RemoveFromParent`.

## Swapping artwork without re-layout

```vbscript
scene.GetImage("Back").Bitmap = FlexDMD.NewImage("", "VPX.bkempty&dmd=2").Bitmap
```

Loads (and caches) the bitmap and replaces the pixels of an existing image actor, keeping its bounds and scaling.

## Digit / segment style displays from image fonts

Tables converted from UltraDMD often draw characters as images: one `Image` per character position, updated by
setting `Bitmap`. Create the slots once (`SetBounds 4 + i * 6, 21, 8, 8`) and update them from a string in a
locked section. Prefer a bitmap font `Label` for new tables; it is one actor instead of forty.

## Rendering the DMD on the playfield (VPX flasher)

```vbscript
' Timer named FlexDMDTimer, interval -1 (every frame)
Sub FlexDMDTimer_Timer
    If FlexDMD Is Nothing Then Exit Sub
    Dim DMDp : DMDp = FlexDMD.DmdColoredPixels
    If Not IsEmpty(DMDp) Then
        DMDWidth = FlexDMD.Width : DMDHeight = FlexDMD.Height
        DMDColoredPixels = DMDp
    End If
End Sub
```

Use `DmdPixels` with `DMDPixels =` for monochrome flashers.

## Previewing while you work

FlexDMD Studio (`FlexDMDStudio/`, or the GitHub Pages deployment of this repo) runs the same API in a browser:
paste the scene code (the `FlexDMD` object is pre-created with `Run = True`), watch it, drag actors to adjust
literal positions, and press the buttons in the *Subs* tab to fire event Subs with arguments. For a headless
check from a terminal: `node FlexDMDStudio/scripts/check-script.mjs scene.vbs --sub "ShowMessage" --args "\"JACKPOT\", \"1,000,000\", 2" --shots 0.5,1.5`.

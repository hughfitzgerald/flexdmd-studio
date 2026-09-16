export interface Sample {
  name: string;
  source: string;
  /** Pre-fills the run bar's "On run" field when this sample is loaded */
  onRun?: string;
  /** Pre-fills the run bar's "Each frame" field when this sample is loaded */
  perFrame?: string;
}

export const SAMPLES: Sample[] = [
  {
    name: 'Builder + Ticker: live score demo',
    onRun: 'BuildScoreDemo',
    perFrame: 'TickScoreDemo',
    source: `' ================================================================
'  Builder + Ticker: a scene built once, then fed data every frame -
'  the shape most real FlexDMD scenes actually take.
' ================================================================
'
' A BUILDER runs once: it creates the fonts and actors, lays them out,
' and hands the finished scene to whoever asked for it. A TICKER runs
' every frame after that and pushes fresh values into the actors the
' Builder already made - score, timers, anything computed from game
' state. Neither Sub is called from anywhere in this file, on purpose:
' a framework (or a table's own DMD timer) is what would normally call
' them, and FlexDMD Studio's run bar stands in for that.
'
' This sample loaded with "On run" set to BuildScoreDemo and "Each
' frame" set to TickScoreDemo. Try clearing either field (top of the
' window) to see what breaks: with no "On run" the scene is built but
' never shown; with no "Each frame" it shows once and then sits still.
' You can also click either Sub in the Subs tab - the studio hands
' BuildScoreDemo the same stand-in entry either way.

Dim fontBig, fontSmall, startFrame   ' shared between the two Subs, so declared up here

Sub BuildScoreDemo(entry)
    ' Fonts are created once, here - not in the Ticker, where each
    ' NewFont call would re-tint its texture 60 times a second for no
    ' reason.
    Set fontBig = FlexDMD.NewFont("FlexDMD.Resources.udmd-f7by13.fnt", vbWhite, vbWhite, 0)
    Set fontSmall = FlexDMD.NewFont("FlexDMD.Resources.udmd-f5by7.fnt", vbWhite, vbWhite, 0)

    Dim scene : Set scene = FlexDMD.NewGroup("ScoreDemo")
    scene.SetSize FlexDMD.Width, FlexDMD.Height
    scene.ClearBackground = True

    ' A fixed box for the score, with AutoPack off: the Ticker only
    ' ever changes .Text below, never the layout, so a longer number
    ' cannot resize the label out from under itself.
    Dim score : Set score = FlexDMD.NewLabel("Score", fontBig, "0")
    score.AutoPack = False
    score.SetBounds 0, 2, 128, 14
    scene.AddActor score

    Dim status : Set status = FlexDMD.NewLabel("Status", fontSmall, "BALL 1")
    status.AutoPack = False
    status.SetBounds 0, 23, 128, 8
    scene.AddActor status

    ' An indicator the Ticker blinks by hand, driven straight off
    ' FlexFrame - never a counted ActionFactory.Blink here, since it
    ' would stop working the second time this scene is shown (see the
    ' flexdmd-scenes skill's pitfalls on Blink).
    Dim dot : Set dot = FlexDMD.NewFrame("Dot")
    dot.SetBounds 60, 17, 8, 4
    dot.Fill = True
    dot.FillColor = RGB(255, 160, 0)
    dot.Thickness = 0
    scene.AddActor dot

    startFrame = FlexFrame

    ' Framework style: hand the scene back rather than showing it
    ' directly. FlexDMD Studio passes a stand-in "entry" here whose
    ' SetScene puts the scene on the display.
    entry.SetScene scene
End Sub

Sub TickScoreDemo()
    Dim elapsed : elapsed = FlexFrame - startFrame

    ' Stand-in "game state": a score that counts up and a ball number
    ' that advances every five seconds. Replace this with real reads
    ' from your table or framework.
    Dim score : score = elapsed * 1370
    Dim ball : ball = 1 + ((elapsed \\ 300) Mod 3)

    FlexDMD.Stage.GetLabel("Score").Text = FormatNumber(score, 0)
    FlexDMD.Stage.GetLabel("Status").Text = "BALL " & ball

    ' 2 Hz blink, computed directly from the frame count rather than
    ' with an action - fine for something this simple.
    FlexDMD.Stage.GetFrame("Dot").Visible = ((elapsed \\ 15) Mod 2) = 0
End Sub
`,
  },
  {
    name: 'Two scenes (FlexDMDUI default)',
    source: `' The classic FlexDMDUI sample: two scenes alternating every 5 seconds.
Dim font
Set font = FlexDMD.NewFont("FlexDMD.Resources.teeny_tiny_pixls-5.fnt", vbWhite, vbWhite, 0)

Dim scene1
Set scene1 = FlexDMD.NewGroup("Scene 1")
scene1.AddActor FlexDMD.NewImage("Back", "FlexDMD.Resources.dmds.black.png")
scene1.AddActor FlexDMD.NewLabel("Label", font, "Welcome to FlexDMD")
scene1.GetLabel("Label").SetAlignedPosition 64, 16, 4

Dim scene2
Set scene2 = FlexDMD.NewGroup("Scene 2")
scene2.AddActor FlexDMD.NewImage("Back", "FlexDMD.Resources.dmds.black.png")
scene2.AddActor FlexDMD.NewLabel("Label", font, "Enjoy!")
scene2.GetLabel("Label").SetAlignedPosition 64, 16, 4

Dim sequence
Set sequence = FlexDMD.NewGroup("Sequence")
sequence.SetSize 128, 32
Set af = sequence.ActionFactory
Set list = af.Sequence()
list.Add af.AddChild(scene1)
list.Add af.Wait(5)
list.Add af.RemoveChild(scene1)
list.Add af.AddChild(scene2)
list.Add af.Wait(5)
list.Add af.RemoveChild(scene2)
sequence.AddAction af.Repeat(list, -1)

FlexDMD.LockRenderThread
FlexDMD.Stage.RemoveAll
FlexDMD.Stage.AddActor sequence
FlexDMD.UnlockRenderThread
`,
  },
  {
    name: 'Score layout with frames and Subs',
    source: `' A score scene: select the labels/frame in the preview and drag them, the SetAlignedPosition / SetBounds
' literals below update live. Use the "Subs" tab to trigger the jackpot animation.
FlexDMD.RenderMode = 1          ' 0 = 4 shades, 1 = 16 shades, 2 = RGB
FlexDMD.Color = RGB(255, 88, 32)
FlexDMD.Clear = True

Dim bigFont, smallFont, dimFont
Set bigFont = FlexDMD.NewFont("FlexDMD.Resources.udmd-f7by13.fnt", vbWhite, vbWhite, 0)
Set smallFont = FlexDMD.NewFont("FlexDMD.Resources.udmd-f5by7.fnt", vbWhite, vbWhite, 0)
Set dimFont = FlexDMD.NewFont("FlexDMD.Resources.teeny_tiny_pixls-5.fnt", RGB(120, 120, 120), vbWhite, 0)

Dim scene
Set scene = FlexDMD.NewGroup("Score")
scene.SetSize 128, 32

Dim frame
Set frame = FlexDMD.NewFrame("Border")
frame.SetBounds 1, 1, 126, 30
frame.Thickness = 1
frame.BorderColor = RGB(90, 90, 90)
scene.AddActor frame

Dim score
Set score = FlexDMD.NewLabel("Score", bigFont, "1,250,000")
score.SetAlignedPosition 64, 12, 4
scene.AddActor score

Dim player
Set player = FlexDMD.NewLabel("Player", smallFont, "PLAYER 1")
player.SetAlignedPosition 4, 29, 6
scene.AddActor player

Dim ball
Set ball = FlexDMD.NewLabel("Ball", smallFont, "BALL 2")
ball.SetAlignedPosition 124, 29, 8
scene.AddActor ball

FlexDMD.Stage.AddActor scene

Sub SetScore(value)
    score.Text = FormatNumber(value, 0)
    score.SetAlignedPosition 64, 12, 4
End Sub

Sub Jackpot(value)
    Dim jp, af, seq
    Set jp = FlexDMD.NewGroup("Jackpot")
    jp.SetSize 128, 32
    jp.ClearBackground = True
    Dim lbl
    Set lbl = FlexDMD.NewLabel("Text", bigFont, "JACKPOT" & vbCrLf & FormatNumber(value, 0))
    lbl.SetBounds 0, 0, 128, 32
    jp.AddActor lbl
    Set af = lbl.ActionFactory
    lbl.AddAction af.Blink(0.15, 0.1, 6)
    ' Show the scene on top of the stage, then remove it after 2 seconds
    Set af = jp.ActionFactory
    Set seq = af.Sequence()
    seq.Add af.Wait(2)
    seq.Add af.RemoveFromParent()
    jp.AddAction seq
    FlexDMD.Stage.AddActor jp
End Sub
`,
  },
  {
    name: 'Animations: MoveTo, easing, Blink',
    source: `' Action sequences: a label bounces in with easing, blinks, then slides out.
FlexDMD.RenderMode = 2
Dim font
Set font = FlexDMD.NewFont("FlexDMD.Resources.bm_army-12.fnt", RGB(255, 200, 60), RGB(120, 40, 0), 1)

Dim scene
Set scene = FlexDMD.NewGroup("Anim")
scene.SetSize 128, 32
scene.ClearBackground = True

Dim title
Set title = FlexDMD.NewLabel("Title", font, "MULTIBALL")
title.Pack
title.SetPosition -100, 10
scene.AddActor title

Dim af, seq, move
Set af = title.ActionFactory
Set seq = af.Sequence()
Set move = af.MoveTo(22, 10, 0.8)
move.Ease = 20            ' BounceOut (see Interpolation enum in IFlexDMD.cs)
seq.Add move

' Blink built from Wait/Show inside a Repeat, NOT af.Blink: a counted af.Blink leaves the actor
' hidden when it ends and never resets its counter, so inside a loop the label only flashes once
' on every pass after the first. Wait, Show and Repeat all reset themselves, so this stays correct.
Dim blink
Set blink = af.Sequence()
blink.Add af.Wait(0.2)
blink.Add af.Show(False)
blink.Add af.Wait(0.15)
blink.Add af.Show(True)
seq.Add af.Repeat(blink, 3)

seq.Add af.Wait(0.5)
Set move = af.MoveTo(140, 10, 0.5)
move.Ease = 4             ' QuadIn
seq.Add move
seq.Add af.Wait(0.3)
Set move = af.MoveTo(-100, 10, 0)
seq.Add move
title.AddAction af.Repeat(seq, -1)

Dim dots, i
Set dots = FlexDMD.NewGroup("Dots")
dots.SetBounds 0, 28, 128, 4
For i = 0 To 7
    Dim d
    Set d = FlexDMD.NewFrame("Dot" & i)
    d.SetBounds i * 16 + 6, 0, 4, 3
    d.Fill = True
    d.FillColor = RGB(60, 120, 255)
    d.Thickness = 0
    d.AddAction d.ActionFactory.Blink(0.4, 0.4, -1)   ' an endless Blink never restarts, so it is safe
    dots.AddActor d
Next
scene.AddActor dots

FlexDMD.Stage.AddActor scene
`,
  },
  {
    name: 'Project folder assets (image, GIF, video)',
    source: `' Open the folder containing your assets with "Open folder", then reference them by name.
' Paths are resolved relative to the opened folder (FlexDMD.ProjectFolder is honoured).
FlexDMD.ProjectFolder = "./"
FlexDMD.RenderMode = 2

Dim scene
Set scene = FlexDMD.NewGroup("Scene")
scene.SetSize 128, 32

' A still image scaled to fit (Scaling: 0 Fit, 1 Fill, 4 Stretch, 7 None)
Dim back
Set back = FlexDMD.NewImage("Back", "background.png")
If Not back Is Nothing Then
    back.SetBounds 0, 0, 128, 32
    back.Scaling = 4
    scene.AddActor back
End If

' An animated GIF or an MP4 video (NewVideo returns Nothing when the file is missing)
Dim vid
Set vid = FlexDMD.NewVideo("Vid", "animation.gif")
If Not vid Is Nothing Then
    vid.SetBounds 80, 0, 48, 32
    vid.Scaling = 0
    vid.Loop = True
    scene.AddActor vid
End If

Dim font
Set font = FlexDMD.NewFont("FlexDMD.Resources.udmd-f5by7.fnt", vbWhite, vbBlack, 1)
Dim lbl
Set lbl = FlexDMD.NewLabel("Label", font, "ASSETS")
lbl.SetAlignedPosition 4, 4, 0
scene.AddActor lbl

FlexDMD.Stage.AddActor scene
`,
  },
];

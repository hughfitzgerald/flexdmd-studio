'*******************************************
'  FlexDMD Studio harness
'*******************************************
'
' Tables built on a framework do not create their DMD scenes inline: a config file lists the
' scenes by name, and a second file holds a Builder Sub that constructs each scene once and a
' Ticker Sub that updates it every frame. The framework itself supplies the glue between them.
'
' This file is that glue, small enough to read and edit. Copy it into your project folder, tick
' it in the Files tab alongside your own files, and set the run bar to:
'
'     On run      Studio_Init
'     Each frame  Studio_Tick
'
' Then use the Subs tab to call Studio_Show "welcome" (or any other scene name) to switch scenes.
'
' Everything the table provides and the previewer does not — players, machine variables, sound —
' is stood in for automatically, so you only need to write glue the stubs cannot fake: anything
' that has to return a real value for the DMD to look right.

' Globals your scene files assign but declare somewhere you have not loaded.
'
' VBScript makes an assignment inside a Sub a local variable unless the name is declared at the
' top level, so a font a Builder creates is invisible to its Ticker unless it is listed here.
' If a run reports that a name "has no value here", add it to this line. These are the ones the
' example scenes need; replace them with your own.
Dim FontScoreActive, FontScoreInactive, FontBig1, FontBig2, FontBig3
Dim DMDfire, DMDTextDisplayTime, DMDTextEffect, DMDTextOnScore

Const Studio_MaxEntries = 200

Dim StudioEntries(200)
Dim StudioEntryCount
Dim StudioCurrent
Dim StudioStartScene

StudioEntryCount = 0
StudioStartScene = "score"      ' the scene shown when the script runs

' One entry in the display list. The fields match the ones a config file sets.
Class StudioDmdEntry
    Public Name, Gif, Image, Text, Builder, Ticker, Callback
    Public RenderMode, Effect, Hold, Over, ResetFrame, Aliases
    Public Scene

    Private Sub Class_Initialize
        Gif = "" : Image = "" : Text = "" : Builder = "" : Ticker = "" : Callback = ""
        Effect = "solid" : Hold = 1.2 : Over = "" : ResetFrame = False
        Set Scene = Nothing
    End Sub

    ' What a Builder calls to hand its finished scene back.
    Public Sub SetScene(g)
        Set Scene = g
    End Sub
End Class

Function Studio_NewEntry(name)
    Dim e : Set e = New StudioDmdEntry
    e.Name = name
    Set StudioEntries(StudioEntryCount) = e
    StudioEntryCount = StudioEntryCount + 1
    Set Studio_NewEntry = e
End Function

' The two names a config file calls. Rename these to match your framework if they differ.
Function CreateDmdSlide(name)
    Set CreateDmdSlide = Studio_NewEntry(name)
End Function

Function CreateDmdWidget(name)
    Set CreateDmdWidget = Studio_NewEntry(name)
End Function

Function Studio_Find(name)
    Dim i
    For i = 0 To StudioEntryCount - 1
        If LCase(StudioEntries(i).Name) = LCase(name) Then
            Set Studio_Find = StudioEntries(i)
            Exit Function
        End If
    Next
    Set Studio_Find = Nothing
End Function

' Builds every scene that names a Builder, exactly once, then shows the starting one.
Sub Studio_Init()
    StudioEntryCount = 0        ' safe to run again after an edit
    Set StudioCurrent = Nothing
    CreateFlexDmdDisplay        ' the Sub your config file defines

    Dim i, e
    For i = 0 To StudioEntryCount - 1
        Set e = StudioEntries(i)
        If e.Builder <> "" Then
            GetRef(e.Builder)(e)
        ElseIf e.Gif <> "" Then
            Studio_BuildMedia e, e.Gif
        ElseIf e.Image <> "" Then
            Studio_BuildMedia e, e.Image
        ElseIf e.Text <> "" Then
            Studio_BuildText e, e.Text
        End If
    Next

    Studio_Show StudioStartScene
End Sub

' A GIF, video or still image filling the display.
Sub Studio_BuildMedia(entry, path)
    Dim g : Set g = FlexDMD.NewGroup("scene_" & entry.Name)
    g.SetSize FlexDMD.Width, FlexDMD.Height
    Dim a
    If LCase(Right(path, 4)) = ".gif" Or LCase(Right(path, 4)) = ".mp4" Then
        Set a = FlexDMD.NewVideo("media", path)
    Else
        Set a = FlexDMD.NewImage("media", path)
    End If
    If Not a Is Nothing Then
        a.SetBounds 0, 0, FlexDMD.Width, FlexDMD.Height
        g.AddActor a
    End If
    entry.SetScene g
End Sub

' A line of text. Tokens like (ticks_remaining) come from the event that played it, which the
' previewer has no idea about, so they are simply left blank here.
Sub Studio_BuildText(entry, text)
    Dim g : Set g = FlexDMD.NewGroup("scene_" & entry.Name)
    g.SetSize FlexDMD.Width, FlexDMD.Height
    g.ClearBackground = True
    Dim font : Set font = FlexDMD.NewFont("FlexDMD.Resources.udmd-f5by7.fnt", vbWhite, vbWhite, 0)
    Dim lbl : Set lbl = FlexDMD.NewLabel("text", font, Studio_StripTokens(text))
    lbl.AutoPack = False
    lbl.SetBounds 0, 0, FlexDMD.Width, FlexDMD.Height
    lbl.Alignment = FlexDMD_Align_Center
    g.AddActor lbl
    entry.SetScene g
End Sub

Function Studio_StripTokens(text)
    Dim out, i, depth, c
    out = "" : depth = 0
    For i = 1 To Len(text)
        c = Mid(text, i, 1)
        If c = "(" Then
            depth = depth + 1
        ElseIf c = ")" Then
            If depth > 0 Then depth = depth - 1
        ElseIf depth = 0 Then
            out = out & c
        End If
    Next
    Studio_StripTokens = Trim(out)
End Function

' Puts one scene on the stage. Call this from the Subs tab to flip between scenes.
Sub Studio_Show(name)
    Dim e : Set e = Studio_Find(name)
    If e Is Nothing Then Exit Sub
    Set StudioCurrent = e
    If e.ResetFrame Then FlexFrame = 0
    FlexDMD.LockRenderThread
    FlexDMD.Stage.RemoveAll
    If Not e.Scene Is Nothing Then FlexDMD.Stage.AddActor e.Scene
    FlexDMD.UnlockRenderThread
End Sub

' Runs the current scene's Ticker, the way the table's DMD timer would.
Sub Studio_Tick()
    If StudioCurrent Is Nothing Then Exit Sub
    If StudioCurrent.Ticker = "" Then Exit Sub
    GetRef(StudioCurrent.Ticker)(Nothing)
End Sub

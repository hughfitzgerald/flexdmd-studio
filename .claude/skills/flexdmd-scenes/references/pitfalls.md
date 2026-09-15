# FlexDMD pitfalls (engine behaviours that surprise people)

Each of these comes straight from the engine code (`FlexDMD/Actors/*.cs`, `FlexDMD/FlexDMD.cs`). Knowing them
saves a debugging round in VPX where errors are silent.

1. **Actions only run on stage.** `Actor.Update` (which drives actions) is only called for actors reachable from
   `FlexDMD.Stage`. Building a group, adding a `Sequence` to it and never adding the group to the stage does
   nothing. Pattern: add the scene to the stage last; let the scene's own sequence remove it.

2. **Nothing clears the frame by default.** `FlexDMD.Clear` defaults to False, so each frame is drawn over the
   previous one. Moving actors leave trails and removed scenes stay visible until something paints over them.
   Set `FlexDMD.Clear = True` at init, or give every scene an opaque full-size background
   (`ClearBackground = True` on the scene group, or a black image as the first child).

3. **`ClearBackground` on a Group fills at twice its offset.** The group translates by (X, Y) and then fills its
   own (X, Y, W, H): a scene group at (0, 0) is fine, a group at (10, 5) clears (20, 10). Keep scene groups at
   the origin and position their children, or use a black `Image` child instead.

4. **Label AutoPack (RuntimeVersion 1008).** Changing `Text` or `Font` re-packs the label to the text size,
   discarding a previous `SetBounds`/`SetSize`, and it does not re-run `SetAlignedPosition`. So a centered score
   that changes value drifts unless you call `SetAlignedPosition` again after `Text =`. Alternatives: set
   `RuntimeVersion = 1009` (no AutoPack, then give labels a fixed box with `SetBounds` and let `Alignment` center
   the text), or set `lbl.AutoPack = False` per label.

5. **`SetAlignedPosition` uses the current size.** Call it after the actor has its final size (after `Pack`,
   after setting `Text`, after `SetSize`). Calling it before `Text` is set aligns an empty box.

6. **`Group.Get` semantics differ by RuntimeVersion.** With 1008 the search is recursive and returns the first
   name match (the group itself if its own name matches). Duplicate names across scenes return the wrong actor.
   With 1009 lookups are by path (`"Scene/Score"`, or absolute `"/Stage/Scene/Score"`) and are not recursive.
   The typed getters (`GetLabel` etc.) cast; a wrong type raises an error.

7. **`NewVideo` returns Nothing on any load failure** (missing file, unsupported codec). Always test
   `If Not vid Is Nothing Then`. `NewImage` throws instead.

8. **Font border is 0 or 1 dot only**, and the outline is drawn into the glyph padding, so custom fonts need 1
   dot of padding on all sides (`padding=1,1,1,1` in the .fnt) or the outline is clipped. Outlined fonts get 2
   extra dots of advance per character, so measured widths change when you toggle the border.

9. **Tinting multiplies.** `NewFont(path, RGB(255,0,0), ...)` on a white font gives red; on a colored font it
   darkens channels. Use `vbWhite` to keep the font's own colors.

10. **Monochrome modes convert luminance.** In render modes 0/1 the RGB frame is converted to 4 or 16 shades of
    `FlexDMD.Color`. Colored artwork loses hue; dark reds/blues become near-black. Design in grays for monochrome.

11. **A counted `Blink` cannot be restarted, and ends hidden.** `BlinkAction` is the one action that does not
    reset itself: every other action explicitly "prepares for restart" (`Wait` zeroes its timer, `Sequence` its
    position, `Repeat` its counter), but `Blink` keeps its cycle count and leaves the actor `Visible = False` at
    the moment it completes. Two consequences:
    - After `Blink(show, hide, n)` finishes, the actor stays invisible until something shows it again.
    - Inside a `Repeat` (or any sequence that runs a second time), the retained counter is already past `n`, so on
      every later pass the actor is shown once, hidden once, and the blink ends immediately. The classic symptom
      is an animation that looks right the first time and whose text is then "barely there" on every loop.

    Safe uses: `Blink(show, hide, -1)` (endless, never completes, so nothing needs resetting), or a counted blink
    in a one-shot scene that is discarded afterwards, followed by `Show(True)`. Anywhere that repeats, build the
    blink from primitives that do reset:

    ```vbscript
    Dim blink
    Set blink = af.Sequence()
    blink.Add af.Wait(0.2)      ' visible
    blink.Add af.Show(False)
    blink.Add af.Wait(0.15)     ' hidden
    blink.Add af.Show(True)
    seq.Add af.Repeat(blink, 3) ' three flashes, ends visible, correct on every pass
    ```

    This is engine behaviour, identical in the C# and the C++ (VPX standalone) implementations, so a script that
    works around it here behaves the same everywhere.

12. **Wait/Sequence timing is frame based.** Durations are accumulated per 60 Hz frame; a `Wait(0.05)` lasts 3
    frames, not exactly 50 ms. A finished action in an actor's list makes the engine skip updating the next
    action for one frame (a quirk of the removal loop). Don't chain frame-critical timing across separate
    `AddAction` calls; put related steps in one `Sequence`.

13. **Videos and GIFs advance only when visible and on stage**; `Paused = True` freezes them. Image sequences run
    at 30 fps regardless of source. Seeking a GIF re-reads frames from the start (cost grows with position).

14. **Threading (COM version).** Any stage change from a timer or event handler must be inside
    `LockRenderThread`/`UnlockRenderThread`; forgetting it causes intermittent crashes or half-drawn frames. Keep
    the locked section short; do not create fonts or load large images inside it.

15. **Enums are plain integers over COM.** There are no named constants in VBScript: `SetAlignedPosition 64, 16, 4`
    means Center. Define your own `Const` values at the top of the DMD section if it helps readability.

16. **`FlexDMD.Width/Height` must be set before `Run = True`** (they rebuild the frame). Changing them while
    running restarts the display.

17. **Paths.** `ProjectFolder` is resolved by VPX from the table folder; use `"./Tablename/"` style paths with
    forward slashes. On macOS/Linux (VPX standalone) file names are case sensitive.

18. **There is no Sleep in a table script.** `WScript.Sleep` and `WScript` in general do not exist inside Visual
    Pinball (or the studio). Never block: express delays as `Wait` actions in a `Sequence`, or with VPX timers.

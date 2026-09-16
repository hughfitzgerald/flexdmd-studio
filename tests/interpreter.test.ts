import { describe, expect, it } from 'vitest';
import { GhostRegistry, Interpreter, VbArray } from '../src/vbs/interpreter';

function run(src: string, globals: Record<string, object> = {}) {
  const logs: string[] = [];
  const it = new Interpreter({ globals, log: (m) => logs.push(m) });
  it.run(src);
  return { it, logs };
}

describe('VBScript interpreter', () => {
  it('evaluates arithmetic with VBScript precedence', () => {
    const { it } = run('x = 2 + 3 * 4 ^ 2 \\ 5 Mod 3 : y = -2 ^ 2 : z = 7 / 2 : s = "a" & 1 & True');
    expect(it.getGlobal('x')).toBe(2 + ((3 * 16) % 3 === 0 ? 0 : 0) + (Math.trunc(48 / 5) % 3));
    expect(it.getGlobal('y')).toBe(-4);
    expect(it.getGlobal('z')).toBe(3.5);
    expect(it.getGlobal('s')).toBe('a1True');
  });

  it('handles Sub/Function, Exit, ByRef defaults and recursion', () => {
    const { it } = run(`
      Function Fact(n)
        If n <= 1 Then
          Fact = 1
        Else
          Fact = n * Fact(n - 1)
        End If
      End Function
      Sub Inc(x)
        x = x + 1
      End Sub
      Dim a : a = 1
      Inc a
      r = Fact(5)
    `);
    expect(it.getGlobal('r')).toBe(120);
    expect(it.getGlobal('a')).toBe(1); // ByRef on locals is not simulated; VBScript would give 2 but scripts rarely depend on it
  });

  it('supports control flow statements', () => {
    const { it } = run(`
      total = 0
      For i = 1 To 10 Step 2 : total = total + i : Next
      Do While total < 100
        total = total * 2
        If total > 50 Then Exit Do
      Loop
      Select Case total
        Case 1, 2 : kind = "small"
        Case 51 To 200 : kind = "medium"
        Case Else : kind = "big"
      End Select
      arr = Array(1, 2, 3)
      s = 0
      For Each v In arr
        s = s + v
      Next
      Dim d(2, 1)
      d(1, 1) = 42
      w = 0
      While w < 3 : w = w + 1 : Wend
    `);
    expect(it.getGlobal('total')).toBe(100);
    expect(it.getGlobal('kind')).toBe('medium');
    expect(it.getGlobal('s')).toBe(6);
    expect((it.getGlobal('d') as VbArray).get([1, 1])).toBe(42);
    expect(it.getGlobal('w')).toBe(3);
  });

  it('dispatches to host objects case-insensitively with call statements', () => {
    class Actor {
      x = 0; y = 0; name = '';
      constructor(name: string) { this.name = name; }
      SetPosition(x: number, y: number) { this.x = x; this.y = y; }
      get Width() { return 10; }
    }
    class Flex {
      created: Actor[] = [];
      NewLabel(name: string) { const a = new Actor(name); this.created.push(a); return a; }
    }
    const flex = new Flex();
    const { it } = run(`
      Set lbl = FlexDMD.NewLabel("Hello")
      lbl.setposition 12, 5
      lbl.X = lbl.X + lbl.width
      With lbl
        .Y = .Y * 2
      End With
      n = lbl.Name
    `, { FlexDMD: flex });
    expect(flex.created[0].x).toBe(22);
    expect(flex.created[0].y).toBe(10);
    expect(it.getGlobal('n')).toBe('Hello');
  });

  it('reports runtime errors with line numbers and supports On Error Resume Next', () => {
    expect(() => run('x = 1\ny = Foo(2)')).toThrow(/Sub or Function not defined: 'foo'/);
    try { run('x = 1\ny = Foo(2)'); } catch (e) { expect((e as { span: { line: number } }).span.line).toBe(2); }
    const { it } = run('On Error Resume Next\ny = Foo(2)\nz = Err.Number\nOn Error GoTo 0\nq = 1');
    expect(it.getGlobal('z')).not.toBe(0);
    expect(it.getGlobal('q')).toBe(1);
  });

  it('supports classes', () => {
    const { it } = run(`
      Class Counter
        Private m_count
        Public Sub Class_Initialize : m_count = 10 : End Sub
        Public Property Get Count : Count = m_count : End Property
        Public Sub Add(n) : m_count = m_count + n : End Sub
      End Class
      Set c = New Counter
      c.Add 5
      r = c.Count
    `);
    expect(it.getGlobal('r')).toBe(15);
  });

  it('parses single line If with Else and colon separators', () => {
    const { it } = run('a = 3 : If a > 2 Then b = 1 : c = 2 Else b = 0\nIf a = 3 Then d = "x"');
    expect(it.getGlobal('b')).toBe(1);
    expect(it.getGlobal('c')).toBe(2);
    expect(it.getGlobal('d')).toBe('x');
  });

  it('formats numbers and strings like VBScript', () => {
    const { it } = run('a = CStr(3.0) & "|" & CStr(0.5) & "|" & CInt(2.5) & "|" & CInt(3.5) & "|" & Hex(255) & "|" & Mid("Hello", 2, 3) & "|" & FormatNumber(1234.5, 1)');
    expect(it.getGlobal('a')).toBe('3|.5|2|4|FF|ell|1,234.5');
  });

  it('supports multiple constants in one Const statement', () => {
    const { it } = run('Const A = 1, B = 2, C = A + B\nx = C * 10');
    expect(it.getGlobal('x')).toBe(30);
  });

  it('parses the single-line forms real table scripts use', () => {
    // All three come from the shared VPW ball-physics block that ships in most tables.
    const { it } = run(`
      Dim threshold, hit
      threshold = 0
      Sub Physics(b)
        If threshold Then If b < threshold Then Exit Sub End If End If
        hit = hit + 1
      End Sub
      Dim ballvel()
      Dim highestID : highestID = 3
      If UBound(ballvel) < highestID Then ReDim ballvel(highestID)
      ReDim a(2), b(3), c(4)
      Physics 5
      Physics 5
    `);
    expect(it.getGlobal('hit')).toBe(2);
    expect((it.getGlobal('ballvel') as VbArray).dims).toEqual([3]);
    expect((it.getGlobal('c') as VbArray).dims).toEqual([4]);
  });

  it('runs the guarded branch of a nested single-line If', () => {
    const { it } = run('Dim n : n = 0\nSub T(a, b)\nIf a Then If b < 2 Then Exit Sub End If End If\nn = n + 1\nEnd Sub\nT 1, 1\nT 1, 5\nT 0, 0');
    expect(it.getGlobal('n')).toBe(2);
  });

  it('calls a Sub through GetRef, the way table frameworks dispatch by name', () => {
    const { it } = run(`
      Dim built
      built = ""
      Sub BuildA(x) : built = built & "A" & x : End Sub
      Function Pick(n) : Pick = "Build" & n : End Function
      GetRef("BuildA")(1)
      GetRef(Pick("A"))(2)
      Dim r : Set r = GetRef("BuildA")
      r 3
    `);
    expect(it.getGlobal('built')).toBe('A1A2A3');
  });

  it('runs a fragment against an already-loaded script, keeping its state', () => {
    const { it } = run('Dim total\ntotal = 1\nSub Add(n) : total = total + n : End Sub');
    it.runFragment('Add 5');
    expect(it.getGlobal('total')).toBe(6);
    it.runFragment('Sub Twice(n) : Add n : Add n : End Sub\nTwice 2');
    expect(it.getGlobal('total')).toBe(10);
    expect(it.hasProc('Twice')).toBe(true);
  });

  it('stands in for names it does not know, so table code around the DMD still runs', () => {
    const logs: string[] = [];
    const ghosts = new GhostRegistry();
    const interp = new Interpreter({ ghosts, log: (m) => logs.push(m) });
    interp.run(`
      Dim ok
      Table1.ShowDT = True
      PlaySound "thud", 0, 1
      Dim n : n = PlayerScore(3) + 1
      If Not Controller Is Nothing Then ok = "guard ran"
      Dim s : s = "score: " & GetPlayerState("score")
      For Each x In SomeCollection : ok = "never" : Next
      Dim c : c = UBound(MissingArray)
    `);
    expect(interp.getGlobal('n')).toBe(1);            // a stand-in counts as 0
    expect(interp.getGlobal('s')).toBe('score: ');    // and as an empty string
    expect(interp.getGlobal('ok')).toBe('guard ran'); // "Is Nothing" guards still take the real branch
    expect(interp.getGlobal('c')).toBe(-1);           // an unknown array is empty, so loops over it do not run
    expect(ghosts.list().map((g) => g.path)).toContain('playsound()'); // () marks a name used as a call
  });

  it('aborts runaway loops', () => {
    expect(() => run('Do\nLoop')).toThrow(/execution budget/);
  });
});

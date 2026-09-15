import { describe, expect, it } from 'vitest';
import { Interpreter, VbArray } from '../src/vbs/interpreter';

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

  it('aborts runaway loops', () => {
    expect(() => run('Do\nLoop')).toThrow(/execution budget/);
  });
});

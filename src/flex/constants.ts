// The named constants real table scripts use for FlexDMD's enums.
//
// FlexDMD's COM interface exposes enums that VBScript cannot see by name, so tables declare a
// Const block instead (the one shipped with the VPW example table). The studio pre-defines the
// same names, so a script that references them runs whether or not it carries the block, and the
// editor can offer them as completions and label bare numbers with them.

export interface EnumDef {
  /** Property or argument the constants belong to, e.g. "Alignment" */
  name: string;
  /** Prefix the constants share, e.g. "FlexDMD_Align_" */
  prefix: string;
  /** Short name to numeric value, in declaration order */
  values: [string, number][];
}

export const ENUMS: EnumDef[] = [
  {
    name: 'Alignment',
    prefix: 'FlexDMD_Align_',
    values: [['TopLeft', 0], ['Top', 1], ['TopRight', 2], ['Left', 3], ['Center', 4], ['Right', 5], ['BottomLeft', 6], ['Bottom', 7], ['BottomRight', 8]],
  },
  {
    name: 'Scaling',
    prefix: 'FlexDMD_Scaling_',
    values: [['Fit', 0], ['Fill', 1], ['FillX', 2], ['FillY', 3], ['Stretch', 4], ['StretchX', 5], ['StretchY', 6], ['None', 7]],
  },
  {
    name: 'RenderMode',
    prefix: 'FlexDMD_RenderMode_',
    values: [
      ['DMD_GRAY', 0], ['DMD_GRAY_4', 1], ['DMD_RGB', 2],
      ['SEG_2x16Alpha', 3], ['SEG_2x20Alpha', 4], ['SEG_2x7Alpha_2x7Num', 5], ['SEG_2x7Alpha_2x7Num_4x1Num', 6],
      ['SEG_2x7Num_2x7Num_4x1Num', 7], ['SEG_2x7Num_2x7Num_10x1Num', 8], ['SEG_2x7Num_2x7Num_4x1Num_gen7', 9],
      ['SEG_2x7Num10_2x7Num10_4x1Num', 10], ['SEG_2x6Num_2x6Num_4x1Num', 11], ['SEG_2x6Num10_2x6Num10_4x1Num', 12],
      ['SEG_4x7Num10', 13], ['SEG_6x4Num_4x1Num', 14], ['SEG_2x7Num_4x1Num_1x16Alpha', 15], ['SEG_1x16Alpha_1x16Num_1x7Num', 16],
    ],
  },
  {
    name: 'Ease',
    prefix: 'FlexDMD_Interpolation_',
    values: [
      ['Linear', 0], ['ElasticIn', 1], ['ElasticOut', 2], ['ElasticInOut', 3], ['QuadIn', 4], ['QuadOut', 5], ['QuadInOut', 6],
      ['CubeIn', 7], ['CubeOut', 8], ['CubeInOut', 9], ['QuartIn', 10], ['QuartOut', 11], ['QuartInOut', 12],
      ['QuintIn', 13], ['QuintOut', 14], ['QuintInOut', 15], ['SineIn', 16], ['SineOut', 17], ['SineInOut', 18],
      ['BounceIn', 19], ['BounceOut', 20], ['BounceInOut', 21], ['CircIn', 22], ['CircOut', 23], ['CircInOut', 24],
      ['ExpoIn', 25], ['ExpoOut', 26], ['ExpoInOut', 27], ['BackIn', 28], ['BackOut', 29], ['BackInOut', 30],
    ],
  },
];

/** Every constant as a flat name -> value map, ready to seed the interpreter's globals. */
export function constantGlobals(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of ENUMS) for (const [n, v] of e.values) out[e.prefix + n] = v;
  return out;
}

/** The enum a property or argument name belongs to. */
export function enumFor(name: string): EnumDef | undefined {
  const n = name.toLowerCase();
  return ENUMS.find((e) => e.name.toLowerCase() === n);
}

/** Short label for a numeric value, e.g. Alignment 4 -> "Center". */
export function labelFor(e: EnumDef, value: number): string | undefined {
  return e.values.find(([, v]) => v === value)?.[0];
}

/** The Const block to paste into a table script so it stays portable to VPX. */
export function constBlock(): string {
  return ENUMS.map((e) => {
    const lines = e.values.map(([n, v]) => `${e.prefix}${n} = ${v}`);
    return `' FlexDMD ${e.name}\nConst ${lines.join(', _\n')}`;
  }).join('\n\n') + '\n';
}

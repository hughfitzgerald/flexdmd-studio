// Ported from FlexDMD (https://github.com/vbousquet/flexdmd), Copyright 2019 Vincent Bousquet,
// licensed under the Apache License 2.0. TypeScript translation of FlexDMD/Glide/Ease.cs, modified
// from the original. See the NOTICE file at the repository root.
// Port of the Glide easing functions used by FlexDMD (FlexDMD/Glide/Ease.cs)

export enum Interpolation {
  Linear = 0,
  ElasticIn, ElasticOut, ElasticInOut,
  QuadIn, QuadOut, QuadInOut,
  CubeIn, CubeOut, CubeInOut,
  QuartIn, QuartOut, QuartInOut,
  QuintIn, QuintOut, QuintInOut,
  SineIn, SineOut, SineInOut,
  BounceIn, BounceOut, BounceInOut,
  CircIn, CircOut, CircInOut,
  ExpoIn, ExpoOut, ExpoInOut,
  BackIn, BackOut, BackInOut,
}

export const InterpolationNames = [
  'Linear', 'ElasticIn', 'ElasticOut', 'ElasticInOut', 'QuadIn', 'QuadOut', 'QuadInOut', 'CubeIn', 'CubeOut', 'CubeInOut',
  'QuartIn', 'QuartOut', 'QuartInOut', 'QuintIn', 'QuintOut', 'QuintInOut', 'SineIn', 'SineOut', 'SineInOut',
  'BounceIn', 'BounceOut', 'BounceInOut', 'CircIn', 'CircOut', 'CircInOut', 'ExpoIn', 'ExpoOut', 'ExpoInOut', 'BackIn', 'BackOut', 'BackInOut',
];

const PI = Math.PI;
const PI2 = Math.PI / 2;
const B1 = 1 / 2.75, B2 = 2 / 2.75, B3 = 1.5 / 2.75, B4 = 2.5 / 2.75, B5 = 2.25 / 2.75, B6 = 2.625 / 2.75;

type Easer = (t: number) => number;

const easers: Record<Interpolation, Easer> = {
  [Interpolation.Linear]: (t) => t,
  [Interpolation.ElasticIn]: (t) => Math.sin(13 * PI2 * t) * Math.pow(2, 10 * (t - 1)),
  [Interpolation.ElasticOut]: (t) => (t === 1 ? 1 : Math.sin(-13 * PI2 * (t + 1)) * Math.pow(2, -10 * t) + 1),
  [Interpolation.ElasticInOut]: (t) => (t < 0.5 ? 0.5 * Math.sin(13 * PI2 * (2 * t)) * Math.pow(2, 10 * (2 * t - 1)) : 0.5 * (Math.sin(-13 * PI2 * (2 * t - 1 + 1)) * Math.pow(2, -10 * (2 * t - 1)) + 2)),
  [Interpolation.QuadIn]: (t) => t * t,
  [Interpolation.QuadOut]: (t) => -t * (t - 2),
  [Interpolation.QuadInOut]: (t) => (t <= 0.5 ? t * t * 2 : 1 - (--t) * t * 2),
  [Interpolation.CubeIn]: (t) => t * t * t,
  [Interpolation.CubeOut]: (t) => 1 + (--t) * t * t,
  [Interpolation.CubeInOut]: (t) => (t <= 0.5 ? t * t * t * 4 : 1 + (--t) * t * t * 4),
  [Interpolation.QuartIn]: (t) => t * t * t * t,
  [Interpolation.QuartOut]: (t) => 1 - (t -= 1) * t * t * t,
  [Interpolation.QuartInOut]: (t) => (t <= 0.5 ? t * t * t * t * 8 : (1 - (t = t * 2 - 2) * t * t * t) / 2 + 0.5),
  [Interpolation.QuintIn]: (t) => t * t * t * t * t,
  [Interpolation.QuintOut]: (t) => (t = t - 1) * t * t * t * t + 1,
  [Interpolation.QuintInOut]: (t) => ((t *= 2) < 1 ? (t * t * t * t * t) / 2 : ((t -= 2) * t * t * t * t + 2) / 2),
  [Interpolation.SineIn]: (t) => (t === 1 ? 1 : -Math.cos(PI2 * t) + 1),
  [Interpolation.SineOut]: (t) => Math.sin(PI2 * t),
  [Interpolation.SineInOut]: (t) => -Math.cos(PI * t) / 2 + 0.5,
  [Interpolation.BounceIn]: (t) => {
    t = 1 - t;
    if (t < B1) return 1 - 7.5625 * t * t;
    if (t < B2) return 1 - (7.5625 * (t - B3) * (t - B3) + 0.75);
    if (t < B4) return 1 - (7.5625 * (t - B5) * (t - B5) + 0.9375);
    return 1 - (7.5625 * (t - B6) * (t - B6) + 0.984375);
  },
  [Interpolation.BounceOut]: (t) => {
    if (t < B1) return 7.5625 * t * t;
    if (t < B2) return 7.5625 * (t - B3) * (t - B3) + 0.75;
    if (t < B4) return 7.5625 * (t - B5) * (t - B5) + 0.9375;
    return 7.5625 * (t - B6) * (t - B6) + 0.984375;
  },
  [Interpolation.BounceInOut]: (t) => {
    if (t < 0.5) {
      t = 1 - t * 2;
      if (t < B1) return (1 - 7.5625 * t * t) / 2;
      if (t < B2) return (1 - (7.5625 * (t - B3) * (t - B3) + 0.75)) / 2;
      if (t < B4) return (1 - (7.5625 * (t - B5) * (t - B5) + 0.9375)) / 2;
      return (1 - (7.5625 * (t - B6) * (t - B6) + 0.984375)) / 2;
    }
    t = t * 2 - 1;
    if (t < B1) return (7.5625 * t * t) / 2 + 0.5;
    if (t < B2) return (7.5625 * (t - B3) * (t - B3) + 0.75) / 2 + 0.5;
    if (t < B4) return (7.5625 * (t - B5) * (t - B5) + 0.9375) / 2 + 0.5;
    return (7.5625 * (t - B6) * (t - B6) + 0.984375) / 2 + 0.5;
  },
  [Interpolation.CircIn]: (t) => -(Math.sqrt(1 - t * t) - 1),
  [Interpolation.CircOut]: (t) => Math.sqrt(1 - (t - 1) * (t - 1)),
  [Interpolation.CircInOut]: (t) => (t <= 0.5 ? (Math.sqrt(1 - t * t * 4) - 1) / -2 : (Math.sqrt(1 - (t * 2 - 2) * (t * 2 - 2)) + 1) / 2),
  [Interpolation.ExpoIn]: (t) => Math.pow(2, 10 * (t - 1)),
  [Interpolation.ExpoOut]: (t) => (t === 1 ? 1 : -Math.pow(2, -10 * t) + 1),
  [Interpolation.ExpoInOut]: (t) => (t === 1 ? 1 : t < 0.5 ? Math.pow(2, 10 * (t * 2 - 1)) / 2 : (-Math.pow(2, -10 * (t * 2 - 1)) + 2) / 2),
  [Interpolation.BackIn]: (t) => t * t * (2.70158 * t - 1.70158),
  [Interpolation.BackOut]: (t) => 1 - (--t) * t * (-2.70158 * t - 1.70158),
  [Interpolation.BackInOut]: (t) => {
    t *= 2;
    if (t < 1) return (t * t * (2.70158 * t - 1.70158)) / 2;
    t--;
    return (1 - (--t) * t * (-2.70158 * t - 1.70158)) / 2 + 0.5;
  },
};

export function ease(mode: Interpolation, t: number): number {
  const f = easers[mode] ?? easers[Interpolation.Linear];
  return f(t);
}

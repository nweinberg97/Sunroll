/**
 * The sky at a given local time: colours, where the sun (or moon) sits on its arc, and which
 * text colour stays readable on top. Pure, so it is tested, including for contrast.
 *
 * The sky follows the clock, not the viewer's location (no permissions, no data): a gentle
 * stylisation of a day, sunrise around 6:30 and sunset around 19:30.
 */

type Rgb = [number, number, number];

interface Keyframe {
  minute: number;
  top: Rgb;
  bottom: Rgb;
}

const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// Night → pre-dawn → dawn → morning → midday → golden hour → dusk → twilight → night.
const KEYFRAMES: Keyframe[] = [
  { minute: 0, top: hex('#0b0a1f'), bottom: hex('#1d1846') },
  { minute: 300, top: hex('#14123a'), bottom: hex('#3a2a5e') },
  { minute: 390, top: hex('#3b3370'), bottom: hex('#ff9f7a') },
  { minute: 480, top: hex('#8fb3ff'), bottom: hex('#ffd8bd') },
  { minute: 720, top: hex('#bcd6ff'), bottom: hex('#fff3dc') },
  { minute: 1020, top: hex('#a9c4ff'), bottom: hex('#ffe2a8') },
  { minute: 1140, top: hex('#5a3fa0'), bottom: hex('#ff9a6b') },
  { minute: 1230, top: hex('#231c52'), bottom: hex('#7a3f7a') },
  { minute: 1320, top: hex('#0e0c27'), bottom: hex('#241d4f') },
  { minute: 1440, top: hex('#0b0a1f'), bottom: hex('#1d1846') },
];

/** Opacity of the soft scrim behind the hero copy (see .sky-copy::before). */
export const SCRIM = 0.4;

export const SUNRISE = 390;
export const SUNSET = 1170;

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;
}

const css = (c: Rgb) => `rgb(${c[0]} ${c[1]} ${c[2]})`;

/** WCAG relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

export const INK: Rgb = hex('#15132b');
export const PAPER: Rgb = hex('#fff8ec');

export interface Sky {
  top: string;
  bottom: string;
  /** The colour behind the headline: where text actually sits. */
  behindText: Rgb;
  /** Text colour that stays readable on this sky. */
  text: 'ink' | 'paper';
  /** The body on its arc: x from 0 (left) to 1 (right), height from 0 (horizon) to 1 (top). */
  body: 'sun' | 'moon';
  x: number;
  height: number;
  /** 0 by day, up to 1 in deep night: how visible the stars are. */
  stars: number;
  phase: 'night' | 'dawn' | 'day' | 'dusk';
}

export function skyAt(minuteOfDay: number): Sky {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  let i = 0;
  while (i < KEYFRAMES.length - 2 && KEYFRAMES[i + 1].minute <= m) i++;
  const a = KEYFRAMES[i];
  const b = KEYFRAMES[i + 1];
  const t = (m - a.minute) / (b.minute - a.minute);
  const top = mix(a.top, b.top, t);
  const bottom = mix(a.bottom, b.bottom, t);
  // Headlines sit in the upper third of the sky, on a soft scrim (SCRIM opacity) of the
  // opposite tone, so they stay readable even as the sky passes through mid-tones at dawn and dusk.
  const sky = mix(top, bottom, 0.3);
  const text = contrast(INK, sky) >= contrast(PAPER, sky) ? 'ink' : 'paper';
  const behindText = mix(sky, text === 'ink' ? PAPER : INK, SCRIM);

  const isDay = m >= SUNRISE && m < SUNSET;
  let progress: number;
  if (isDay) progress = (m - SUNRISE) / (SUNSET - SUNRISE);
  else {
    const nightLength = 1440 - (SUNSET - SUNRISE);
    progress = (((m - SUNSET + 1440) % 1440) / nightLength);
  }
  const height = Math.sin(progress * Math.PI);
  const stars = isDay ? 0 : Math.min(1, Math.max(0, 1 - Math.abs(progress - 0.5) * 2.2 + 0.25));
  const phase = m < 300 || m >= 1290 ? 'night' : m < 480 ? 'dawn' : m < 1080 ? 'day' : 'dusk';
  return { top: css(top), bottom: css(bottom), behindText, text, body: isDay ? 'sun' : 'moon', x: progress, height, stars, phase };
}

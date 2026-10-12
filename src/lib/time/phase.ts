/**
 * Time of day as a colour story: night → dawn → day → dusk.
 * Used to paint each person's lane in their own local time.
 */
import { inRange, type DayRange } from './ranges';

export type Phase = 'night' | 'dawn' | 'day' | 'dusk';

export const PHASES: Record<Phase, DayRange> = {
  dawn: { start: 5 * 60, end: 8 * 60 },
  day: { start: 8 * 60, end: 17 * 60 },
  dusk: { start: 17 * 60, end: 21 * 60 },
  night: { start: 21 * 60, end: 5 * 60 },
};

/** The phase of the day for a local minute-of-day. */
export function phaseOf(minute: number): Phase {
  if (inRange(minute, PHASES.dawn)) return 'dawn';
  if (inRange(minute, PHASES.day)) return 'day';
  if (inRange(minute, PHASES.dusk)) return 'dusk';
  return 'night';
}

/** A small glyph for the phase, for places where colour can't carry meaning alone. */
export function phaseGlyph(phase: Phase): string {
  switch (phase) {
    case 'night':
      return '☾';
    case 'dawn':
      return '◒';
    case 'day':
      return '☀';
    case 'dusk':
      return '◓';
  }
}

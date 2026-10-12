/**
 * Minute-of-day ranges that may wrap past midnight, e.g. sleep 23:00–07:00.
 * Pure arithmetic on wall-clock minutes; no time zones involved.
 */
import { DAY_MINUTES } from './zone';

export interface DayRange {
  /** Minutes after midnight, 0–1439. */
  start: number;
  /** Minutes after midnight, 0–1440. end <= start wraps past midnight. */
  end: number;
}

/** True if a minute-of-day falls inside the range (start inclusive, end exclusive). */
export function inRange(minute: number, range: DayRange): boolean {
  const m = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  if (range.start === range.end) return false;
  if (range.start < range.end) return m >= range.start && m < range.end;
  return m >= range.start || m < range.end;
}

/**
 * Minutes of the local interval [from, from + length) that fall inside the range.
 * `from` is a minute-of-day; the interval may run past midnight (length up to 1440).
 */
export function minutesInside(from: number, length: number, range: DayRange): number {
  if (range.start === range.end || length <= 0) return 0;
  const segments: Array<[number, number]> =
    range.start < range.end
      ? [[range.start, range.end]]
      : [
          [range.start, DAY_MINUTES],
          [0, range.end],
        ];
  const a = ((from % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const b = a + length;
  let inside = 0;
  for (const [s, e] of segments) {
    // The interval may extend into the next day; check both copies of the segment.
    for (const shift of [0, DAY_MINUTES]) {
      const lo = Math.max(a, s + shift);
      const hi = Math.min(b, e + shift);
      if (hi > lo) inside += hi - lo;
    }
  }
  return Math.min(inside, length);
}

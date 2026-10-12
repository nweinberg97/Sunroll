/**
 * Event slots: the set of instants a group can choose from.
 *
 * An event is defined by its organizer in their own zone: a set of calendar dates and a
 * daily window of wall-clock time. Each date's window is converted to instants and cut
 * into fixed-length slots. Because the window is defined in wall-clock time, a day with a
 * DST change inside the window simply has one slot-hour more or less, as in real life.
 */
import { DAY_MINUTES, MINUTE, type Instant, type IsoDate, type Zone, toInstant } from './zone';

export interface EventShape {
  timezone: Zone;
  dates: IsoDate[];
  /** Window start, minutes after local midnight (0–1439). */
  windowStartMin: number;
  /** Window end, minutes after local midnight (0–1440). end <= start means the window crosses midnight. */
  windowEndMin: number;
  slotMinutes: number;
}

/** Length of the daily window in minutes, as wall-clock time. */
export function windowLength(startMin: number, endMin: number): number {
  const len = endMin - startMin;
  return len > 0 ? len : len + DAY_MINUTES;
}

/** Every slot start in the event, as sorted, de-duplicated instants. */
export function eventSlots(shape: EventShape): Instant[] {
  const { timezone, dates, windowStartMin, windowEndMin, slotMinutes } = shape;
  if (slotMinutes <= 0 || DAY_MINUTES % slotMinutes !== 0) {
    throw new RangeError(`slotMinutes must divide a day: ${slotMinutes}`);
  }
  const step = slotMinutes * MINUTE;
  const crosses = windowEndMin <= windowStartMin;
  const seen = new Set<number>();
  for (const date of dates) {
    const start = toInstant(date, windowStartMin, timezone);
    // toInstant rolls minutes ≥ 1440 onto the next date, so 24:00 and cross-midnight ends just work.
    const end = toInstant(date, crosses ? windowEndMin + DAY_MINUTES : windowEndMin, timezone);
    for (let t = start; t + step <= end; t += step) seen.add(t);
  }
  return [...seen].sort((a, b) => a - b);
}

/** Slot starts covering [start, start + durationMinutes), or null if any are missing from the event. */
export function slotsCovering(
  start: Instant,
  durationMinutes: number,
  slotMinutes: number,
  available: ReadonlySet<Instant>,
): Instant[] | null {
  const n = Math.ceil(durationMinutes / slotMinutes);
  const out: Instant[] = [];
  for (let i = 0; i < n; i++) {
    const t = start + i * slotMinutes * MINUTE;
    if (!available.has(t)) return null;
    out.push(t);
  }
  return out;
}

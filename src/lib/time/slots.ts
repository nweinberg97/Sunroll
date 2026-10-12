/**
 * Event slots: the set of instants a group can choose from.
 *
 * An event is defined by its organizer in their own zone: a set of calendar dates and a
 * daily window of wall-clock time. Each date's window is converted to instants and cut
 * into fixed-length slots. Because the window is defined in wall-clock time, a day with a
 * DST change inside the window simply has one slot-hour more or less, as in real life.
 */
import { DAY_MINUTES, MINUTE, type Instant, type IsoDate, type Zone, toInstant } from './zone';

/** One day the group can choose from, with its own window of wall-clock time. */
export interface DayWindow {
  /** Organizer-local calendar date. */
  date: IsoDate;
  /** Window start, minutes after local midnight (0–1439). */
  startMin: number;
  /** Window end, minutes after local midnight (0–1440). end <= start means the window crosses midnight. */
  endMin: number;
}

export interface EventShape {
  timezone: Zone;
  /** Each day and its own window. Days may have different windows ("Mon 6–8 pm, Wed noon–2 pm"). */
  days: DayWindow[];
  slotMinutes: number;
}

/** The same window on every one of `dates`. */
export function everyDay(dates: IsoDate[], startMin: number, endMin: number): DayWindow[] {
  return dates.map((date) => ({ date, startMin, endMin }));
}

/** Length of a daily window in minutes, as wall-clock time. */
export function windowLength(startMin: number, endMin: number): number {
  const len = endMin - startMin;
  return len > 0 ? len : len + DAY_MINUTES;
}

/** True if every day uses the same window. */
export function isUniform(days: DayWindow[]): boolean {
  return days.every((d) => d.startMin === days[0].startMin && d.endMin === days[0].endMin);
}

/** Every slot start in the event, as sorted, de-duplicated instants. */
export function eventSlots(shape: EventShape): Instant[] {
  const { timezone, days, slotMinutes } = shape;
  if (slotMinutes <= 0 || DAY_MINUTES % slotMinutes !== 0) {
    throw new RangeError(`slotMinutes must divide a day: ${slotMinutes}`);
  }
  const step = slotMinutes * MINUTE;
  const seen = new Set<number>();
  for (const { date, startMin, endMin } of days) {
    const crosses = endMin <= startMin;
    const start = toInstant(date, startMin, timezone);
    // toInstant rolls minutes ≥ 1440 onto the next date, so 24:00 and cross-midnight ends just work.
    const end = toInstant(date, crosses ? endMin + DAY_MINUTES : endMin, timezone);
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

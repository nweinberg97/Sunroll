/**
 * Booking links: which start times a visitor may book.
 *
 * Pure and built on the same time engine as "Find a time": working hours are wall-clock
 * times in the host's zone (so they follow DST), and everything else is UTC instants.
 */
import { addDays, MINUTE, offsetAt, toInstant, wallTime, weekdayOf, type Instant, type IsoDate, type Zone } from '../time/zone';

export interface Interval {
  start: Instant;
  end: Instant;
}

/** Wall-clock windows per ISO weekday (1 = Monday … 7 = Sunday), in the host's zone. */
export type WeeklyHours = Record<number, { start: number; end: number }[]>;

export interface SlotRules {
  zone: Zone;
  hours: WeeklyHours;
  durationMin: number;
  /** Free time kept before and after every busy block and booking. */
  bufferMin: number;
  /** How far ahead a booking must be made. */
  minNoticeMin: number;
  /** Most bookings of this type per host-local day; null for no limit. */
  dailyLimit: number | null;
  /** Spacing between offered start times. */
  stepMin: number;
}

export const WORKDAYS = (start: number, end: number): WeeklyHours => ({ 1: [{ start, end }], 2: [{ start, end }], 3: [{ start, end }], 4: [{ start, end }], 5: [{ start, end }], 6: [], 7: [] });

/** Sort and merge overlapping or touching intervals. */
export function mergeIntervals(list: readonly Interval[]): Interval[] {
  const sorted = [...list].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

function overlaps(s: Instant, e: Instant, busy: readonly Interval[], bufferMin: number): boolean {
  const pad = bufferMin * MINUTE;
  for (const b of busy) if (s < b.end + pad && e + pad > b.start) return true;
  return false;
}

/**
 * Every bookable start time, from the host-local date `from` for `days` days.
 * `busy` is every busy block across the host's calendars; `bookings` are existing Sunroll
 * bookings of this event type (they count toward the daily limit as well as being busy).
 */
export function bookableSlots(
  rules: SlotRules,
  opts: { from: IsoDate; days: number; now: Instant; busy: readonly Interval[]; bookings: readonly Interval[] },
): Instant[] {
  const { zone, hours, durationMin, bufferMin, minNoticeMin, dailyLimit, stepMin } = rules;
  const busy = mergeIntervals([...opts.busy, ...opts.bookings]);
  const earliest = opts.now + minNoticeMin * MINUTE;
  const perDay = new Map<IsoDate, number>();
  for (const b of opts.bookings) {
    const d = wallTime(b.start, zone).date;
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
  }
  const seen = new Set<Instant>();
  for (let i = 0; i < opts.days; i++) {
    const date = addDays(opts.from, i);
    if (dailyLimit !== null && (perDay.get(date) ?? 0) >= dailyLimit) continue;
    for (const w of hours[weekdayOf(date)] ?? []) {
      const windowEnd = toInstant(date, w.end, zone);
      for (let m = w.start; m + durationMin <= w.end; m += stepMin) {
        const s = toInstant(date, m, zone);
        const e = s + durationMin * MINUTE;
        // A start inside a spring-forward gap resolves later; keep only real, in-window, on-day starts.
        if (e > windowEnd || wallTime(s, zone).date !== date) continue;
        if (s < earliest || seen.has(s)) continue;
        if (overlaps(s, e, busy, bufferMin)) continue;
        seen.add(s);
      }
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/** Is this exact start still bookable? Used to re-check at the moment of booking. */
export function isBookable(rules: SlotRules, start: Instant, opts: { now: Instant; busy: readonly Interval[]; bookings: readonly Interval[] }): boolean {
  const date = wallTime(start, rules.zone).date;
  return bookableSlots(rules, { from: date, days: 1, ...opts }).includes(start);
}

/** "Nadia is 16 hours ahead of you" — the signed difference in whole and half hours. */
export function hoursApart(hostZone: Zone, visitorZone: Zone, at: Instant): number {
  return (offsetAt(at, hostZone) - offsetAt(at, visitorZone)) / 60;
}

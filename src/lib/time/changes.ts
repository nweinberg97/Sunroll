/**
 * Clock changes (DST and rule changes) that fall inside an event, for each zone in the group.
 * These are only used to *tell* people; every conversion already follows the zone rules.
 */
import { addDays, cityOf, MINUTE, offsetAt, wallTime, type Instant, type IsoDate, type Zone } from './zone';

export interface ClockChange {
  zone: Zone;
  city: string;
  /** The first instant on the new offset. */
  at: Instant;
  /** Local date of the change, in that zone. */
  localDate: IsoDate;
  /** Positive when clocks go forward, negative when they go back, in minutes. */
  shift: number;
}

const HOUR = 60 * MINUTE;

/** Every offset change for these zones between two dates (inclusive), to the minute. */
export function clockChanges(zones: Zone[], from: IsoDate, to: IsoDate): ClockChange[] {
  const start = Date.parse(`${addDays(from, -1)}T00:00:00Z`);
  const end = Date.parse(`${addDays(to, 2)}T00:00:00Z`);
  const out: ClockChange[] = [];
  for (const zone of [...new Set(zones)]) {
    let prev = offsetAt(start, zone);
    for (let t = start + HOUR; t <= end; t += HOUR) {
      const o = offsetAt(t, zone);
      if (o === prev) continue;
      // Narrow to the exact minute of the change.
      let lo = t - HOUR;
      let hi = t;
      while (hi - lo > MINUTE) {
        const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE;
        if (offsetAt(mid, zone) === prev) lo = mid;
        else hi = mid;
      }
      const localDate = wallTime(hi, zone).date;
      if (localDate >= from && localDate <= addDays(to, 1)) out.push({ zone, city: cityOf(zone), at: hi, localDate, shift: o - prev });
      prev = o;
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** "Clocks go back 1 hour in London" */
export function describeChange(c: ClockChange): string {
  const amount = Math.abs(c.shift) === 60 ? '1 hour' : Math.abs(c.shift) % 60 === 0 ? `${Math.abs(c.shift) / 60} hours` : `${Math.abs(c.shift)} minutes`;
  return `Clocks go ${c.shift > 0 ? 'forward' : 'back'} ${amount} in ${c.city}`;
}

/**
 * Rule changes recent enough that some devices may not have them yet. If this device still
 * answers with the old rule, we tell people to update, rather than silently showing wrong times.
 * Each entry: a zone, an instant after the change, and the offset the *current* rules give.
 */
const RECENT_RULES: { zone: Zone; at: Instant; expectedOffset: number; note: string }[] = [
  // British Columbia moved to permanent daylight time in 2026 (UTC−7 all year).
  { zone: 'America/Vancouver', at: Date.parse('2026-11-15T12:00:00Z'), expectedOffset: -420, note: 'B.C. stays on daylight time from 2026' },
];

export function outdatedZoneData(zones: Zone[]): { zone: Zone; note: string }[] {
  return RECENT_RULES.filter((r) => zones.includes(r.zone) && offsetAt(r.at, r.zone) !== r.expectedOffset).map((r) => ({ zone: r.zone, note: r.note }));
}

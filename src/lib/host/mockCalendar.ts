/**
 * Stand-in for Google Calendar free/busy in demo mode: believable, deterministic busy blocks
 * for each calendar, generated from the date and a seed. Only busy times exist, never event
 * details, matching what the real free/busy API returns.
 */
import { addDays, toInstant, weekdayOf, type IsoDate, type Zone } from '../time/zone';
import type { Interval } from '../booking/slots';

export type MockKind = 'work' | 'personal' | 'family' | 'holidays' | 'team';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Wall-clock busy ranges [startMin, endMin] for one calendar on one date. */
export function mockDay(kind: MockKind, seed: string, date: IsoDate): [number, number][] {
  const wd = weekdayOf(date);
  const r = (n: number) => hash(`${seed}|${date}|${n}`) % 100;
  const weekday = wd <= 5;
  const out: [number, number][] = [];
  switch (kind) {
    case 'work':
      if (!weekday) break;
      if (wd === 1 || wd === 3 || wd === 5) out.push([600, 630]); // 10:00 standup
      if (wd === 2 || wd === 4) out.push([840, 930]); // 2:00–3:30 planning
      if (r(1) < 55) out.push([660 + (r(2) % 4) * 30, 720 + (r(2) % 4) * 30]); // a late-morning meeting
      if (r(3) < 45) out.push([930 + (r(4) % 3) * 30, 990 + (r(4) % 3) * 30]); // an afternoon call
      break;
    case 'personal':
      if (weekday && r(1) < 40) out.push([720, 780]); // lunch
      if (wd === 2 || wd === 4) out.push([1110, 1200]); // 6:30–8:00 pm class
      if (r(2) < 20) out.push([480, 540]); // dentist, gym…
      break;
    case 'family':
      if (!weekday) out.push([600, 840]);
      if (wd === 3 && r(1) < 60) out.push([1020, 1080]); // school pickup
      break;
    case 'team':
      if (weekday && r(1) < 25) out.push([780, 840]);
      break;
    case 'holidays':
      if (r(1) < 6) out.push([0, 1440]);
      break;
  }
  return out;
}

/** Busy instants for a calendar over a host-local date range. */
export function mockBusy(kind: MockKind, seed: string, zone: Zone, from: IsoDate, days: number): Interval[] {
  const out: Interval[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    for (const [s, e] of mockDay(kind, seed, date)) out.push({ start: toInstant(date, s, zone), end: toInstant(date, e, zone) });
  }
  return out;
}

/**
 * The only module that talks to the time zone database.
 *
 * Every conversion between an instant (UTC milliseconds) and a wall-clock time in an
 * IANA zone goes through here. Zone rules come from the platform's ICU tz database via
 * Intl.DateTimeFormat (the same source Luxon and the Temporal polyfill read). Nothing here
 * reads the device's own time zone: callers always pass a zone explicitly.
 *
 * Arithmetic between instants is done on UTC milliseconds, which is always correct.
 * Arithmetic on calendar dates is done on ISO date strings via UTC, which has no DST.
 */

/** An IANA time zone name, e.g. "America/Vancouver". Never a fixed offset. */
export type Zone = string;
/** A calendar date, "YYYY-MM-DD". */
export type IsoDate = string;
/** An instant, as milliseconds since the Unix epoch (UTC). */
export type Instant = number;

export const MINUTE = 60_000;
export const DAY_MINUTES = 1440;

export interface WallTime {
  /** Local calendar date in the zone. */
  date: IsoDate;
  /** Minutes after local midnight, 0–1439. */
  minute: number;
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** UTC offset in minutes at that instant (e.g. -420 for PDT, 345 for Nepal). */
  offset: number;
}

const validity = new Map<string, boolean>();

/** True if the platform knows this IANA zone. */
export function isValidZone(zone: string): boolean {
  if (typeof zone !== 'string' || zone.length === 0 || zone.length > 64) return false;
  const cached = validity.get(zone);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    // Reject bare offsets like "+05:30": we only ever store named zones.
    ok = /^[A-Za-z]/.test(zone);
  } catch {
    ok = false;
  }
  validity.set(zone, ok);
  return ok;
}

function assertZone(zone: Zone): void {
  if (!isValidZone(zone)) throw new RangeError(`Unknown time zone: ${zone}`);
}

/** Add whole days to a calendar date. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = parseDate(date);
  const t = Date.UTC(y, m - 1, d + days);
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const [ay, am, ad] = parseDate(a);
  const [by, bm, bd] = parseDate(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** ISO weekday (1 = Monday) of a calendar date. */
export function weekdayOf(date: IsoDate): number {
  const [y, m, d] = parseDate(date);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = parseDate(value);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function parseDate(date: IsoDate): [number, number, number] {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return [y, m, d];
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: Zone): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, f);
  }
  return f;
}

/** Wall-clock fields of an instant in a zone, read from the tz database. */
function fields(instant: Instant, zone: Zone): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const out = { y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 0 };
  for (const p of formatter(zone).formatToParts(new Date(instant))) {
    const v = Number(p.value);
    if (p.type === 'year') out.y = v;
    else if (p.type === 'month') out.mo = v;
    else if (p.type === 'day') out.d = v;
    else if (p.type === 'hour') out.h = v === 24 ? 0 : v;
    else if (p.type === 'minute') out.mi = v;
    else if (p.type === 'second') out.s = v;
  }
  return out;
}

/** UTC offset of a zone at an instant, in whole minutes. */
function offsetMinutes(instant: Instant, zone: Zone): number {
  const f = fields(instant, zone);
  const asUtc = Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi, f.s);
  const whole = instant - (((instant % 1000) + 1000) % 1000);
  return Math.round((asUtc - whole) / MINUTE);
}

/**
 * The instant at which a wall-clock time occurs in a zone.
 *
 * `minute` may be ≥ 1440 or negative; it rolls onto adjacent dates.
 * Disambiguation follows Temporal's "compatible" rule:
 *  - a time skipped by a spring-forward gap resolves to the time shifted forward by the gap
 *    (2:30 am on a 2→3 am jump becomes 3:30 am);
 *  - a time repeated by a fall-back resolves to its first (earlier) occurrence.
 */
export function toInstant(date: IsoDate, minute: number, zone: Zone): Instant {
  assertZone(zone);
  const [y, m, d] = parseDate(date);
  // The wall time read as if it were UTC.
  const local = Date.UTC(y, m - 1, d) + minute * MINUTE;
  // Offsets in force a day either side cover every transition the wall time could fall in.
  const before = offsetMinutes(local - 1440 * MINUTE, zone);
  const after = offsetMinutes(local + 1440 * MINUTE, zone);
  const valid: Instant[] = [];
  for (const o of before === after ? [before] : [before, after]) {
    const t = local - o * MINUTE;
    if (offsetMinutes(t, zone) === o) valid.push(t);
  }
  if (valid.length > 0) return Math.min(...valid); // repeated time: the earlier one
  // Skipped time (gap): read it with the offset from before the jump, which lands after it.
  return local - before * MINUTE;
}

/** The wall-clock reading of an instant in a zone. */
export function wallTime(instant: Instant, zone: Zone): WallTime {
  assertZone(zone);
  const f = fields(instant, zone);
  const date = `${String(f.y).padStart(4, '0')}-${pad(f.mo)}-${pad(f.d)}`;
  return {
    date,
    minute: f.h * 60 + f.mi,
    weekday: weekdayOf(date),
    offset: offsetMinutes(instant, zone),
  };
}

/** UTC offset of a zone at an instant, in minutes. */
export function offsetAt(instant: Instant, zone: Zone): number {
  return wallTime(instant, zone).offset;
}

/** "UTC+5:45", "UTC−7", "UTC" */
export function formatOffset(offset: number): string {
  if (offset === 0) return 'UTC';
  const sign = offset > 0 ? '+' : '−';
  const abs = Math.abs(offset);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${pad(m)}` : ''}`;
}

const CITY_OVERRIDES: Record<string, string> = {
  'Etc/UTC': 'UTC',
  'Etc/GMT': 'UTC',
  UTC: 'UTC',
  'Asia/Calcutta': 'Kolkata',
  'Asia/Kolkata': 'Kolkata',
  'Asia/Saigon': 'Ho Chi Minh City',
  'Asia/Katmandu': 'Kathmandu',
  'America/St_Johns': "St. John's",
  'Europe/Kiev': 'Kyiv',
  'Europe/Kyiv': 'Kyiv',
};

/** A human place name for a zone: "America/Vancouver" → "Vancouver". */
export function cityOf(zone: Zone): string {
  if (CITY_OVERRIDES[zone]) return CITY_OVERRIDES[zone];
  const last = zone.split('/').pop() ?? zone;
  return last.replace(/_/g, ' ');
}

/** The minute-of-day reading of an instant in a zone. Convenience for the UI. */
export function minuteIn(instant: Instant, zone: Zone): number {
  return wallTime(instant, zone).minute;
}

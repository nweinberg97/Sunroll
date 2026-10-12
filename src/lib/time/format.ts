/**
 * Human formatting for times and dates. Pure: locale and clock style are parameters,
 * so formatting is deterministic in tests and never depends on the device's zone.
 */
import { formatOffset, cityOf, wallTime, type Instant, type IsoDate, type Zone } from './zone';

export type Clock = '12h' | '24h';

export interface FormatPrefs {
  locale: string;
  clock: Clock;
}

export const DEFAULT_PREFS: FormatPrefs = { locale: 'en-US', clock: '12h' };

/** "9:00 am", "12:30 pm" or "09:00", "23:30" */
export function formatMinute(minute: number, clock: Clock = '12h'): string {
  const m = ((minute % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  if (clock === '24h') return `${String(h).padStart(2, '0')}:${mm}`;
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${suffix}`;
}

/** Compact hour label for grid rows: "9 am", "9:30", "21:00". */
export function formatRowLabel(minute: number, clock: Clock = '12h'): string {
  const m = ((minute % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mins = m % 60;
  if (clock === '24h') return `${String(h).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (mins === 0) return `${h12} ${h < 12 ? 'am' : 'pm'}`;
  return `${h12}:${String(mins).padStart(2, '0')}`;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function dateFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = dateFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
    dateFormatters.set(key, f);
  }
  return f;
}

function dateAtNoonUtc(date: IsoDate): Date {
  return new Date(`${date}T12:00:00Z`);
}

/** "Tue, Oct 13" */
export function formatDate(date: IsoDate, locale = 'en-US'): string {
  return dateFormatter(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(dateAtNoonUtc(date));
}

/** "Tuesday, October 13" */
export function formatDateLong(date: IsoDate, locale = 'en-US'): string {
  return dateFormatter(locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(dateAtNoonUtc(date));
}

/** { weekday: "Tue", day: "13", month: "Oct" } for column headers. */
export function dateParts(date: IsoDate, locale = 'en-US'): { weekday: string; day: string; month: string } {
  const d = dateAtNoonUtc(date);
  return {
    weekday: dateFormatter(locale, { weekday: 'short' }).format(d),
    day: dateFormatter(locale, { day: 'numeric' }).format(d),
    month: dateFormatter(locale, { month: 'short' }).format(d),
  };
}

/** "9:00 am" for an instant in a zone. */
export function formatTimeIn(instant: Instant, zone: Zone, clock: Clock = '12h'): string {
  return formatMinute(wallTime(instant, zone).minute, clock);
}

/** "Tue, Oct 13 · 9:00 am" for an instant in a zone. */
export function formatInstant(instant: Instant, zone: Zone, prefs: FormatPrefs = DEFAULT_PREFS): string {
  const w = wallTime(instant, zone);
  return `${formatDate(w.date, prefs.locale)} · ${formatMinute(w.minute, prefs.clock)}`;
}

/** "9:00–10:00 am", "11:30 pm–12:30 am" for a span in a zone. */
export function formatSpan(start: Instant, end: Instant, zone: Zone, clock: Clock = '12h'): string {
  const a = formatMinute(wallTime(start, zone).minute, clock);
  const b = formatMinute(wallTime(end, zone).minute, clock);
  if (clock === '12h') {
    const [aTime, aSuffix] = a.split(' ');
    const [, bSuffix] = b.split(' ');
    if (aSuffix === bSuffix) return `${aTime}–${b}`;
  }
  return `${a}–${b}`;
}

/** Day difference between a person's local date and a reference date: −1, 0, +1. */
export function dayShift(instant: Instant, zone: Zone, referenceZone: Zone): number {
  const a = wallTime(instant, zone).date;
  const b = wallTime(instant, referenceZone).date;
  return a === b ? 0 : a > b ? 1 : -1;
}

/** "Vancouver · UTC−7" */
export function zoneLabel(zone: Zone, at: Instant): string {
  return `${cityOf(zone)} · ${formatOffset(wallTime(at, zone).offset)}`;
}

/** Guess the user's preferred clock from their locale. Impure helper, used only at startup. */
export function detectClock(locale?: string): Clock {
  try {
    const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return cycle === 'h23' || cycle === 'h24' ? '24h' : '12h';
  } catch {
    return '12h';
  }
}

/** Duration label: "30 min", "1 hr", "1.5 hr". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hr`;
}

/**
 * Input rules shared by the UI (to explain problems early) and the local adapter (to behave
 * like the server). The database enforces the same rules again; it never trusts a client.
 */
import { DAY_MINUTES, daysBetween, isIsoDate, isValidZone } from '../time/zone';
import { windowLength } from '../time/slots';
import type { NewEvent, NewParticipant } from './types';
import { COLOR_NAMES } from './types';

export const LIMITS = {
  titleMax: 80,
  nameMax: 40,
  maxDates: 14,
  maxSpanDays: 62,
  maxDurationMinutes: 480,
  maxParticipants: 50,
} as const;

export const DURATIONS = [30, 60, 90, 120, 180, 240] as const;

/** Returns a human message for the first problem found, or null if the event is valid. */
export function eventProblem(e: NewEvent, today: string): string | null {
  const title = e.title.trim();
  if (title.length < 1) return 'Give it a name.';
  if ([...title].length > LIMITS.titleMax) return `Keep the name under ${LIMITS.titleMax} characters.`;
  if (!isValidZone(e.timezone)) return 'That time zone isn’t one we know.';
  if (e.dates.length < 1) return 'Pick at least one day.';
  if (e.dates.length > LIMITS.maxDates) return `Pick up to ${LIMITS.maxDates} days.`;
  if (!e.dates.every(isIsoDate)) return 'One of those dates isn’t valid.';
  const sorted = [...e.dates].sort();
  if (daysBetween(sorted[0], sorted[sorted.length - 1]) > LIMITS.maxSpanDays) return 'Keep the days within two months.';
  if (daysBetween(today, sorted[0]) < -2) return 'Those days have passed.';
  if (![15, 30, 60].includes(e.slotMinutes)) return 'Slot length must be 15, 30 or 60 minutes.';
  const { windowStartMin: ws, windowEndMin: we } = e;
  if (!Number.isInteger(ws) || !Number.isInteger(we) || ws < 0 || ws >= DAY_MINUTES || we < 0 || we > DAY_MINUTES) return 'Check the times.';
  if (ws % e.slotMinutes !== 0 || we % e.slotMinutes !== 0) return 'Times must line up with the slots.';
  if (e.durationMinutes < e.slotMinutes || e.durationMinutes > LIMITS.maxDurationMinutes || e.durationMinutes % e.slotMinutes !== 0) return 'Pick a meeting length.';
  if (e.durationMinutes > windowLength(ws, we)) return 'The meeting is longer than the time window.';
  if (e.expectedCount !== null && (e.expectedCount < 2 || e.expectedCount > LIMITS.maxParticipants)) return 'Group size should be 2 to 50.';
  if (!COLOR_NAMES.includes(e.color)) return 'Pick a colour.';
  return null;
}

export function participantProblem(p: NewParticipant): string | null {
  const name = p.name.trim();
  if (name.length < 1) return 'What should we call you?';
  if ([...name].length > LIMITS.nameMax) return `Keep your name under ${LIMITS.nameMax} characters.`;
  if (!isValidZone(p.timezone)) return 'That time zone isn’t one we know.';
  if (!COLOR_NAMES.includes(p.color)) return 'Pick a colour.';
  for (const r of [p.sleep, p.work]) {
    if (!r) continue;
    if (r.start < 0 || r.start >= DAY_MINUTES || r.end < 0 || r.end > DAY_MINUTES) return 'Check your hours.';
  }
  return null;
}

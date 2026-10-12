/**
 * Fairness: rank candidate meeting times by how many people can make them, then by how
 * kind they are to everyone's local day.
 *
 * Rules are explicit and adjustable (`FairnessRules`). By default a humane meeting hour is
 * 8:00 am to 10:00 pm in each person's own time zone.
 */
import { MINUTE, wallTime, type Instant } from '../time/zone';
import { minutesInside, type DayRange } from '../time/ranges';
import { slotsCovering } from '../time/slots';
import type { Person } from '../availability/overlap';

export interface FairnessRules {
  humane: DayRange;
  /** Earliest local time we call "early" rather than "the middle of the night". */
  earlyFrom: number;
  /** How many suggestions to return. */
  count: number;
}

export const DEFAULT_RULES: FairnessRules = {
  humane: { start: 8 * 60, end: 22 * 60 },
  earlyFrom: 5 * 60,
  count: 3,
};

export type Discomfort = 'early' | 'late' | 'night';

export interface PersonCost {
  id: string;
  /** Local minute-of-day the meeting starts for this person. */
  localStart: number;
  /** Local minute-of-day the meeting ends for this person. */
  localEnd: number;
  /** Minutes of the meeting outside this person's humane hours. */
  minutesOutside: number;
  discomfort: Discomfort | null;
  /** Calendar date where this person is. */
  localDate: string;
}

export interface Candidate {
  start: Instant;
  end: Instant;
  /** Can make it (free or if needed for the whole meeting). */
  available: string[];
  /** Subset of `available` who said "if needed" for part of it. */
  ifNeeded: string[];
  /** Responders who can't make it. */
  unavailable: string[];
  /** Per-person local cost, for everyone who can make it. */
  costs: PersonCost[];
  /** People who can make it but are outside humane hours. */
  outside: number;
  minutesOutside: number;
  worstMinutesOutside: number;
}

function classify(localStart: number, minutesOutside: number, rules: FairnessRules): Discomfort | null {
  if (minutesOutside === 0) return null;
  const { humane, earlyFrom } = rules;
  if (localStart >= earlyFrom && localStart < humane.start) return 'early';
  if (localStart >= humane.start && localStart < humane.end) return 'late';
  // Starting after humane end but before midnight is "late"; after midnight is "night".
  if (localStart >= humane.end) return 'late';
  return 'night';
}

/** Cost of one meeting time for one person. */
export function personCost(person: Person, start: Instant, durationMinutes: number, rules: FairnessRules): PersonCost {
  const w = wallTime(start, person.zone);
  const endWall = wallTime(start + durationMinutes * MINUTE, person.zone);
  const humane = person.humane ?? rules.humane;
  const inside = minutesInside(w.minute, durationMinutes, humane);
  const minutesOutside = durationMinutes - inside;
  return {
    id: person.id,
    localStart: w.minute,
    localEnd: endWall.minute,
    minutesOutside,
    discomfort: classify(w.minute, minutesOutside, rules),
    localDate: w.date,
  };
}

/** Evaluate every possible start time in the event. */
export function evaluate(
  slots: readonly Instant[],
  slotMinutes: number,
  durationMinutes: number,
  responders: readonly Person[],
  rules: FairnessRules = DEFAULT_RULES,
): Candidate[] {
  const slotSet = new Set(slots);
  const out: Candidate[] = [];
  for (const start of slots) {
    const covering = slotsCovering(start, durationMinutes, slotMinutes, slotSet);
    if (!covering) continue;
    const available: string[] = [];
    const ifNeeded: string[] = [];
    const unavailable: string[] = [];
    const costs: PersonCost[] = [];
    for (const p of responders) {
      let ok = true;
      let maybe = false;
      for (const t of covering) {
        const k = p.availability.get(t);
        if (!k) {
          ok = false;
          break;
        }
        if (k === 'if_needed') maybe = true;
      }
      if (!ok) {
        unavailable.push(p.id);
        continue;
      }
      available.push(p.id);
      if (maybe) ifNeeded.push(p.id);
      costs.push(personCost(p, start, durationMinutes, rules));
    }
    let outside = 0;
    let minutesOutside = 0;
    let worst = 0;
    for (const c of costs) {
      if (c.minutesOutside > 0) outside++;
      minutesOutside += c.minutesOutside;
      worst = Math.max(worst, c.minutesOutside);
    }
    out.push({
      start,
      end: start + durationMinutes * MINUTE,
      available,
      ifNeeded,
      unavailable,
      costs,
      outside,
      minutesOutside,
      worstMinutesOutside: worst,
    });
  }
  return out;
}

/**
 * Ordering: most people available; then fewest "if needed"; then fewest people outside
 * humane hours; then the least total and worst-case discomfort; then the earliest time.
 */
export function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    b.available.length - a.available.length ||
    a.ifNeeded.length - b.ifNeeded.length ||
    a.outside - b.outside ||
    a.minutesOutside - b.minutesOutside ||
    a.worstMinutesOutside - b.worstMinutesOutside ||
    a.start - b.start
  );
}

/**
 * The best few meeting times: ranked, at least one person available, and never
 * overlapping each other (so the list isn't three half-hour shifts of the same window).
 */
export function bestTimes(
  slots: readonly Instant[],
  slotMinutes: number,
  durationMinutes: number,
  responders: readonly Person[],
  rules: FairnessRules = DEFAULT_RULES,
): Candidate[] {
  if (responders.length === 0) return [];
  const ranked = evaluate(slots, slotMinutes, durationMinutes, responders, rules)
    .filter((c) => c.available.length > 0)
    .sort(compareCandidates);
  const chosen: Candidate[] = [];
  for (const c of ranked) {
    if (chosen.some((x) => c.start < x.end && x.start < c.end)) continue;
    chosen.push(c);
    if (chosen.length >= rules.count) break;
  }
  return chosen;
}

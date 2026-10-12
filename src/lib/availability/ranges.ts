/**
 * Turn painted slots into plain-language ranges ("Tue, Oct 13 · 10:00 am – 12:30 pm"),
 * per day in the viewer's zone. Used to show people exactly what they picked.
 */
import { MINUTE, wallTime, type Instant, type IsoDate, type Zone } from '../time/zone';
import type { Kind } from './blocks';

export interface PickedRange {
  /** The viewer's calendar date the range starts on. */
  date: IsoDate;
  start: Instant;
  end: Instant;
  kind: Kind;
  slots: Instant[];
}

export function pickedRanges(availability: ReadonlyMap<Instant, Kind>, zone: Zone, slotMinutes: number): PickedRange[] {
  const step = slotMinutes * MINUTE;
  const out: PickedRange[] = [];
  for (const [t, kind] of [...availability.entries()].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    const date = wallTime(t, zone).date;
    if (last && last.kind === kind && last.end === t && last.date === date) {
      last.end = t + step;
      last.slots.push(t);
    } else out.push({ date, start: t, end: t + step, kind, slots: [t] });
  }
  return out;
}

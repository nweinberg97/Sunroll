/**
 * The group's overlap: who is free in each slot.
 */
import type { Instant, Zone } from '../time/zone';
import type { DayRange } from '../time/ranges';
import type { Kind } from './blocks';

export interface Person {
  id: string;
  name: string;
  zone: Zone;
  availability: ReadonlyMap<Instant, Kind>;
  /** Hours this person considers reasonable for a meeting. Defaults to the fairness rules. */
  humane?: DayRange;
}

export interface SlotSummary {
  free: string[];
  ifNeeded: string[];
}

/** Who is free and who is "if needed" in every slot. */
export function summarize(slots: readonly Instant[], people: readonly Person[]): Map<Instant, SlotSummary> {
  const out = new Map<Instant, SlotSummary>();
  for (const t of slots) out.set(t, { free: [], ifNeeded: [] });
  for (const p of people) {
    for (const [t, kind] of p.availability) {
      const s = out.get(t);
      if (!s) continue;
      if (kind === 'free') s.free.push(p.id);
      else s.ifNeeded.push(p.id);
    }
  }
  return out;
}

/**
 * Strength of a slot from 0 to 1: free counts fully, "if needed" counts half.
 * `full` is true only when every responder is free or "if needed".
 */
export function heat(summary: SlotSummary, responders: number): { level: number; available: number; full: boolean } {
  const available = summary.free.length + summary.ifNeeded.length;
  if (responders === 0) return { level: 0, available: 0, full: false };
  const level = (summary.free.length + summary.ifNeeded.length * 0.5) / responders;
  return { level, available, full: available === responders && responders > 0 };
}

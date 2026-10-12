/**
 * Availability as the UI paints it (a status per slot) and as it is stored
 * (merged blocks of [start, end) with a kind). Pure conversions in both directions.
 */
import { MINUTE, type Instant } from '../time/zone';

export type Kind = 'free' | 'if_needed';
export type Availability = Map<Instant, Kind>;

export interface Block {
  start: Instant;
  end: Instant;
  kind: Kind;
}

/** Merge per-slot availability into the fewest contiguous same-kind blocks. */
export function toBlocks(availability: ReadonlyMap<Instant, Kind>, slotMinutes: number): Block[] {
  const step = slotMinutes * MINUTE;
  const entries = [...availability.entries()].sort((a, b) => a[0] - b[0]);
  const blocks: Block[] = [];
  for (const [t, kind] of entries) {
    const last = blocks[blocks.length - 1];
    if (last && last.kind === kind && last.end === t) last.end = t + step;
    else blocks.push({ start: t, end: t + step, kind });
  }
  return blocks;
}

/**
 * Expand stored blocks back into per-slot availability, keeping only slots that are part
 * of the event. Overlapping blocks resolve to the more positive answer ("free").
 */
export function fromBlocks(blocks: readonly Block[], eventSlots: ReadonlySet<Instant>, slotMinutes: number): Availability {
  const step = slotMinutes * MINUTE;
  const out: Availability = new Map();
  for (const b of blocks) {
    if (!(b.end > b.start)) continue;
    // Align to the slot grid: a slot is covered if its start lies inside the block.
    for (const t of eventSlots) {
      if (t >= b.start && t + step <= b.end) {
        if (out.get(t) !== 'free') out.set(t, b.kind);
      }
    }
  }
  return out;
}

/** Set every slot in `slots` to `kind`, or clear them if kind is null. Returns a new map. */
export function paint(availability: ReadonlyMap<Instant, Kind>, slots: Iterable<Instant>, kind: Kind | null): Availability {
  const next: Availability = new Map(availability);
  for (const t of slots) {
    if (kind) next.set(t, kind);
    else next.delete(t);
  }
  return next;
}

/** Cycle used by keyboard and single taps: empty → free → if needed → empty. */
export function nextKind(current: Kind | undefined): Kind | null {
  if (current === undefined) return 'free';
  if (current === 'free') return 'if_needed';
  return null;
}

export function sameAvailability(a: ReadonlyMap<Instant, Kind>, b: ReadonlyMap<Instant, Kind>): boolean {
  if (a.size !== b.size) return false;
  for (const [t, k] of a) if (b.get(t) !== k) return false;
  return true;
}

/**
 * Lay an event's slots out as a grid in one viewer's time zone.
 *
 * Columns are the viewer's days; rows are the viewer's wall-clock times. Three things make
 * this harder than it looks, and all are handled here so the UI never has to think about them:
 *
 * 1. Crossing midnight. If the event runs 6pm–2am for the viewer, a naive layout would put
 *    midnight–2am at the *top* of the next column. Instead we find the largest gap in the
 *    viewer's times and start each "grid day" there, so evenings stay in one column and the
 *    after-midnight rows sit underneath, marked as next day.
 * 2. DST changes for the viewer. Some days' slots shift by an hour; rows are the union of all
 *    times, and cells that aren't in the event on a given day are null.
 * 3. Fall-back repeats. On the night clocks go back, the same wall time happens twice. The
 *    second occurrence gets its own row (`fold: 1`) rather than colliding with the first.
 */
import { DAY_MINUTES, type Instant, type IsoDate, type Zone, addDays, wallTime } from './zone';

export interface GridColumn {
  /** The grid day this column represents: the viewer's calendar date at the column's first row. */
  date: IsoDate;
}

export interface GridRow {
  key: string;
  /** Viewer's wall-clock minute-of-day for this row. */
  minute: number;
  /** 0 normally; 1 for the second occurrence of a repeated wall time (DST fall-back). */
  fold: number;
  /** True if this row falls on the calendar day after its column's date. */
  nextDay: boolean;
}

export interface Grid {
  zone: Zone;
  columns: GridColumn[];
  rows: GridRow[];
  /** cells[row][col] is the slot instant shown there, or null if that cell isn't part of the event. */
  cells: (Instant | null)[][];
  /** Where each slot sits. */
  position: Map<Instant, { row: number; col: number }>;
  /** Minute-of-day at which each grid day starts (0 unless the event crosses the viewer's midnight). */
  dayStartMinute: number;
}

/** Find the minute-of-day after the largest circular gap: the natural start of a "grid day". */
export function naturalDayStart(minutes: Iterable<number>): number {
  const sorted = [...new Set(minutes)].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  let bestGap = sorted[0] + DAY_MINUTES - sorted[sorted.length - 1];
  let start = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > bestGap) {
      bestGap = gap;
      start = sorted[i];
    }
  }
  return start;
}

export function buildGrid(slots: readonly Instant[], zone: Zone): Grid {
  const sorted = [...slots].sort((a, b) => a - b);
  const walls = sorted.map((t) => ({ t, w: wallTime(t, zone) }));
  const dayStart = naturalDayStart(walls.map((x) => x.w.minute));

  // Assign each slot a grid day, a rotated row position, and a fold index.
  const seenWall = new Set<string>();
  const placed = walls.map(({ t, w }) => {
    const nextDay = w.minute < dayStart;
    const day = nextDay ? addDays(w.date, -1) : w.date;
    const rotated = (w.minute - dayStart + DAY_MINUTES) % DAY_MINUTES;
    const wallKey = `${w.date}|${w.minute}`;
    const fold = seenWall.has(wallKey) ? 1 : 0;
    seenWall.add(wallKey);
    return { t, day, rotated, minute: w.minute, fold, nextDay };
  });

  const days = [...new Set(placed.map((p) => p.day))].sort();
  const rowMap = new Map<string, GridRow & { rotated: number }>();
  for (const p of placed) {
    const key = `${p.minute}:${p.fold}`;
    if (!rowMap.has(key)) rowMap.set(key, { key, minute: p.minute, fold: p.fold, nextDay: p.nextDay, rotated: p.rotated });
  }
  const rowList = [...rowMap.values()].sort((a, b) => a.rotated - b.rotated || a.fold - b.fold);
  const rowIndex = new Map(rowList.map((r, i) => [r.key, i]));
  const colIndex = new Map(days.map((d, i) => [d, i]));

  const cells: (Instant | null)[][] = rowList.map(() => days.map(() => null));
  const position = new Map<Instant, { row: number; col: number }>();
  for (const p of placed) {
    const row = rowIndex.get(`${p.minute}:${p.fold}`)!;
    const col = colIndex.get(p.day)!;
    cells[row][col] = p.t;
    position.set(p.t, { row, col });
  }

  return {
    zone,
    columns: days.map((date) => ({ date })),
    rows: rowList.map(({ rotated: _rotated, ...r }) => r),
    cells,
    position,
    dayStartMinute: dayStart,
  };
}

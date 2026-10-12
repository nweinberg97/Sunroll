import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Grid } from '../lib/time/grid';
import { dateParts, formatDate, formatMinute, formatRowLabel, type Clock } from '../lib/time/format';
import { inRange, type DayRange } from '../lib/time/ranges';
import { cityOf, wallTime, type Instant, type Zone } from '../lib/time/zone';
import type { PersonColor } from '../lib/people';
import { nextKind, paint, type Availability, type Kind } from '../lib/availability/blocks';
import { heat, type SlotSummary } from '../lib/availability/overlap';
import type { ParticipantRecord } from '../lib/data/types';
import { announce, Avatar } from './ui';

/* ── Shared ─────────────────────────────────────────────────────────────── */

interface RowMeta {
  label: string;
  hour: boolean;
  midnight: boolean;
  half: boolean;
}

/** Every row gets a full time label ("10:00 am", "10:30 am"); hours get a line, midnight a divider. */
function rowMeta(grid: Grid, clock: Clock): RowMeta[] {
  return grid.rows.map((r, i) => {
    const prev = grid.rows[i - 1];
    const newHour = !prev || Math.floor(prev.minute / 60) !== Math.floor(r.minute / 60) || prev.fold !== r.fold;
    const midnight = !!prev && !prev.nextDay && r.nextDay;
    return { label: formatMinute(r.minute, clock) + (r.fold ? ' (2nd)' : ''), hour: newHour && i > 0, midnight, half: r.minute % 60 !== 0 };
  });
}

function DayHeaders({ grid, locale, selectedCol, onSelectCol }: { grid: Grid; locale: string; selectedCol?: number; onSelectCol?: (c: number) => void }) {
  return (
    <div role="row">
      <span className="tgrid-corner" role="columnheader" aria-label="Time" />
      {grid.columns.map((c, i) => {
        const p = dateParts(c.date, locale);
        const body = (
          <>
            <span className="dow">{p.weekday}</span>
            <span className="dom">{p.day}</span>
          </>
        );
        return onSelectCol ? (
          <button
            key={c.date}
            type="button"
            role="columnheader"
            className="tgrid-day"
            data-selected={selectedCol === i || undefined}
            aria-label={`${formatDate(c.date, locale)}. Show everyone’s day`}
            onClick={() => onSelectCol(i)}
          >
            {body}
          </button>
        ) : (
          <span key={c.date} role="columnheader" className="tgrid-day" aria-label={formatDate(c.date, locale)}>
            {body}
          </span>
        );
      })}
    </div>
  );
}

function TimeLabel({ meta, sleep, nextDay, minute, clock }: { meta: RowMeta; sleep: boolean; nextDay: boolean; minute: number; clock: Clock }) {
  return (
    <span className="tgrid-time" role="rowheader" data-sleep={sleep || undefined} data-half={meta.half || undefined} aria-label={formatMinute(minute, clock) + (nextDay ? ', next day' : '')}>
      {meta.midnight && <span className="plus1" aria-hidden="true">next day</span>}
      {sleep && <span className="moon" aria-hidden="true">☾</span>}
      <span aria-hidden="true">{meta.label}</span>
    </span>
  );
}

/** Roving focus over a grid of cells, with arrow keys, Home/End and Page Up/Down. */
function useRovingFocus(rows: number, cols: number) {
  const [focus, setFocus] = useState({ row: 0, col: 0 });
  const container = useRef<HTMLDivElement>(null);
  const move = useCallback(
    (row: number, col: number) => {
      const r = Math.max(0, Math.min(rows - 1, row));
      const c = Math.max(0, Math.min(cols - 1, col));
      setFocus({ row: r, col: c });
      const el = container.current?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
      el?.focus({ preventScroll: false });
      return { row: r, col: c };
    },
    [rows, cols],
  );
  const handleArrows = useCallback(
    (e: KeyboardEvent): { row: number; col: number } | null => {
      const { row, col } = focus;
      switch (e.key) {
        case 'ArrowUp':
          return move(row - 1, col);
        case 'ArrowDown':
          return move(row + 1, col);
        case 'ArrowLeft':
          return move(row, col - 1);
        case 'ArrowRight':
          return move(row, col + 1);
        case 'Home':
          return move(e.ctrlKey ? 0 : row, 0);
        case 'End':
          return move(e.ctrlKey ? rows - 1 : row, cols - 1);
        case 'PageUp':
          return move(row - 4, col);
        case 'PageDown':
          return move(row + 4, col);
        default:
          return null;
      }
    },
    [focus, move, rows, cols],
  );
  return { focus, setFocus, move, handleArrows, container };
}

function cellFromPoint(x: number, y: number): { row: number; col: number } | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-r]');
  if (!el) return null;
  return { row: Number(el.dataset.r), col: Number(el.dataset.c) };
}

function stateWord(k: Kind | undefined): string {
  return k === 'free' ? 'free' : k === 'if_needed' ? 'if needed' : 'not marked';
}

/* ── Painting your availability ─────────────────────────────────────────── */

export interface PaintGridProps {
  grid: Grid;
  slotMinutes: number;
  availability: Availability;
  onChange: (next: Availability) => void;
  brush: Kind;
  sleep: DayRange;
  clock: Clock;
  locale: string;
  label: string;
}

export function PaintGrid({ grid, slotMinutes, availability, onChange, brush, sleep, clock, locale, label }: PaintGridProps) {
  const meta = useMemo(() => rowMeta(grid, clock), [grid, clock]);
  const { focus, setFocus, handleArrows, container } = useRovingFocus(grid.rows.length, grid.columns.length);
  const [drag, setDrag] = useState<{ anchor: { row: number; col: number }; current: { row: number; col: number }; mode: 'paint' | 'erase'; pointerId: number } | null>(null);

  const rect = useMemo(() => {
    if (!drag) return null;
    return {
      r0: Math.min(drag.anchor.row, drag.current.row),
      r1: Math.max(drag.anchor.row, drag.current.row),
      c0: Math.min(drag.anchor.col, drag.current.col),
      c1: Math.max(drag.anchor.col, drag.current.col),
    };
  }, [drag]);

  const slotsIn = useCallback(
    (r: { r0: number; r1: number; c0: number; c1: number }) => {
      const out: Instant[] = [];
      for (let row = r.r0; row <= r.r1; row++)
        for (let col = r.c0; col <= r.c1; col++) {
          const t = grid.cells[row]?.[col];
          if (t != null) out.push(t);
        }
      return out;
    },
    [grid],
  );

  const effective = useCallback(
    (row: number, col: number, t: Instant): { state: Kind | undefined; preview: 'paint' | 'erase' | undefined } => {
      if (rect && drag && row >= rect.r0 && row <= rect.r1 && col >= rect.c0 && col <= rect.c1) {
        return drag.mode === 'paint' ? { state: brush, preview: 'paint' } : { state: availability.get(t), preview: 'erase' };
      }
      return { state: availability.get(t), preview: undefined };
    },
    [rect, drag, brush, availability],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const hit = cellFromPoint(e.clientX, e.clientY);
    if (!hit) return;
    const t = grid.cells[hit.row]?.[hit.col];
    if (t == null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const mode = availability.get(t) === brush ? 'erase' : 'paint';
    setDrag({ anchor: hit, current: hit, mode, pointerId: e.pointerId });
    setFocus(hit);
    if ('vibrate' in navigator) navigator.vibrate?.(6);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const hit = cellFromPoint(e.clientX, e.clientY);
    if (!hit || (hit.row === drag.current.row && hit.col === drag.current.col)) return;
    setDrag({ ...drag, current: hit });
    if ('vibrate' in navigator) navigator.vibrate?.(3);
  };

  const finish = (commit: boolean) => {
    if (!drag || !rect) return;
    if (commit) {
      const slots = slotsIn(rect);
      onChange(paint(availability, slots, drag.mode === 'paint' ? brush : null));
      announce(`${slots.length} ${slots.length === 1 ? 'slot' : 'slots'} ${drag.mode === 'paint' ? `marked ${stateWord(brush)}` : 'cleared'}`);
    }
    setDrag(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const moved = handleArrows(e);
    if (moved) {
      e.preventDefault();
      if (e.shiftKey) {
        const t = grid.cells[moved.row]?.[moved.col];
        if (t != null) {
          onChange(paint(availability, [t], brush));
          announce(`${stateWord(brush)}`);
        }
      }
      return;
    }
    const t = grid.cells[focus.row]?.[focus.col];
    if (t == null) return;
    let next: Kind | null | undefined;
    if (e.key === ' ' || e.key === 'Enter') next = nextKind(availability.get(t));
    else if (e.key.toLowerCase() === 'f') next = 'free';
    else if (e.key.toLowerCase() === 'i') next = 'if_needed';
    else if (e.key === 'Backspace' || e.key === 'Delete') next = null;
    if (next === undefined) return;
    e.preventDefault();
    onChange(paint(availability, [t], next));
    announce(stateWord(next ?? undefined));
  };

  // Say exactly what is being selected, in words, while dragging.
  let readout: string | null = null;
  if (rect && drag) {
    const first = grid.columns[rect.c0]?.date;
    const last = grid.columns[rect.c1]?.date;
    const days = first === last ? formatDate(first, locale) : `${formatDate(first, locale)} to ${formatDate(last, locale)}`;
    const from = formatMinute(grid.rows[rect.r0].minute, clock);
    const to = formatMinute(grid.rows[rect.r1].minute + slotMinutes, clock);
    readout = `${drag.mode === 'paint' ? (brush === 'free' ? 'Free' : 'If needed') : 'Clearing'}: ${days} · ${from} – ${to}`;
  }

  return (
    <>
    <p className="paint-readout" data-active={!!readout || undefined} aria-hidden={!readout || undefined}>
      {readout ?? 'Tap a time, or drag across several, to mark when you’re free.'}
    </p>
    <div className="tgrid-scroll" style={{ ['--grid-max-h' as string]: 'min(62dvh, 820px)' }}>
      <div
        ref={container}
        className="tgrid paint"
        role="grid"
        aria-label={label}
        aria-describedby="paint-help"
        style={{ ['--cols' as string]: grid.columns.length }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => finish(true)}
        onPointerCancel={() => finish(false)}
        onLostPointerCapture={() => finish(true)}
        onKeyDown={onKeyDown}
      >
        <DayHeaders grid={grid} locale={locale} />
        {grid.rows.map((row, r) => {
          const sleepRow = inRange(row.minute, sleep);
          return (
            <div role="row" key={row.key} className={r === 0 ? 'tgrid-row-first' : undefined}>
              <TimeLabel meta={meta[r]} sleep={sleepRow} nextDay={row.nextDay} minute={row.minute} clock={clock} />
              {grid.columns.map((col, c) => {
                const t = grid.cells[r][c];
                if (t == null)
                  return <span key={col.date} className="cell" role="gridcell" data-off="true" data-r={r} data-c={c} aria-disabled="true" aria-label="Not part of this event" tabIndex={focus.row === r && focus.col === c ? 0 : -1} />;
                const { state, preview } = effective(r, c, t);
                const up = r > 0 && grid.cells[r - 1][c] != null ? effective(r - 1, c, grid.cells[r - 1][c]!).state : undefined;
                const down = r < grid.rows.length - 1 && grid.cells[r + 1][c] != null ? effective(r + 1, c, grid.cells[r + 1][c]!).state : undefined;
                return (
                  <span
                    key={col.date}
                    className="cell"
                    role="gridcell"
                    data-r={r}
                    data-c={c}
                    data-state={state}
                    data-preview={preview}
                    data-sleep={sleepRow || undefined}
                    data-hour={meta[r].hour || undefined}
                    data-midnight={meta[r].midnight || undefined}
                    data-joined-up={(state && up === state) || undefined}
                    data-joined-down={(state && down === state) || undefined}
                    tabIndex={focus.row === r && focus.col === c ? 0 : -1}
                    aria-selected={state ? true : false}
                    aria-label={`${formatDate(col.date, locale)}, ${formatMinute(row.minute, clock)}${row.nextDay ? ' (next day)' : ''}: ${stateWord(state)}`}
                    onFocus={() => (focus.row !== r || focus.col !== c) && setFocus({ row: r, col: c })}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      <p id="paint-help" className="sr-only">
        Use arrow keys to move between times. Space cycles free, if needed and clear. Shift and an arrow key paints as you move. F marks free, I marks if needed, Delete clears.
      </p>
    </div>
    </>
  );
}

/* ── The overlap heatmap ────────────────────────────────────────────────── */

export interface OverlapGridProps {
  grid: Grid;
  summary: Map<Instant, SlotSummary>;
  responders: number;
  names: Map<string, string>;
  selected: Instant | null;
  onSelect: (t: Instant) => void;
  best: Set<Instant>;
  pulse: Set<Instant>;
  selectedCol: number;
  onSelectCol: (c: number) => void;
  sleep: DayRange;
  clock: Clock;
  locale: string;
}

export const OverlapGrid = memo(function OverlapGrid({ grid, summary, responders, names, selected, onSelect, best, pulse, selectedCol, onSelectCol, sleep, clock, locale }: OverlapGridProps) {
  const meta = useMemo(() => rowMeta(grid, clock), [grid, clock]);
  const { focus, setFocus, handleArrows, container } = useRovingFocus(grid.rows.length, grid.columns.length);

  // Keep keyboard focus position in step with the selected slot.
  useEffect(() => {
    if (selected == null) return;
    const pos = grid.position.get(selected);
    if (pos) setFocus(pos);
  }, [selected, grid, setFocus]);

  const describe = (s: SlotSummary | undefined): string => {
    if (!s || responders === 0) return 'nobody has answered yet';
    const h = heat(s, responders);
    const maybe = s.ifNeeded.map((id) => names.get(id)).filter(Boolean);
    const base = h.full ? `everyone free (${responders})` : `${h.available} of ${responders} free`;
    return maybe.length ? `${base}; if needed: ${maybe.join(', ')}` : base;
  };

  return (
    <div className="tgrid-scroll">
      <div
        ref={container}
        className="tgrid overlap"
        role="grid"
        aria-label="Everyone’s availability, in your time"
        style={{ ['--cols' as string]: grid.columns.length }}
        onKeyDown={(e) => {
          const moved = handleArrows(e);
          if (moved) {
            e.preventDefault();
            const t = grid.cells[moved.row]?.[moved.col];
            if (t != null) onSelect(t);
            return;
          }
          if (e.key === 'Enter' || e.key === ' ') {
            const t = grid.cells[focus.row]?.[focus.col];
            if (t != null) {
              e.preventDefault();
              onSelect(t);
            }
          }
        }}
        onClick={(e) => {
          const el = (e.target as HTMLElement).closest<HTMLElement>('[data-r]');
          if (!el) return;
          const r = Number(el.dataset.r);
          const c = Number(el.dataset.c);
          const t = grid.cells[r]?.[c];
          if (t != null) {
            setFocus({ row: r, col: c });
            onSelect(t);
          }
        }}
      >
        <DayHeaders grid={grid} locale={locale} selectedCol={selectedCol} onSelectCol={onSelectCol} />
        {grid.rows.map((row, r) => {
          const sleepRow = inRange(row.minute, sleep);
          return (
            <div role="row" key={row.key} className={r === 0 ? 'tgrid-row-first' : undefined}>
              <TimeLabel meta={meta[r]} sleep={sleepRow} nextDay={row.nextDay} minute={row.minute} clock={clock} />
              {grid.columns.map((col, c) => {
                const t = grid.cells[r][c];
                const isFocus = focus.row === r && focus.col === c;
                if (t == null)
                  return <span key={col.date} className="cell" role="gridcell" data-off="true" data-r={r} data-c={c} aria-disabled="true" aria-label="Not part of this event" tabIndex={isFocus ? 0 : -1} />;
                const s = summary.get(t);
                const h = s ? heat(s, responders) : { level: 0, available: 0, full: false };
                const full = h.full && responders >= 2;
                return (
                  <span
                    key={col.date}
                    className="cell"
                    role="gridcell"
                    data-r={r}
                    data-c={c}
                    data-full={full || undefined}
                    data-strong={h.level > 0.55 || undefined}
                    data-selected={selected === t || undefined}
                    data-best={best.has(t) || undefined}
                    data-pulse={pulse.has(t) || undefined}
                    data-hour={meta[r].hour || undefined}
                    data-midnight={meta[r].midnight || undefined}
                    data-sleep={sleepRow || undefined}
                    tabIndex={isFocus ? 0 : -1}
                    aria-selected={selected === t}
                    aria-label={`${formatDate(col.date, locale)}, ${formatMinute(row.minute, clock)}: ${describe(s)}`}
                    style={{ ['--heat' as string]: `${Math.round(h.level * 100)}%` }}
                  >
                    <span className="heat" aria-hidden="true" />
                    {h.available > 0 && responders > 1 && (
                      <span className="count" aria-hidden="true">
                        {full ? '✦' : h.available}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
});

/* ── The day view: each person's free time in their own colour ────────────── */

export interface DayOverlapProps {
  grid: Grid;
  col: number;
  participants: ParticipantRecord[];
  colors: Map<string, PersonColor>;
  availability: Map<string, Availability>;
  responded: Set<string>;
  responders: number;
  selected: Instant | null;
  onSelect: (t: Instant) => void;
  meId: string | null;
  viewerZone: Zone;
  clock: Clock;
  locale: string;
}

/**
 * One column per person, their free time drawn as blocks in their colour, and a final
 * "Everyone" column. Rows where everyone's blocks line up turn gold. Built for the
 * grandma test: full times on every row, faces at the top, one obvious answer.
 */
export function DayOverlap({ grid, col, participants, colors, availability, responded, responders, selected, onSelect, meId, viewerZone, clock, locale }: DayOverlapProps) {
  const rows = grid.rows.map((row, r) => ({ row, t: grid.cells[r][col] })).filter((x) => x.t != null) as { row: Grid['rows'][number]; t: Instant }[];
  const people = [...participants].sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : a.createdAt - b.createdAt));
  const answered = people.filter((p) => responded.has(p.id));
  const date = grid.columns[col]?.date;
  const state = (pid: string, t: Instant | undefined) => (t == null ? undefined : availability.get(pid)?.get(t));
  const allFree = (t: Instant) => responders >= 2 && answered.every((p) => state(p.id, t) !== undefined);
  const countFree = (t: Instant) => answered.filter((p) => state(p.id, t) !== undefined).length;

  return (
    <div className="tgrid-scroll" style={{ ['--grid-max-h' as string]: 'min(74dvh, 980px)' }}>
      <div className="tgrid dayview" role="table" aria-label={`Who is free on ${date ? formatDate(date, locale) : ''}, in your time`} style={{ ['--cols' as string]: people.length + 1 }}>
        <div role="row">
          <span className="tgrid-corner" role="columnheader">
            Time
          </span>
          <span className="person-head everyone-head" role="columnheader">
            <span className="everyone-badge" aria-hidden="true">
              ✓
            </span>
            <span className="who">Everyone</span>
            <span className="where">{responders} answered</span>
          </span>
          {people.map((p) => {
            const c = colors.get(p.id)!;
            return (
              <span key={p.id} className="person-head" role="columnheader" style={{ ['--pc' as string]: c.solid }} aria-label={`${p.name}${p.id === meId ? ' (you)' : ''}, ${cityOf(p.timezone)}`}>
                <Avatar emoji={p.emoji} color={p.color} tint={c.soft} ring={c.solid} size={34} />
                <span className="who">{p.id === meId ? 'You' : p.name}</span>
                <span className="where">{responded.has(p.id) ? cityOf(p.timezone) : 'not yet'}</span>
              </span>
            );
          })}
        </div>
        {rows.map(({ row, t }, i) => {
          const full = allFree(t);
          const prevT = rows[i - 1]?.t;
          const nextT = rows[i + 1]?.t;
          const prevFull = prevT != null && allFree(prevT);
          const nextFull = nextT != null && allFree(nextT);
          const n = countFree(t);
          return (
            <div role="row" key={row.key} className={`day-row${full ? ' is-full' : ''}${selected === t ? ' is-selected' : ''}`} onClick={() => onSelect(t)}>
              <span className="tgrid-time" role="rowheader" data-half={row.minute % 60 !== 0 || undefined}>
                {formatMinute(row.minute, clock)}
              </span>
              <span className="everyone-cell" role="cell" data-full={full || undefined} data-up={(full && prevFull) || undefined} data-down={(full && nextFull) || undefined} aria-label={full ? 'Everyone is free' : `${n} of ${responders} free`}>
                <span className="block" aria-hidden="true">
                  {full ? '✓' : responders > 0 && n > 0 ? `${n}/${responders}` : ''}
                </span>
              </span>
              {people.map((p) => {
                const c = colors.get(p.id)!;
                const k = state(p.id, t);
                const up = state(p.id, prevT) === k && k !== undefined;
                const down = state(p.id, nextT) === k && k !== undefined;
                const differentZone = p.timezone !== viewerZone;
                const w = wallTime(t, p.timezone);
                const asleep = inRange(w.minute, p.sleep);
                const showLocal = differentZone && (w.minute % 60 === 0 || i === 0);
                return (
                  <span
                    key={p.id}
                    className="person-cell"
                    role="cell"
                    data-state={k}
                    data-up={up || undefined}
                    data-down={down || undefined}
                    data-waiting={!responded.has(p.id) || undefined}
                    style={{ ['--pc' as string]: c.solid, ['--pc-soft' as string]: c.soft }}
                    aria-label={`${p.name}: ${k === 'free' ? 'free' : k === 'if_needed' ? 'if needed' : responded.has(p.id) ? 'not free' : 'hasn’t answered'}${differentZone ? `, ${formatMinute(w.minute, clock)} for them` : ''}${asleep ? ', usually asleep' : ''}`}
                  >
                    <span className="block" aria-hidden="true" />
                    {showLocal && (
                      <span className="their-time" aria-hidden="true">
                        {asleep ? '☾ ' : ''}
                        {formatRowLabel(w.minute, clock)}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

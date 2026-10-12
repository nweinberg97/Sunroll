import { useMemo, useRef, useState } from 'react';
import { addDays, cityOf, formatOffset, wallTime, weekdayOf, type IsoDate, type Zone } from '../lib/time/zone';
import { formatMinute, type Clock } from '../lib/time/format';
import { Sheet } from './ui';

/* ── Emoji ──────────────────────────────────────────────────────────────── */

export const EVENT_EMOJI = ['☀️', '🎲', '📞', '☕', '📚', '🐉', '🗺️', '📖', '🎉', '🍕', '🎮', '🏃', '🎬', '🍷', '🧠', '💼', '🎸', '🧘', '🏕️', '✈️', '🎂', '⚽', '🃏', '🌙'];
export const PERSON_EMOJI = ['🦊', '🐼', '🐸', '🦉', '🐙', '🦄', '🐝', '🐢', '🦁', '🐳', '🌻', '🌵', '🍄', '🌈', '⚡', '🔥', '🍩', '🥑', '🎧', '🚀', '🌸', '🪐', '🦖', '🐧'];

export function EmojiPicker({ value, options, onChange, label }: { value: string; options: string[]; onChange: (e: string) => void; label: string }) {
  return (
    <div className="emoji-grid" role="radiogroup" aria-label={label}>
      {options.map((e) => (
        <button key={e} type="button" role="radio" aria-checked={value === e} aria-label={e} onClick={() => onChange(e)}>
          {e}
        </button>
      ))}
    </div>
  );
}

export function EmojiButton({ value, options, onChange, label }: { value: string; options: string[]; onChange: (e: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="emoji-trigger" onClick={() => setOpen(true)} aria-label={`${label}: ${value}. Change`}>
        <span aria-hidden="true">{value}</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <EmojiPicker
          value={value}
          options={options}
          label={label}
          onChange={(e) => {
            onChange(e);
            setOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}

/* ── Time zones ─────────────────────────────────────────────────────────── */

function allZones(): Zone[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
    if (list && list.length) return list;
  } catch {
    /* fall back below */
  }
  return ['UTC', 'America/Vancouver', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Toronto', 'America/St_Johns', 'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Africa/Lagos', 'Africa/Nairobi', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland'];
}

export function ZonePicker({ value, onChange, now }: { value: Zone; onChange: (z: Zone) => void; now: number }) {
  const [query, setQuery] = useState('');
  const zones = useMemo(
    () =>
      allZones()
        .filter((z) => !z.startsWith('Etc/') || z === 'Etc/UTC')
        .map((z) => ({ zone: z, city: cityOf(z), region: z.split('/')[0], offset: wallTime(now, z).offset }))
        .sort((a, b) => a.offset - b.offset || a.city.localeCompare(b.city)),
    [now],
  );
  const q = query.trim().toLowerCase();
  const shown = q ? zones.filter((z) => z.zone.toLowerCase().includes(q) || z.city.toLowerCase().includes(q) || formatOffset(z.offset).toLowerCase().includes(q)) : zones;
  return (
    <div className="stack" style={{ ['--gap' as string]: '12px' }}>
      <input className="input" type="search" placeholder="Search a city or region" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search time zones" autoFocus />
      <div role="listbox" aria-label="Time zones" style={{ maxHeight: '50dvh', overflowY: 'auto', display: 'grid', gap: 4 }}>
        {shown.slice(0, 200).map((z) => (
          <button
            key={z.zone}
            type="button"
            role="option"
            aria-selected={z.zone === value}
            className="zone-option"
            onClick={() => onChange(z.zone)}
          >
            <span>
              <strong>{z.city}</strong> <span className="faint small">{z.region}</span>
            </span>
            <span className="small muted">
              {formatMinute(wallTime(now, z.zone).minute)} · {formatOffset(z.offset)}
            </span>
          </button>
        ))}
        {shown.length === 0 && <p className="muted">No match. Try a bigger city nearby.</p>}
      </div>
    </div>
  );
}

/** "Vancouver · UTC−7 · Change" */
export function ZoneLine({ zone, now, onChange, prefix }: { zone: Zone; now: number; onChange: (z: Zone) => void; prefix?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="zone-line">
        <span aria-hidden="true">🌍</span>{' '}
        <span>
          {prefix ?? 'Your time zone:'} <strong>{cityOf(zone)}</strong> <span className="muted">({formatOffset(wallTime(now, zone).offset)})</span>
        </span>{' '}
        <button type="button" className="link-btn" onClick={() => setOpen(true)}>
          Change
        </button>
      </p>
      <Sheet open={open} onClose={() => setOpen(false)} title="Pick your time zone">
        <ZonePicker
          value={zone}
          now={now}
          onChange={(z) => {
            onChange(z);
            setOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}

/* ── Times ──────────────────────────────────────────────────────────────── */

export function TimeSelect({ value, onChange, label, clock, step = 30, allowEndOfDay = false, id }: { value: number; onChange: (m: number) => void; label: string; clock: Clock; step?: number; allowEndOfDay?: boolean; id?: string }) {
  const options: number[] = [];
  for (let m = 0; m < 1440; m += step) options.push(m);
  if (allowEndOfDay) options.push(1440);
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
      {options.map((m) => (
        <option key={m} value={m}>
          {m === 1440 ? (clock === '24h' ? '24:00' : 'Midnight') : formatMinute(m, clock)}
        </option>
      ))}
    </select>
  );
}

/* ── Days: a month calendar you can tap or drag across ───────────────────── */

export function DayPicker({ value, onChange, today, max = 14, locale }: { value: IsoDate[]; onChange: (d: IsoDate[]) => void; today: IsoDate; max?: number; locale: string }) {
  const [month, setMonth] = useState(() => (value[0] ?? today).slice(0, 7));
  const drag = useRef<{ mode: 'add' | 'remove'; touched: Set<IsoDate> } | null>(null);
  const selected = new Set(value);

  const first = `${month}-01`;
  const offset = weekdayOf(first) - 1; // Monday-first
  const days: (IsoDate | null)[] = [];
  for (let i = 0; i < offset; i++) days.push(null);
  for (let d = first; d.slice(0, 7) === month; d = addDays(d, 1)) days.push(d);

  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${first}T12:00:00Z`));
  const dow = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(`2026-10-${12 + i}T12:00:00Z`)));
  const shiftMonth = (n: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const canGoBack = month > today.slice(0, 7);

  const apply = (d: IsoDate, mode: 'add' | 'remove') => {
    const next = new Set(selected);
    if (mode === 'add') {
      if (next.size >= max) return;
      next.add(d);
    } else next.delete(d);
    onChange([...next].sort());
  };

  const dayAt = (x: number, y: number): IsoDate | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-date]');
    return el && !el.hasAttribute('disabled') ? (el.dataset.date as IsoDate) : null;
  };

  return (
    <div className="cal">
      <div className="cal-head">
        <button type="button" className="icon-btn" onClick={() => shiftMonth(-1)} disabled={!canGoBack} aria-label="Previous month">
          ‹
        </button>
        <span className="cal-title" aria-live="polite">
          {monthLabel}
        </span>
        <button type="button" className="icon-btn" onClick={() => shiftMonth(1)} aria-label="Next month">
          ›
        </button>
      </div>
      <div
        className="cal-grid"
        role="group"
        aria-label={`Days in ${monthLabel}. ${value.length} selected, up to ${max}.`}
        onPointerDown={(e) => {
          const d = dayAt(e.clientX, e.clientY);
          if (!d) return;
          e.preventDefault();
          const mode = selected.has(d) ? 'remove' : 'add';
          drag.current = { mode, touched: new Set([d]) };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          apply(d, mode);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const d = dayAt(e.clientX, e.clientY);
          if (!d || drag.current.touched.has(d)) return;
          drag.current.touched.add(d);
          apply(d, drag.current.mode);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        {dow.map((d, i) => (
          <span key={`dow-${i}`} className="cal-dow" aria-hidden="true">
            {d}
          </span>
        ))}
        {days.map((d, i) =>
          d === null ? (
            <span key={`pad-${i}`} aria-hidden="true" />
          ) : (
            <button
              key={d}
              type="button"
              className="cal-day"
              data-date={d}
              data-today={d === today || undefined}
              aria-pressed={selected.has(d)}
              aria-label={new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`))}
              disabled={d < today}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  apply(d, selected.has(d) ? 'remove' : 'add');
                }
              }}
              onClick={(e) => {
                // Pointer users are handled on pointerdown; this covers assistive tech "clicks".
                if (e.detail === 0) apply(d, selected.has(d) ? 'remove' : 'add');
              }}
            >
              {Number(d.slice(8))}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

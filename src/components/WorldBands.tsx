import { useMemo } from 'react';
import { cityOf, toInstant, wallTime, MINUTE, type Zone } from '../lib/time/zone';
import { formatMinute, type Clock } from '../lib/time/format';
import { phaseOf } from '../lib/time/phase';
import { inRange } from '../lib/time/ranges';

export interface BandPerson {
  name: string;
  emoji: string;
  zone: Zone;
}

/**
 * The signature illustration: one Sunband per person across the same 24 hours, each coloured
 * by *their* local time of day. Where it's a humane hour for everyone, a golden window glows.
 * Computed from the real time zone engine, not drawn by hand.
 */
export function WorldBands({ people, date = '2026-10-13', anchorZone, clock = '12h', animate = true }: { people: BandPerson[]; date?: string; anchorZone: Zone; clock?: Clock; animate?: boolean }) {
  const STEP = 30;
  const N = 1440 / STEP;
  const start = useMemo(() => toInstant(date, 0, anchorZone), [date, anchorZone]);
  const humane = { start: 8 * 60, end: 22 * 60 };

  const lanes = useMemo(
    () =>
      people.map((p) => {
        const cells = Array.from({ length: N }, (_, i) => {
          const w = wallTime(start + i * STEP * MINUTE, p.zone);
          return { phase: phaseOf(w.minute), ok: inRange(w.minute, humane) };
        });
        return { p, cells };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [people, start],
  );

  // The golden window: the longest run where every lane is in humane hours.
  const window = useMemo(() => {
    let best = { from: -1, to: -1 };
    let run = -1;
    for (let i = 0; i <= N; i++) {
      const all = i < N && lanes.every((l) => l.cells[i].ok);
      if (all && run < 0) run = i;
      if (!all && run >= 0) {
        if (i - run > best.to - best.from) best = { from: run, to: i };
        run = -1;
      }
    }
    return best;
  }, [lanes, N]);

  const mid = window.from >= 0 ? start + ((window.from + window.to) / 2) * STEP * MINUTE : null;
  const hours = [0, 6, 12, 18, 24];

  return (
    <figure className="bands" aria-label="Four people’s days side by side. The window where it’s a reasonable hour for all of them is highlighted.">
      <div className="bands-body">
        {window.from >= 0 && (
          <div className="bands-overlay" aria-hidden="true">
            <div className="bands-window" style={{ left: `${(window.from / N) * 100}%`, width: `${((window.to - window.from) / N) * 100}%` }}>
              <span className="bands-window-label">✦ works for everyone</span>
            </div>
          </div>
        )}
        {lanes.map(({ p, cells }, li) => (
          <div key={p.zone + p.name} className="bands-lane">
            <span className="bands-who">
              <span className="bands-emoji" aria-hidden="true">
                {p.emoji}
              </span>
              <span>
                <strong>{p.name}</strong>
                <span>{cityOf(p.zone)}</span>
              </span>
            </span>
            <span className="bands-strip" aria-hidden="true">
              {cells.map((c, i) => (
                <i key={i} data-phase={c.phase} />
              ))}
              {li === 0 && mid != null && <span className={`bands-sun${animate ? ' rolling' : ''}`} style={{ ['--to' as string]: `${(((window.from + window.to) / 2) / N) * 100}%` }} />}
            </span>
            {mid != null && <span className="bands-local">{formatMinute(wallTime(mid, p.zone).minute, clock)}</span>}
          </div>
        ))}
      </div>
      <div className="bands-axis" aria-hidden="true">
        {hours.map((h) => (
          <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
            {h === 24 ? '' : formatMinute(h * 60, clock).replace(':00', '')}
          </span>
        ))}
      </div>
    </figure>
  );
}

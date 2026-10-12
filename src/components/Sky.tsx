import { useMemo, useState, type ReactNode } from 'react';
import { skyAt } from '../lib/sky';
import { useNow } from '../lib/hooks';
import { cityOf, toInstant, wallTime, type Zone } from '../lib/time/zone';
import { formatMinute, type Clock } from '../lib/time/format';
import { phaseOf, phaseGlyph } from '../lib/time/phase';

const CITIES: Zone[] = ['America/Vancouver', 'America/New_York', 'Europe/London', 'Africa/Lagos', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];

const PHASE_WORD = { night: 'night', dawn: 'sunrise', day: 'day', dusk: 'sunset' } as const;

/**
 * The sky behind the landing page follows the visitor's own clock: night, dawn, day, dusk,
 * with the sun (or moon) on its arc. Dragging "roll the sun" scrubs through the day and shows
 * what time it is around the world: the sun is always rising somewhere.
 */
export function SkyHero({ zone, clock, children }: { zone: Zone; clock: Clock; children: ReactNode }) {
  const now = useNow(30_000);
  const live = wallTime(now, zone);
  const [scrub, setScrub] = useState<number | null>(null);
  const minute = scrub ?? live.minute;
  const sky = skyAt(minute);
  const instant = useMemo(() => (scrub === null ? now : toInstant(live.date, scrub, zone)), [scrub, now, live.date, zone]);

  return (
    <section
      className="hero sky"
      data-text={sky.text}
      style={{ ['--sky-top' as string]: sky.top, ['--sky-bottom' as string]: sky.bottom }}
      aria-label="The sky right now where you are"
    >
      <div className="sky-stars" style={{ opacity: sky.stars }} aria-hidden="true" />
      <div className="sky-arc" aria-hidden="true">
        <span className="sky-body" data-body={sky.body} style={{ left: `${8 + sky.x * 84}%`, bottom: `${6 + sky.height * 70}%` }} />
      </div>
      <div className="sky-content">{children}</div>
      <div className="wrap">
        <div className="roller">
          <div className="spread" style={{ flexWrap: 'wrap', gap: 8 }}>
            <p className="roller-now">
              {scrub === null ? (
                <>
                  It’s <strong>{formatMinute(live.minute, clock)}</strong> in {cityOf(zone)}. {sky.body === 'sun' ? 'The sun’s up.' : 'The sun’s down.'}
                </>
              ) : (
                <>
                  At <strong>{formatMinute(minute, clock)}</strong> in {cityOf(zone)}…
                </>
              )}
            </p>
            {scrub !== null && (
              <button type="button" className="roller-reset" onClick={() => setScrub(null)}>
                Back to now
              </button>
            )}
          </div>
          <label className="roller-label">
            <span>☀ Roll the sun</span>
            <input
              type="range"
              min={0}
              max={1425}
              step={15}
              value={minute - (minute % 15)}
              onChange={(e) => setScrub(Number(e.target.value))}
              aria-valuetext={`${formatMinute(minute, clock)} in ${cityOf(zone)}`}
            />
          </label>
          <ul className="roller-cities" aria-label="The time around the world">
            {CITIES.map((z) => {
              const w = wallTime(instant, z);
              const phase = phaseOf(w.minute);
              return (
                <li key={z} className="roller-city" data-phase={phase}>
                  <span aria-hidden="true">{phaseGlyph(phase)}</span>
                  <span>
                    <strong>{cityOf(z) === 'Kolkata' ? 'Delhi' : cityOf(z)}</strong>
                    <span className="t">
                      {formatMinute(w.minute, clock)} · {PHASE_WORD[phase]}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="sky-horizon" aria-hidden="true" />
    </section>
  );
}

/** Where the logo's sun sits right now: risen by day, sunk behind its band at night. */
export function useLogoSun(): { cy: number; color: string } {
  const now = useNow(60_000);
  const zone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, []);
  let minute = 720;
  try {
    minute = wallTime(now, zone).minute;
  } catch {
    /* unknown zone: keep noon */
  }
  const s = skyAt(minute);
  return s.body === 'sun' ? { cy: 21 - 7 * s.height, color: '#ffc93c' } : { cy: 23, color: '#e9e6ff' };
}

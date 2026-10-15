/**
 * Public booking pages: /<handle>, /<handle>/<link>, /<company>, /<company>/<product>,
 * /<company>/<product>/<link>, the "Booked" page and the guest's manage page.
 * Visitors never need an account; times show in their zone, with the host's beside them.
 */
import { useEffect, useMemo, useState } from 'react';
import { hostStore, setGuideStep, useGuideStep, useHostQuery } from '../../lib/host/hooks';
import { HostError } from '../../lib/host/store';
import type { Booking, PublicTarget, PublicType } from '../../lib/host/types';
import { hoursApart } from '../../lib/booking/slots';
import { Link, navigate, useLocation } from '../../lib/router';
import { cityOf, isValidZone, MINUTE, toInstant, wallTime, type Instant, type IsoDate, type Zone } from '../../lib/time/zone';
import { dateParts, detectClock, formatDate, formatDuration, formatMinute, formatSpan, type Clock } from '../../lib/time/format';
import { phaseGlyph, phaseOf } from '../../lib/time/phase';
import { buildIcs, googleCalendarUrl } from '../../lib/calendar/ics';
import { downloadFile } from '../../lib/share/card';
import { detectZone, preferredLocale } from '../../lib/identity';
import { BRAND } from '../../lib/brand';
import { Spinner, useToast } from '../../components/ui';
import { ZoneLine } from '../../components/pickers';
import { GuideCard } from '../../components/Guide';
import { useNow } from '../../lib/hooks';
import NotFound from '../NotFound';

function errText(e: unknown): string {
  if (e instanceof HostError) return e.message.charAt(0).toUpperCase() + e.message.slice(1) + '.';
  return 'Something went wrong. Please try again.';
}

/** The visitor's zone: ?vz=… (used by the demo) or this device's zone. */
function useVisitorZone(): [Zone, (z: Zone) => void] {
  const loc = useLocation();
  const fromUrl = loc.search.get('vz');
  const [zone, setZone] = useState<Zone>(() => (fromUrl && isValidZone(fromUrl) ? fromUrl : detectZone()));
  useEffect(() => {
    if (fromUrl && isValidZone(fromUrl)) setZone(fromUrl);
  }, [fromUrl]);
  return [zone, setZone];
}

function Brand({ name, emoji, color, sub }: { name: string; emoji: string; color: string; sub?: string }) {
  return (
    <div className="brand-head" style={{ ['--brand' as string]: color }}>
      <span className="brand-logo" aria-hidden="true">
        {emoji}
      </span>
      <div>
        <p className="brand-name">{name}</p>
        {sub && <p className="small muted">{sub}</p>}
      </div>
    </div>
  );
}

/** Entry point for any path that isn't one of the app's own routes. */
export default function PublicPath({ segments }: { segments: string[] }) {
  const loc = useLocation();
  const { data, error } = useHostQuery((s) => s.resolve(segments), [segments.join('/')]);
  if (error) return <NotFound />;
  if (data === null) return <Spinner />;
  return <Resolved target={data} at={loc.path} />;
}

function Resolved({ target, at }: { target: PublicTarget | null; at: string }) {
  if (!target) return <NotFound />;
  if (target.kind === 'company')
    return (
      <div className="wrap-narrow stack public" style={{ ['--gap' as string]: '18px', paddingBlock: '28px 64px' }}>
        <Brand name={target.workspace.name} emoji={target.workspace.emoji} color={target.workspace.color} sub="Pick a product to book time with the team." />
        <ul className="type-list">
          {target.products.map((p) => (
            <li key={p.id}>
              <Link to={p.path} className="type-card" style={{ ['--brand' as string]: p.color }}>
                <span className="brand-logo small-logo" aria-hidden="true">
                  {p.emoji}
                </span>
                <span>
                  <strong>{p.name}</strong>
                  <span className="small muted" style={{ display: 'block' }}>
                    {p.types} {p.types === 1 ? 'way' : 'ways'} to book
                  </span>
                </span>
                <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  if (target.kind === 'host')
    return (
      <div className="wrap-narrow stack public" style={{ ['--gap' as string]: '18px', paddingBlock: '28px 64px' }}>
        <Brand name={target.title} emoji={target.emoji} color={target.color} sub={target.subtitle} />
        {target.types.length === 0 && <p className="callout" data-tone="quiet">No links here yet.</p>}
        <ul className="type-list">
          {target.types.map((t) => (
            <li key={t.id}>
              <Link to={t.path} className="type-card" style={{ ['--brand' as string]: t.brand.color }}>
                <span>
                  <strong>{t.title}</strong>
                  <span className="small muted" style={{ display: 'block' }}>
                    {formatDuration(t.durationMin)} · Google Meet · with {t.host.name}
                  </span>
                </span>
                <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  return <BookType type={target.type} at={at} />;
}

/* ── Picking a time ──────────────────────────────────────────────────────────────────── */

function SlotPicker({ type, visitorZone, clock, locale, selected, onPick, exclude }: { type: PublicType; visitorZone: Zone; clock: Clock; locale: string; selected: Instant | null; onPick: (t: Instant) => void; exclude?: Instant }) {
  const now = useNow(60_000);
  const { data } = useHostQuery((s) => s.publicSlots(type.id, now, 21), [type.id, Math.floor(now / 600_000)]);
  const slots = useMemo(() => (data?.slots ?? []).filter((t) => t !== exclude), [data, exclude]);
  const byDay = useMemo(() => {
    const m = new Map<IsoDate, Instant[]>();
    for (const t of slots) {
      const d = wallTime(t, visitorZone).date;
      m.set(d, [...(m.get(d) ?? []), t]);
    }
    return m;
  }, [slots, visitorZone]);
  const days = [...byDay.keys()];
  const [day, setDay] = useState<IsoDate | null>(null);
  const current = day && byDay.has(day) ? day : days[0] ?? null;
  if (!data) return <Spinner />;
  if (days.length === 0) return <p className="callout" data-tone="quiet">No open times in the next three weeks. Check back soon.</p>;
  const daySlots = current ? byDay.get(current)! : [];
  const host = type.host;
  const dayStart = current ? toInstant(current, 0, visitorZone) : 0;

  return (
    <div className="stack" style={{ ['--gap' as string]: '14px' }}>
      <div className="day-chips" role="group" aria-label="Pick a day (your time)">
        {days.map((d) => {
          const p = dateParts(d, locale);
          return (
            <button key={d} type="button" className="day-chip" aria-pressed={d === current} onClick={() => setDay(d)}>
              <span className="wd">{p.weekday}</span>
              <span className="dd">
                {p.month} {p.day}
              </span>
              <span className="count">{byDay.get(d)!.length}</span>
            </button>
          );
        })}
      </div>
      {current && (
        <div className="duo" aria-hidden="true">
          {[
            { who: 'You', zone: visitorZone },
            { who: host.name, zone: host.zone },
          ].map((row) => (
            <div key={row.who} className="duo-lane">
              <span className="duo-who">
                <strong>{row.who}</strong>
                <span>{cityOf(row.zone)}</span>
              </span>
              <span className="bands-strip duo-strip">
                {Array.from({ length: 48 }, (_, i) => (
                  <i key={i} data-phase={phaseOf(wallTime(dayStart + i * 30 * MINUTE, row.zone).minute)} />
                ))}
                {daySlots.map((t) => (
                  <b key={t} className="duo-tick" data-on={t === selected || undefined} style={{ left: `${((t - dayStart) / (24 * 60 * MINUTE)) * 100}%`, width: `${(type.durationMin / 1440) * 100}%` }} />
                ))}
              </span>
            </div>
          ))}
          <p className="small muted">Gold marks are open times. Colours show each side’s night, morning, day and evening.</p>
        </div>
      )}
      <ul className="slot-grid" aria-label={`Open times on ${current ? formatDate(current, locale) : ''}`}>
        {daySlots.map((t) => {
          const you = wallTime(t, visitorZone).minute;
          const them = wallTime(t, host.zone);
          const theirDay = them.date !== current ? ` (${formatDate(them.date, locale).split(',')[0]})` : '';
          return (
            <li key={t}>
              <button type="button" className="slot" aria-pressed={selected === t} onClick={() => onPick(t)}>
                <span className="slot-you">
                  <span aria-hidden="true">{phaseGlyph(phaseOf(you))}</span> {formatMinute(you, clock)}
                </span>
                <span className="slot-them">
                  {formatMinute(them.minute, clock)}
                  {theirDay} for {host.name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function farAwayNote(type: PublicType, visitorZone: Zone, slots: Instant[], now: Instant): string | null {
  const diff = hoursApart(type.host.zone, visitorZone, now);
  if (Math.abs(diff) < 5) return null;
  const n = Math.abs(diff);
  const amount = Number.isInteger(n) ? `${n} hours` : `${n.toFixed(1)} hours`;
  const phases = slots.map((t) => phaseOf(wallTime(t, visitorZone).minute));
  const counts = { night: 0, dawn: 0, day: 0, dusk: 0 } as Record<string, number>;
  phases.forEach((p) => counts[p]++);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const word = top === 'night' ? 'your night' : top === 'dawn' ? 'your early morning' : top === 'dusk' ? 'your evening' : 'your day';
  return `${type.host.name} is ${amount} ${diff > 0 ? 'ahead of' : 'behind'} you, so most open times fall in ${word}. Every time below shows both sides.`;
}

function BookType({ type, at }: { type: PublicType; at: string }) {
  const toast = useToast();
  const now = useNow(60_000);
  const clock = useMemo(() => detectClock(preferredLocale()), []);
  const locale = useMemo(preferredLocale, []);
  const [visitorZone, setVisitorZone] = useVisitorZone();
  const [selected, setSelected] = useState<Instant | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guide = useGuideStep();
  const { data } = useHostQuery((s) => s.publicSlots(type.id, now, 21), [type.id, Math.floor(now / 600_000)]);
  const note2 = data ? farAwayNote(type, visitorZone, data.slots, now) : null;

  useEffect(() => {
    document.title = `${type.title} · ${type.brand.name} · ${BRAND.name}`;
  }, [type]);

  return (
    <div className="wrap stack public" style={{ ['--gap' as string]: '18px', paddingBlock: '24px 72px', maxWidth: 860, ['--brand' as string]: type.brand.color }}>
      <GuideCard at={at} />
      <Brand name={type.brand.name} emoji={type.brand.emoji} color={type.brand.color} />
      <header className="stack" style={{ ['--gap' as string]: '6px' }}>
        <h1 style={{ fontSize: 'var(--step-3)' }}>{type.title}</h1>
        <p className="event-meta">
          <span>
            {type.host.emoji} with {type.host.name}
          </span>
          <span>⏱ {formatDuration(type.durationMin)}</span>
          <span>🎥 Google Meet</span>
        </p>
        {type.description && <p className="muted">{type.description}</p>}
      </header>
      <ZoneLine zone={visitorZone} now={now} onChange={setVisitorZone} prefix="Times are in your time zone:" />
      {note2 && (
        <p className="callout" data-tone="info">
          <span aria-hidden="true">🌍</span>
          <span>{note2}</span>
        </p>
      )}

      {!selected ? (
        <SlotPicker type={type} visitorZone={visitorZone} clock={clock} locale={locale} selected={selected} onPick={setSelected} />
      ) : (
        <form
          className="ws-card stack"
          style={{ ['--gap' as string]: '14px' }}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const { booking, manageToken } = await hostStore().book(type.id, selected, { name, email, zone: visitorZone, note });
              try {
                sessionStorage.setItem(`sunroll:booked:${booking.id}`, manageToken);
              } catch {
                /* ignore */
              }
              if (guide === 3) setGuideStep(4);
              navigate(`/booked/${booking.id}#t=${encodeURIComponent(manageToken)}`);
            } catch (err) {
              setError(errText(err));
              if (err instanceof HostError && err.code === 'taken') {
                toast('That time just went. Pick another.', 'error');
                setSelected(null);
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="spread" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <p className="small muted" style={{ fontWeight: 700 }}>
                {formatDate(wallTime(selected, visitorZone).date, locale)} · your time
              </p>
              <p className="num" style={{ fontSize: 'var(--step-3)', lineHeight: 1 }}>
                {formatSpan(selected, selected + type.durationMin * MINUTE, visitorZone, clock)}
              </p>
              <p className="small muted" style={{ fontWeight: 600 }}>
                {formatSpan(selected, selected + type.durationMin * MINUTE, type.host.zone, clock)} {formatDate(wallTime(selected, type.host.zone).date, locale)} for {type.host.name} in {cityOf(type.host.zone)}
              </p>
            </div>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(null)}>
              Change time
            </button>
          </div>
          <label className="field">
            <span className="small" style={{ fontWeight: 700 }}>
              Your name
            </span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required autoFocus />
          </label>
          <label className="field">
            <span className="small" style={{ fontWeight: 700 }}>
              Your email
            </span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            <span className="field-hint">Only used for this booking: your confirmation, the calendar invite, and a link to change it.</span>
          </label>
          <label className="field">
            <span className="small" style={{ fontWeight: 700 }}>
              Anything {type.host.name} should know? (optional)
            </span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </label>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? 'Booking…' : 'Confirm booking'}
          </button>
        </form>
      )}
      <p className="small faint">
        Booking with {BRAND.name}: no account needed.{' '}
        <Link to="/" className="link-btn muted small">
          Find a time with a whole group →
        </Link>
      </p>
    </div>
  );
}

/* ── Booked, and the guest's manage page ────────────────────────────────────────────── */

function useBooking(id: string) {
  const loc = useLocation();
  const token = useMemo(() => {
    const m = /(?:^|&)t=([^&]+)/.exec(loc.hash);
    if (m) return decodeURIComponent(m[1]);
    try {
      return sessionStorage.getItem(`sunroll:booked:${id}`) ?? '';
    } catch {
      return '';
    }
  }, [loc.hash, id]);
  const q = useHostQuery((s) => s.getBooking(id, token), [id, token]);
  return { ...q, token };
}

function CalendarAdd({ b, type }: { b: Booking; type: PublicType }) {
  const base = { title: `${type.title} with ${type.host.name}`, start: b.start, end: b.end, description: `Booked with ${BRAND.name}. Google Meet link in the invite.` };
  return (
    <div className="row-wrap">
      <a className="btn btn-sm" href={googleCalendarUrl(base)} target="_blank" rel="noopener noreferrer">
        Google Calendar
      </a>
      <button type="button" className="btn btn-sm" onClick={() => downloadFile(new File([buildIcs({ ...base, uid: `${b.id}@sunroll`, sequence: b.sequence, stamp: Date.now() }, BRAND.name)], 'booking.ics', { type: 'text/calendar' }))}>
        Apple / Outlook (.ics)
      </button>
    </div>
  );
}

export function Booked({ id }: { id: string }) {
  const loc = useLocation();
  const clock = useMemo(() => detectClock(preferredLocale()), []);
  const locale = useMemo(preferredLocale, []);
  const { data, error, token } = useBooking(id);
  const { data: outbox } = useHostQuery((s) => s.outbox());
  if (error) return <NotFound />;
  if (!data) return <Spinner />;
  const { booking: b, type } = data;
  const mine = (outbox ?? []).filter((m) => m.bookingId === b.id && m.to === b.guestEmail);
  return (
    <div className="wrap-narrow stack public" style={{ ['--gap' as string]: '18px', paddingBlock: '24px 72px', ['--brand' as string]: type.brand.color }}>
      <GuideCard at={loc.path} />
      <section className="locked stack" style={{ ['--gap' as string]: '14px' }} aria-labelledby="booked-title">
        <span className="eyebrow">
          {type.brand.emoji} {type.brand.name}
        </span>
        <h1 id="booked-title" style={{ fontSize: 'var(--step-4)', lineHeight: 0.95 }}>
          You’re booked.
        </h1>
        <div>
          <p className="muted" style={{ fontWeight: 700 }}>
            {formatDate(wallTime(b.start, b.guestZone).date, locale)} · your time in {cityOf(b.guestZone)}
          </p>
          <p className="big-time" style={{ fontSize: 'var(--step-4)' }}>
            {formatSpan(b.start, b.end, b.guestZone, clock)}
          </p>
          <p className="muted" style={{ fontWeight: 600 }}>
            {type.title} with {type.host.name}: {formatSpan(b.start, b.end, type.host.zone, clock)} {formatDate(wallTime(b.start, type.host.zone).date, locale)} in {cityOf(type.host.zone)}
          </p>
        </div>
        <p className="small muted">🎥 A Google Meet link comes with the calendar invite. (This demo doesn’t create a real one.)</p>
        <CalendarAdd b={b} type={type} />
      </section>
      <div className="ws-card stack" style={{ ['--gap' as string]: '8px' }}>
        <strong>Need to change it?</strong>
        <p className="small muted">This private link lets you reschedule or cancel. It’s also in your confirmation email.</p>
        <Link to={`/booking/${b.id}#t=${encodeURIComponent(token)}`} className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>
          Manage booking
        </Link>
      </div>
      {mine[0] && (
        <details className="disclosure" open>
          <summary>The confirmation email (demo preview, not sent)</summary>
          <div className="email-preview">
            <span className="small muted">To {mine[0].to}</span>
            <strong>{mine[0].subject}</strong>
            <pre>{mine[0].body}</pre>
          </div>
        </details>
      )}
    </div>
  );
}

export function ManageBooking({ id }: { id: string }) {
  const toast = useToast();
  const clock = useMemo(() => detectClock(preferredLocale()), []);
  const locale = useMemo(preferredLocale, []);
  const { data, error, token } = useBooking(id);
  const [picking, setPicking] = useState(false);
  const [newTime, setNewTime] = useState<Instant | null>(null);
  if (error) return <NotFound />;
  if (!data) return <Spinner />;
  const { booking: b, type } = data;
  const cancelled = b.status === 'cancelled';
  return (
    <div className="wrap stack public" style={{ ['--gap' as string]: '18px', paddingBlock: '24px 72px', maxWidth: 860 }}>
      <Brand name={type.brand.name} emoji={type.brand.emoji} color={type.brand.color} />
      <h1 style={{ fontSize: 'var(--step-3)' }}>{cancelled ? 'This booking is cancelled.' : `${type.title} with ${type.host.name}`}</h1>
      <p className="muted" style={{ fontWeight: 600 }}>
        {formatDate(wallTime(b.start, b.guestZone).date, locale)} · {formatSpan(b.start, b.end, b.guestZone, clock)} your time ({cityOf(b.guestZone)})
      </p>
      {!cancelled && !picking && (
        <div className="row-wrap">
          <button type="button" className="btn btn-primary" onClick={() => setPicking(true)}>
            Pick a new time
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-danger"
            onClick={async () => {
              await hostStore().cancel(b.id, token);
              toast('Cancelled. We let them know.');
            }}
          >
            Cancel booking
          </button>
        </div>
      )}
      {picking && !cancelled && (
        <>
          <SlotPicker type={type} visitorZone={b.guestZone} clock={clock} locale={locale} selected={newTime} onPick={setNewTime} exclude={b.start} />
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={newTime === null}
              onClick={async () => {
                try {
                  await hostStore().reschedule(b.id, token, newTime!);
                  setPicking(false);
                  setNewTime(null);
                  toast('Moved. Everyone gets the new time.');
                } catch (err) {
                  toast(errText(err), 'error');
                }
              }}
            >
              Move it here
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setPicking(false)}>
              Keep the current time
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** /demo/booking: sign in as the demo host and start the guided tour. */
export function StartBookingDemo() {
  useEffect(() => {
    void hostStore()
      .signIn()
      .then(() => {
        setGuideStep(0);
        navigate('/app', { replace: true });
      });
  }, []);
  return <Spinner label="Setting up the booking demo" />;
}

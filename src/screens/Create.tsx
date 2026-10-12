import { useEffect, useMemo, useState } from 'react';
import { useNow, useStore } from '../lib/hooks';
import { navigate, useLocation } from '../lib/router';
import { detectZone, getProfile, preferredLocale, saveProfile, setCredentials, setOrganizerToken } from '../lib/identity';
import { cityOf, wallTime, type IsoDate, type Zone } from '../lib/time/zone';
import { detectClock, formatDuration, type Clock } from '../lib/time/format';
import { windowLength } from '../lib/time/slots';
import { datesFor, templateBySlug, TEMPLATES, type DayPattern } from '../lib/templates';
import { DURATIONS, eventProblem, participantProblem } from '../lib/data/validate';
import { StoreError } from '../lib/data/store';
import type { NewEvent } from '../lib/data/types';
import { copy, NAME_PLACEHOLDERS } from '../lib/copy';
import { EVENT_EMOJI, DayPicker, EmojiButton, PERSON_EMOJI, TimeSelect, ZoneLine } from '../components/pickers';
import { useToast } from '../components/ui';

const QUICK: { pattern: DayPattern; label: string }[] = [
  { pattern: 'next7', label: 'Next 7 days' },
  { pattern: 'weekdays', label: 'Weekdays' },
  { pattern: 'weekend', label: 'Weekends' },
  { pattern: 'next14', label: 'Next 2 weeks' },
];

export default function CreateScreen() {
  const store = useStore();
  const loc = useLocation();
  const toast = useToast();
  const now = useNow();
  const locale = useMemo(preferredLocale, []);
  const clock: Clock = useMemo(() => detectClock(locale), [locale]);
  const profile = useMemo(getProfile, []);

  const template = templateBySlug(loc.search.get('t'));
  const referrer = loc.search.get('ref');
  const duplicateOf = loc.search.get('from');

  const [zone, setZone] = useState<Zone>(detectZone);
  const today: IsoDate = wallTime(now, zone).date;

  const [title, setTitle] = useState(template?.name ?? '');
  const [emoji, setEmoji] = useState(template?.emoji ?? '☀️');
  const [dates, setDates] = useState<IsoDate[]>(() => datesFor(template?.dayPattern ?? 'next7', wallTime(Date.now(), detectZone()).date));
  const [windowStart, setWindowStart] = useState(template?.windowStartMin ?? 8 * 60);
  const [windowEnd, setWindowEnd] = useState(template?.windowEndMin ?? 22 * 60);
  const [duration, setDuration] = useState(template?.durationMinutes ?? 60);
  const [name, setName] = useState(profile?.name ?? '');
  const [hostEmoji, setHostEmoji] = useState(profile?.emoji ?? PERSON_EMOJI[0]);
  const [expected, setExpected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [placeholder, setPlaceholder] = useState(0);

  // Rotate the playful placeholder while the name is empty.
  useEffect(() => {
    if (title) return;
    const t = window.setInterval(() => setPlaceholder((p) => (p + 1) % NAME_PLACEHOLDERS.length), 2200);
    return () => window.clearInterval(t);
  }, [title]);

  // Duplicate: copy everything but the dates from an existing event.
  useEffect(() => {
    if (!store || !duplicateOf) return;
    void store.getSnapshot(duplicateOf).then((s) => {
      if (!s) return;
      setTitle(s.event.title);
      setEmoji(s.event.emoji);
      setWindowStart(s.event.windowStartMin);
      setWindowEnd(s.event.windowEndMin);
      setDuration(s.event.durationMinutes);
      setExpected(s.event.expectedCount);
    });
  }, [store, duplicateOf]);

  const crossesMidnight = windowEnd <= windowStart && windowEnd !== 0;
  const fits = duration <= windowLength(windowStart, windowEnd);

  const submit = async () => {
    if (!store) return;
    const event: NewEvent = {
      title: title.trim(),
      emoji,
      color: 'sun',
      timezone: zone,
      dates,
      windowStartMin: windowStart,
      windowEndMin: windowEnd,
      slotMinutes: 30,
      durationMinutes: duration,
      expectedCount: expected,
      templateSlug: template?.slug ?? null,
      referredByEventId: referrer && /^[1-9A-HJ-NP-Za-km-z]{14}$/.test(referrer) ? referrer : null,
    };
    const host = { name: name.trim(), emoji: hostEmoji, color: profile?.color ?? ('coral' as const), timezone: zone, sleep: profile?.sleep, work: profile?.work };
    const problem = eventProblem(event, today) ?? participantProblem(host);
    if (problem) {
      setError(problem);
      document.getElementById('create-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await store.createEvent(event, host);
      setOrganizerToken(r.eventId, r.organizerToken);
      setCredentials(r.eventId, { participantId: r.participantId, token: r.participantToken });
      saveProfile({
        name: host.name,
        emoji: hostEmoji,
        color: host.color,
        sleep: profile?.sleep ?? { start: 23 * 60, end: 7 * 60 },
        work: profile?.work ?? { start: 9 * 60, end: 17 * 60 },
      });
      navigate(`/e/${r.eventId}?welcome=1`);
    } catch (err) {
      const msg =
        err instanceof StoreError
          ? err.code === 'rate_limited'
            ? copy.errors.rate
            : err.code === 'network'
              ? copy.errors.network
              : err.message
          : copy.errors.generic;
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="create-page">
      <form
        className="wrap-narrow stack"
        style={{ ['--gap' as string]: '28px', paddingBlock: '24px 40px' }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        <header className="stack" style={{ ['--gap' as string]: '6px' }}>
          <span className="eyebrow">{template ? `${template.emoji} ${template.name} template` : duplicateOf ? 'Duplicate' : 'New event'}</span>
          <h1 style={{ fontSize: 'var(--step-4)' }}>{copy.create.title}</h1>
        </header>

        <div className="row" style={{ alignItems: 'stretch' }}>
          <EmojiButton value={emoji} options={EVENT_EMOJI} onChange={setEmoji} label="Event emoji" />
          <label className="sr-only" htmlFor="title">
            Event name
          </label>
          <input
            id="title"
            className="input input-xl"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={NAME_PLACEHOLDERS[placeholder]}
            maxLength={80}
            autoFocus={!template}
            autoComplete="off"
            enterKeyHint="next"
          />
        </div>
        {!template && !duplicateOf && (
          <div className="row-wrap" aria-label="Templates">
            {TEMPLATES.slice(0, 5).map((t) => (
              <button
                key={t.slug}
                type="button"
                className="chip"
                onClick={() => {
                  setTitle(t.name);
                  setEmoji(t.emoji);
                  setDates(datesFor(t.dayPattern, today));
                  setWindowStart(t.windowStartMin);
                  setWindowEnd(t.windowEndMin);
                  setDuration(t.durationMinutes);
                  navigate(`/new?t=${t.slug}${referrer ? `&ref=${referrer}` : ''}`, { replace: true });
                }}
              >
                <span aria-hidden="true">{t.emoji}</span> {t.name}
              </button>
            ))}
          </div>
        )}

        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">{copy.create.days}</legend>
          <div className="row-wrap" style={{ margin: '10px 0 14px' }} role="group" aria-label="Quick picks">
            {QUICK.map((q) => {
              const set = datesFor(q.pattern, today);
              const pressed = set.length === dates.length && set.every((d, i) => d === dates[i]);
              return (
                <button key={q.pattern} type="button" className="chip" aria-pressed={pressed} onClick={() => setDates(set)}>
                  {q.label}
                </button>
              );
            })}
          </div>
          <div className="card card-tight">
            <DayPicker value={dates} onChange={setDates} today={today} locale={locale} />
          </div>
          <span className="field-hint">
            {dates.length} {dates.length === 1 ? 'day' : 'days'} picked · tap or drag to change · up to 14
          </span>
        </fieldset>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">{copy.create.window}</legend>
          <div className="row" style={{ marginTop: 10 }}>
            <TimeSelect value={windowStart} onChange={setWindowStart} label="From" clock={clock} />
            <span aria-hidden="true" className="muted">
              to
            </span>
            <TimeSelect value={windowEnd} onChange={setWindowEnd} label="To" clock={clock} allowEndOfDay />
          </div>
          <span className="field-hint">
            {crossesMidnight ? 'Runs past midnight into the next day. ' : ''}A wide window helps people in other time zones.
          </span>
        </fieldset>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">{copy.create.length}</legend>
          <div className="row-wrap" role="radiogroup" aria-label="Meeting length" style={{ marginTop: 10 }}>
            {DURATIONS.map((d) => (
              <button key={d} type="button" className="chip" role="radio" aria-checked={duration === d} onClick={() => setDuration(d)}>
                {formatDuration(d)}
              </button>
            ))}
          </div>
          {!fits && <span className="error-text">That’s longer than the time window.</span>}
        </fieldset>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">{copy.create.you}</legend>
          <div className="row" style={{ alignItems: 'flex-end', marginTop: 10 }}>
            <EmojiButton value={hostEmoji} options={PERSON_EMOJI} onChange={setHostEmoji} label="Your emoji" />
            <label className="field" style={{ flex: 1 }}>
              <span className="small muted" style={{ fontWeight: 700 }}>
                Your name, so guests know who invited them
              </span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="given-name" placeholder="Nadia" />
            </label>
          </div>
        </fieldset>

        <details className="disclosure">
          <summary>{copy.create.group}</summary>
          <div className="row" style={{ paddingTop: 8 }}>
            <button type="button" className="icon-btn" aria-label="Fewer people" onClick={() => setExpected((n) => (n === null || n <= 2 ? null : n - 1))} style={{ border: '1.5px solid var(--line-strong)' }}>
              −
            </button>
            <span className="num" style={{ fontSize: 'var(--step-2)', minWidth: 72, textAlign: 'center' }} aria-live="polite">
              {expected ?? 'Not sure'}
            </span>
            <button type="button" className="icon-btn" aria-label="More people" onClick={() => setExpected((n) => Math.min(50, (n ?? 1) + 1))} style={{ border: '1.5px solid var(--line-strong)' }}>
              +
            </button>
            <span className="small muted">{copy.create.groupHint}</span>
          </div>
        </details>

        <div className="panel">
          <ZoneLine zone={zone} now={now} onChange={setZone} />
          <p className="small muted" style={{ marginTop: 4 }}>
            {copy.create.zone(cityOf(zone))}
          </p>
        </div>

        {error && (
          <p id="create-error" className="error-text" role="alert" style={{ fontSize: 'var(--step-0)' }}>
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || !store}>
          {busy ? copy.create.submitting : `${copy.create.submit} →`}
        </button>
        <p className="small faint" style={{ textAlign: 'center' }}>
          No account needed. We keep only names and time zones, and delete everything 90 days after the last day.
        </p>
      </form>
    </div>
  );
}

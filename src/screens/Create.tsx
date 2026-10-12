import { useEffect, useMemo, useRef, useState } from 'react';
import { useNow, useStore } from '../lib/hooks';
import { navigate, useLocation } from '../lib/router';
import { detectZone, getProfile, preferredLocale, saveProfile, setCredentials, setOrganizerToken } from '../lib/identity';
import { cityOf, wallTime, type IsoDate, type Zone } from '../lib/time/zone';
import { detectClock, formatDate, formatDuration, formatMinute, type Clock } from '../lib/time/format';
import { windowLength } from '../lib/time/slots';
import { datesFor, templateBySlug, TEMPLATES, type DayPattern } from '../lib/templates';
import { DURATIONS, eventProblem, participantProblem } from '../lib/data/validate';
import { StoreError } from '../lib/data/store';
import type { NewEvent } from '../lib/data/types';
import { copy, NAME_PLACEHOLDERS } from '../lib/copy';
import { EVENT_EMOJI, DayPicker, EmojiButton, PERSON_EMOJI, TimeSelect, ZoneLine } from '../components/pickers';
import { useToast } from '../components/ui';

/**
 * Creating an event, one question per screen. Nothing is chosen for you without you seeing
 * it, and every choice is said back in plain words.
 */

const QUICK: { pattern: DayPattern; label: string }[] = [
  { pattern: 'next7', label: 'The next 7 days' },
  { pattern: 'weekdays', label: 'Next 5 weekdays' },
  { pattern: 'weekend', label: 'Next 2 weekends' },
];

const WINDOWS: { id: string; label: string; start: number; end: number; emoji: string }[] = [
  { id: 'morning', label: 'Mornings', start: 8 * 60, end: 12 * 60, emoji: '🌅' },
  { id: 'work', label: 'Work hours', start: 9 * 60, end: 17 * 60, emoji: '💼' },
  { id: 'evening', label: 'Evenings', start: 17 * 60, end: 22 * 60, emoji: '🌆' },
  { id: 'any', label: 'Any time of day', start: 8 * 60, end: 22 * 60, emoji: '☀️' },
];

const STEPS = ['Name', 'Days', 'Times', 'Length', 'You'] as const;

function durationWords(m: number): string {
  if (m === 30) return '30 minutes';
  if (m === 60) return '1 hour';
  if (m % 60 === 0) return `${m / 60} hours`;
  return `${Math.floor(m / 60)}½ hours`;
}

export default function CreateScreen() {
  const store = useStore();
  const loc = useLocation();
  const toast = useToast();
  const now = useNow();
  const locale = useMemo(preferredLocale, []);
  const clock: Clock = useMemo(() => detectClock(locale), [locale]);
  const profile = useMemo(getProfile, []);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const template = templateBySlug(loc.search.get('t'));
  const referrer = loc.search.get('ref');
  const duplicateOf = loc.search.get('from');

  const [step, setStep] = useState(0);
  const [zone, setZone] = useState<Zone>(detectZone);
  const today: IsoDate = wallTime(now, zone).date;

  const [title, setTitle] = useState(template?.name ?? '');
  const [emoji, setEmoji] = useState(template?.emoji ?? '☀️');
  const [dates, setDates] = useState<IsoDate[]>([]);
  const [windowStart, setWindowStart] = useState(template?.windowStartMin ?? 8 * 60);
  const [windowEnd, setWindowEnd] = useState(template?.windowEndMin ?? 22 * 60);
  const [windowChosen, setWindowChosen] = useState(!!template);
  const [customTimes, setCustomTimes] = useState(false);
  const [duration, setDuration] = useState(template?.durationMinutes ?? 60);
  const [name, setName] = useState(profile?.name ?? '');
  const [hostEmoji, setHostEmoji] = useState(profile?.emoji ?? PERSON_EMOJI[0]);
  const [expected, setExpected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [placeholder, setPlaceholder] = useState(0);

  useEffect(() => {
    if (title) return;
    const t = window.setInterval(() => setPlaceholder((p) => (p + 1) % NAME_PLACEHOLDERS.length), 2200);
    return () => window.clearInterval(t);
  }, [title]);

  // Duplicate: copy everything but the days from an existing event.
  useEffect(() => {
    if (!store || !duplicateOf) return;
    void store.getSnapshot(duplicateOf).then((s) => {
      if (!s) return;
      setTitle(s.event.title);
      setEmoji(s.event.emoji);
      setWindowStart(s.event.windowStartMin);
      setWindowEnd(s.event.windowEndMin);
      setWindowChosen(true);
      setDuration(s.event.durationMinutes);
      setExpected(s.event.expectedCount);
    });
  }, [store, duplicateOf]);

  // Move focus to the new question so screen readers (and eyes) land in the right place.
  useEffect(() => {
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);

  const presetId = WINDOWS.find((w) => w.start === windowStart && w.end === windowEnd)?.id;
  const fits = duration <= windowLength(windowStart, windowEnd);
  const timesSentence = `between ${formatMinute(windowStart, clock)} and ${windowEnd === 1440 ? 'midnight' : formatMinute(windowEnd, clock)}${windowEnd <= windowStart && windowEnd !== 0 ? ' (the next day)' : ''}`;

  const stepProblem = (): string | null => {
    if (step === 0 && !title.trim()) return 'Give your event a name first.';
    if (step === 1 && dates.length === 0) return 'Tap at least one day on the calendar.';
    if (step === 2 && !windowChosen) return 'Pick a time of day.';
    if (step === 2 && windowLength(windowStart, windowEnd) < 30) return 'The end time needs to be after the start time.';
    if (step === 3 && !fits) return `That’s longer than the times you picked (${timesSentence}).`;
    return null;
  };

  const next = () => {
    const p = stepProblem();
    if (p) {
      setError(p);
      return;
    }
    setError(null);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const back = () => {
    setError(null);
    if (step === 0) navigate('/');
    else setStep((s) => s - 1);
  };

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
      const msg = err instanceof StoreError ? (err.code === 'rate_limited' ? copy.errors.rate : err.code === 'network' ? copy.errors.network : err.message) : copy.errors.generic;
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const last = step === STEPS.length - 1;

  return (
    <div className="create-page">
      <form
        className="wrap-narrow stack wizard"
        style={{ ['--gap' as string]: '24px', paddingBlock: '20px 140px' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (last) void submit();
          else next();
        }}
        noValidate
      >
        <div className="wizard-progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <span key={s} className="wizard-dot" data-state={i < step ? 'done' : i === step ? 'current' : 'todo'}>
              <span className="sr-only">
                {s}
                {i < step ? ' (done)' : i === step ? ' (current)' : ''}
              </span>
            </span>
          ))}
          <span className="small muted" style={{ marginLeft: 8, fontWeight: 700 }}>
            Step {step + 1} of {STEPS.length}
          </span>
        </div>

        {step === 0 && (
          <section className="stack" style={{ ['--gap' as string]: '18px' }}>
            <h1 ref={headingRef} tabIndex={-1} className="wizard-q">
              What are you planning?
            </h1>
            <p className="muted">Give it a name your group will recognise.</p>
            <div className="row" style={{ alignItems: 'stretch' }}>
              <EmojiButton value={emoji} options={EVENT_EMOJI} onChange={setEmoji} label="Pick an emoji" />
              <label className="sr-only" htmlFor="title">
                Event name
              </label>
              <input id="title" className="input input-xl" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={NAME_PLACEHOLDERS[placeholder]} maxLength={80} autoComplete="off" enterKeyHint="next" />
            </div>
            {!duplicateOf && (
              <div className="stack" style={{ ['--gap' as string]: '8px' }}>
                <p className="small muted" style={{ fontWeight: 700 }}>
                  Or start from an idea:
                </p>
                <div className="row-wrap">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.slug}
                      type="button"
                      className="chip"
                      aria-pressed={template?.slug === t.slug}
                      onClick={() => {
                        setTitle(t.name);
                        setEmoji(t.emoji);
                        setWindowStart(t.windowStartMin);
                        setWindowEnd(t.windowEndMin);
                        setWindowChosen(true);
                        setDuration(t.durationMinutes);
                        navigate(`/new?t=${t.slug}${referrer ? `&ref=${referrer}` : ''}`, { replace: true });
                      }}
                    >
                      <span aria-hidden="true">{t.emoji}</span> {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {step === 1 && (
          <section className="stack" style={{ ['--gap' as string]: '16px' }}>
            <h1 ref={headingRef} tabIndex={-1} className="wizard-q">
              Which days could work?
            </h1>
            <p className="muted">Tap every day that might work. Your group will pick their times on these days.</p>
            <div className="card card-tight">
              <DayPicker value={dates} onChange={setDates} today={today} locale={locale} />
            </div>
            <div className="row-wrap">
              <span className="small muted" style={{ fontWeight: 700 }}>
                Shortcuts:
              </span>
              {QUICK.map((q) => (
                <button key={q.pattern} type="button" className="chip" onClick={() => setDates(datesFor(q.pattern, today))}>
                  {q.label}
                </button>
              ))}
              {dates.length > 0 && (
                <button type="button" className="chip" onClick={() => setDates([])}>
                  Clear
                </button>
              )}
            </div>
            <div className="choice-summary" aria-live="polite">
              {dates.length === 0 ? (
                <span className="muted">No days picked yet.</span>
              ) : (
                <>
                  <strong>
                    You picked {dates.length} {dates.length === 1 ? 'day' : 'days'}:
                  </strong>{' '}
                  {dates.map((d) => formatDate(d, locale)).join(' · ')}
                </>
              )}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="stack" style={{ ['--gap' as string]: '16px' }}>
            <h1 ref={headingRef} tabIndex={-1} className="wizard-q">
              What time of day?
            </h1>
            <p className="muted">People will only be able to pick times inside this range.</p>
            <div className="option-cards" role="radiogroup" aria-label="Time of day">
              {WINDOWS.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  role="radio"
                  aria-checked={windowChosen && !customTimes && presetId === w.id}
                  className="option-card"
                  onClick={() => {
                    setWindowStart(w.start);
                    setWindowEnd(w.end);
                    setWindowChosen(true);
                    setCustomTimes(false);
                  }}
                >
                  <span className="oc-emoji" aria-hidden="true">
                    {w.emoji}
                  </span>
                  <span className="oc-label">{w.label}</span>
                  <span className="oc-sub">
                    {formatMinute(w.start, clock)} – {formatMinute(w.end, clock)}
                  </span>
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={windowChosen && (customTimes || !presetId)}
                className="option-card"
                onClick={() => {
                  setCustomTimes(true);
                  setWindowChosen(true);
                }}
              >
                <span className="oc-emoji" aria-hidden="true">
                  ✏️
                </span>
                <span className="oc-label">Choose my own</span>
                <span className="oc-sub">Set a start and end</span>
              </button>
            </div>
            {windowChosen && (customTimes || !presetId) && (
              <div className="row">
                <label className="field" style={{ flex: 1 }}>
                  <span className="small" style={{ fontWeight: 700 }}>
                    From
                  </span>
                  <TimeSelect value={windowStart} onChange={setWindowStart} label="From" clock={clock} />
                </label>
                <label className="field" style={{ flex: 1 }}>
                  <span className="small" style={{ fontWeight: 700 }}>
                    Until
                  </span>
                  <TimeSelect value={windowEnd} onChange={setWindowEnd} label="Until" clock={clock} allowEndOfDay />
                </label>
              </div>
            )}
            {windowChosen && (
              <div className="choice-summary">
                People can pick times <strong>{timesSentence}</strong>, in {cityOf(zone)} time. People in other places see it in their own time.
              </div>
            )}
          </section>
        )}

        {step === 3 && (
          <section className="stack" style={{ ['--gap' as string]: '16px' }}>
            <h1 ref={headingRef} tabIndex={-1} className="wizard-q">
              How long will it be?
            </h1>
            <div className="option-cards" role="radiogroup" aria-label="How long">
              {DURATIONS.map((d) => (
                <button key={d} type="button" role="radio" aria-checked={duration === d} className="option-card option-card-sm" onClick={() => setDuration(d)}>
                  <span className="oc-label">{durationWords(d)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="stack" style={{ ['--gap' as string]: '18px' }}>
            <h1 ref={headingRef} tabIndex={-1} className="wizard-q">
              And who’s organizing?
            </h1>
            <p className="muted">Your name tells your group who invited them. No account needed.</p>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <EmojiButton value={hostEmoji} options={PERSON_EMOJI} onChange={setHostEmoji} label="Pick your emoji" />
              <label className="field" style={{ flex: 1 }}>
                <span className="small" style={{ fontWeight: 700 }}>
                  Your name
                </span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="given-name" placeholder="Nadia" />
              </label>
            </div>
            <details className="disclosure">
              <summary>How many of you? (optional)</summary>
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
            <div className="review">
              <p className="eyebrow">Here’s your event</p>
              <p className="review-title">
                <span aria-hidden="true">{emoji}</span> {title.trim() || 'Untitled'}
              </p>
              <ul>
                <li>
                  <span aria-hidden="true">📅</span> {dates.length} {dates.length === 1 ? 'day' : 'days'}: {dates.map((d) => formatDate(d, locale)).join(', ')}{' '}
                  <button type="button" className="link-btn muted" onClick={() => setStep(1)}>
                    Change
                  </button>
                </li>
                <li>
                  <span aria-hidden="true">🕘</span> {timesSentence}{' '}
                  <button type="button" className="link-btn muted" onClick={() => setStep(2)}>
                    Change
                  </button>
                </li>
                <li>
                  <span aria-hidden="true">⏱</span> {durationWords(duration)} ({formatDuration(duration)}){' '}
                  <button type="button" className="link-btn muted" onClick={() => setStep(3)}>
                    Change
                  </button>
                </li>
              </ul>
              <ZoneLine zone={zone} now={now} onChange={setZone} />
            </div>
          </section>
        )}

        {error && (
          <p className="error-text" role="alert" style={{ fontSize: 'var(--step-0)' }}>
            {error}
          </p>
        )}
      </form>

      <div className="action-bar">
        <div className="inner" style={{ maxWidth: 640 }}>
          <button type="button" className="btn btn-ghost" onClick={back}>
            ← {step === 0 ? 'Home' : 'Back'}
          </button>
          {last ? (
            <button type="button" className="btn btn-primary btn-lg" onClick={() => void submit()} disabled={busy || !store}>
              {busy ? copy.create.submitting : 'Create event ✓'}
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-lg" onClick={next}>
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

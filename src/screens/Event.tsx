import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAutosave, useEvent, useNow, usePresence, useStore } from '../lib/hooks';
import { clearHash, Link, navigate, useLocation } from '../lib/router';
import {
  clearCredentials,
  clearOrganizerToken,
  detectZone,
  getCredentials,
  getOrganizerToken,
  getProfile,
  markLockSeen,
  preferredLocale,
  saveProfile,
  seenLockVersion,
  setCredentials,
  setOrganizerToken,
  type Credentials,
} from '../lib/identity';
import { buildGrid } from '../lib/time/grid';
import { cityOf, daysBetween, wallTime, type Instant, type Zone } from '../lib/time/zone';
import { dateParts, detectClock, formatDate, formatDuration, formatMinute, type Clock } from '../lib/time/format';
import { summarize, heat } from '../lib/availability/overlap';
import { bestTimes, evaluate, type Candidate } from '../lib/fairness/score';
import { explain } from '../lib/fairness/explain';
import { sameAvailability, type Availability, type Kind } from '../lib/availability/blocks';
import { formatSpan } from '../lib/time/format';
import { StoreError } from '../lib/data/store';
import type { ColorName, ParticipantRecord, ReactionEmoji } from '../lib/data/types';
import { COLOR_NAMES } from '../lib/data/types';
import { participantProblem } from '../lib/data/validate';
import { copy } from '../lib/copy';
import { backendKind } from '../lib/data';
import { buildModel, joinList } from '../lib/model';
import { BRAND } from '../lib/brand';
import { Avatar, AvatarStack, announce, SavePill, Sheet, Spinner, useToast } from '../components/ui';
import { EmojiButton, EVENT_EMOJI, PERSON_EMOJI, TimeSelect, ZoneLine } from '../components/pickers';
import { DayOverlap, OverlapGrid, PaintGrid } from '../components/grids';
import { colorsFor } from '../lib/people';
import { pickedRanges } from '../lib/availability/ranges';
import { clockChanges, describeChange, outdatedZoneData } from '../lib/time/changes';
import { paint } from '../lib/availability/blocks';
import {
  BestTimes,
  LockedCard,
  LockMoment,
  NudgeSheet,
  PlanYourOwn,
  PresenceBar,
  ShareSheet,
  SlotDetail,
  WorldStrip,
  type ViewPrefs,
} from '../components/event-parts';

const DEFAULT_SLEEP = { start: 23 * 60, end: 7 * 60 };
const DEFAULT_WORK = { start: 9 * 60, end: 17 * 60 };

function errorText(err: unknown): string {
  if (err instanceof StoreError) {
    if (err.code === 'network') return copy.errors.network;
    if (err.code === 'rate_limited') return copy.errors.rate;
    if (err.code === 'invalid' || err.code === 'forbidden' || err.code === 'not_found') return err.message.charAt(0).toUpperCase() + err.message.slice(1) + '.';
  }
  return copy.errors.generic;
}

export default function EventScreen({ id }: { id: string }) {
  const store = useStore();
  const { model: fullModel, state } = useEvent(store, id);

  /* ── Demo tour: replay how the group got here, one answer at a time ──── */
  const isDemo = useMemo(() => {
    try {
      return sessionStorage.getItem(`sunroll:demo:${id}`) === '1';
    } catch {
      return false;
    }
  }, [id]);
  const [tourStep, setTourStep] = useState<number | null>(null);
  const tourStarted = useRef(false);
  useEffect(() => {
    if (!isDemo || !fullModel || tourStarted.current) return;
    tourStarted.current = true;
    if (!fullModel.snapshot.lock) setTourStep(0);
  }, [isDemo, fullModel]);
  const tourOrder = useMemo(() => [...(fullModel?.snapshot.participants ?? [])].sort((a, b) => Number(b.isOrganizer) - Number(a.isOrganizer) || a.createdAt - b.createdAt), [fullModel]);
  // Steps: 0..n-1 each person answers; n the overlap; n+1 seeing it from anyone's side; n+2 lock it in.
  const tourPeople = tourOrder.length;
  const tourLast = tourPeople + 2;
  // While touring, show only the people who have "answered so far".
  const model = useMemo(() => {
    if (!fullModel || tourStep === null || tourStep >= tourPeople) return fullModel;
    const visible = new Set(tourOrder.slice(0, tourStep + 1).map((p) => p.id));
    const snap = fullModel.snapshot;
    return buildModel({
      ...snap,
      participants: snap.participants.filter((p) => visible.has(p.id)),
      blocks: snap.blocks.filter((b) => visible.has(b.participantId)),
      reactions: snap.reactions.filter((r) => visible.has(r.participantId)),
    });
  }, [fullModel, tourStep, tourOrder, tourPeople]);
  const loc = useLocation();
  const toast = useToast();
  const now = useNow();
  const locale = useMemo(preferredLocale, []);
  const clock: Clock = useMemo(() => detectClock(locale), [locale]);

  /* ── Who am I here? ─────────────────────────────────────────────────── */
  const [creds, setCreds] = useState<Credentials | null>(() => getCredentials(id));
  const [orgToken, setOrgToken] = useState<string | null>(() => getOrganizerToken(id));
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [deviceZone, setDeviceZone] = useState<Zone>(detectZone);

  // An organizer link carries its token in the fragment: verify, remember, then hide it.
  useEffect(() => {
    if (!store) return;
    const m = /(?:^|&)o=([^&]+)/.exec(loc.hash);
    if (!m) return;
    const token = decodeURIComponent(m[1]);
    clearHash();
    void store.verifyOrganizer(id, token).then((ok) => {
      if (ok) {
        setOrganizerToken(id, token);
        setOrgToken(token);
      } else toast('That organizer link doesn’t match this event.', 'error');
    });
  }, [store, id, loc.hash, toast]);

  useEffect(() => {
    if (!store || !orgToken) {
      setIsOrganizer(false);
      return;
    }
    let alive = true;
    void store.verifyOrganizer(id, orgToken).then((ok) => {
      if (!alive) return;
      setIsOrganizer(ok);
      if (!ok) {
        clearOrganizerToken(id);
        setOrgToken(null);
      }
    });
    return () => {
      alive = false;
    };
  }, [store, id, orgToken]);

  const me: ParticipantRecord | null = useMemo(() => model?.snapshot.participants.find((p) => p.id === creds?.participantId) ?? null, [model, creds]);

  // If we were removed (or the data was reset), forget the stale credentials.
  useEffect(() => {
    if (model && creds && !me) {
      clearCredentials(id);
      setCreds(null);
    }
  }, [model, creds, me, id]);

  // An organizer whose host participant exists on this device also gets its credentials.
  const viewerZone: Zone = me?.timezone ?? deviceZone;
  // "Seeing times for": anyone in the group, so you can see the event from their side.
  const [viewAs, setViewAs] = useState<string | null>(null);
  const viewAsPerson = model?.snapshot.participants.find((p) => p.id === viewAs && p.id !== me?.id) ?? null;
  const shownZone: Zone = viewAsPerson?.timezone ?? viewerZone;
  const prefs: ViewPrefs = useMemo(() => ({ zone: shownZone, clock, locale }), [shownZone, clock, locale]);
  // The tour shows each person's step from their own time zone.
  useEffect(() => {
    if (tourStep === null) return;
    const p = tourStep < tourPeople ? tourOrder[tourStep] : undefined;
    setViewAs(p && !p.isOrganizer ? p.id : null);
  }, [tourStep, tourOrder, tourPeople]);

  // Count the view once per session, for link → response conversion. Organizers don't count.
  useEffect(() => {
    if (!store || state !== 'ready' || isOrganizer || orgToken) return;
    const key = `sunroll:viewed:${id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      /* ignore */
    }
    void store.recordView(id);
  }, [store, state, id, isOrganizer, orgToken]);

  /* ── Mode ───────────────────────────────────────────────────────────── */
  const [mode, setMode] = useState<'overview' | 'paint'>('overview');
  const [joinOpen, setJoinOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(() => loc.search.get('welcome') === '1');
  const [nudgeOpen, setNudgeOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [selected, setSelected] = useState<Instant | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [view, setView] = useState<'people' | 'heat' | 'list'>('people');
  const [laneCol, setLaneCol] = useState(0);
  const [dayFilter, setDayFilter] = useState<'all' | 'yes' | 'no'>('all');
  const [moment, setMoment] = useState(false);
  const [repicking, setRepicking] = useState(false);

  useEffect(() => {
    if (loc.search.get('welcome') === '1') navigate(`/e/${id}`, { replace: true });
  }, [loc.search, id]);

  /* ── Painting ───────────────────────────────────────────────────────── */
  const [brush, setBrush] = useState<Kind>('free');
  const [draft, setDraft] = useState<Availability | null>(null);
  const autosave = useAutosave(store, creds, model?.snapshot.event.slotMinutes ?? 30);

  const startPainting = useCallback(() => {
    if (!model || !me) return;
    setDraft(new Map(model.availability.get(me.id) ?? new Map()));
    setMode('paint');
    window.scrollTo({ top: 0 });
  }, [model, me]);

  const finishPainting = async () => {
    const ok = await autosave.flush();
    if (!ok) {
      toast(copy.paint.failed, 'error');
      return;
    }
    setMode('overview');
    setDraft(null);
    window.scrollTo({ top: 0 });
  };

  const noneWork = async () => {
    const empty: Availability = new Map();
    setDraft(empty);
    autosave.save(empty, true);
    const ok = await autosave.flush();
    if (ok) {
      setMode('overview');
      setDraft(null);
      toast('Got it. Thanks for letting everyone know.');
    }
  };

  /* ── Presence ───────────────────────────────────────────────────────── */
  const peers = usePresence(store, id, { participantId: me?.id ?? null, name: me?.name ?? null, emoji: me?.emoji ?? null, activity: mode === 'paint' ? 'painting' : 'viewing' });

  /* ── Overlap ────────────────────────────────────────────────────────── */
  const grid = useMemo(() => (model ? buildGrid(model.slots, shownZone) : null), [model, shownZone]);
  const summary = useMemo(() => (model ? summarize(model.slots, model.people) : new Map()), [model]);
  const names = useMemo(() => new Map(model?.snapshot.participants.map((p) => [p.id, p.name]) ?? []), [model]);
  const colors = useMemo(() => colorsFor(model?.snapshot.participants ?? []), [model]);
  const event = model?.snapshot.event;
  const best = useMemo(() => (model && event ? bestTimes(model.slots, event.slotMinutes, event.durationMinutes, model.people) : []), [model, event]);
  const candidates = useMemo(() => {
    if (!model || !event) return new Map<Instant, Candidate>();
    return new Map(evaluate(model.slots, event.slotMinutes, event.durationMinutes, model.people).map((c) => [c.start, c]));
  }, [model, event]);
  const explanations = useMemo(() => best.map((c) => explain(c, model?.responders.length ?? 0, names, { clock, you: me?.id })), [best, model, names, clock, me]);
  const bestSlots = useMemo(() => {
    const s = new Set<Instant>();
    if (best[0] && model && event) for (let t = best[0].start; t < best[0].end; t += event.slotMinutes * 60_000) s.add(t);
    return s;
  }, [best, model, event]);

  // Pulse the cells that changed when someone else updates their times.
  const prevCounts = useRef<Map<Instant, number> | null>(null);
  const [pulse, setPulse] = useState<Set<Instant>>(new Set());
  useEffect(() => {
    const counts = new Map<Instant, number>();
    for (const [t, s] of summary) counts.set(t, s.free.length * 2 + s.ifNeeded.length);
    const prev = prevCounts.current;
    prevCounts.current = counts;
    if (!prev) return;
    const changed = new Set<Instant>();
    for (const [t, c] of counts) if ((prev.get(t) ?? 0) !== c) changed.add(t);
    if (changed.size === 0) return;
    setPulse(changed);
    const timer = window.setTimeout(() => setPulse(new Set()), 1000);
    return () => window.clearTimeout(timer);
  }, [summary]);

  // "Everyone's in." when the group size the organizer expected has answered.
  const respondersCount = model?.responders.length ?? 0;
  const prevResponders = useRef<number | null>(null);
  useEffect(() => {
    if (!model) return; // only compare real counts, never the empty state before loading
    if (tourStep !== null) {
      prevResponders.current = null; // the demo replay adds people on purpose; don't celebrate each step
      return;
    }
    const expected = event?.expectedCount;
    if (prevResponders.current !== null && expected && prevResponders.current < expected && respondersCount >= expected) {
      toast(`${copy.overlap.everyoneIn} ✦`);
      announce(copy.overlap.everyoneIn);
    }
    prevResponders.current = respondersCount;
  }, [model, respondersCount, event?.expectedCount, toast, tourStep]);

  // "It's on." plays once per lock version on each device.
  const lock = model?.snapshot.lock ?? null;
  useEffect(() => {
    if (!lock) return;
    const seen = seenLockVersion(id);
    if (lock.version > seen) {
      if (seen > 0) toast(copy.lock.changed);
      setMoment(true);
      markLockSeen(id, lock.version);
    }
  }, [lock, id, toast]);

  // Open the day view on the day of the best time (or the first day), once.
  const dayPicked = useRef(false);
  useEffect(() => {
    if (dayPicked.current || !grid) return;
    const t = lock?.start ?? best[0]?.start;
    const pos = t != null ? grid.position.get(t) : undefined;
    if (pos) setLaneCol(pos.col);
  }, [grid, best, lock]);

  // Clock changes inside the event for anyone in the group: told, never acted on.
  const changes = useMemo(() => {
    if (!event || !model) return [];
    const zones = [event.timezone, ...model.snapshot.participants.map((p) => p.timezone)];
    return clockChanges(zones, event.days[0].date, event.days[event.days.length - 1].date);
  }, [event, model]);
  const outdated = useMemo(() => (model ? outdatedZoneData(model.zones) : []), [model]);

  /* ── Actions ────────────────────────────────────────────────────────── */
  const select = (t: Instant) => {
    setSelected(t);
    if (grid) {
      const pos = grid.position.get(t);
      if (pos) setLaneCol(pos.col);
    }
    setDetailOpen(true);
  };

  const lockAt = async (c: Candidate) => {
    if (!store || !orgToken) return;
    try {
      await store.lock(id, orgToken, c.start, c.end);
      setDetailOpen(false);
      setRepicking(false);
      window.scrollTo({ top: 0 });
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

  const unlock = async () => {
    if (!store || !orgToken) return;
    try {
      await store.unlock(id, orgToken);
      toast('Reopened. Pick a new time whenever you’re ready.');
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

  const react = async (e: ReactionEmoji) => {
    if (!store || !creds) return;
    try {
      await store.toggleReaction(creds.participantId, creds.token, e);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

  const changeMyZone = async (z: Zone) => {
    if (!me || !store || !creds) {
      setDeviceZone(z);
      return;
    }
    try {
      await store.updateParticipant(creds.participantId, creds.token, { timezone: z });
      toast(`Times now shown in ${cityOf(z)} time.`);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

  /* ── Render ─────────────────────────────────────────────────────────── */
  if (state === 'loading' || !store) return <Spinner label="Loading the event" />;
  if (state === 'missing') return <NotFoundEvent />;
  if (state === 'error' || !model || !event || !grid)
    return (
      <div className="wrap-narrow stack" style={{ paddingBlock: 64, textAlign: 'center' }}>
        <h1 style={{ fontSize: 'var(--step-3)' }}>We couldn’t load this event.</h1>
        <p className="muted">{copy.errors.network}</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );

  const participants = model.snapshot.participants;
  const responders = model.responders.length;
  const sleep = viewAsPerson?.sleep ?? me?.sleep ?? DEFAULT_SLEEP;
  const hostName = model.host?.name ?? 'Someone';
  const selectedCandidate = selected != null ? candidates.get(selected) ?? null : null;
  const firstDay = event.days[0].date;
  const lastDay = event.days[event.days.length - 1].date;
  const dateRange = firstDay === lastDay ? formatDate(firstDay, locale) : `${formatDate(firstDay, locale)} – ${formatDate(lastDay, locale)}`;
  const everyoneIn = !!event.expectedCount && responders >= event.expectedCount;
  const canLock = isOrganizer && (!lock || repicking);
  // The demo reveals the product one idea at a time; outside the demo everything shows.
  const tourOn = isDemo && tourStep !== null && !lock;
  const stage: 'full' | 'person' | 'overlap' | 'views' | 'lock' = !tourOn
    ? 'full'
    : tourStep! < tourPeople
      ? 'person'
      : tourStep === tourPeople
        ? 'overlap'
        : tourStep === tourPeople + 1
          ? 'views'
          : 'lock';
  const show = {
    tools: stage === 'full' || stage === 'lock',
    world: stage === 'full' || stage === 'views' || stage === 'lock',
    overlap: stage !== 'person',
    views: stage === 'full' || stage === 'views' || stage === 'lock',
    best: stage === 'full' || stage === 'lock',
    me: stage === 'full' || stage === 'lock',
  };
  const touring = stage !== 'full' && stage !== 'lock';
  const tourPerson = stage === 'person' ? tourOrder[tourStep!] : null;
  const myResponded = !!me && model.responders.some((p) => p.id === me.id);

  if (mode === 'paint' && me && draft) {
    return (
      <PaintMode
        eventTitle={`${event.emoji} ${event.title}`}
        grid={grid}
        draft={draft}
        onChange={(next) => {
          if (sameAvailability(next, draft)) return;
          setDraft(next);
          autosave.save(next, true);
        }}
        brush={brush}
        setBrush={setBrush}
        slotMinutes={event.slotMinutes}
        sleep={sleep}
        prefs={prefs}
        now={now}
        saveState={autosave.state}
        onZone={changeMyZone}
        onDone={finishPainting}
        onNone={noneWork}
        peers={peers}
      />
    );
  }

  return (
    <div className="event-page">
      {moment && lock && <LockMoment model={model} lock={lock} prefs={prefs} onClose={() => setMoment(false)} />}

      <header className="wrap event-hero stack" data-color={event.color} style={{ ['--gap' as string]: '14px' }}>
        <div className="row" style={{ alignItems: 'flex-start', ['--gap' as string]: '14px' }}>
          <span className="emoji-tile" aria-hidden="true">
            {event.emoji}
          </span>
          <div className="stack" style={{ ['--gap' as string]: '6px', minWidth: 0 }}>
            {isOrganizer ? (
              <span className="eyebrow">You’re organizing</span>
            ) : (
              <span className="invite-line">{copy.guest.invited(hostName)}</span>
            )}
            <h1>{event.title}</h1>
            <div className="event-meta">
              <span>📅 {dateRange}</span>
              <span>⏱ {formatDuration(event.durationMinutes)}</span>
              <span>
                👥 {participants.length} {participants.length === 1 ? 'person' : 'people'} · {model.zones.length} time zone{model.zones.length === 1 ? '' : 's'}
              </span>
              {everyoneIn && <span className="tag tag-sun">✦ {copy.overlap.everyoneIn}</span>}
            </div>
          </div>
        </div>
        {show.world && <WorldStrip participants={participants} now={now} prefs={prefs} />}
        <PresenceBar peers={peers} />
        {isOrganizer && show.tools && (
          <div className="row-wrap">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setShareOpen(true)}>
              Invite
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setNudgeOpen(true)}>
              Nudge
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setEditOpen(true)}>
              Edit
            </button>
            <button type="button" className="btn btn-sm" onClick={() => navigate(`/new?from=${id}`)}>
              Duplicate
            </button>
          </div>
        )}
      </header>

      <main className="wrap stack" style={{ ['--gap' as string]: '22px', paddingBottom: 48 }}>
        {isDemo && tourStep !== null && !lock && fullModel && (
          <DemoTour
            step={tourStep}
            last={tourLast}
            order={tourOrder}
            full={fullModel}
            locale={locale}
            clock={clock}
            onStep={(n) => {
              setTourStep(n);
              setSelected(null);
              setView('people');
              dayPicked.current = false;
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onSkip={() => {
              setTourStep(null);
              setViewAs(null);
            }}
          />
        )}
        {isDemo && (tourStep === null || lock) && (
          <aside className="demo-banner" aria-label="About this demo">
            <span className="demo-tag">Demo</span>
            <span>
              {lock ? (
                <>
                  <strong>That’s it.</strong> Everyone sees the time in their own zone and can add it to their calendar. Ready for your own group?{' '}
                  <Link to="/new">Start an event →</Link>
                </>
              ) : (
                <>
                  <strong>You’re Nadia, the organizer.</strong> Luke, Maddie and Brian have already added their times. Each person has their own colour; gold rows ✓ work for everyone. Pick a best time below and tap <strong>Lock it in</strong>.
                </>
              )}
            </span>
          </aside>
        )}
        {lock && !repicking && (
          <LockedCard
            model={model}
            lock={lock}
            prefs={prefs}
            meId={me?.id ?? null}
            onReact={react}
            organizerActions={
              isOrganizer ? (
                <div className="row-wrap">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setRepicking(true);
                      document.getElementById('overlap')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                  >
                    {copy.lock.change}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={unlock}>
                    {copy.lock.reopen}
                  </button>
                </div>
              ) : undefined
            }
          />
        )}
        {repicking && (
          <div className="callout" role="status">
            <span aria-hidden="true">✦</span>
            <span>
              <strong>Pick the new time.</strong> Everyone will see the change and get a fresh calendar invite.{' '}
              <button type="button" className="link-btn" onClick={() => setRepicking(false)}>
                Cancel
              </button>
            </span>
          </div>
        )}

        {!show.me ? null : !me ? (
          <section className="card stack" style={{ ['--gap' as string]: '14px' }} aria-label="Add your times">
            <div className="row" style={{ ['--gap' as string]: '12px' }}>
              <AvatarStack people={participants} colors={colors} />
              <p style={{ fontWeight: 700 }}>
                {responders === 0 ? 'Be the first to add your times.' : `${joinList(model.responders.map((p) => p.name))} ${responders === 1 ? 'has' : 'have'} added their times.`}
              </p>
            </div>
            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => setJoinOpen(true)}>
              {copy.guest.cta}
            </button>
            <ZoneLine zone={viewerZone} now={now} onChange={setDeviceZone} prefix="Showing times in" />
          </section>
        ) : (
          <section className="panel spread" aria-label="Your times" style={{ flexWrap: 'wrap' }}>
            <div className="row">
              <Avatar emoji={me.emoji} color={me.color} tint={colors.get(me.id)?.soft} ring={colors.get(me.id)?.solid} />
              <div>
                <p style={{ fontWeight: 800 }}>
                  {me.name} <span className="muted small">(you)</span>
                </p>
                <p className="small muted">
                  {myResponded ? describeMine(model.availability.get(me.id), event.slotMinutes) : 'You haven’t added your times yet.'} · {cityOf(me.timezone)} time
                </p>
              </div>
            </div>
            <button type="button" className={`btn ${myResponded ? '' : 'btn-primary'}`} onClick={startPainting}>
              {myResponded ? 'Edit my times' : copy.guest.cta}
            </button>
          </section>
        )}

        {tourPerson && fullModel && <PersonTimetable person={tourPerson} model={fullModel} colors={colors} clock={clock} locale={locale} />}

        {show.overlap && (
        <section id="overlap" className="stack" style={{ ['--gap' as string]: '16px' }} aria-labelledby="overlap-title">
          <div className="section-head" style={{ marginBottom: 0 }}>
            <div>
              <h2 id="overlap-title">{touring || (lock && !repicking) || responders < 2 ? 'Who’s free when' : 'Best times'}</h2>
              <p className="small muted" style={{ marginTop: 4 }}>
                {viewAsPerson ? `Shown in ${viewAsPerson.name}’s time · ${cityOf(shownZone)}` : `Shown in your time · ${cityOf(shownZone)}`}
              </p>
            </div>
          </div>

          {show.views && participants.length > 1 && (
            <div className="seeing" role="group" aria-label="See the times from someone else’s time zone">
              <span className="seeing-label">
                Seeing times for:{' '}
                <strong>
                  {viewAsPerson ? `${viewAsPerson.name} in ${cityOf(shownZone)}` : `${me ? 'you' : 'your device'} in ${cityOf(shownZone)}`}
                </strong>
              </span>
              <div className="seeing-people">
                {(me ? [me, ...participants.filter((p) => p.id !== me.id)] : participants).map((p) => {
                  const pressed = p.id === me?.id ? !viewAsPerson : viewAsPerson?.id === p.id;
                  const c = colors.get(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className="seeing-person"
                      aria-pressed={pressed}
                      style={{ ['--pc' as string]: c?.solid }}
                      onClick={() => setViewAs(p.id === me?.id ? null : p.id)}
                    >
                      <Avatar emoji={p.emoji} color={p.color} tint={c?.soft} size={32} />
                      <span>
                        {p.id === me?.id ? 'You' : p.name} <small>{cityOf(p.timezone)}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {changes.length > 0 && (
            <div className="callout" data-tone="info" role="note">
              <span aria-hidden="true">🕐</span>
              <span>
                {changes.map((c) => (
                  <span key={c.zone + c.at} style={{ display: 'block' }}>
                    <strong>{describeChange(c)}</strong> on {formatDate(c.localDate, locale)}.
                  </span>
                ))}
                <span className="muted">Every time here already includes this, so nothing to do. Just a heads-up.</span>
              </span>
            </div>
          )}
          {outdated.length > 0 && (
            <div className="callout" role="alert">
              <span aria-hidden="true">⚠️</span>
              <span>
                <strong>This device’s time zone data looks out of date</strong> ({outdated.map((o) => o.note).join('; ')}). Times for {outdated.map((o) => cityOf(o.zone)).join(', ')} could be off by an hour. Updating your browser or phone fixes it.
              </span>
            </div>
          )}

          {responders === 0 && <p className="callout" data-tone="quiet">{copy.overlap.empty}</p>}
          {responders === 1 && <p className="callout" data-tone="quiet">{model.responders[0].id === me?.id ? copy.overlap.justYou : `Just ${model.responders[0].name} so far. The glow appears when others add theirs.`}</p>}
          {show.best && responders >= 2 && best.length > 0 && (!lock || repicking) && (
            <>
              {best[0].available.length < responders && <p className="callout" data-tone="info">{copy.overlap.noOverlap}</p>}
              <BestTimes colors={colors} best={best} model={model} explanations={explanations} prefs={prefs} meId={me?.id ?? null} selected={selected} onSelect={select} onLock={lockAt} canLock={canLock} />
            </>
          )}
          {show.best && responders >= 2 && best.length === 0 && <p className="callout" data-tone="info">No time works for anyone for the full {formatDuration(event.durationMinutes)} yet.</p>}

          <div className="spread" style={{ flexWrap: 'wrap' }}>
            <div className="tabs" role="tablist" aria-label="Views" hidden={!show.views}>
              <button type="button" role="tab" aria-selected={view === 'people'} onClick={() => setView('people')}>
                By person
              </button>
              <button type="button" role="tab" aria-selected={view === 'heat'} onClick={() => setView('heat')}>
                Whole week
              </button>
              <button type="button" role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}>
                List
              </button>
            </div>
          </div>
          {view === 'people' && (
            <div className="stack" style={{ ['--gap' as string]: '6px' }}>
              <div className="segmented" role="radiogroup" aria-label="Which days to show" style={{ alignSelf: 'flex-start' }} hidden={!show.views}>
                <button type="button" role="radio" aria-checked={dayFilter === 'all'} onClick={() => setDayFilter('all')}>
                  All days
                </button>
                <button type="button" role="radio" aria-checked={dayFilter === 'yes'} onClick={() => setDayFilter('yes')}>
                  ✓ Everyone free
                </button>
                <button type="button" role="radio" aria-checked={dayFilter === 'no'} onClick={() => setDayFilter('no')}>
                  ✗ No overlap
                </button>
              </div>
              <div className="day-chips" role="group" aria-label="Pick a day">
                {grid.columns.map((c, i) => {
                  const full =
                    responders >= 2 &&
                    model.slots.some((t) => {
                      const pos = grid.position.get(t);
                      if (!pos || pos.col !== i) return false;
                      const sm = summary.get(t);
                      return !!sm && sm.free.length + sm.ifNeeded.length === responders;
                    });
                  const dp = dateParts(c.date, locale);
                  const change = changes.find((x) => wallTime(x.at, shownZone).date === c.date);
                  const hidden = (dayFilter === 'yes' && !full) || (dayFilter === 'no' && full);
                  return (
                    <button
                      key={c.date}
                      type="button"
                      className="day-chip"
                      hidden={hidden}
                      data-full={responders >= 2 ? String(full) : undefined}
                      aria-pressed={laneCol === i}
                      onClick={() => {
                        dayPicked.current = true;
                        setLaneCol(i);
                      }}
                      aria-label={`${formatDate(c.date, locale)}${full ? ', works for everyone' : responders >= 2 ? ', no time works for everyone' : ''}${change ? `, ${describeChange(change)}` : ''}`}
                      title={change ? describeChange(change) : undefined}
                    >
                      <span className="wd">{dp.weekday}</span>
                      <span className="dd">
                        {dp.month} {dp.day}
                      </span>
                      {full && (
                        <span className="dot" aria-hidden="true">
                          ✓
                        </span>
                      )}
                      {change && (
                        <span className="clock" aria-hidden="true">
                          🕐
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div role="tabpanel">
            {view === 'people' && (
              <DayOverlap
                grid={grid}
                col={Math.min(laneCol, grid.columns.length - 1)}
                participants={participants}
                colors={colors}
                availability={model.availability}
                responded={new Set(model.responders.map((p) => p.id))}
                responders={responders}
                selected={selected}
                onSelect={select}
                meId={me?.id ?? null}
                viewerZone={shownZone}
                clock={clock}
                locale={locale}
              />
            )}
            {view === 'heat' && (
              <OverlapGrid
                grid={grid}
                summary={summary}
                responders={responders}
                names={names}
                selected={selected}
                onSelect={select}
                best={bestSlots}
                pulse={pulse}
                selectedCol={laneCol}
                onSelectCol={(c) => {
                  setLaneCol(c);
                  setView('people');
                }}
                sleep={sleep}
                clock={clock}
                locale={locale}
              />
            )}
            {view === 'list' && <OverlapTable model={model} summary={summary} names={names} prefs={prefs} />}
          </div>

          <div className="legend" aria-label="Legend">
            {view === 'people' ? (
              <>
                <span>
                  <i className="swatch" style={{ background: 'var(--blue)' }} /> Free (each person has their own colour)
                </span>
                <span>
                  <i className="swatch swatch-maybe" /> If needed
                </span>
                <span>
                  <i className="swatch swatch-sun" /> ✓ Works for everyone
                </span>
                <span>Small grey times are the time where that person is</span>
              </>
            ) : (
              <>
                <span>
                  <i className="swatch swatch-heat" /> More people free
                </span>
                <span>
                  <i className="swatch swatch-sun" /> ✦ Everyone free
                </span>
                <span>Numbers show how many can make it</span>
              </>
            )}
          </div>
        </section>
        )}

        {!isOrganizer && (myResponded || lock) && <PlanYourOwn eventId={id} templateSlug={event.templateSlug} />}

        <footer className="row-wrap small muted" style={{ ['--gap' as string]: '6px 18px', paddingTop: 8 }}>
          {me && !me.isOrganizer && (
            <>
              <button
                type="button"
                className="link-btn muted"
                onClick={() => {
                  clearCredentials(id);
                  setCreds(null);
                  setMode('overview');
                }}
              >
                {copy.guest.notYou(me.name)} Join as someone else
              </button>
              <button type="button" className="link-btn muted" onClick={() => setLeaveOpen(true)}>
                Remove me from this event
              </button>
            </>
          )}
          <span>
            Deleted automatically {daysBetween(wallTime(now, 'UTC').date, new Date(event.expiresAt).toISOString().slice(0, 10))} days from now. <Link to="/privacy">Privacy</Link>
          </span>
        </footer>
      </main>

      {/* Sheets */}
      <Sheet
        open={detailOpen && selected != null}
        onClose={() => setDetailOpen(false)}
        title={selectedCandidate ? 'This time, for everyone' : 'Too close to the end'}
        footer={
          canLock && selectedCandidate ? (
            <button type="button" className="btn btn-sun btn-block btn-lg" onClick={() => lockAt(selectedCandidate)}>
              {lock ? 'Move it here' : copy.lock.cta}
            </button>
          ) : undefined
        }
      >
        {selectedCandidate ? (
          <SlotDetail colors={colors} candidate={selectedCandidate} model={model} prefs={prefs} meId={me?.id ?? null} explanation={explain(selectedCandidate, responders, names, { clock, you: me?.id })} />
        ) : selected != null ? (
          <p className="muted">
            A {formatDuration(event.durationMinutes)} meeting starting at {formatMinute(wallTime(selected, shownZone).minute, clock)} would run past the end of the time window. Try an earlier slot.
          </p>
        ) : null}
      </Sheet>

      <JoinSheet
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        zone={viewerZone}
        now={now}
        clock={clock}
        hostName={hostName}
        title={event.title}
        colorIndex={participants.length}
        takenNames={participants.map((p) => p.name.toLowerCase())}
        takenEmoji={participants.map((p) => p.emoji)}
        onJoined={(c, p) => {
          setCredentials(id, c);
          setCreds(c);
          setJoinOpen(false);
          setDraft(new Map());
          setMode('paint');
          window.scrollTo({ top: 0 });
          announce(`Welcome, ${p.name}. Paint the times you’re free.`);
        }}
        join={async (p) => store.join(id, p)}
      />

      {isOrganizer && (
        <>
          <ShareSheet
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            model={model}
            organizerToken={orgToken}
            onAddTimes={
              me && !myResponded
                ? () => {
                    setShareOpen(false);
                    startPainting();
                  }
                : undefined
            }
          />
          <NudgeSheet open={nudgeOpen} onClose={() => setNudgeOpen(false)} model={model} />
          <EditSheet
            open={editOpen}
            onClose={() => setEditOpen(false)}
            title={event.title}
            emoji={event.emoji}
            participants={participants}
            onSave={async (patch) => {
              try {
                await store.updateEvent(id, orgToken!, patch);
                setEditOpen(false);
                toast('Saved.');
              } catch (err) {
                toast(errorText(err), 'error');
              }
            }}
            onRemove={async (pid) => {
              try {
                await store.removeParticipant(id, orgToken!, pid);
              } catch (err) {
                toast(errorText(err), 'error');
              }
            }}
            onDelete={() => {
              setEditOpen(false);
              setDeleteOpen(true);
            }}
          />
          <Sheet
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            title="Delete this event?"
            footer={
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn" onClick={() => setDeleteOpen(false)}>
                  Keep it
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    try {
                      await store.deleteEvent(id, orgToken!);
                      clearOrganizerToken(id);
                      clearCredentials(id);
                      navigate('/');
                      toast('Deleted. Everything about it is gone.');
                    } catch (err) {
                      toast(errorText(err), 'error');
                    }
                  }}
                >
                  Delete for everyone
                </button>
              </div>
            }
          >
            <p className="muted">Everyone’s times, names and reactions are deleted right away. This can’t be undone.</p>
          </Sheet>
        </>
      )}

      {me && (
        <Sheet
          open={leaveOpen}
          onClose={() => setLeaveOpen(false)}
          title="Remove yourself?"
          footer={
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setLeaveOpen(false)}>
                Stay
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    await store.leave(creds!.participantId, creds!.token);
                    clearCredentials(id);
                    setCreds(null);
                    setLeaveOpen(false);
                    toast('Removed. Your name and times are gone.');
                  } catch (err) {
                    toast(errorText(err), 'error');
                  }
                }}
              >
                Remove me
              </button>
            </div>
          }
        >
          <p className="muted">Your name, your times and your reactions will be deleted from this event.</p>
        </Sheet>
      )}
    </div>
  );
}

function describeMine(a: Availability | undefined, slotMinutes: number): string {
  if (!a || a.size === 0) return 'None of these times work for you';
  let free = 0;
  let maybe = 0;
  for (const k of a.values()) k === 'free' ? free++ : maybe++;
  const hrs = (n: number) => {
    const h = (n * slotMinutes) / 60;
    return `${Number.isInteger(h) ? h : h.toFixed(1)} hr`;
  };
  return maybe ? `${hrs(free)} free, ${hrs(maybe)} if needed` : `${hrs(free)} free`;
}

/* ── Painting mode ─────────────────────────────────────────────────────── */

function PaintMode({
  eventTitle,
  grid,
  draft,
  onChange,
  brush,
  setBrush,
  slotMinutes,
  sleep,
  prefs,
  now,
  saveState,
  onZone,
  onDone,
  onNone,
  peers,
}: {
  eventTitle: string;
  grid: ReturnType<typeof buildGrid>;
  draft: Availability;
  onChange: (a: Availability) => void;
  brush: Kind;
  setBrush: (k: Kind) => void;
  slotMinutes: number;
  sleep: { start: number; end: number };
  prefs: ViewPrefs;
  now: number;
  saveState: ReturnType<typeof useAutosave>['state'];
  onZone: (z: Zone) => void;
  onDone: () => void;
  onNone: () => void;
  peers: ReturnType<typeof usePresence>;
}) {
  return (
    <div className="paint-page">
      <div className="wrap stack" style={{ ['--gap' as string]: '12px', paddingTop: 16 }}>
        <div className="stack" style={{ ['--gap' as string]: '4px' }}>
          <span className="eyebrow">{eventTitle}</span>
          <h1 style={{ fontSize: 'var(--step-3)' }}>When are you free?</h1>
          <ZoneLine zone={prefs.zone} now={now} onChange={onZone} prefix="In your time:" />
        </div>
        <div className="paint-toolbar">
          <div className="segmented" role="radiogroup" aria-label="Paint as">
            <button type="button" role="radio" aria-checked={brush === 'free'} onClick={() => setBrush('free')}>
              <i className="swatch swatch-free" aria-hidden="true" /> {copy.paint.free}
            </button>
            <button type="button" role="radio" aria-checked={brush === 'if_needed'} onClick={() => setBrush('if_needed')}>
              <i className="swatch swatch-maybe" aria-hidden="true" /> {copy.paint.ifNeeded}
            </button>
          </div>
          <span className="small muted" style={{ fontWeight: 600 }}>
            {copy.paint.hint} <span className="faint">☾ = your usual sleep</span>
          </span>
        </div>
        <PresenceBar peers={peers} />
        <PaintGrid grid={grid} slotMinutes={slotMinutes} availability={draft} onChange={onChange} brush={brush} sleep={sleep} clock={prefs.clock} locale={prefs.locale} label={`Your availability, in ${cityOf(prefs.zone)} time`} />
      </div>
      <div className="wrap" style={{ paddingBlock: '20px 120px' }}>
        <MyTimes availability={draft} zone={prefs.zone} slotMinutes={slotMinutes} prefs={prefs} onRemove={(slots) => onChange(paint(draft, slots, null))} />
        <button type="button" className="link-btn muted" style={{ marginTop: 16 }} onClick={onNone}>
          {copy.paint.none}
        </button>
      </div>
      <div className="action-bar">
        <div className="inner">
          <SavePill state={saveState} />
          <button type="button" className="btn btn-primary" onClick={onDone}>
            Done ✓
          </button>
        </div>
      </div>
    </div>
  );
}

/** What you picked, in plain words, with a way to remove each range. */
function MyTimes({ availability, zone, slotMinutes, prefs, onRemove, title = 'Your times' }: { availability: Availability; zone: Zone; slotMinutes: number; prefs: ViewPrefs; onRemove?: (slots: Instant[]) => void; title?: string }) {
  const ranges = pickedRanges(availability, zone, slotMinutes);
  const days = [...new Set(ranges.map((r) => r.date))];
  return (
    <section className="my-times" aria-labelledby="my-times-title">
      <h2 id="my-times-title">{title}</h2>
      {ranges.length === 0 ? (
        <p className="muted">Nothing picked yet. Tap the times above that work for you.</p>
      ) : (
        <ul>
          {days.map((d) => (
            <li key={d}>
              <strong>{formatDate(d, prefs.locale)}</strong>
              <span className="ranges">
                {ranges
                  .filter((r) => r.date === d)
                  .map((r) => (
                    <span key={r.start} className="range" data-kind={r.kind}>
                      {formatSpan(r.start, r.end, zone, prefs.clock)}
                      {r.kind === 'if_needed' && <em> if needed</em>}
                      {onRemove && (
                        <button type="button" className="range-x" aria-label={`Remove ${formatSpan(r.start, r.end, zone, prefs.clock)} on ${formatDate(d, prefs.locale)}`} onClick={() => onRemove(r.slots)}>
                          ✕
                        </button>
                      )}
                    </span>
                  ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── Demo replay ─────────────────────────────────────────────────────────── */

/** One person's timetable, exactly as they saw it: their days, in their own time zone. */
function PersonTimetable({ person, model, colors, clock, locale }: { person: ParticipantRecord; model: NonNullable<ReturnType<typeof useEvent>['model']>; colors: Map<string, { solid: string; soft: string }>; clock: Clock; locale: string }) {
  const grid = useMemo(() => buildGrid(model.slots, person.timezone), [model, person.timezone]);
  const a = model.availability.get(person.id) ?? new Map();
  const c = colors.get(person.id);
  const prefs: ViewPrefs = { zone: person.timezone, clock, locale };
  return (
    <section className="person-sheet stack" style={{ ['--gap' as string]: '14px', ['--blue' as string]: c?.solid ?? 'var(--blue)', borderColor: c?.solid }} aria-label={`${person.name}’s times`}>
      <div className="row">
        <Avatar emoji={person.emoji} color={person.color} tint={c?.soft} ring={c?.solid} size={44} />
        <div>
          <h2>{person.name}’s timetable</h2>
          <p className="small muted" style={{ fontWeight: 600 }}>
            In {cityOf(person.timezone)} time, exactly how {person.name} saw it.
          </p>
        </div>
      </div>
      <PaintGrid grid={grid} slotMinutes={model.snapshot.event.slotMinutes} availability={a} onChange={() => {}} brush="free" sleep={person.sleep} clock={clock} locale={locale} label={`${person.name}’s times, in ${cityOf(person.timezone)} time`} readOnly />
      <MyTimes availability={a} zone={person.timezone} slotMinutes={model.snapshot.event.slotMinutes} prefs={prefs} title={`${person.name} picked`} />
    </section>
  );
}

function DemoTour({
  step,
  last,
  order,
  full,
  locale,
  clock,
  onStep,
  onSkip,
}: {
  step: number;
  last: number;
  order: ParticipantRecord[];
  full: NonNullable<ReturnType<typeof useEvent>['model']>;
  locale: string;
  clock: Clock;
  onStep: (n: number) => void;
  onSkip: () => void;
}) {
  const event = full.snapshot.event;
  const host = order[0];
  const person = order[step];
  const at = toInstantSafe(event.days[0].date, event.timezone);
  const hoursFromHost = (z: Zone) => (wallTime(at, z).offset - wallTime(at, host.timezone).offset) / 60;
  const aheadWords = (z: Zone) => {
    const d = hoursFromHost(z);
    if (d === 0) return `the same time as ${host.name}`;
    const n = Math.abs(d);
    return `${n} hour${n === 1 ? '' : 's'} ${d > 0 ? 'ahead of' : 'behind'} ${host.name}`;
  };
  const range = (s: number, e: number) => `${formatMinute(s, clock)} – ${e === 1440 ? 'midnight' : formatMinute(e, clock)}`;
  let title: string;
  let body: ReactNode;
  if (step === 0) {
    title = `${host.name} sets it up`;
    body = (
      <>
        {host.name} wants a {event.title.toLowerCase()}. She picks {event.days.length} days, each with its own hours, then sends the link to the group chat:
        <span className="tour-days">
          {event.days.map((d) => (
            <span key={d.date} className="tour-day" data-odd={d.startMin !== event.days[0].startMin || undefined}>
              <strong>{formatDate(d.date, locale)}</strong> {range(d.startMin, d.endMin)}
            </span>
          ))}
        </span>
      </>
    );
  } else if (step < order.length) {
    const a = full.availability.get(person.id);
    const maybe = a ? [...a.values()].includes('if_needed') : false;
    title = `${person.name} adds their times`;
    body = (
      <>
        {person.name} taps the link in <strong>{cityOf(person.timezone)}</strong>, {aheadWords(person.timezone)}. Sunroll shows {person.name} the same days, already in {cityOf(person.timezone)} time. {person.name} paints when they’re free{maybe ? ', and marks a few times “if needed” (striped)' : ''}.
      </>
    );
  } else if (step === order.length) {
    title = 'Everyone’s in. The overlap glows';
    body = (
      <>
        Sunroll lays everyone’s times side by side, one colour each. <strong>The Everyone column turns gold ✓</strong> wherever all {order.length} of them are free. Days with a ✓ have a time that works.
      </>
    );
  } else if (step === order.length + 1) {
    title = 'See it from anyone’s side';
    body = (
      <>
        Tap a face under <strong>Seeing times for</strong> to see the whole plan in their time zone. Use <strong>✓ Everyone free</strong> to show only the days that work, or <strong>Whole week</strong> for the big picture.
      </>
    );
  } else {
    title = 'Lock it in';
    body = (
      <>
        Sunroll ranks the <strong>best times</strong> and says why, with each person’s local time. As the organizer, {host.name} also has <strong>Invite</strong>, <strong>Nudge</strong> (a friendly reminder for the group chat), <strong>Edit</strong> and <strong>Duplicate</strong> (same group next week). Pick a time and tap <strong>Lock it in</strong>.
      </>
    );
  }
  return (
    <aside className="tour" aria-live="polite" aria-label="How this event came together">
      <div className="spread">
        <span className="demo-tag">
          Demo · step {step + 1} of {last + 1}
        </span>
        <button type="button" className="link-btn muted small" onClick={onSkip}>
          Skip
        </button>
      </div>
      <div className="tour-dots" aria-hidden="true">
        {Array.from({ length: last + 1 }, (_, i) => (
          <span key={i} data-on={i <= step || undefined} />
        ))}
      </div>
      <h2 className="tour-title">{title}</h2>
      <p className="tour-body">{body}</p>
      <div className="spread">
        <button type="button" className="btn btn-sm btn-ghost" disabled={step === 0} onClick={() => onStep(step - 1)}>
          ← Back
        </button>
        {step < last ? (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => onStep(step + 1)}>
            {step + 1 < order.length ? `Next: ${order[step + 1].name} →` : step + 1 === order.length ? 'See the overlap →' : 'Next →'}
          </button>
        ) : (
          <button type="button" className="btn btn-sm btn-primary" onClick={onSkip}>
            Explore on my own
          </button>
        )}
      </div>
    </aside>
  );
}

/** Noon UTC on a date: a stable moment to compare offsets on that day. */
function toInstantSafe(date: string, _zone: Zone): number {
  return Date.parse(`${date}T12:00:00Z`);
}

/* ── Join ──────────────────────────────────────────────────────────────── */

function JoinSheet({
  open,
  onClose,
  zone: initialZone,
  now,
  clock,
  hostName,
  title,
  colorIndex,
  takenNames,
  takenEmoji,
  onJoined,
  join,
}: {
  open: boolean;
  onClose: () => void;
  zone: Zone;
  now: number;
  clock: Clock;
  hostName: string;
  title: string;
  colorIndex: number;
  takenNames: string[];
  takenEmoji: string[];
  onJoined: (c: Credentials, p: ParticipantRecord) => void;
  join: (p: { name: string; emoji: string; color: ColorName; timezone: Zone; sleep: { start: number; end: number }; work: { start: number; end: number } }) => Promise<{ participant: ParticipantRecord; token: string }>;
}) {
  const profile = useMemo(getProfile, []);
  // Pre-fill from this device's last join, unless that person is already in this event.
  const profileFits = !!profile && !takenNames.includes(profile.name.toLowerCase());
  const freeEmoji = PERSON_EMOJI.find((e) => !takenEmoji.includes(e)) ?? PERSON_EMOJI[colorIndex % PERSON_EMOJI.length];
  const [name, setName] = useState(profileFits ? profile!.name : '');
  const [emoji, setEmoji] = useState(profileFits && !takenEmoji.includes(profile!.emoji) ? profile!.emoji : freeEmoji);
  const [zone, setZone] = useState(initialZone);
  const [sleep, setSleep] = useState(profile?.sleep ?? DEFAULT_SLEEP);
  const [work, setWork] = useState(profile?.work ?? DEFAULT_WORK);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const color: ColorName = profile?.color ?? COLOR_NAMES[(colorIndex + 2) % COLOR_NAMES.length];
  useEffect(() => setZone(initialZone), [initialZone]);

  const submit = async () => {
    const p = { name: name.trim(), emoji, color, timezone: zone, sleep, work };
    const problem = participantProblem(p);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await join(p);
      saveProfile({ name: p.name, emoji, color, sleep, work });
      onJoined({ participantId: r.participant.id, token: r.token }, r.participant);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add your times"
      footer={
        <button type="button" className="btn btn-primary btn-block btn-lg" onClick={submit} disabled={busy}>
          {busy ? 'Joining…' : 'Next: paint your times →'}
        </button>
      }
    >
      <form
        className="stack"
        style={{ ['--gap' as string]: '18px' }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="muted">
          {hostName} invited you to <strong>{title}</strong>. Just a name, no account.
        </p>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <EmojiButton value={emoji} options={PERSON_EMOJI} onChange={setEmoji} label="Your emoji" />
          <label className="field" style={{ flex: 1 }}>
            <span className="field-label">Your name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="given-name" autoFocus enterKeyHint="go" placeholder="Sam" />
          </label>
        </div>
        <div className="callout" data-tone="info">
          <span aria-hidden="true">🌍</span>
          <span>
            {copy.guest.zone(cityOf(zone))}{' '}
            <ZoneLine zone={zone} now={now} onChange={setZone} prefix="Zone:" />
          </span>
        </div>
        <details className="disclosure">
          <summary>Your usual hours (optional)</summary>
          <div className="stack" style={{ ['--gap' as string]: '12px', paddingTop: 8 }}>
            <p className="small muted">We shade these softly so nobody books you at 3am. Only used to shade the grid.</p>
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                <span className="small" style={{ fontWeight: 700 }}>
                  Asleep from
                </span>
                <TimeSelect value={sleep.start} onChange={(m) => setSleep({ ...sleep, start: m })} label="Asleep from" clock={clock} />
              </label>
              <label className="field" style={{ flex: 1 }}>
                <span className="small" style={{ fontWeight: 700 }}>
                  until
                </span>
                <TimeSelect value={sleep.end} onChange={(m) => setSleep({ ...sleep, end: m })} label="Asleep until" clock={clock} />
              </label>
            </div>
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                <span className="small" style={{ fontWeight: 700 }}>
                  Work from
                </span>
                <TimeSelect value={work.start} onChange={(m) => setWork({ ...work, start: m })} label="Work from" clock={clock} />
              </label>
              <label className="field" style={{ flex: 1 }}>
                <span className="small" style={{ fontWeight: 700 }}>
                  until
                </span>
                <TimeSelect value={work.end} onChange={(m) => setWork({ ...work, end: m })} label="Work until" clock={clock} allowEndOfDay />
              </label>
            </div>
          </div>
        </details>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/* ── Organizer: edit ───────────────────────────────────────────────────── */

function EditSheet({
  open,
  onClose,
  title,
  emoji,
  participants,
  onSave,
  onRemove,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  emoji: string;
  participants: ParticipantRecord[];
  onSave: (patch: { title: string; emoji: string }) => void;
  onRemove: (id: string) => void;
  onDelete: () => void;
}) {
  const [t, setT] = useState(title);
  const [e, setE] = useState(emoji);
  useEffect(() => {
    if (open) {
      setT(title);
      setE(emoji);
    }
  }, [open, title, emoji]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Edit event"
      footer={
        <div className="spread">
          <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={onDelete}>
            Delete event
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave({ title: t, emoji: e })}>
            Save
          </button>
        </div>
      }
    >
      <div className="stack">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <EmojiButton value={e} options={EVENT_EMOJI} onChange={setE} label="Event emoji" />
          <label className="field" style={{ flex: 1 }}>
            <span className="field-label">Name</span>
            <input className="input" value={t} onChange={(ev) => setT(ev.target.value)} maxLength={80} />
          </label>
        </div>
        <div className="stack" style={{ ['--gap' as string]: '6px' }}>
          <p className="field-label">People</p>
          <p className="small muted">Remove anyone who joined by mistake. Their times go with them.</p>
          <ul className="slot-people">
            {participants.map((p) => (
              <li key={p.id} className="slot-person">
                <Avatar emoji={p.emoji} color={p.color} />
                <span className="name">
                  {p.name} <span className="small muted">· {cityOf(p.timezone)}</span>
                </span>
                {p.isOrganizer ? (
                  <span className="small muted">Organizer</span>
                ) : (
                  <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => onRemove(p.id)}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Sheet>
  );
}

/* ── Text alternative to the grid ──────────────────────────────────────── */

function OverlapTable({ model, summary, names, prefs }: { model: NonNullable<ReturnType<typeof useEvent>['model']>; summary: Map<Instant, { free: string[]; ifNeeded: string[] }>; names: Map<string, string>; prefs: ViewPrefs }) {
  const responders = model.responders.length;
  const rows = model.slots
    .map((t) => ({ t, s: summary.get(t)! }))
    .filter((x) => x.s && x.s.free.length + x.s.ifNeeded.length > 0)
    .sort((a, b) => b.s.free.length + b.s.ifNeeded.length - (a.s.free.length + a.s.ifNeeded.length) || a.t - b.t)
    .slice(0, 60);
  if (rows.length === 0) return <p className="callout" data-tone="quiet">{copy.overlap.empty}</p>;
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <table className="alt">
        <caption>Times people can make, most popular first (in {cityOf(prefs.zone)} time)</caption>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Free</th>
            <th scope="col">If needed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ t, s }) => {
            const w = wallTime(t, prefs.zone);
            const h = heat(s, responders);
            return (
              <tr key={t}>
                <th scope="row">
                  {formatDate(w.date, prefs.locale)}, {formatMinute(w.minute, prefs.clock)}
                  {h.full && responders >= 2 ? ' ✦ everyone' : ''}
                </th>
                <td>
                  {s.free.length} · {s.free.map((id) => names.get(id)).join(', ')}
                </td>
                <td>{s.ifNeeded.map((id) => names.get(id)).join(', ') || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function NotFoundEvent() {
  if (backendKind() === 'local') {
    return (
      <div className="wrap-narrow stack" style={{ paddingBlock: 72, textAlign: 'center', alignItems: 'center' }}>
        <span style={{ fontSize: 56 }} aria-hidden="true">
          💻
        </span>
        <h1 style={{ fontSize: 'var(--step-3)' }}>{copy.local.notHereHeading}</h1>
        <p className="muted">{copy.local.notHereBody}</p>
        <Link to="/new" className="btn btn-primary btn-lg">
          Start a new one
        </Link>
      </div>
    );
  }
  return (
    <div className="wrap-narrow stack" style={{ paddingBlock: 72, textAlign: 'center', alignItems: 'center' }}>
      <span style={{ fontSize: 56 }} aria-hidden="true">
        🌒
      </span>
      <h1 style={{ fontSize: 'var(--step-3)' }}>{copy.notFound.heading}</h1>
      <p className="muted">{copy.notFound.body}</p>
      <Link to="/new" className="btn btn-primary btn-lg">
        Start a new one
      </Link>
      <p className="small faint">{BRAND.name} keeps events for {BRAND.retentionDays} days after their last date.</p>
    </div>
  );
}

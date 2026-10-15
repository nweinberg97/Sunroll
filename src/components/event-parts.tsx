import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { cityOf, formatOffset, wallTime, type Instant, type Zone } from '../lib/time/zone';
import { formatDate, formatMinute, formatSpan, type Clock } from '../lib/time/format';
import { inRange } from '../lib/time/ranges';
import { phaseGlyph, phaseOf } from '../lib/time/phase';
import type { Candidate } from '../lib/fairness/score';
import type { EventModel } from '../lib/model';
import type { LockRecord, ParticipantRecord, PresencePeer, ReactionEmoji, ReactionRecord } from '../lib/data/types';
import { REACTIONS } from '../lib/data/types';
import { buildIcs, googleCalendarUrl, outlookCalendarUrl } from '../lib/calendar/ics';
import { copy } from '../lib/copy';
import { BRAND } from '../lib/brand';
import { encodeQr, qrSvgPath } from '../lib/qr/qr';
import { canNativeShare, eventUrl, messagingLinks, nativeShare, organizerUrl } from '../lib/share/links';
import { downloadFile, renderCard, type CardFormat } from '../lib/share/card';
import { Link } from '../lib/router';
import { backendKind } from '../lib/data';
import type { PersonColor } from '../lib/people';
import { Avatar, AvatarStack, CopyField, Sheet, useToast, copyText } from './ui';

export interface ViewPrefs {
  zone: Zone;
  clock: Clock;
  locale: string;
}

/* ── World strip ────────────────────────────────────────────────────────── */

export function WorldStrip({ participants, now, prefs }: { participants: ParticipantRecord[]; now: number; prefs: ViewPrefs }) {
  const zones = useMemo(() => {
    const by = new Map<Zone, ParticipantRecord[]>();
    for (const p of participants) by.set(p.timezone, [...(by.get(p.timezone) ?? []), p]);
    return [...by.entries()].sort((a, b) => wallTime(now, a[0]).offset - wallTime(now, b[0]).offset);
  }, [participants, now]);
  if (zones.length === 0) return null;
  return (
    <div className="world" role="list" aria-label="Where everyone is right now">
      {zones.map(([zone, people]) => {
        const w = wallTime(now, zone);
        const phase = phaseOf(w.minute);
        return (
          <div key={zone} className="world-chip" data-phase={phase} role="listitem">
            <span className="glyph" aria-hidden="true">
              {phaseGlyph(phase)}
            </span>
            <span>
              <strong>{cityOf(zone)}</strong>
              <span className="t">
                {formatMinute(w.minute, prefs.clock)}
                {w.date !== wallTime(now, prefs.zone).date && (w.date > wallTime(now, prefs.zone).date ? ' · tomorrow' : ' · yesterday')}
              </span>
            </span>
            <AvatarStack people={people} max={3} size={22} />
          </div>
        );
      })}
    </div>
  );
}

/* ── Local time chips: what a moment means for each person ──────────────── */

export function LocalChips({ start, people, prefs, unavailable, meId, colors }: { start: Instant; people: ParticipantRecord[]; prefs: ViewPrefs; unavailable?: Set<string>; meId: string | null; colors?: Map<string, PersonColor> }) {
  const viewerDate = wallTime(start, prefs.zone).date;
  return (
    <div className="local-chips">
      {people.map((p) => {
        const w = wallTime(start, p.timezone);
        const asleep = inRange(w.minute, p.sleep);
        const shift = w.date === viewerDate ? '' : w.date > viewerDate ? ' +1' : ' −1';
        return (
          <span
            key={p.id}
            className="local-chip"
            data-phase={phaseOf(w.minute)}
            data-out={unavailable?.has(p.id) || undefined}
            title={`${p.name}, ${cityOf(p.timezone)}`}
            aria-label={`${p.id === meId ? 'You' : p.name}: ${formatMinute(w.minute, prefs.clock)} in ${cityOf(p.timezone)}${shift ? (shift === ' +1' ? ', next day' : ', previous day') : ''}${asleep ? ', usually asleep' : ''}${unavailable?.has(p.id) ? ', can’t make it' : ''}`}
          >
            <Avatar emoji={p.emoji} color={p.color} size={20} tint={colors?.get(p.id)?.soft} />
            {formatMinute(w.minute, prefs.clock)}
            {shift && <sup>{shift.trim()}</sup>}
            {asleep && <span aria-hidden="true"> 😴</span>}
          </span>
        );
      })}
    </div>
  );
}

/* ── Best times ─────────────────────────────────────────────────────────── */

export function BestTimes({
  colors,
  best,
  model,
  explanations,
  prefs,
  meId,
  selected,
  onSelect,
  onLock,
  canLock,
}: {
  colors?: Map<string, PersonColor>;
  best: Candidate[];
  model: EventModel;
  explanations: string[];
  prefs: ViewPrefs;
  meId: string | null;
  selected: Instant | null;
  onSelect: (t: Instant) => void;
  onLock?: (c: Candidate) => void;
  canLock: boolean;
}) {
  const responders = model.responders.length;
  return (
    <ol className="best-list" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Best times">
      {best.map((c, i) => {
        const full = c.available.length === responders && responders >= 2;
        const w = wallTime(c.start, prefs.zone);
        const unavailable = new Set(c.unavailable);
        return (
          <li key={c.start} className="best" data-full={full || undefined} data-selected={selected === c.start || undefined}>
            <span className="rank" aria-hidden="true">
              {full ? '✦ ' : ''}#{i + 1}
            </span>
            <span className="day">{formatDate(w.date, prefs.locale)}</span>
            <span className="when">{formatSpan(c.start, c.end, prefs.zone, prefs.clock)}</span>
            <span className="why">{explanations[i]}</span>
            <LocalChips start={c.start} people={model.responders} prefs={prefs} unavailable={unavailable} meId={meId} colors={colors} />
            <div className="row" style={{ marginTop: 4 }}>
              <button type="button" className="btn btn-sm" onClick={() => onSelect(c.start)}>
                Details
              </button>
              {canLock && onLock && (
                <button type="button" className="btn btn-sm btn-sun" onClick={() => onLock(c)}>
                  {copy.lock.cta}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ── Slot detail ────────────────────────────────────────────────────────── */

export function SlotDetail({ candidate, model, prefs, meId, explanation, colors }: { candidate: Candidate; model: EventModel; prefs: ViewPrefs; meId: string | null; explanation: string; colors?: Map<string, PersonColor> }) {
  const participants = model.snapshot.participants;
  const responded = new Set(model.responders.map((p) => p.id));
  const status = (p: ParticipantRecord): { s: string; label: string } => {
    if (!responded.has(p.id)) return { s: 'waiting', label: 'Hasn’t answered' };
    if (candidate.ifNeeded.includes(p.id)) return { s: 'if_needed', label: 'If needed' };
    if (candidate.available.includes(p.id)) return { s: 'free', label: 'Free' };
    return { s: 'busy', label: 'Can’t make it' };
  };
  const viewerDate = wallTime(candidate.start, prefs.zone).date;
  return (
    <div className="stack" style={{ ['--gap' as string]: '14px' }}>
      <div>
        <p className="muted small" style={{ fontWeight: 700 }}>
          {formatDate(viewerDate, prefs.locale)} · your time
        </p>
        <p className="num" style={{ fontSize: 'var(--step-3)', lineHeight: 1 }}>
          {formatSpan(candidate.start, candidate.end, prefs.zone, prefs.clock)}
        </p>
        <p className="muted small" style={{ marginTop: 6, fontWeight: 600 }}>
          {explanation}
        </p>
      </div>
      <ul className="slot-people">
        {participants.map((p) => {
          const w = wallTime(candidate.start, p.timezone);
          const asleep = inRange(w.minute, p.sleep);
          const st = status(p);
          return (
            <li key={p.id} className="slot-person">
              <Avatar emoji={p.emoji} color={p.color} tint={colors?.get(p.id)?.soft} ring={colors?.get(p.id)?.solid} />
              <span>
                <span className="name">{p.id === meId ? `${p.name} (you)` : p.name}</span>
                <span className="place" style={{ display: 'block' }}>
                  {cityOf(p.timezone)} · {formatOffset(w.offset)}
                </span>
                <span className="status" data-s={st.s}>
                  {st.label}
                </span>
              </span>
              <span className="local">
                <strong>
                  {phaseGlyph(phaseOf(w.minute))} {formatSpan(candidate.start, candidate.end, p.timezone, prefs.clock)}
                </strong>
                <span className="small muted">
                  {w.date === viewerDate ? formatDate(w.date, prefs.locale) : `${formatDate(w.date, prefs.locale)} (${w.date > viewerDate ? 'next day' : 'day before'})`}
                  {asleep ? ' · 😴' : ''}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── Presence ───────────────────────────────────────────────────────────── */

export function PresenceBar({ peers }: { peers: PresencePeer[] }) {
  const painting = peers.filter((p) => p.activity === 'painting' && p.name);
  const viewing = peers.filter((p) => p.activity !== 'painting');
  if (painting.length === 0 && viewing.length === 0) return null;
  return (
    <div className="row-wrap" aria-live="polite">
      {painting.slice(0, 2).map((p) => (
        <span key={p.clientId} className="presence-pill">
          <Avatar emoji={p.emoji ?? '🙂'} color="coral" size={26} live />
          {copy.overlap.adding(p.name!)}
        </span>
      ))}
      {painting.length === 0 && viewing.length > 0 && (
        <span className="tag" title="People looking at this event right now">
          <span aria-hidden="true">●</span> {viewing.length} {viewing.length === 1 ? 'other person' : 'others'} here now
        </span>
      )}
    </div>
  );
}

/* ── Calendar ───────────────────────────────────────────────────────────── */

export function CalendarButtons({ title, lock, eventId, description }: { title: string; lock: LockRecord; eventId: string; description: string }) {
  const url = eventUrl(eventId);
  const base = { title, start: lock.start, end: lock.end, description, url };
  const [outlookOpen, setOutlookOpen] = useState(false);
  const downloadIcs = () => {
    const ics = buildIcs({ ...base, uid: `${eventId}@${BRAND.name.toLowerCase()}`, sequence: lock.version, stamp: Date.now() }, BRAND.name);
    const file = new File([ics], `${title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'event'}.ics`, { type: 'text/calendar' });
    downloadFile(file);
  };
  return (
    <div className="row-wrap">
      <a className="btn btn-sm" href={googleCalendarUrl(base)} target="_blank" rel="noopener noreferrer">
        Google Calendar
      </a>
      <button type="button" className="btn btn-sm" aria-expanded={outlookOpen} onClick={() => setOutlookOpen((o) => !o)}>
        Outlook ▾
      </button>
      {outlookOpen && (
        <>
          <a className="btn btn-sm" href={outlookCalendarUrl(base, 'personal')} target="_blank" rel="noopener noreferrer">
            Outlook.com
          </a>
          <a className="btn btn-sm" href={outlookCalendarUrl(base, 'work')} target="_blank" rel="noopener noreferrer">
            Microsoft 365
          </a>
        </>
      )}
      <button type="button" className="btn btn-sm" onClick={downloadIcs}>
        Apple / .ics
      </button>
    </div>
  );
}

/* ── Reactions ──────────────────────────────────────────────────────────── */

export function Reactions({ reactions, meId, onToggle }: { reactions: ReactionRecord[]; meId: string | null; onToggle: (e: ReactionEmoji) => void }) {
  return (
    <div className="reactions" role="group" aria-label="Reactions">
      {REACTIONS.map((e) => {
        const count = reactions.filter((r) => r.emoji === e).length;
        const mine = !!meId && reactions.some((r) => r.emoji === e && r.participantId === meId);
        return (
          <button
            key={e}
            type="button"
            className="reaction"
            aria-pressed={mine}
            disabled={!meId}
            title={meId ? undefined : 'Add your times to react'}
            onClick={() => onToggle(e)}
            aria-label={`${e} ${count}`}
          >
            <span className="e" aria-hidden="true">
              {e}
            </span>
            {count > 0 && <span>{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ── Share card buttons ─────────────────────────────────────────────────── */

export function ShareCardButtons({ model, lock, prefs }: { model: EventModel; lock: LockRecord; prefs: ViewPrefs }) {
  const toast = useToast();
  const [busy, setBusy] = useState<CardFormat | null>(null);
  const make = async (format: CardFormat) => {
    setBusy(format);
    try {
      const file = await renderCard(format, {
        title: model.snapshot.event.title,
        emoji: model.snapshot.event.emoji,
        start: lock.start,
        end: lock.end,
        viewerZone: prefs.zone,
        clock: prefs.clock,
        locale: prefs.locale,
        people: model.snapshot.participants.map((p) => ({ name: p.name, emoji: p.emoji, zone: p.timezone })),
      });
      const shared = await nativeShare({ files: [file], title: model.snapshot.event.title });
      if (!shared) {
        downloadFile(file);
        toast('Card saved. Post it anywhere.');
      }
    } catch {
      toast('Couldn’t make the card on this device.', 'error');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="row-wrap">
      <button type="button" className="btn btn-sm btn-sun" disabled={busy !== null} onClick={() => make('story')}>
        {busy === 'story' ? 'Making…' : 'Share card · story'}
      </button>
      <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => make('square')}>
        {busy === 'square' ? 'Making…' : 'Square'}
      </button>
    </div>
  );
}

/* ── It's on: the locked card ───────────────────────────────────────────── */

export function LockedCard({
  model,
  lock,
  prefs,
  meId,
  onReact,
  organizerActions,
}: {
  model: EventModel;
  lock: LockRecord;
  prefs: ViewPrefs;
  meId: string | null;
  onReact: (e: ReactionEmoji) => void;
  organizerActions?: ReactNode;
}) {
  const e = model.snapshot.event;
  const w = wallTime(lock.start, prefs.zone);
  const zones: Zone[] = [];
  for (const p of model.snapshot.participants) if (!zones.includes(p.timezone)) zones.push(p.timezone);
  return (
    <section className="locked stack" style={{ ['--gap' as string]: '18px' }} aria-labelledby="locked-title">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ ['--gap' as string]: '6px' }}>
          <span className="eyebrow">{e.emoji} {e.title}</span>
          <h2 id="locked-title">{copy.lock.moment}</h2>
        </div>
        <span style={{ fontSize: 44 }} aria-hidden="true">
          {e.emoji}
        </span>
      </div>
      <div>
        <p className="muted" style={{ fontWeight: 700 }}>
          {formatDate(w.date, prefs.locale)} · your time in {cityOf(prefs.zone)}
        </p>
        <p className="big-time">{formatMinute(w.minute, prefs.clock)}</p>
      </div>
      <div className="stack" style={{ ['--gap' as string]: '10px' }} aria-label="Local times">
        {zones.map((z) => {
          const zw = wallTime(lock.start, z);
          const people = model.snapshot.participants.filter((p) => p.timezone === z);
          return (
            <div key={z} className="band-row">
              <span>
                <strong className="num" style={{ fontSize: 'var(--step-1)' }}>
                  {formatMinute(zw.minute, prefs.clock)}
                </strong>{' '}
                <span className="muted small">
                  {cityOf(z)}
                  {zw.date !== w.date ? (zw.date > w.date ? ' · next day' : ' · day before') : ''} {people.map((p) => p.emoji).join('')}
                </span>
              </span>
              <span className="mini-band" aria-hidden="true">
                <span className="sun" style={{ left: `${(zw.minute / 1440) * 100}%` }} />
              </span>
            </div>
          );
        })}
      </div>
      <p className="muted small">{copy.lock.cardLine(model.snapshot.participants.length, zones.length)}</p>
      <div className="stack" style={{ ['--gap' as string]: '12px' }}>
        <CalendarButtons title={`${e.emoji} ${e.title}`} lock={lock} eventId={e.id} description={`Found with ${BRAND.name}.`} />
        <ShareCardButtons model={model} lock={lock} prefs={prefs} />
        <Reactions reactions={model.snapshot.reactions} meId={meId} onToggle={onReact} />
        {organizerActions}
      </div>
    </section>
  );
}

/** The full-screen celebration the first time someone sees a newly locked time. */
export function LockMoment({ model, lock, prefs, onClose }: { model: EventModel; lock: LockRecord; prefs: ViewPrefs; onClose: () => void }) {
  const w = wallTime(lock.start, prefs.zone);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(onClose, 7000);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
    };
  }, [onClose]);
  return (
    <div className="moment" role="dialog" aria-modal="true" aria-labelledby="moment-title" onClick={onClose}>
      <div className="rays" aria-hidden="true" />
      <div className="moment-inner">
        <div className="sun-rise" aria-hidden="true">
          {model.snapshot.event.emoji}
        </div>
        <h2 id="moment-title">{copy.lock.moment}</h2>
        <p className="moment-date">{formatDate(w.date, prefs.locale)}</p>
        <p className="big-time">{formatMinute(w.minute, prefs.clock)}</p>
        <p className="moment-zone">your time in {cityOf(prefs.zone)}</p>
        <p className="who" style={{ fontWeight: 700 }}>
          {copy.lock.cardLine(model.snapshot.participants.length, new Set(model.snapshot.participants.map((p) => p.timezone)).size)}
        </p>
        <button type="button" className="btn btn-sun btn-lg" autoFocus onClick={onClose}>
          Nice
        </button>
      </div>
    </div>
  );
}

/* ── Share and invite ───────────────────────────────────────────────────── */

export function QrCode({ text }: { text: string }) {
  const { path, size } = useMemo(() => qrSvgPath(encodeQr(text)), [text]);
  return (
    <div className="qr">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="QR code for the event link" shapeRendering="crispEdges">
        <rect width={size} height={size} fill="#fff" />
        <path d={path} fill="#15132b" />
      </svg>
    </div>
  );
}

export function SharePreview({ model }: { model: EventModel }) {
  const e = model.snapshot.event;
  return (
    <div className="preview-card" aria-label="What your group will see">
      <div className="spread">
        <span className="emoji" aria-hidden="true">
          {e.emoji}
        </span>
        <span className="small" style={{ fontWeight: 800, opacity: 0.85 }}>
          ☀ {BRAND.name}
        </span>
      </div>
      <div className="stack" style={{ ['--gap' as string]: '6px' }}>
        <span className="title">{e.title}</span>
        <span className="small" style={{ opacity: 0.85, fontWeight: 600 }}>
          {model.host ? `${model.host.name} invited you · ` : ''}
          {model.cities.join(' · ')}
        </span>
      </div>
      <span className="band" aria-hidden="true" />
    </div>
  );
}

export function ShareSheet({ open, onClose, model, organizerToken, onAddTimes }: { open: boolean; onClose: () => void; model: EventModel; organizerToken: string | null; onAddTimes?: () => void }) {
  const e = model.snapshot.event;
  const url = eventUrl(e.id);
  const text = copy.invite(`${e.emoji} ${e.title}`, url);
  const links = messagingLinks(text, url);
  const [qr, setQr] = useState(false);
  const toast = useToast();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={copy.share.heading}
      footer={
        onAddTimes ? (
          <button type="button" className="btn btn-primary btn-block btn-lg" onClick={onAddTimes}>
            {copy.share.addMine} →
          </button>
        ) : undefined
      }
    >
      <div className="stack" style={{ ['--gap' as string]: '18px' }}>
        <p className="muted">{copy.share.sub}</p>
        {backendKind() === 'local' && (
          <p className="callout" role="note" data-testid="local-share-note">
            <span aria-hidden="true">⚠️</span>
            <span>{copy.local.shareNote}</span>
          </p>
        )}
        <SharePreview model={model} />
        <CopyField value={url} label="Event link" />
        <div className="share-grid">
          {canNativeShare() ? (
            <button type="button" className="share-target" onClick={async () => void (await nativeShare({ title: e.title, text: copy.invite(`${e.emoji} ${e.title}`, ''), url }))}>
              <span className="ico" aria-hidden="true">
                ⤴
              </span>
              Share…
            </button>
          ) : (
            <button
              type="button"
              className="share-target"
              onClick={async () => toast((await copyText(text)) ? 'Message copied. Paste it in your group chat.' : 'Couldn’t copy.')}
            >
              <span className="ico" aria-hidden="true">
                ✎
              </span>
              Copy message
            </button>
          )}
          <a className="share-target" href={links.whatsapp} target="_blank" rel="noopener noreferrer">
            <span className="ico" aria-hidden="true">
              💬
            </span>
            WhatsApp
          </a>
          <a className="share-target" href={links.sms}>
            <span className="ico" aria-hidden="true">
              ✉️
            </span>
            Messages
          </a>
          <button type="button" className="share-target" aria-expanded={qr} onClick={() => setQr((q) => !q)}>
            <span className="ico" aria-hidden="true">
              ▦
            </span>
            QR code
          </button>
        </div>
        {qr && <QrCode text={url} />}
        <div className="row-wrap small">
          <a href={links.telegram} target="_blank" rel="noopener noreferrer" className="link-btn muted">
            Telegram
          </a>
          <a href={links.email} className="link-btn muted">
            Email
          </a>
        </div>
        {organizerToken && (
          <div className="panel stack" style={{ ['--gap' as string]: '10px' }}>
            <div>
              <p style={{ fontWeight: 800 }}>🔑 {copy.share.organizer}</p>
              <p className="small muted">{copy.share.organizerHint} Don’t post it in the group.</p>
            </div>
            <CopyField value={organizerUrl(e.id, organizerToken)} label="Organizer link" display={`${url.replace(/^https?:\/\//, '')}#o=••••••`} />
          </div>
        )}
      </div>
    </Sheet>
  );
}

export function NudgeSheet({ open, onClose, model }: { open: boolean; onClose: () => void; model: EventModel }) {
  const e = model.snapshot.event;
  const url = eventUrl(e.id);
  const expected = e.expectedCount;
  const waiting = expected ? Math.max(0, expected - model.responders.length) : model.waiting.length || null;
  const text = copy.nudge(`${e.emoji} ${e.title}`, url, waiting);
  const links = messagingLinks(text, url);
  const toast = useToast();
  return (
    <Sheet open={open} onClose={onClose} title="Give the group a nudge">
      <div className="stack">
        <p className="muted">A friendly reminder to paste into your group chat. No names, no guilt.</p>
        <div className="panel" style={{ fontWeight: 600 }}>
          {text}
        </div>
        <div className="row-wrap">
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              if (canNativeShare() && (await nativeShare({ text }))) return;
              toast((await copyText(text)) ? 'Copied. Paste it in your group chat.' : 'Couldn’t copy.');
            }}
          >
            {canNativeShare() ? 'Share' : 'Copy message'}
          </button>
          <a className="btn" href={links.whatsapp} target="_blank" rel="noopener noreferrer">
            WhatsApp
          </a>
          <a className="btn" href={links.sms}>
            Messages
          </a>
        </div>
      </div>
    </Sheet>
  );
}

/* ── Plan your own (the quiet growth loop) ───────────────────────────────── */

export function PlanYourOwn({ eventId, templateSlug }: { eventId: string; templateSlug: string | null }) {
  const params = new URLSearchParams({ ref: eventId });
  if (templateSlug) params.set('t', templateSlug);
  return (
    <aside className="plan-own" aria-label="Start your own event">
      <span>
        <strong>{copy.planYourOwn.heading}</strong>
        <span className="muted small">{copy.planYourOwn.body}</span>
      </span>
      <Link to={`/new?${params.toString()}`} className="btn btn-sm">
        {copy.planYourOwn.cta} →
      </Link>
    </aside>
  );
}

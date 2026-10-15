/**
 * The host side of booking links: dashboard, bookings, calendars, my week, link editor.
 * Demo mode: sign-in, Google Calendar and email are simulated; nothing leaves the browser.
 */
import { useMemo, useState } from 'react';
import { hostStore, useHostQuery, useMe } from '../../lib/host/hooks';
import { HostError } from '../../lib/host/store';
import type { ConnectedCalendar, EventType, NewEventType, WorkspaceView } from '../../lib/host/types';
import { Link, match, navigate, useLocation } from '../../lib/router';
import { addDays, cityOf, formatOffset, MINUTE, toInstant, wallTime, type Instant, type IsoDate } from '../../lib/time/zone';
import { dateParts, detectClock, formatDate, formatDuration, formatMinute, formatSpan } from '../../lib/time/format';
import { mergeIntervals, WORKDAYS, type Interval } from '../../lib/booking/slots';
import { preferredLocale } from '../../lib/identity';
import { displayUrl, pageUrl } from '../../lib/share/links';
import { Avatar, CopyField, Spinner, useToast, copyText } from '../../components/ui';
import { TimeSelect, ZoneLine } from '../../components/pickers';
import { GuideCard } from '../../components/Guide';
import { useNow } from '../../lib/hooks';

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function errText(e: unknown): string {
  if (e instanceof HostError) return e.message.charAt(0).toUpperCase() + e.message.slice(1) + '.';
  return 'Something went wrong. Please try again.';
}

export default function HostApp() {
  const loc = useLocation();
  const { me, loading } = useMe();
  if (loading) return <Spinner />;
  if (!me) return <SignIn />;
  const tab = loc.path.startsWith('/app/bookings') ? 'bookings' : loc.path.startsWith('/app/calendars') ? 'calendars' : loc.path.startsWith('/app/week') ? 'week' : 'links';
  const editId = match('/app/links/:id', loc.path)?.id;
  return (
    <div className="host wrap stack" style={{ ['--gap' as string]: '18px', paddingBlock: '20px 64px' }}>
      <header className="spread host-head" style={{ flexWrap: 'wrap' }}>
        <div className="row">
          <Avatar emoji={me.emoji} color="coral" size={44} />
          <div>
            <h1 style={{ fontSize: 'var(--step-2)' }}>{me.name}’s booking links</h1>
            <p className="small muted" style={{ fontWeight: 600 }}>
              {me.email} · {cityOf(me.zone)} time <span className="tag" style={{ marginLeft: 4 }}>Demo account</span>
            </p>
          </div>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void hostStore().signOut()}>
          Sign out
        </button>
      </header>
      <nav className="tabs" aria-label="Sections">
        {(
          [
            ['links', '/app', 'Links'],
            ['bookings', '/app/bookings', 'Bookings'],
            ['calendars', '/app/calendars', 'Calendars'],
            ['week', '/app/week', 'Week'],
          ] as const
        ).map(([id, to, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id && !editId && loc.path !== '/app/links/new'} onClick={() => navigate(to)}>
            {label}
          </button>
        ))}
      </nav>
      <GuideCard at={loc.path} />
      {loc.path === '/app/links/new' ? (
        <LinkEditor workspaceId={loc.search.get('ws')} productId={loc.search.get('product')} />
      ) : editId ? (
        <LinkEditor editId={editId} />
      ) : tab === 'bookings' ? (
        <Bookings />
      ) : tab === 'calendars' ? (
        <Calendars />
      ) : tab === 'week' ? (
        <MyWeek />
      ) : (
        <Links />
      )}
    </div>
  );
}

/* ── Sign in (demo) ──────────────────────────────────────────────────────────────────── */

function SignIn() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="wrap-narrow stack" style={{ ['--gap' as string]: '18px', paddingBlock: '56px 72px', textAlign: 'center', alignItems: 'center' }}>
      <span style={{ fontSize: 56 }} aria-hidden="true">
        🔗
      </span>
      <h1 style={{ fontSize: 'var(--step-4)' }}>Your booking links</h1>
      <p className="muted" style={{ maxWidth: '44ch' }}>
        Share a link, and people book time with you in their own time zone. Sunroll checks all your calendars, so you’re never double-booked.
      </p>
      <button
        type="button"
        className="btn btn-primary btn-lg"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await hostStore().signIn();
          setBusy(false);
        }}
      >
        <span aria-hidden="true">G</span> Continue with Google
      </button>
      <p className="callout" data-tone="info" style={{ textAlign: 'left' }}>
        <span aria-hidden="true">🧪</span>
        <span>
          <strong>Demo:</strong> this signs you in as Nadia, with two pretend Google accounts. No real Google account is used, and nothing leaves your browser.
        </span>
      </p>
      <p className="small muted">Guests who book never need an account. Neither does “Find a time”.</p>
      <Link to="/demo/booking" className="link-btn">
        Or take the guided booking demo →
      </Link>
    </div>
  );
}

/* ── Links, grouped by workspace and product ────────────────────────────────────────── */

function LinkRow({ t, path }: { t: EventType; path: string }) {
  const toast = useToast();
  return (
    <li className="link-row" data-inactive={!t.active || undefined}>
      <div style={{ minWidth: 0 }}>
        <strong>{t.title}</strong>
        <span className="small muted" style={{ display: 'block' }}>
          {formatDuration(t.durationMin)} · Google Meet · <span className="mono">{displayUrl(path)}</span>
        </span>
      </div>
      <div className="row" style={{ ['--gap' as string]: '6px', flex: 'none' }}>
        <button type="button" className="btn btn-sm" onClick={async () => toast((await copyText(pageUrl(path))) ? 'Link copied.' : 'Couldn’t copy.')}>
          Copy link
        </button>
        <Link to={path} className="btn btn-sm btn-ghost">
          Open
        </Link>
        <Link to={`/app/links/${t.id}`} className="btn btn-sm btn-ghost">
          Edit
        </Link>
      </div>
    </li>
  );
}

function Links() {
  const { data } = useHostQuery((s) => s.workspaces());
  const { data: me } = useHostQuery((s) => s.me());
  const [newCompany, setNewCompany] = useState(false);
  if (!data || !me) return <Spinner />;
  return (
    <div className="stack" style={{ ['--gap' as string]: '18px' }}>
      {data.map((w) => (
        <WorkspaceCard key={w.workspace.id} w={w} handle={me.handle} />
      ))}
      {newCompany ? (
        <NewCompany onDone={() => setNewCompany(false)} />
      ) : (
        <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setNewCompany(true)}>
          + New company workspace
        </button>
      )}
    </div>
  );
}

function WorkspaceCard({ w, handle }: { w: WorkspaceView; handle: string }) {
  const [addingProduct, setAddingProduct] = useState(false);
  const active = (t: EventType) => t.active;
  const personalTypes = w.types.filter((t) => !t.productId && active(t));
  return (
    <section className="ws-card" aria-label={w.workspace.name}>
      <header className="spread" style={{ flexWrap: 'wrap' }}>
        <div className="row">
          <span className="ws-emoji" aria-hidden="true">
            {w.workspace.emoji}
          </span>
          <div>
            <h2>{w.workspace.kind === 'personal' ? 'Personal' : w.workspace.name}</h2>
            <p className="small muted" style={{ fontWeight: 600 }}>
              {w.workspace.kind === 'personal' ? (
                <span className="mono">{displayUrl(`/${handle}`)}</span>
              ) : (
                <>
                  Company · you’re {w.role === 'owner' ? 'the owner' : `an ${w.role}`} · {w.members.length} {w.members.length === 1 ? 'person' : 'people'} · <span className="mono">{displayUrl(`/${w.workspace.slug}`)}</span>
                </>
              )}
            </p>
          </div>
        </div>
        {w.workspace.kind === 'company' && (
          <div className="avatar-stack" aria-label={`Team: ${w.members.map((m) => m.name).join(', ')}`}>
            {w.members.map((m) => (
              <span key={m.accountId} className="avatar" data-color="sun" style={{ ['--size' as string]: '30px', fontSize: 13, fontWeight: 800 }} title={`${m.name} (${m.role})`}>
                {m.name.slice(0, 1).toUpperCase()}
              </span>
            ))}
          </div>
        )}
      </header>

      {w.workspace.kind === 'personal' && (
        <>
          <ul className="link-list">
            {personalTypes.map((t) => (
              <LinkRow key={t.id} t={t} path={`/${handle}/${t.slug}`} />
            ))}
          </ul>
          <Link to={`/app/links/new?ws=${w.workspace.id}`} className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>
            + New link
          </Link>
        </>
      )}

      {w.workspace.kind === 'company' &&
        w.products.map((p) => (
          <div key={p.id} className="product" style={{ ['--brand' as string]: p.color }}>
            <div className="spread">
              <h3>
                <span aria-hidden="true">{p.emoji}</span> {p.name}
              </h3>
              <span className="small muted mono">{displayUrl(`/${w.workspace.slug}/${p.slug}`)}</span>
            </div>
            <ul className="link-list">
              {w.types
                .filter((t) => t.productId === p.id && active(t))
                .map((t) => (
                  <LinkRow key={t.id} t={t} path={`/${w.workspace.slug}/${p.slug}/${t.slug}`} />
                ))}
            </ul>
            <Link to={`/app/links/new?ws=${w.workspace.id}&product=${p.id}`} className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>
              + New link for {p.name}
            </Link>
          </div>
        ))}
      {w.workspace.kind === 'company' &&
        (w.role === 'member' ? null : addingProduct ? (
          <NewProduct workspaceId={w.workspace.id} onDone={() => setAddingProduct(false)} />
        ) : (
          <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setAddingProduct(true)}>
            + Add a product
          </button>
        ))}
    </section>
  );
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

function NewCompany({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="ws-card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await hostStore().createCompany(name, slug || slugify(name), '🏢');
          onDone();
        } catch (err) {
          setError(errText(err));
        }
      }}
    >
      <h2>New company workspace</h2>
      <label className="field">
        <span className="small" style={{ fontWeight: 700 }}>
          Company name
        </span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Globex" autoFocus />
      </label>
      <label className="field">
        <span className="small" style={{ fontWeight: 700 }}>
          Link
        </span>
        <input className="input" value={slug || slugify(name)} onChange={(e) => setSlug(slugify(e.target.value))} />
        <span className="field-hint mono">{displayUrl(`/${slug || slugify(name) || 'your-company'}`)}</span>
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="row">
        <button type="submit" className="btn btn-primary">
          Create
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const BRAND_COLORS = ['#2f4bff', '#e8366d', '#0f9d6e', '#7c4dff', '#e8680c', '#0b8fb3'];

function NewProduct({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(BRAND_COLORS[2]);
  const [emoji, setEmoji] = useState('✨');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="product stack"
      style={{ ['--brand' as string]: color }}
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await hostStore().createProduct(workspaceId, { name, slug: slugify(name), emoji, color });
          onDone();
        } catch (err) {
          setError(errText(err));
        }
      }}
    >
      <h3>New product</h3>
      <div className="row">
        <input className="input" style={{ width: 64, textAlign: 'center', fontSize: 22 }} value={emoji} onChange={(e) => setEmoji(e.target.value)} aria-label="Logo emoji" maxLength={4} />
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Pay" aria-label="Product name" autoFocus />
      </div>
      <div className="row" role="radiogroup" aria-label="Brand colour">
        {BRAND_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} className="swatch-btn" style={{ background: c }} onClick={() => setColor(c)} />
        ))}
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="row">
        <button type="submit" className="btn btn-primary btn-sm">
          Add product
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ── Upcoming bookings ───────────────────────────────────────────────────────────────── */

function Bookings() {
  const now = useNow();
  const clock = useMemo(() => detectClock(preferredLocale()), []);
  const { data } = useHostQuery((s) => s.myBookings());
  const { data: me } = useHostQuery((s) => s.me());
  const { data: cals } = useHostQuery((s) => s.calendars());
  const { data: outbox } = useHostQuery((s) => s.outbox());
  if (!data || !me || !cals) return <Spinner />;
  const upcoming = data.filter((b) => b.end > now);
  const calName = (id: string | null) => cals.calendars.find((c) => c.id === id)?.name ?? 'calendar';
  return (
    <div className="stack" style={{ ['--gap' as string]: '16px' }}>
      {upcoming.length === 0 && <p className="callout" data-tone="quiet">No upcoming bookings yet. Share a link and they’ll appear here.</p>}
      <ul className="booking-list">
        {upcoming.map((b) => {
          const w = wallTime(b.start, me.zone);
          return (
            <li key={b.id} className="booking-row" data-status={b.status}>
              <div className="when">
                <span className="small muted" style={{ fontWeight: 700 }}>
                  {formatDate(w.date)}
                </span>
                <strong className="num">{formatSpan(b.start, b.end, me.zone, clock)}</strong>
              </div>
              <div style={{ minWidth: 0 }}>
                <strong>
                  {b.typeTitle} with {b.guestName}
                </strong>
                <span className="small muted" style={{ display: 'block' }}>
                  {b.status === 'cancelled' ? 'Cancelled · ' : ''}
                  {formatMinute(wallTime(b.start, b.guestZone).minute, clock)} for them in {cityOf(b.guestZone)} · on your {calName(b.calendarId)} calendar · Google Meet
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {outbox && outbox.length > 0 && (
        <details className="disclosure">
          <summary>Emails Sunroll would have sent ({outbox.length})</summary>
          <ul className="outbox">
            {outbox.slice(0, 6).map((m) => (
              <li key={m.id}>
                <span className="small muted">To {m.to}</span>
                <strong>{m.subject}</strong>
                <pre>{m.body}</pre>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/* ── Calendars ───────────────────────────────────────────────────────────────────────── */

function Calendars() {
  const toast = useToast();
  const { data } = useHostQuery((s) => s.calendars());
  const [email, setEmail] = useState('');
  if (!data) return <Spinner />;
  return (
    <div className="stack" style={{ ['--gap' as string]: '16px' }}>
      <p className="muted">Sunroll checks every calendar marked “busy” before offering a time, so you’re never double-booked. It only ever sees busy times, never what the events are.</p>
      {data.connections.map((c) => (
        <section key={c.id} className="ws-card" aria-label={c.email}>
          <header className="spread" style={{ flexWrap: 'wrap' }}>
            <div className="row">
              <span className="g-badge" aria-hidden="true">
                G
              </span>
              <div>
                <h2 style={{ fontSize: 'var(--step-1)' }}>{c.email}</h2>
                <p className="small muted" style={{ fontWeight: 600 }}>
                  Google Calendar {c.demo && <span className="tag">Demo connection</span>}
                </p>
              </div>
            </div>
            <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => void hostStore().disconnect(c.id)}>
              Disconnect
            </button>
          </header>
          <ul className="cal-list">
            {data.calendars
              .filter((cal) => cal.connectionId === c.id)
              .map((cal) => (
                <li key={cal.id}>
                  <span className="cal-dot" style={{ background: cal.color }} aria-hidden="true" />
                  <span style={{ flex: 1 }}>
                    {cal.name}
                    {cal.primary && <span className="small muted"> · main</span>}
                  </span>
                  <label className="toggle">
                    <input type="checkbox" checked={cal.busy} onChange={(e) => void hostStore().setCalendarBusy(cal.id, e.target.checked)} />
                    <span>Counts as busy</span>
                  </label>
                </li>
              ))}
          </ul>
        </section>
      ))}
      <form
        className="ws-card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await hostStore().connectGoogle(email.trim());
            setEmail('');
            toast('Connected.');
          } catch (err) {
            toast(errText(err), 'error');
          }
        }}
      >
        <h2 style={{ fontSize: 'var(--step-1)' }}>Connect another calendar</h2>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input className="input" style={{ flex: 1, minWidth: 220 }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" aria-label="Google account email" />
          <button type="submit" className="btn btn-primary">
            <span aria-hidden="true">G</span> Connect Google
          </button>
        </div>
        <p className="small muted">
          Microsoft 365 and Outlook: coming soon. In the demo, connecting adds a pretend calendar with some busy times.
        </p>
      </form>
    </div>
  );
}

/* ── My week: every calendar merged into one busy band ──────────────────────────────── */

function clip(blocks: Interval[], dayStart: Instant, dayEnd: Instant): Interval[] {
  return blocks.filter((b) => b.end > dayStart && b.start < dayEnd).map((b) => ({ start: Math.max(b.start, dayStart), end: Math.min(b.end, dayEnd) }));
}

function MyWeek() {
  const now = useNow();
  const clock = useMemo(() => detectClock(preferredLocale()), []);
  const locale = useMemo(preferredLocale, []);
  const { data: me } = useHostQuery((s) => s.me());
  const zone = me?.zone ?? 'UTC';
  const today = wallTime(now, zone).date;
  const { data: busy } = useHostQuery((s) => s.myBusyByCalendar(today, 7), [today]);
  const { data: cals } = useHostQuery((s) => s.calendars());
  const [day, setDay] = useState<IsoDate>(today);
  if (!me || !busy || !cals) return <Spinner />;
  const dayStart = toInstant(day, 0, zone);
  const dayEnd = toInstant(day, 1440, zone);
  const span = dayEnd - dayStart;
  const pos = (i: Interval) => ({ left: `${((i.start - dayStart) / span) * 100}%`, width: `${((i.end - i.start) / span) * 100}%` });
  const byCal = new Map(busy.map((b) => [b.calendarId, b.blocks]));
  const counted = cals.calendars.filter((c) => c.busy);
  const merged = mergeIntervals(counted.flatMap((c) => clip(byCal.get(c.id) ?? [], dayStart, dayEnd)));
  const total = merged.reduce((n, i) => n + (i.end - i.start), 0) / MINUTE;
  const lane = (cal: ConnectedCalendar) => (
    <div key={cal.id} className="week-lane" data-off={!cal.busy || undefined}>
      <span className="week-label">
        <span className="cal-dot" style={{ background: cal.color }} aria-hidden="true" /> {cal.name}
        {!cal.busy && <span className="small muted"> · not counted</span>}
      </span>
      <span className="week-track">
        {clip(byCal.get(cal.id) ?? [], dayStart, dayEnd).map((i) => (
          <i key={i.start} style={{ ...pos(i), background: cal.color }} title={`Busy ${formatSpan(i.start, i.end, zone, clock)}`} />
        ))}
      </span>
    </div>
  );
  return (
    <div className="stack" style={{ ['--gap' as string]: '16px' }}>
      <div className="day-chips" role="group" aria-label="Pick a day">
        {Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d) => {
          const p = dateParts(d, locale);
          return (
            <button key={d} type="button" className="day-chip" aria-pressed={d === day} onClick={() => setDay(d)}>
              <span className="wd">{p.weekday}</span>
              <span className="dd">
                {p.month} {p.day}
              </span>
            </button>
          );
        })}
      </div>
      <section className="ws-card week" aria-label={`Busy times on ${formatDate(day, locale)}`}>
        <p className="small muted" style={{ fontWeight: 700 }}>
          {formatDate(day, locale)} · {cityOf(zone)} time ({formatOffset(wallTime(dayStart, zone).offset)})
        </p>
        <div className="week-axis" aria-hidden="true">
          {[6, 12, 18].map((h) => (
            <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
              {h === 12 ? 'noon' : formatMinute(h * 60, clock).replace(':00', '')}
            </span>
          ))}
        </div>
        {cals.connections.map((c) => (
          <div key={c.id} className="stack" style={{ ['--gap' as string]: '6px' }}>
            <span className="small muted mono">{c.email}</span>
            {cals.calendars.filter((cal) => cal.connectionId === c.id).map(lane)}
          </div>
        ))}
        <div className="week-lane week-all">
          <span className="week-label">
            <strong>All calendars</strong>
          </span>
          <span className="week-track sunband-track">
            {merged.map((i) => (
              <i key={i.start} style={pos(i)} title={`Busy ${formatSpan(i.start, i.end, zone, clock)}`} />
            ))}
          </span>
        </div>
        <p className="small" style={{ fontWeight: 700 }}>
          {total === 0 ? 'Nothing booked: wide open.' : `${formatDuration(Math.round(total))} busy across ${counted.length} calendars.`} Busy times are hidden from your booking links.
        </p>
      </section>
    </div>
  );
}

/* ── Link editor ─────────────────────────────────────────────────────────────────────── */

function LinkEditor({ editId, workspaceId, productId }: { editId?: string; workspaceId?: string | null; productId?: string | null }) {
  const toast = useToast();
  const now = useNow();
  const clock = useMemo(() => detectClock(preferredLocale()), []);
  const { data: ws } = useHostQuery((s) => s.workspaces());
  const { data: cals } = useHostQuery((s) => s.calendars());
  const { data: me } = useHostQuery((s) => s.me());
  const existing = ws?.flatMap((w) => w.types).find((t) => t.id === editId);
  const wsId = existing?.workspaceId ?? workspaceId ?? ws?.[0]?.workspace.id;
  const view = ws?.find((w) => w.workspace.id === wsId);
  const product = view?.products.find((p) => p.id === (existing?.productId ?? productId));
  const [draft, setDraft] = useState<NewEventType | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!ws || !cals || !me || !view) return <Spinner />;
  const writable = cals.calendars.filter((c) => c.writable);
  const base: NewEventType = existing ?? {
    workspaceId: view.workspace.id,
    productId: product?.id ?? null,
    slug: '',
    title: '',
    description: '',
    durationMin: 30,
    bufferMin: 10,
    minNoticeMin: 12 * 60,
    dailyLimit: null,
    zone: me.zone,
    hours: WORKDAYS(9 * 60, 17 * 60),
    writeCalendarId: writable.find((c) => c.primary)?.id ?? writable[0]?.id ?? null,
    location: 'google_meet',
    active: true,
  };
  const d = draft ?? base;
  const set = (patch: Partial<NewEventType>) => setDraft({ ...d, ...patch });
  const path = product ? `/${view.workspace.slug}/${product.slug}/${d.slug || 'your-link'}` : `/${me.handle}/${d.slug || 'your-link'}`;

  return (
    <form
      className="ws-card stack editor"
      style={{ ['--gap' as string]: '18px', ['--brand' as string]: product?.color }}
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await hostStore().saveEventType({ ...d, id: existing?.id, slug: d.slug || slugify(d.title) });
          toast('Saved.');
          navigate('/app');
        } catch (err) {
          setError(errText(err));
        }
      }}
    >
      <p className="eyebrow">
        {existing ? 'Edit link' : 'New link'} · {product ? `${view.workspace.name} · ${product.emoji} ${product.name}` : 'Personal'}
      </p>
      <label className="field">
        <span className="field-label">Name</span>
        <input className="input" value={d.title} onChange={(e) => set({ title: e.target.value, slug: existing || draft?.slug ? d.slug : slugify(e.target.value) })} placeholder="Intro chat" autoFocus />
        <span className="field-hint mono">{displayUrl(path)}</span>
      </label>
      <label className="field">
        <span className="small" style={{ fontWeight: 700 }}>
          What’s it for? (shown on the page)
        </span>
        <input className="input" value={d.description} onChange={(e) => set({ description: e.target.value })} placeholder="A quick hello. Bring a question!" />
      </label>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label">How long?</legend>
        <div className="row-wrap" role="radiogroup" aria-label="Length" style={{ marginTop: 8 }}>
          {[15, 30, 45, 60, 90].map((m) => (
            <button key={m} type="button" role="radio" aria-checked={d.durationMin === m} className="chip" onClick={() => set({ durationMin: m })}>
              {formatDuration(m)}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label">When can people book?</legend>
        <p className="field-hint">Your working hours, in {cityOf(d.zone)} time. Visitors see them in their own time.</p>
        <ul className="hours">
          {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
            const ranges = d.hours[wd] ?? [];
            const on = ranges.length > 0;
            const r = ranges[0] ?? { start: 9 * 60, end: 17 * 60 };
            return (
              <li key={wd}>
                <label className="toggle">
                  <input type="checkbox" checked={on} onChange={(e) => set({ hours: { ...d.hours, [wd]: e.target.checked ? [r] : [] } })} />
                  <span style={{ width: 36, fontWeight: 800 }}>{DAY_NAMES[wd]}</span>
                </label>
                {on ? (
                  <span className="row" style={{ ['--gap' as string]: '6px' }}>
                    <TimeSelect value={r.start} onChange={(m) => set({ hours: { ...d.hours, [wd]: [{ ...r, start: m }, ...ranges.slice(1)] } })} label={`${DAY_NAMES[wd]} from`} clock={clock} />
                    <span className="muted">to</span>
                    <TimeSelect value={r.end} onChange={(m) => set({ hours: { ...d.hours, [wd]: [{ ...r, end: m }, ...ranges.slice(1)] } })} label={`${DAY_NAMES[wd]} until`} clock={clock} allowEndOfDay />
                    {ranges.length > 1 && <span className="small muted">+{ranges.length - 1} more</span>}
                  </span>
                ) : (
                  <span className="small muted">Unavailable</span>
                )}
              </li>
            );
          })}
        </ul>
        <ZoneLine zone={d.zone} now={now} onChange={(z) => set({ zone: z })} prefix="Hours are in" />
      </fieldset>
      <div className="grid-2">
        <label className="field">
          <span className="small" style={{ fontWeight: 700 }}>
            Gap before and after other events
          </span>
          <select className="select" value={d.bufferMin} onChange={(e) => set({ bufferMin: Number(e.target.value) })}>
            {[0, 5, 10, 15, 30].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? 'No gap' : `${m} minutes`}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="small" style={{ fontWeight: 700 }}>
            Minimum notice
          </span>
          <select className="select" value={d.minNoticeMin} onChange={(e) => set({ minNoticeMin: Number(e.target.value) })}>
            {[[0, 'None'], [60, '1 hour'], [240, '4 hours'], [720, '12 hours'], [1440, '1 day'], [2880, '2 days']].map(([m, l]) => (
              <option key={m} value={m}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="small" style={{ fontWeight: 700 }}>
            Most bookings a day
          </span>
          <select className="select" value={d.dailyLimit ?? 0} onChange={(e) => set({ dailyLimit: Number(e.target.value) || null })}>
            {[0, 1, 2, 3, 4, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'No limit' : n}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="small" style={{ fontWeight: 700 }}>
            Put new bookings on
          </span>
          <select className="select" value={d.writeCalendarId ?? ''} onChange={(e) => set({ writeCalendarId: e.target.value || null })}>
            {writable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({cals.connections.find((x) => x.id === c.connectionId)?.email})
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="callout" data-tone="info">
        <span aria-hidden="true">🎥</span>
        <span>Every booking gets a Google Meet link, created when the event goes on your calendar. (Demo: no real link is made.)</span>
      </p>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-primary">
          {existing ? 'Save changes' : 'Create link'}
        </button>
        <Link to="/app" className="btn btn-ghost">
          Cancel
        </Link>
        {existing && (
          <button
            type="button"
            className="btn btn-ghost btn-danger"
            onClick={async () => {
              await hostStore().deleteEventType(existing.id);
              navigate('/app');
            }}
          >
            Turn off this link
          </button>
        )}
      </div>
      {existing && <CopyField value={pageUrl(path)} label="Link" display={displayUrl(path)} />}
    </form>
  );
}

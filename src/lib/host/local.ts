/**
 * Local demo adapter for hosts and booking links. Behaves like the planned backend: the same
 * validation, ownership checks and atomic booking, with Google Calendar and email mocked.
 * Nothing leaves the browser.
 */
import { addDays, isValidZone, wallTime, type Instant, type IsoDate, type Zone } from '../time/zone';
import { bookableSlots, isBookable, mergeIntervals, WORKDAYS, type Interval, type SlotRules } from '../booking/slots';
import { formatDate, formatMinute } from '../time/format';
import { hashSecret, newToken, newUuid } from '../data/ids';
import type { KeyValue } from '../data/local';
import { mockBusy, type MockKind } from './mockCalendar';
import { HostError, type Guest, type HostStore } from './store';
import type {
  Account,
  Booking,
  CalendarConnection,
  ConnectedCalendar,
  EventType,
  Member,
  NewEventType,
  OutboxEmail,
  Product,
  PublicTarget,
  PublicType,
  Role,
  Workspace,
  WorkspaceView,
} from './types';

interface StoredWorkspace extends Workspace {
  ownerId: string;
}
interface StoredCalendar extends ConnectedCalendar {
  kind: MockKind;
  seed: string;
}
interface StoredBooking extends Booking {
  tokenHash: string;
}
interface Db {
  v: 1;
  accounts: Record<string, Account>;
  workspaces: Record<string, StoredWorkspace>;
  members: Member[];
  products: Record<string, Product>;
  connections: Record<string, CalendarConnection>;
  calendars: Record<string, StoredCalendar>;
  types: Record<string, EventType>;
  bookings: Record<string, StoredBooking>;
  outbox: OutboxEmail[];
}

const DB_KEY = 'sunroll:host-db:v1';
const SESSION_KEY = 'sunroll:host-session';
export const RESERVED = new Set(['new', 'e', 't', 'app', 'demo', 'privacy', 'booking', 'book', 'api', 'admin', 'settings', 'login', 'signin', 'help', 'about', 'pricing']);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const empty = (): Db => ({ v: 1, accounts: {}, workspaces: {}, members: [], products: {}, connections: {}, calendars: {}, types: {}, bookings: {}, outbox: [] });

function browserStorage(): KeyValue {
  const memory = new Map<string, string>();
  return {
    get: (k) => {
      try {
        return window.localStorage.getItem(k);
      } catch {
        return memory.get(k) ?? null;
      }
    },
    set: (k, v) => {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        memory.set(k, v);
      }
    },
  };
}

export interface HostLocalOptions {
  storage?: KeyValue;
  now?: () => Instant;
  channel?: string;
}

export function createLocalHostStore(options: HostLocalOptions = {}): HostStore {
  const storage = options.storage ?? browserStorage();
  const now = options.now ?? (() => Date.now());
  const listeners = new Set<() => void>();
  const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(options.channel ?? 'sunroll-host') : null;
  if (bc && 'unref' in bc) (bc as unknown as { unref(): void }).unref();
  bc?.addEventListener('message', () => listeners.forEach((l) => l()));

  const read = (): Db => {
    try {
      const raw = storage.get(DB_KEY);
      const db = raw ? (JSON.parse(raw) as Db) : empty();
      return db.v === 1 ? db : empty();
    } catch {
      return empty();
    }
  };
  /** Read, change, write with no await in between, so concurrent bookings can't both win. */
  const mutate = <T,>(fn: (db: Db) => T): T => {
    const db = read();
    const result = fn(db);
    storage.set(DB_KEY, JSON.stringify(db));
    listeners.forEach((l) => l());
    bc?.postMessage('changed');
    return result;
  };
  const session = () => storage.get(SESSION_KEY) || null;
  const requireMe = (db: Db): Account => {
    const id = session();
    const a = id ? db.accounts[id] : undefined;
    if (!a) throw new HostError('signed_out', 'please sign in');
    return a;
  };
  const roleIn = (db: Db, workspaceId: string, accountId: string): Role | null => db.members.find((m) => m.workspaceId === workspaceId && m.accountId === accountId)?.role ?? null;
  const requireRole = (db: Db, workspaceId: string, accountId: string, allowed: Role[]) => {
    const r = roleIn(db, workspaceId, accountId);
    if (!r) throw new HostError('forbidden', 'you’re not part of that workspace');
    if (!allowed.includes(r)) throw new HostError('forbidden', 'you need to be an owner or admin for that');
  };
  const slugTaken = (db: Db, slug: string) => RESERVED.has(slug) || Object.values(db.accounts).some((a) => a.handle === slug) || Object.values(db.workspaces).some((w) => w.kind === 'company' && w.slug === slug);

  /* ── Calendars: mocked free/busy plus the events Sunroll wrote ─────────────────────── */
  function busyFor(db: Db, accountId: string, from: IsoDate, days: number, zone: Zone, onlyCalendar?: string): Interval[] {
    const conns = new Set(Object.values(db.connections).filter((c) => c.accountId === accountId).map((c) => c.id));
    const out: Interval[] = [];
    for (const cal of Object.values(db.calendars)) {
      if (!conns.has(cal.connectionId)) continue;
      if (onlyCalendar ? cal.id !== onlyCalendar : !cal.busy) continue;
      out.push(...mockBusy(cal.kind, cal.seed, zone, from, days));
      for (const b of Object.values(db.bookings)) if (b.status === 'confirmed' && b.calendarId === cal.id) out.push({ start: b.start, end: b.end });
    }
    return out;
  }

  function hostBusy(db: Db, t: EventType, from: IsoDate, days: number): Interval[] {
    const owner = db.accounts[t.ownerId];
    const busy = busyFor(db, t.ownerId, addDays(from, -1), days + 2, owner?.zone ?? t.zone);
    // Every confirmed booking with this host is busy, whichever calendar it went to.
    for (const b of Object.values(db.bookings)) if (b.status === 'confirmed' && b.hostId === t.ownerId) busy.push({ start: b.start, end: b.end });
    return busy;
  }

  function rulesOf(t: EventType): SlotRules {
    return { zone: t.zone, hours: t.hours, durationMin: t.durationMin, bufferMin: t.bufferMin, minNoticeMin: t.minNoticeMin, dailyLimit: t.dailyLimit, stepMin: t.durationMin <= 30 ? 15 : 30 };
  }

  function publicType(db: Db, t: EventType): PublicType {
    const owner = db.accounts[t.ownerId];
    const ws = db.workspaces[t.workspaceId];
    const product = t.productId ? db.products[t.productId] : null;
    const brand = product ? { name: product.name, emoji: product.emoji, color: product.color } : { name: owner.name, emoji: owner.emoji, color: '#2f4bff' };
    const path = product ? `/${ws.slug}/${product.slug}/${t.slug}` : `/${owner.handle}/${t.slug}`;
    return { id: t.id, title: t.title, description: t.description, durationMin: t.durationMin, path, host: { name: owner.name, emoji: owner.emoji, zone: t.zone }, brand };
  }

  function email(db: Db, b: Booking, to: string, subject: string, body: string) {
    db.outbox.unshift({ id: newUuid(), to, subject, body, at: now(), bookingId: b.id });
    db.outbox = db.outbox.slice(0, 50);
  }

  function describe(t: Instant, zone: Zone): string {
    const w = wallTime(t, zone);
    return `${formatDate(w.date)} at ${formatMinute(w.minute)}`;
  }

  /* ── Demo data ─────────────────────────────────────────────────────────────────────── */
  function seed(db: Db): Account {
    const existing = Object.values(db.accounts).find((a) => a.handle === 'nadia');
    if (existing) return existing;
    const zone = 'America/Vancouver';
    const nadia: Account = { id: newUuid(), name: 'Nadia', email: 'nadia@example.com', handle: 'nadia', emoji: '🌻', zone };
    const luke: Account = { id: newUuid(), name: 'Luke', email: 'luke@acme.example', handle: 'luke', emoji: '🦉', zone: 'America/Toronto' };
    db.accounts[nadia.id] = nadia;
    db.accounts[luke.id] = luke;

    const personal: StoredWorkspace = { id: newUuid(), kind: 'personal', name: 'Personal', slug: 'nadia', emoji: '🌻', color: '#2f4bff', ownerId: nadia.id };
    const acme: StoredWorkspace = { id: newUuid(), kind: 'company', name: 'Acme', slug: 'acme', emoji: '🅰️', color: '#15132b', ownerId: nadia.id };
    db.workspaces[personal.id] = personal;
    db.workspaces[acme.id] = acme;
    db.members.push(
      { workspaceId: personal.id, accountId: nadia.id, name: nadia.name, email: nadia.email, role: 'owner' },
      { workspaceId: acme.id, accountId: nadia.id, name: nadia.name, email: 'nadia@acme.example', role: 'owner' },
      { workspaceId: acme.id, accountId: luke.id, name: luke.name, email: luke.email, role: 'admin' },
    );
    const analytics: Product = { id: newUuid(), workspaceId: acme.id, name: 'Acme Analytics', slug: 'analytics', emoji: '📊', color: '#2f4bff' };
    const mobile: Product = { id: newUuid(), workspaceId: acme.id, name: 'Acme Mobile', slug: 'mobile', emoji: '📱', color: '#e8366d' };
    db.products[analytics.id] = analytics;
    db.products[mobile.id] = mobile;

    const gmail: CalendarConnection = { id: newUuid(), accountId: nadia.id, provider: 'google', email: 'nadia@gmail.com', demo: true };
    const work: CalendarConnection = { id: newUuid(), accountId: nadia.id, provider: 'google', email: 'nadia@acme.example', demo: true };
    db.connections[gmail.id] = gmail;
    db.connections[work.id] = work;
    const cal = (c: CalendarConnection, name: string, kind: MockKind, color: string, busy: boolean, primary: boolean): StoredCalendar => ({ id: newUuid(), connectionId: c.id, name, kind, seed: `${c.email}/${name}`, color, busy, writable: kind !== 'holidays', primary });
    const cPersonal = cal(gmail, 'Personal', 'personal', '#0f9d6e', true, true);
    const cFamily = cal(gmail, 'Family', 'family', '#e8680c', true, false);
    const cHolidays = cal(gmail, 'Holidays in Canada', 'holidays', '#9b7bff', false, false);
    const cWork = cal(work, 'Work', 'work', '#2f4bff', true, true);
    const cTeam = cal(work, 'Team events', 'team', '#c026d3', true, false);
    for (const c of [cPersonal, cFamily, cHolidays, cWork, cTeam]) db.calendars[c.id] = c;

    const type = (ws: StoredWorkspace, product: Product | null, slug: string, title: string, description: string, durationMin: number, writeCalendarId: string, hours = WORKDAYS(9 * 60, 17 * 60), extra: Partial<EventType> = {}): EventType => ({
      id: newUuid(),
      ownerId: nadia.id,
      workspaceId: ws.id,
      productId: product?.id ?? null,
      slug,
      title,
      description,
      durationMin,
      bufferMin: 10,
      minNoticeMin: 12 * 60,
      dailyLimit: null,
      zone,
      hours,
      writeCalendarId,
      location: 'google_meet',
      active: true,
      ...extra,
    });
    const intro = type(personal, null, 'intro', 'Intro chat', 'A quick hello. Bring a question!', 30, cPersonal.id, { 1: [{ start: 540, end: 720 }], 2: [{ start: 540, end: 720 }, { start: 1020, end: 1140 }], 3: [{ start: 540, end: 720 }], 4: [{ start: 1020, end: 1140 }], 5: [{ start: 540, end: 660 }], 6: [], 7: [] });
    const coffee = type(personal, null, 'coffee', 'Virtual coffee', 'Catch up over a coffee, wherever you are.', 45, cPersonal.id, WORKDAYS(8 * 60, 18 * 60), { dailyLimit: 2 });
    const demo = type(acme, analytics, 'demo', 'Product demo', 'See Acme Analytics on your own data, with time for questions.', 30, cWork.id, WORKDAYS(7 * 60, 16 * 60), { bufferMin: 15 });
    const onboarding = type(acme, mobile, 'onboarding', 'Onboarding call', 'Get your team set up on Acme Mobile in one call.', 45, cWork.id, WORKDAYS(8 * 60, 15 * 60), { dailyLimit: 3 });
    for (const t of [intro, coffee, demo, onboarding]) db.types[t.id] = t;

    // Two people have already booked.
    const today = wallTime(now(), zone).date;
    const seedBooking = (t: EventType, guest: { name: string; email: string; zone: Zone }) => {
      const slots = bookableSlots(rulesOf(t), { from: addDays(today, 2), days: 5, now: now(), busy: hostBusy(db, t, addDays(today, 2), 5), bookings: [] });
      const start = slots[Math.min(3, slots.length - 1)];
      if (start === undefined) return;
      const b: StoredBooking = { id: newUuid(), eventTypeId: t.id, hostId: nadia.id, start, end: start + t.durationMin * 60_000, guestName: guest.name, guestEmail: guest.email, guestZone: guest.zone, note: '', status: 'confirmed', calendarId: t.writeCalendarId, meetUrl: null, createdAt: now(), sequence: 0, tokenHash: 'seeded' };
      db.bookings[b.id] = b;
    };
    seedBooking(demo, { name: 'Priya', email: 'priya@example.com', zone: 'Europe/Berlin' });
    seedBooking(onboarding, { name: 'Kenji', email: 'kenji@example.com', zone: 'Asia/Tokyo' });
    return nadia;
  }

  /* ── The store ─────────────────────────────────────────────────────────────────────── */
  const store: HostStore = {
    demo: true,

    async me() {
      const id = session();
      return id ? read().accounts[id] ?? null : null;
    },

    async signIn() {
      const a = mutate((db) => seed(db));
      storage.set(SESSION_KEY, a.id);
      listeners.forEach((l) => l());
      return a;
    },

    async signOut() {
      storage.set(SESSION_KEY, '');
      listeners.forEach((l) => l());
    },

    async workspaces(): Promise<WorkspaceView[]> {
      const db = read();
      const me = requireMe(db);
      return db.members
        .filter((m) => m.accountId === me.id)
        .map((m) => db.workspaces[m.workspaceId])
        .filter(Boolean)
        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'personal' ? -1 : 1))
        .map((w) => ({
          workspace: (({ ownerId: _o, ...rest }) => rest)(w),
          role: roleIn(db, w.id, me.id)!,
          members: db.members.filter((m) => m.workspaceId === w.id),
          products: Object.values(db.products).filter((p) => p.workspaceId === w.id),
          types: Object.values(db.types).filter((t) => t.workspaceId === w.id),
        }));
    },

    async createCompany(name, slug, emoji) {
      return mutate((db) => {
        const me = requireMe(db);
        const n = name.trim();
        if (n.length < 1 || n.length > 60) throw new HostError('invalid', 'give the company a name');
        if (!SLUG.test(slug)) throw new HostError('invalid', 'use lowercase letters, numbers and dashes for the link');
        if (slugTaken(db, slug)) throw new HostError('taken', 'that link is taken');
        const w: StoredWorkspace = { id: newUuid(), kind: 'company', name: n, slug, emoji: emoji || '🏢', color: '#15132b', ownerId: me.id };
        db.workspaces[w.id] = w;
        db.members.push({ workspaceId: w.id, accountId: me.id, name: me.name, email: me.email, role: 'owner' });
        return w;
      });
    },

    async createProduct(workspaceId, p) {
      return mutate((db) => {
        const me = requireMe(db);
        requireRole(db, workspaceId, me.id, ['owner', 'admin']);
        if (db.workspaces[workspaceId]?.kind !== 'company') throw new HostError('invalid', 'products belong to company workspaces');
        if (!p.name.trim()) throw new HostError('invalid', 'give the product a name');
        if (!SLUG.test(p.slug) || RESERVED.has(p.slug)) throw new HostError('invalid', 'use lowercase letters, numbers and dashes for the link');
        if (Object.values(db.products).some((x) => x.workspaceId === workspaceId && x.slug === p.slug)) throw new HostError('taken', 'that link is taken');
        const product: Product = { id: newUuid(), workspaceId, name: p.name.trim(), slug: p.slug, emoji: p.emoji || '✨', color: p.color };
        db.products[product.id] = product;
        return product;
      });
    },

    async inviteMember(workspaceId, emailAddress, role) {
      mutate((db) => {
        const me = requireMe(db);
        requireRole(db, workspaceId, me.id, ['owner', 'admin']);
        if (!EMAIL.test(emailAddress)) throw new HostError('invalid', 'that email doesn’t look right');
        if (role === 'owner') throw new HostError('invalid', 'invite as admin or member');
        // Demo: the invite is recorded as a pending member.
        db.members.push({ workspaceId, accountId: `pending:${emailAddress}`, name: emailAddress.split('@')[0], email: emailAddress, role });
      });
    },

    async calendars() {
      const db = read();
      const me = requireMe(db);
      const connections = Object.values(db.connections).filter((c) => c.accountId === me.id);
      const ids = new Set(connections.map((c) => c.id));
      const calendars = Object.values(db.calendars)
        .filter((c) => ids.has(c.connectionId))
        .map(({ kind: _k, seed: _s, ...rest }) => rest);
      return { connections, calendars };
    },

    async connectGoogle(emailAddress) {
      return mutate((db) => {
        const me = requireMe(db);
        if (!EMAIL.test(emailAddress)) throw new HostError('invalid', 'that email doesn’t look right');
        if (Object.values(db.connections).some((c) => c.accountId === me.id && c.email === emailAddress)) throw new HostError('taken', 'that calendar account is already connected');
        const c: CalendarConnection = { id: newUuid(), accountId: me.id, provider: 'google', email: emailAddress, demo: true };
        db.connections[c.id] = c;
        const main: StoredCalendar = { id: newUuid(), connectionId: c.id, name: emailAddress, kind: 'work', seed: emailAddress, color: '#0b8fb3', busy: true, writable: true, primary: true };
        db.calendars[main.id] = main;
        return c;
      });
    },

    async disconnect(connectionId) {
      mutate((db) => {
        const me = requireMe(db);
        const c = db.connections[connectionId];
        if (!c || c.accountId !== me.id) throw new HostError('not_found', 'no such calendar connection');
        delete db.connections[connectionId];
        for (const cal of Object.values(db.calendars)) if (cal.connectionId === connectionId) delete db.calendars[cal.id];
      });
    },

    async setCalendarBusy(calendarId, busy) {
      mutate((db) => {
        const me = requireMe(db);
        const cal = db.calendars[calendarId];
        if (!cal || db.connections[cal.connectionId]?.accountId !== me.id) throw new HostError('not_found', 'no such calendar');
        cal.busy = busy;
      });
    },

    async myBusyByCalendar(from, days) {
      const db = read();
      const me = requireMe(db);
      const { calendars } = await store.calendars();
      return calendars.map((c) => ({ calendarId: c.id, blocks: mergeIntervals(busyFor(db, me.id, from, days, me.zone, c.id)) }));
    },

    async saveEventType(input) {
      return mutate((db) => {
        const me = requireMe(db);
        requireRole(db, input.workspaceId, me.id, ['owner', 'admin', 'member']);
        if (!input.title.trim()) throw new HostError('invalid', 'give it a name');
        if (!SLUG.test(input.slug)) throw new HostError('invalid', 'use lowercase letters, numbers and dashes for the link');
        if (!isValidZone(input.zone)) throw new HostError('invalid', 'unknown time zone');
        if (input.durationMin < 15 || input.durationMin > 480) throw new HostError('invalid', 'pick a length between 15 minutes and 8 hours');
        const clash = Object.values(db.types).find((t) => t.id !== input.id && t.workspaceId === input.workspaceId && t.productId === input.productId && t.slug === input.slug);
        if (clash) throw new HostError('taken', 'another link already uses that name');
        if (input.writeCalendarId && !db.calendars[input.writeCalendarId]) throw new HostError('invalid', 'pick a calendar to write to');
        const existing = input.id ? db.types[input.id] : undefined;
        if (existing && existing.ownerId !== me.id) throw new HostError('forbidden', 'only the link’s owner can edit it');
        const t: EventType = { ...input, id: input.id ?? newUuid(), ownerId: existing?.ownerId ?? me.id, title: input.title.trim() };
        db.types[t.id] = t;
        return t;
      });
    },

    async deleteEventType(id) {
      mutate((db) => {
        const me = requireMe(db);
        const t = db.types[id];
        if (!t || t.ownerId !== me.id) throw new HostError('not_found', 'no such link');
        t.active = false;
      });
    },

    async myBookings() {
      const db = read();
      const me = requireMe(db);
      return Object.values(db.bookings)
        .filter((b) => b.hostId === me.id)
        .sort((a, b) => a.start - b.start)
        .map(({ tokenHash: _t, ...b }) => ({ ...b, typeTitle: db.types[b.eventTypeId]?.title ?? 'Meeting' }));
    },

    async outbox() {
      return read().outbox;
    },

    async resolve(segments) {
      const db = read();
      const seg = segments.map((s) => s.toLowerCase());
      if (seg.length === 0 || RESERVED.has(seg[0])) return null;
      const account = Object.values(db.accounts).find((a) => a.handle === seg[0]);
      const company = Object.values(db.workspaces).find((w) => w.kind === 'company' && w.slug === seg[0]);
      const active = (t: EventType) => t.active;
      if (account) {
        const personal = Object.values(db.workspaces).find((w) => w.kind === 'personal' && w.ownerId === account.id)!;
        const types = Object.values(db.types).filter((t) => t.workspaceId === personal.id && active(t));
        if (seg.length === 1)
          return { kind: 'host', title: account.name, subtitle: 'Pick a time that works for you.', emoji: account.emoji, color: '#2f4bff', path: `/${account.handle}`, types: types.map((t) => publicType(db, t)) } satisfies PublicTarget;
        if (seg.length === 2) {
          const t = types.find((x) => x.slug === seg[1]);
          return t ? { kind: 'type', type: publicType(db, t) } : null;
        }
        return null;
      }
      if (company) {
        const products = Object.values(db.products).filter((p) => p.workspaceId === company.id);
        if (seg.length === 1)
          return {
            kind: 'company',
            workspace: (({ ownerId: _o, ...rest }) => rest)(company),
            products: products.map((p) => ({ ...p, path: `/${company.slug}/${p.slug}`, types: Object.values(db.types).filter((t) => t.productId === p.id && active(t)).length })),
          } satisfies PublicTarget;
        const product = products.find((p) => p.slug === seg[1]);
        if (!product) return null;
        const types = Object.values(db.types).filter((t) => t.productId === product.id && active(t));
        if (seg.length === 2) return { kind: 'host', title: product.name, subtitle: `by ${company.name}`, emoji: product.emoji, color: product.color, path: `/${company.slug}/${product.slug}`, types: types.map((t) => publicType(db, t)) } satisfies PublicTarget;
        if (seg.length === 3) {
          const t = types.find((x) => x.slug === seg[2]);
          return t ? { kind: 'type', type: publicType(db, t) } : null;
        }
      }
      return null;
    },

    async publicSlots(typeId, at, days) {
      const db = read();
      const t = db.types[typeId];
      if (!t || !t.active) throw new HostError('not_found', 'this link isn’t available');
      const from = wallTime(at, t.zone).date;
      const mine = Object.values(db.bookings).filter((b) => b.status === 'confirmed' && b.eventTypeId === t.id);
      const slots = bookableSlots(rulesOf(t), { from, days, now: at, busy: hostBusy(db, t, from, days), bookings: mine });
      return { type: publicType(db, t), slots };
    },

    async book(typeId, start, guest: Guest) {
      const name = guest.name.trim();
      const mail = guest.email.trim().toLowerCase();
      if (!name || name.length > 60) throw new HostError('invalid', 'what’s your name?');
      if (!EMAIL.test(mail)) throw new HostError('invalid', 'that email doesn’t look right');
      if (!isValidZone(guest.zone)) throw new HostError('invalid', 'unknown time zone');
      const manageToken = newToken();
      const tokenHash = await hashSecret(manageToken);
      // Everything below runs without awaiting, so two bookings can't interleave.
      const booking = mutate((db) => {
        const t = db.types[typeId];
        if (!t || !t.active) throw new HostError('not_found', 'this link isn’t available');
        const from = wallTime(start, t.zone).date;
        const mine = Object.values(db.bookings).filter((b) => b.status === 'confirmed' && b.eventTypeId === t.id);
        if (!isBookable(rulesOf(t), start, { now: now(), busy: hostBusy(db, t, from, 1), bookings: mine })) throw new HostError('taken', 'someone just took that time');
        const b: StoredBooking = {
          id: newUuid(),
          eventTypeId: t.id,
          hostId: t.ownerId,
          start,
          end: start + t.durationMin * 60_000,
          guestName: name,
          guestEmail: mail,
          guestZone: guest.zone,
          note: (guest.note ?? '').slice(0, 500),
          status: 'confirmed',
          calendarId: t.writeCalendarId,
          meetUrl: null,
          createdAt: now(),
          sequence: 0,
          tokenHash,
        };
        db.bookings[b.id] = b;
        const host = db.accounts[t.ownerId];
        email(db, b, mail, `Confirmed: ${t.title} with ${host.name}`, `Hi ${name},\n\nYou're booked: ${t.title} with ${host.name}, ${describe(start, guest.zone)} your time (${describe(start, t.zone)} for ${host.name}).\n\nA Google Meet link is in the calendar invite.\n\nNeed to change it? Use your manage link: /booking/${b.id}#t=…`);
        email(db, b, host.email, `New booking: ${t.title} with ${name}`, `${name} booked ${t.title} for ${describe(start, t.zone)} your time (${describe(start, guest.zone)} for them).`);
        const { tokenHash: _h, ...pub } = b;
        return pub;
      });
      return { booking, manageToken };
    },

    async getBooking(id, token) {
      const hash = await hashSecret(token ?? '');
      const db = read();
      const b = db.bookings[id];
      if (!b || b.tokenHash !== hash) throw new HostError('not_found', 'we couldn’t find that booking');
      const { tokenHash: _h, ...booking } = b;
      return { booking, type: publicType(db, db.types[b.eventTypeId]) };
    },

    async cancel(id, token) {
      const hash = await hashSecret(token ?? '');
      mutate((db) => {
        const b = db.bookings[id];
        if (!b || b.tokenHash !== hash) throw new HostError('not_found', 'we couldn’t find that booking');
        b.status = 'cancelled';
        b.sequence += 1;
        const t = db.types[b.eventTypeId];
        email(db, b, db.accounts[b.hostId].email, `Cancelled: ${t.title} with ${b.guestName}`, `${b.guestName} cancelled ${t.title} on ${describe(b.start, t.zone)}.`);
      });
    },

    async reschedule(id, token, start) {
      const hash = await hashSecret(token ?? '');
      return mutate((db) => {
        const b = db.bookings[id];
        if (!b || b.tokenHash !== hash || b.status !== 'confirmed') throw new HostError('not_found', 'we couldn’t find that booking');
        const t = db.types[b.eventTypeId];
        // Check the new time as if this booking weren't there.
        b.status = 'cancelled';
        const mine = Object.values(db.bookings).filter((x) => x.status === 'confirmed' && x.eventTypeId === t.id);
        const ok = isBookable(rulesOf(t), start, { now: now(), busy: hostBusy(db, t, wallTime(start, t.zone).date, 1), bookings: mine });
        b.status = 'confirmed';
        if (!ok) throw new HostError('taken', 'someone just took that time');
        b.start = start;
        b.end = start + t.durationMin * 60_000;
        b.sequence += 1;
        email(db, b, b.guestEmail, `Updated: ${t.title} with ${db.accounts[b.hostId].name}`, `Your ${t.title} is now ${describe(start, b.guestZone)} your time.`);
        const { tokenHash: _h, ...pub } = b;
        return pub;
      });
    },

    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
  return store;
}

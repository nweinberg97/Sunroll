/**
 * Hosts, workspaces, calendars and booking links ("Book me").
 *
 * Accounts exist only for hosts. Guests who book never need one, and "Find a time" stays
 * account-free. See BACKLOG.md (B1) and DESIGN notes in docs/booking.md.
 */
import type { Instant, Zone } from '../time/zone';
import type { Interval, WeeklyHours } from '../booking/slots';

export type { Interval, WeeklyHours };

export interface Account {
  id: string;
  name: string;
  email: string;
  /** Personal link handle: sunroll.app/<handle>. Shares one namespace with company slugs. */
  handle: string;
  emoji: string;
  zone: Zone;
}

export type Role = 'owner' | 'admin' | 'member';

export interface Workspace {
  id: string;
  kind: 'personal' | 'company';
  name: string;
  /** Company URL slug (sunroll.app/<slug>). Personal workspaces use the owner's handle. */
  slug: string;
  emoji: string;
  color: string;
}

export interface Member {
  workspaceId: string;
  accountId: string;
  name: string;
  email: string;
  role: Role;
}

export interface Product {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  emoji: string;
  /** Brand colour for the product's booking pages. */
  color: string;
}

export type Provider = 'google' | 'microsoft';

export interface CalendarConnection {
  id: string;
  accountId: string;
  provider: Provider;
  /** The calendar account's email, e.g. nadia@acme.com. */
  email: string;
  /** In demo mode no real provider is contacted. */
  demo: boolean;
}

export interface ConnectedCalendar {
  id: string;
  connectionId: string;
  name: string;
  color: string;
  /** Counts toward busy time. */
  busy: boolean;
  /** Bookings can be written to it. */
  writable: boolean;
  primary: boolean;
}

export interface EventType {
  id: string;
  ownerId: string;
  workspaceId: string;
  productId: string | null;
  slug: string;
  title: string;
  description: string;
  durationMin: number;
  bufferMin: number;
  minNoticeMin: number;
  dailyLimit: number | null;
  /** Working hours, wall-clock in `zone`. */
  zone: Zone;
  hours: WeeklyHours;
  /** The calendar new bookings are written to. */
  writeCalendarId: string | null;
  location: 'google_meet';
  active: boolean;
}

export type NewEventType = Omit<EventType, 'id' | 'ownerId'>;

export interface Booking {
  id: string;
  eventTypeId: string;
  hostId: string;
  start: Instant;
  end: Instant;
  guestName: string;
  guestEmail: string;
  guestZone: Zone;
  note: string;
  status: 'confirmed' | 'cancelled';
  /** Where the event was written. */
  calendarId: string | null;
  /** In production, the Google Meet link Google creates. Demo bookings have none. */
  meetUrl: string | null;
  createdAt: Instant;
  /** Bumped on every reschedule, so calendar files update in place. */
  sequence: number;
}

/** Mock outbox: emails that would have been sent. Nothing leaves the device. */
export interface OutboxEmail {
  id: string;
  to: string;
  subject: string;
  body: string;
  at: Instant;
  bookingId: string;
}

/** What a public link resolves to. */
export type PublicTarget =
  | { kind: 'host'; title: string; subtitle: string; emoji: string; color: string; path: string; types: PublicType[] }
  | { kind: 'company'; workspace: Workspace; products: (Product & { path: string; types: number })[] }
  | { kind: 'type'; type: PublicType };

export interface PublicType {
  id: string;
  title: string;
  description: string;
  durationMin: number;
  path: string;
  host: { name: string; emoji: string; zone: Zone };
  brand: { name: string; emoji: string; color: string };
}

export interface WorkspaceView {
  workspace: Workspace;
  role: Role;
  members: Member[];
  products: Product[];
  types: EventType[];
}

/**
 * Everything hosts and bookers do, behind one interface (like DataStore for "Find a time").
 * Today: a local demo adapter with mocked calendars and email. Later: a real backend with
 * OAuth calendar access on the server. Screens never know which one they have.
 */
import type { Instant, IsoDate } from '../time/zone';
import type {
  Account,
  Booking,
  CalendarConnection,
  ConnectedCalendar,
  EventType,
  Interval,
  NewEventType,
  OutboxEmail,
  Product,
  PublicTarget,
  PublicType,
  Role,
  Workspace,
  WorkspaceView,
} from './types';

export class HostError extends Error {
  readonly code: 'invalid' | 'forbidden' | 'not_found' | 'taken' | 'signed_out';
  constructor(code: HostError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'HostError';
  }
}

export interface Guest {
  name: string;
  email: string;
  zone: string;
  note?: string;
}

export interface HostStore {
  readonly demo: boolean;

  /* Session (hosts only) */
  me(): Promise<Account | null>;
  /** Demo: "Sign in with Google" creates or restores a demo host. */
  signIn(): Promise<Account>;
  signOut(): Promise<void>;

  /* Workspaces and products */
  workspaces(): Promise<WorkspaceView[]>;
  createCompany(name: string, slug: string, emoji: string): Promise<Workspace>;
  createProduct(workspaceId: string, p: { name: string; slug: string; emoji: string; color: string }): Promise<Product>;
  inviteMember(workspaceId: string, email: string, role: Role): Promise<void>;

  /* Calendars */
  calendars(): Promise<{ connections: CalendarConnection[]; calendars: ConnectedCalendar[] }>;
  connectGoogle(email: string): Promise<CalendarConnection>;
  disconnect(connectionId: string): Promise<void>;
  setCalendarBusy(calendarId: string, busy: boolean): Promise<void>;
  /** Busy blocks per calendar for my own week view. Never event details. */
  myBusyByCalendar(from: IsoDate, days: number): Promise<{ calendarId: string; blocks: Interval[] }[]>;

  /* Event types */
  saveEventType(t: NewEventType & { id?: string }): Promise<EventType>;
  deleteEventType(id: string): Promise<void>;

  /* Bookings, host side */
  myBookings(): Promise<(Booking & { typeTitle: string })[]>;
  outbox(): Promise<OutboxEmail[]>;

  /* Public: anyone with the link */
  resolve(segments: string[]): Promise<PublicTarget | null>;
  /** Bookable starts for the next `days` days of the host's calendar, from `now`. */
  publicSlots(typeId: string, now: Instant, days: number): Promise<{ type: PublicType; slots: Instant[] }>;
  /** Re-checks availability at the moment of booking; throws 'taken' if the slot just went. */
  book(typeId: string, start: Instant, guest: Guest): Promise<{ booking: Booking; manageToken: string }>;
  getBooking(id: string, token: string): Promise<{ booking: Booking; type: PublicType }>;
  cancel(id: string, token: string): Promise<void>;
  reschedule(id: string, token: string, start: Instant): Promise<Booking>;

  subscribe(onChange: () => void): () => void;
}

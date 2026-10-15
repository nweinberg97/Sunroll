/**
 * The copy deck. Warm, a little witty, never cringe; never shames anyone.
 * Screens import from here so the voice stays consistent.
 */
import { BRAND } from './brand';

export const NAME_PLACEHOLDERS = ['Game night', 'Family call', 'Q4 planning', 'D&D, session 12', 'Book club', 'Study group', 'Standup'];

export const copy = {
  landing: {
    headline: 'Find the time that works everywhere.',
    sub: BRAND.description,
    cta: 'Start an event',
    secondary: 'See how it works',
  },
  create: {
    title: 'What’s the plan?',
    days: 'Which days?',
    window: 'Between what times?',
    length: 'How long?',
    you: 'And you are…',
    group: 'How many of you?',
    groupHint: 'Optional. Helps us tell you when everyone’s in.',
    zone: (city: string) => `Times are in ${city} time. Everyone else sees their own.`,
    submit: 'Create event',
    submitting: 'Creating…',
  },
  share: {
    heading: 'It’s live.',
    sub: 'Send the link to your group chat. No accounts, no app to download.',
    organizer: 'Your organizer link',
    organizerHint: 'Keep this one. It’s how you lock the time.',
    addMine: 'Add my times',
    copied: 'Copied',
  },
  guest: {
    invited: (host: string) => `${host} invited you to`,
    cta: 'Add your times',
    look: 'Just look at the overlap',
    zone: (city: string) => `Looks like you’re in ${city}. Times are shown in your time.`,
    notYou: (name: string) => `Not ${name}?`,
  },
  paint: {
    hint: 'Drag to paint. Tap to toggle.',
    hintKeyboard: 'Arrow keys to move, Space to mark.',
    free: 'Free',
    ifNeeded: 'If needed',
    none: 'None of these work for me',
    done: 'Done — see the overlap',
    saving: 'Saving…',
    saved: 'Saved',
    failed: 'Couldn’t save. Trying again…',
    offline: 'You’re offline. We’ll save when you’re back.',
  },
  overlap: {
    empty: 'Nobody’s added times yet. You could be first.',
    justYou: 'Just you so far. The glow appears when others add theirs.',
    noOverlap: 'No time works for everyone yet. The closest options are below.',
    everyoneIn: 'Everyone’s in.',
    adding: (name: string) => `${name} is adding their times…`,
    finding: (zones: number) => `Finding a time across ${zones} time zone${zones === 1 ? '' : 's'}…`,
    coffee: (name: string) => `${name} is going to need coffee for this one.`,
  },
  lock: {
    cta: 'Lock it in',
    moment: 'It’s on.',
    change: 'Change the time',
    reopen: 'Reopen',
    changed: 'Heads up: the time changed.',
    cardLine: (people: number, zones: number) =>
      `${people} ${people === 1 ? 'person' : 'people'} · ${zones} time zone${zones === 1 ? '' : 's'} · 1 time that works.`,
  },
  nudge: (title: string, link: string, waiting: number | null) =>
    waiting && waiting > 0
      ? `${waiting} of you still haven’t added your times for ${title} 👀 It takes 20 seconds: ${link}`
      : `Still need your times for ${title} 👀 It takes 20 seconds: ${link}`,
  invite: (title: string, link: string) => `Add your times for ${title} — it takes 20 seconds: ${link}`,
  planYourOwn: {
    heading: 'Wrangling another group?',
    body: 'Start your own. It takes 20 seconds.',
    cta: 'Start an event',
  },
  notFound: {
    heading: 'This event has rolled off.',
    body: 'It may have been deleted, or it ended more than 90 days ago.',
  },
  /** Local mode: events live only in the browser that made them. Say so plainly. */
  local: {
    shareNote: 'Heads up: this copy of Sunroll is in local mode, so this link only works in this browser. To share with other people and devices, Sunroll needs its shared backend switched on.',
    notHereHeading: 'This event isn’t on this device.',
    notHereBody: 'This copy of Sunroll is in local mode, so events only live in the browser that made them. Open the link in that browser, or ask the organizer to switch on the shared backend.',
  },
  errors: {
    network: 'We couldn’t reach Sunroll. Check your connection and try again.',
    rate: 'That’s a lot of events. Take a breath and try again in a bit.',
    generic: 'Something went wrong on our side. Please try again.',
  },
} as const;

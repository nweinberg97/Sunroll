/**
 * Templates for recurring use cases. Each one pre-fills the create form and has its own
 * landing page at /t/{slug}. Mirrors the `templates` table seeded in the first migration.
 */
import { addDays, weekdayOf, type IsoDate } from './time/zone';

export type DayPattern = 'next7' | 'next14' | 'weekdays' | 'weekend';

export interface Template {
  slug: string;
  name: string;
  emoji: string;
  durationMinutes: number;
  windowStartMin: number;
  windowEndMin: number;
  dayPattern: DayPattern;
  /** One-line pitch shown on cards. */
  blurb: string;
  /** Landing page copy. */
  headline: string;
  intro: string;
  points: [string, string, string];
  searchTitle: string;
  searchDescription: string;
}

export const TEMPLATES: Template[] = [
  {
    slug: 'game-night',
    name: 'Game night',
    emoji: '🎲',
    durationMinutes: 180,
    windowStartMin: 18 * 60,
    windowEndMin: 23 * 60,
    dayPattern: 'next14',
    blurb: 'Find the night the whole table is free.',
    headline: 'Find a game night that works for the whole table.',
    intro: 'Board games in the living room or online with friends three time zones away. Everyone paints their free evenings, and the night that works for everyone glows.',
    points: ['Evenings by default, in everyone’s own time', 'See who’s up late before you pick', 'Lock it in and it lands in every calendar'],
    searchTitle: 'Schedule game night across time zones',
    searchDescription: 'Find a game night that works for every player, even across time zones. Free, no sign-up: everyone marks when they’re free and the best night glows.',
  },
  {
    slug: 'family-call',
    name: 'Family call',
    emoji: '📞',
    durationMinutes: 60,
    windowStartMin: 8 * 60,
    windowEndMin: 22 * 60,
    dayPattern: 'next7',
    blurb: 'Mom in Toronto, Sam in London. Daytime for all.',
    headline: 'Find a time for a family call across time zones.',
    intro: 'Mom in Toronto, Sam in London, you in Vancouver. Sunroll shows everyone’s day side by side, so nobody gets the 6am call by accident.',
    points: ['Every slot shown in each person’s local time', 'Sleep hours shaded, so nobody’s woken up', 'Grandparent-proof: no accounts, no downloads'],
    searchTitle: 'Find a time for a family call across time zones',
    searchDescription: 'Plan a family video call across time zones without the back-and-forth. See everyone’s local time, avoid the 6am slot, and add it to every calendar.',
  },
  {
    slug: 'standup',
    name: 'Team standup',
    emoji: '☕',
    durationMinutes: 30,
    windowStartMin: 7 * 60,
    windowEndMin: 19 * 60,
    dayPattern: 'weekdays',
    blurb: 'A check-in that’s kind to every time zone.',
    headline: 'Find a standup time that’s fair to a distributed team.',
    intro: 'Remote teams always have someone on the early call. Sunroll ranks times by who can make it, then by how humane they are for each person.',
    points: ['Working hours marked for each teammate', 'Best times ranked for fairness, not just overlap', 'One link in Slack, answers in a minute'],
    searchTitle: 'Schedule a standup for a distributed team',
    searchDescription: 'Pick a daily standup time that’s fair across time zones. Sunroll ranks times by availability and by humane local hours for every teammate.',
  },
  {
    slug: 'study-group',
    name: 'Study group',
    emoji: '📚',
    durationMinutes: 120,
    windowStartMin: 9 * 60,
    windowEndMin: 22 * 60,
    dayPattern: 'next7',
    blurb: 'Get everyone in the room before the exam.',
    headline: 'Find a study session time that works for everyone.',
    intro: 'Different classes, different jobs, different cities. Paint your free hours once and see where the whole group overlaps.',
    points: ['Works great on a phone, from a group chat', 'Mark “if needed” for the hours you could stretch', 'See the best two-hour window at a glance'],
    searchTitle: 'Schedule a study group session',
    searchDescription: 'Find a study group time that works for everyone. Share one link, everyone marks when they’re free, and the best session time glows.',
  },
  {
    slug: 'dnd',
    name: 'D&D session',
    emoji: '🐉',
    durationMinutes: 240,
    windowStartMin: 17 * 60,
    windowEndMin: 24 * 60,
    dayPattern: 'next14',
    blurb: 'Gather the party. Roll for a time.',
    headline: 'Find a D&D session time the whole party can make.',
    intro: 'Four hours, five players, one long-suffering DM. Sunroll finds the evening where the whole party can sit down together, wherever they’re playing from.',
    points: ['Long sessions need long overlaps; we look for them', 'See who’d be playing past midnight', 'Same group next week? Duplicate in one tap'],
    searchTitle: 'Schedule a D&D session across time zones',
    searchDescription: 'Find a Dungeons & Dragons session time the whole party can make, across time zones. Free, no sign-up, made for group chats.',
  },
  {
    slug: 'offsite',
    name: 'Offsite planning',
    emoji: '🗺️',
    durationMinutes: 90,
    windowStartMin: 7 * 60,
    windowEndMin: 19 * 60,
    dayPattern: 'weekdays',
    blurb: 'Line up the planning call across offices.',
    headline: 'Find a planning call time across every office.',
    intro: 'Before the offsite comes the planning call, and someone always takes it from the wrong side of midnight. Not this time.',
    points: ['Every office’s working hours side by side', 'Fair suggestions with one-line reasons', 'Calendar invites for Google, Outlook and Apple'],
    searchTitle: 'Schedule a planning call across offices and time zones',
    searchDescription: 'Find a planning meeting time that works across every office and time zone. See each person’s working hours and pick the fairest slot.',
  },
  {
    slug: 'book-club',
    name: 'Book club',
    emoji: '📖',
    durationMinutes: 90,
    windowStartMin: 17 * 60,
    windowEndMin: 22 * 60,
    dayPattern: 'next14',
    blurb: 'Pick the evening for the next chapter.',
    headline: 'Find a book club night that works for every reader.',
    intro: 'Whether the club meets in a living room or over video from three countries, find the evening everyone can make, and give people time to finish the book.',
    points: ['Two weeks of evenings to choose from', 'See the night everyone’s free glow', 'Reactions when it’s set: 🎉 📖'],
    searchTitle: 'Schedule a book club meeting',
    searchDescription: 'Pick a book club night that works for every reader, in any time zone. One link, no sign-up, and the best evening glows.',
  },
];

export function templateBySlug(slug: string | null | undefined): Template | undefined {
  return TEMPLATES.find((t) => t.slug === slug);
}

/** The dates a day pattern means, starting from `today` (the organizer's local date). */
export function datesFor(pattern: DayPattern, today: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  switch (pattern) {
    case 'next7':
      for (let i = 0; i < 7; i++) out.push(addDays(today, i));
      break;
    case 'next14':
      for (let i = 0; i < 14; i++) out.push(addDays(today, i));
      break;
    case 'weekdays': {
      // The next five working days, starting tomorrow.
      for (let i = 1; out.length < 5 && i < 14; i++) {
        const d = addDays(today, i);
        if (weekdayOf(d) <= 5) out.push(d);
      }
      break;
    }
    case 'weekend': {
      for (let i = 0; out.length < 4 && i < 21; i++) {
        const d = addDays(today, i);
        if (weekdayOf(d) >= 6) out.push(d);
      }
      break;
    }
  }
  return out;
}

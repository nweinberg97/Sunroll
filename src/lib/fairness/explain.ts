/**
 * One-line, human explanations for a suggested time. Pure, so it is tested like the ranking.
 */
import { formatMinute, type Clock } from '../time/format';
import type { Candidate, FairnessRules } from './score';
import { DEFAULT_RULES } from './score';

function hourWord(minute: number, clock: Clock): string {
  if (clock === '24h') return formatMinute(minute, '24h');
  const h = Math.floor(minute / 60) % 12 || 12;
  return minute % 60 === 0 ? String(h) : formatMinute(minute, '12h').replace(/ (am|pm)$/, '');
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Explain a candidate in one line.
 * `names` maps person id → display name; `you` is the viewer's id (rendered as "you").
 */
export function explain(
  c: Candidate,
  responders: number,
  names: ReadonlyMap<string, string>,
  opts: { clock?: Clock; you?: string; rules?: FairnessRules } = {},
): string {
  const clock = opts.clock ?? '12h';
  const rules = opts.rules ?? DEFAULT_RULES;
  const nameOf = (id: string) => (id === opts.you ? 'you' : names.get(id) ?? 'Someone');
  const everyone = c.available.length === responders;
  const lead = everyone
    ? responders === 1
      ? 'You’re free'
      : 'Everyone’s free'
    : `${c.available.length} of ${responders} can make it`;

  const uncomfortable = c.costs.filter((x) => x.discomfort);
  if (uncomfortable.length === 0) {
    const maybe = c.ifNeeded.map(nameOf);
    if (maybe.length > 0) return `${lead}, though ${list(maybe)} said “if needed”.`;
    if (!everyone) return `${lead}, and it’s a humane hour for all of them.`;
    const earliest = Math.min(...c.costs.map((x) => x.localStart));
    const latestEnd = Math.max(...c.costs.map((x) => (x.localEnd < x.localStart ? x.localEnd + 1440 : x.localEnd)));
    if (earliest - rules.humane.start <= rules.humane.end - latestEnd) {
      return `${lead}, and nobody’s up before ${hourWord(rules.humane.start, clock)}.`;
    }
    return `${lead}, and nobody’s up past ${hourWord(rules.humane.end, clock)}.`;
  }

  // Name the person paying the highest price.
  const worst = [...uncomfortable].sort((a, b) => b.minutesOutside - a.minutesOutside)[0];
  const who = nameOf(worst.id);
  const at = formatMinute(worst.localStart, clock);
  const others = uncomfortable.length - 1;
  const tail = others > 0 ? ` (and ${others} other${others > 1 ? 's' : ''})` : '';
  switch (worst.discomfort) {
    case 'early':
      return `${lead}. ${capitalise(who)} would be up early, at ${at}${tail}.`;
    case 'late':
      return `${lead}. It runs late for ${who}, starting ${at}${tail}.`;
    default:
      return `${lead}, but it’s ${at} for ${who} 😴${tail}.`;
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

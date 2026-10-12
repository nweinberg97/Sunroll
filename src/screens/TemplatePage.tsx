import { useEffect, useMemo } from 'react';
import { Link } from '../lib/router';
import { templateBySlug, TEMPLATES } from '../lib/templates';
import { BRAND } from '../lib/brand';
import { formatDuration, formatMinute, detectClock } from '../lib/time/format';
import { preferredLocale } from '../lib/identity';
import { WorldBands } from '../components/WorldBands';
import NotFound from './NotFound';

const BAND_PEOPLE = {
  'family-call': [
    { name: 'You', emoji: '🌻', zone: 'America/Vancouver' },
    { name: 'Mom', emoji: '🌷', zone: 'America/Toronto' },
    { name: 'Sam', emoji: '🦊', zone: 'Europe/London' },
  ],
  default: [
    { name: 'Ana', emoji: '🦉', zone: 'America/New_York' },
    { name: 'Ben', emoji: '🐸', zone: 'Europe/London' },
    { name: 'Chen', emoji: '🐼', zone: 'Asia/Singapore' },
  ],
} as const;

export default function TemplatePage({ slug }: { slug: string }) {
  const t = templateBySlug(slug);
  const clock = useMemo(() => detectClock(preferredLocale()), []);
  useEffect(() => {
    if (!t) return;
    document.title = `${t.searchTitle} · ${BRAND.name}`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.searchDescription);
  }, [t]);
  if (!t) return <NotFound />;
  const people = [...(slug === 'family-call' ? BAND_PEOPLE['family-call'] : BAND_PEOPLE.default)];
  return (
    <div className="landing">
      <section className="hero">
        <div className="wrap hero-grid">
          <div className="stack" style={{ ['--gap' as string]: '20px' }}>
            <span style={{ fontSize: 64 }} aria-hidden="true">
              {t.emoji}
            </span>
            <h1 style={{ fontSize: 'var(--step-4)' }}>{t.headline}</h1>
            <p className="lede">{t.intro}</p>
            <ul className="stack" style={{ ['--gap' as string]: '8px', paddingLeft: 0, listStyle: 'none', fontWeight: 600 }}>
              {t.points.map((p) => (
                <li key={p}>
                  <span aria-hidden="true">✦ </span>
                  {p}
                </li>
              ))}
            </ul>
            <div className="hero-cta">
              <Link to={`/new?t=${t.slug}`} className="btn btn-primary btn-lg">
                Start a {t.name.toLowerCase()} →
              </Link>
            </div>
            <p className="small muted">
              Pre-set to {formatDuration(t.durationMinutes)}, {formatMinute(t.windowStartMin, clock)}–{formatMinute(t.windowEndMin % 1440, clock)}. Change anything.
            </p>
          </div>
          <WorldBands people={people} anchorZone={people[0].zone} clock={clock} />
        </div>
      </section>
      <section className="l-section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <h2 style={{ fontSize: 'var(--step-3)' }}>More templates</h2>
          <div className="tpl-grid">
            {TEMPLATES.filter((x) => x.slug !== t.slug).map((x) => (
              <Link key={x.slug} to={`/t/${x.slug}`} className="tpl">
                <span className="e" aria-hidden="true">
                  {x.emoji}
                </span>
                <strong>{x.name}</strong>
                <span>{x.blurb}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

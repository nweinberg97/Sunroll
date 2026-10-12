import { useMemo } from 'react';
import { Link } from '../lib/router';
import { copy } from '../lib/copy';
import { BRAND } from '../lib/brand';
import { TEMPLATES } from '../lib/templates';
import { detectClock } from '../lib/time/format';
import { preferredLocale } from '../lib/identity';
import { WorldBands, type BandPerson } from '../components/WorldBands';

const DEMO: BandPerson[] = [
  { name: 'Nadia', emoji: '🌻', zone: 'America/Vancouver' },
  { name: 'Mom', emoji: '🌷', zone: 'America/Toronto' },
  { name: 'Sam', emoji: '🦊', zone: 'Europe/London' },
  { name: 'Priya', emoji: '🐝', zone: 'Europe/Berlin' },
];

export default function Landing() {
  const clock = useMemo(() => detectClock(preferredLocale()), []);
  return (
    <div className="landing">
      <section className="hero">
        <div className="wrap hero-grid">
          <div className="stack" style={{ ['--gap' as string]: '22px' }}>
            <h1>
              Find the time that works <span className="glow">everywhere.</span>
            </h1>
            <p className="lede">{copy.landing.sub}</p>
            <div className="hero-cta">
              <Link to="/new" className="btn btn-primary btn-lg">
                {copy.landing.cta} →
              </Link>
              <a href="#how" className="btn btn-ghost btn-lg">
                {copy.landing.secondary}
              </a>
            </div>
            <div className="trust">
              <span>No sign-up</span>
              <span>Every time zone</span>
              <span>Free</span>
            </div>
          </div>
          <WorldBands people={DEMO} anchorZone="America/Vancouver" clock={clock} />
        </div>
      </section>

      <section id="how" className="l-section" aria-labelledby="how-title">
        <div className="wrap">
          <p className="eyebrow">How it works</p>
          <h2 id="how-title">Three taps from group chat to calendar.</h2>
          <div className="steps">
            <article className="step">
              <span className="n">1</span>
              <div className="step-art" aria-hidden="true">
                <div className="mini-grid">
                  {Array.from({ length: 25 }, (_, i) => (
                    <i key={i} className={[6, 7, 8, 11, 12, 13, 16, 17].includes(i) ? 'f' : [18, 21, 22].includes(i) ? 'm' : ''} />
                  ))}
                </div>
                <span className="mini-cursor">👆</span>
              </div>
              <h3>Mark when you’re free</h3>
              <p>Drag across the grid on your phone, in your own time zone. “If needed” for the hours you could stretch.</p>
            </article>
            <article className="step">
              <span className="n">2</span>
              <div className="step-art" aria-hidden="true">
                <div className="mini-grid">
                  {Array.from({ length: 25 }, (_, i) => (
                    <i key={i} className={[11, 12, 13].includes(i) ? 'g' : [6, 7, 8, 16, 17, 18].includes(i) ? 'f' : ''} style={[6, 8, 16, 18].includes(i) ? { opacity: 0.45 } : undefined} />
                  ))}
                </div>
              </div>
              <h3>Watch the overlap glow</h3>
              <p>Everyone’s times stack up live. The slots that work for the whole group light up gold.</p>
            </article>
            <article className="step">
              <span className="n">3</span>
              <div className="step-art" aria-hidden="true">
                <div className="mini-lock">
                  <b>It’s on.</b>
                  <em>Sat 10:00 am</em>
                </div>
              </div>
              <h3>Lock it in</h3>
              <p>One tap and it’s in everyone’s calendar, at the right time for where they are.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="l-section l-dark" aria-labelledby="fair-title">
        <div className="wrap fair-grid">
          <div className="stack" style={{ ['--gap' as string]: '16px' }}>
            <p className="eyebrow" style={{ color: '#ffc93c' }}>
              Fair by design
            </p>
            <h2 id="fair-title">9am for you can be 1am for Tom.</h2>
            <p className="lede">
              Other tools find a time that’s free. {BRAND.name} also shows what each slot costs each person: their local time, their night shaded, their working hours marked. Suggestions favour times that are humane for everyone, so nobody quietly eats the 3am call.
            </p>
          </div>
          <div className="fair-card" aria-label="Example suggestions">
            <div className="fair-row" data-good="true">
              <span>
                <span className="t">Sat 10:00 am</span>
                <span className="why" style={{ display: 'block' }}>
                  Everyone’s free, and nobody’s up before 8.
                </span>
              </span>
              <span className="chips">
                <span className="local-chip" data-phase="day">🌻 10:00</span>
                <span className="local-chip" data-phase="dusk">🦊 6:00 pm</span>
              </span>
            </div>
            <div className="fair-row">
              <span>
                <span className="t">Fri 6:00 pm</span>
                <span className="why" style={{ display: 'block' }}>
                  Everyone’s free, but it’s 2:00 am for Sam 😴
                </span>
              </span>
              <span className="chips">
                <span className="local-chip" data-phase="dusk">🌻 6:00</span>
                <span className="local-chip" data-phase="night">🦊 2:00 am</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="l-section" aria-labelledby="tpl-title">
        <div className="wrap">
          <p className="eyebrow">Start from a template</p>
          <h2 id="tpl-title">For every group that can never agree.</h2>
          <div className="tpl-grid">
            {TEMPLATES.map((t) => (
              <Link key={t.slug} to={`/t/${t.slug}`} className="tpl">
                <span className="e" aria-hidden="true">
                  {t.emoji}
                </span>
                <strong>{t.name}</strong>
                <span>{t.blurb}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="l-section" style={{ background: 'var(--paper-2)' }} aria-labelledby="chat-title">
        <div className="wrap fair-grid">
          <div className="stack" style={{ ['--gap' as string]: '16px' }}>
            <p className="eyebrow">Made for the group chat</p>
            <h2 id="chat-title">One link. No app. No accounts.</h2>
            <p className="lede">Drop the link in WhatsApp, iMessage, Slack or Discord. Friends tap, type their name and paint. The preview already shows who’s in and where they are.</p>
          </div>
          <div className="chat-mock" aria-hidden="true">
            <span className="bubble">so when are we doing this 😅</span>
            <span className="bubble me">ok putting it in Sunroll</span>
            <span className="bubble link">
              <span className="preview-card">
                <span className="spread">
                  <span className="emoji">🎲</span>
                  <span className="small" style={{ fontWeight: 800, opacity: 0.85 }}>
                    ☀ {BRAND.name}
                  </span>
                </span>
                <span className="stack" style={{ ['--gap' as string]: '4px' }}>
                  <span className="title">Game night</span>
                  <span className="small" style={{ opacity: 0.85, fontWeight: 600 }}>
                    Nadia, Sam are in · Vancouver · London
                  </span>
                </span>
                <span className="band" />
              </span>
              <span className="meta" style={{ display: 'block' }}>
                sunroll.app · Add your times
              </span>
            </span>
            <span className="bubble">done ✅ thursday glows</span>
          </div>
        </div>
      </section>

      <section className="l-section" aria-labelledby="privacy-title">
        <div className="wrap">
          <p className="eyebrow">Private by default</p>
          <h2 id="privacy-title">A name and a time zone. That’s it.</h2>
          <div className="privacy-points">
            <div>
              <strong>No accounts</strong>
              <p>No sign-up, no email, no password. Ever, for guests.</p>
            </div>
            <div>
              <strong>Nothing to track</strong>
              <p>No ad trackers, no third-party analytics, no selling anything.</p>
            </div>
            <div>
              <strong>Gone in 90 days</strong>
              <p>Events delete themselves 90 days after their last date. Organizers can delete any time.</p>
            </div>
            <div>
              <strong>Unguessable links</strong>
              <p>Only people with the link can see an event. Only the organizer can lock it.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="l-section l-dark">
        <div className="wrap final-cta">
          <span style={{ fontSize: 56 }} aria-hidden="true">
            ☀️
          </span>
          <h2>Got a group to wrangle?</h2>
          <p className="lede">It takes 20 seconds to start. Your friends will thank you (at a reasonable hour).</p>
          <Link to="/new" className="btn btn-sun btn-lg">
            {copy.landing.cta} →
          </Link>
        </div>
      </section>
    </div>
  );
}

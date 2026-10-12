import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, match, useLocation } from './lib/router';
import { backendKind } from './lib/data';
import { isZoneSimulated, detectZone } from './lib/identity';
import { cityOf } from './lib/time/zone';
import { BRAND } from './lib/brand';
import { Logo, Spinner, ToastProvider } from './components/ui';
import Landing from './screens/Landing';
import { ErrorBoundary } from './components/ErrorBoundary';

// The landing page ships in the main bundle; everything else loads on demand.
const Create = lazy(() => import('./screens/Create'));
const EventScreen = lazy(() => import('./screens/Event'));
const TemplatePage = lazy(() => import('./screens/TemplatePage'));
const Privacy = lazy(() => import('./screens/Privacy'));
const NotFound = lazy(() => import('./screens/NotFound'));
const Demo = lazy(() => import('./screens/Demo'));

type Theme = 'light' | 'dark';

function currentTheme(): Theme {
  const explicit = document.documentElement.dataset.theme as Theme | undefined;
  if (explicit) return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('sunroll:theme', next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  };
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title="Theme">
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
    </button>
  );
}

function Route({ path }: { path: string }) {
  if (path === '/' || path === '') return <Landing />;
  if (path === '/new') return <Create />;
  if (path === '/privacy') return <Privacy />;
  if (path === '/demo') return <Demo />;
  const ev = match('/e/:id', path);
  if (ev) return <EventScreen key={ev.id} id={ev.id} />;
  const t = match('/t/:slug', path);
  if (t) return <TemplatePage slug={t.slug} />;
  return <NotFound />;
}

const TITLES: Record<string, string> = {
  '/': `${BRAND.name} · ${BRAND.tagline}`,
  '/new': `New event · ${BRAND.name}`,
  '/privacy': `Privacy · ${BRAND.name}`,
};

export default function App() {
  const loc = useLocation();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    if (TITLES[loc.path]) document.title = TITLES[loc.path];
    else if (loc.path.startsWith('/e/')) document.title = BRAND.name;
  }, [loc.path]);

  const onLanding = loc.path === '/';
  const local = backendKind() === 'local';

  return (
    <ToastProvider>
      <div className="app">
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="app-header" data-scrolled={scrolled}>
          <div className="wrap">
            <Link to="/" className="home-link" aria-label={`${BRAND.name} home`}>
              <Logo />
            </Link>
            <div className="row" style={{ ['--gap' as string]: '6px' }}>
              {!onLanding && loc.path !== '/new' && (
                <Link to="/new" className="btn btn-sm btn-ghost">
                  + New event
                </Link>
              )}
              {onLanding && (
                <Link to="/new" className="btn btn-sm btn-primary">
                  Start an event
                </Link>
              )}
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main id="main" className="app-main" tabIndex={-1}>
          <ErrorBoundary resetKey={loc.path}>
            <Suspense fallback={<Spinner />}>
              <Route path={loc.path} />
            </Suspense>
          </ErrorBoundary>
        </main>
        <footer className="app-footer">
          <div className="wrap">
            <Logo size={20} />
            <span>Find the time that works everywhere.</span>
            {local && (
              <span className="dev-badge" role="note" title="Events are stored in this browser only. Connect Supabase to share them.">
                Local mode{isZoneSimulated() ? ` · ${cityOf(detectZone())}` : ''}
              </span>
            )}
            <span className="row" style={{ ['--gap' as string]: '18px' }}>
              <Link to="/privacy">Privacy</Link>
              <Link to="/t/family-call">Templates</Link>
            </span>
          </div>
        </footer>

      </div>
    </ToastProvider>
  );
}

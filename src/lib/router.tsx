/**
 * A deliberately tiny router: path routes, history API, base-path aware (GitHub Pages serves
 * the app under /<repo>/). Hash routing is available for hosts that can't rewrite URLs.
 */
import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const HASH_MODE = import.meta.env.VITE_ROUTER === 'hash';
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

export interface Location {
  path: string;
  search: URLSearchParams;
  hash: string;
}

function current(): Location {
  if (HASH_MODE) {
    const raw = window.location.hash.replace(/^#/, '') || '/';
    const [pathAndSearch, hash = ''] = raw.split('#');
    const [path, search = ''] = pathAndSearch.split('?');
    return { path: path || '/', search: new URLSearchParams(search), hash };
  }
  let path = window.location.pathname;
  if (BASE && path.startsWith(BASE)) path = path.slice(BASE.length) || '/';
  return { path, search: new URLSearchParams(window.location.search), hash: window.location.hash.replace(/^#/, '') };
}

const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((fn) => fn());
}

/** Turn an app path ("/e/abc") into an href for this deployment. */
export function href(to: string): string {
  if (HASH_MODE) return `#${to}`;
  return `${BASE}${to}`;
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const url = href(to);
  if (options.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  notify();
  if (!options.replace) window.scrollTo({ top: 0 });
}

/** Remove the fragment from the address bar without navigating (used for secret tokens). */
export function clearHash(): void {
  const loc = current();
  const search = loc.search.toString();
  window.history.replaceState(null, '', href(`${loc.path}${search ? `?${search}` : ''}`));
}

export function useLocation(): Location {
  const [loc, setLoc] = useState(current);
  useEffect(() => {
    const update = () => setLoc(current());
    listeners.add(update);
    window.addEventListener('popstate', update);
    window.addEventListener('hashchange', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
      window.removeEventListener('hashchange', update);
    };
  }, []);
  return loc;
}

/** Match "/e/:id" against a path. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      {...rest}
      href={href(to)}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target) return;
        e.preventDefault();
        navigate(to);
      }}
    />
  );
}

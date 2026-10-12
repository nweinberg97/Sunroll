import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ColorName } from '../lib/data/types';
import type { SaveState } from '../lib/hooks';
import { copy } from '../lib/copy';
import { BRAND } from '../lib/brand';

/* ── Brand ──────────────────────────────────────────────────────────────── */

/** The logo: a sun resting on its Sunband. */
export function Logo({ size = 28, withWord = true }: { size?: number; withWord?: boolean }) {
  return (
    <span className="logo" aria-label={BRAND.name} role="img">
      <svg width={size * 1.6} height={size} viewBox="0 0 48 30" aria-hidden="true">
        <defs>
          <linearGradient id="logo-band" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#2a2550" />
            <stop offset="0.3" stopColor="#ff9f7a" />
            <stop offset="0.55" stopColor="#cfe0ff" />
            <stop offset="0.8" stopColor="#9b7bff" />
            <stop offset="1" stopColor="#2a2550" />
          </linearGradient>
        </defs>
        <rect x="1" y="19" width="46" height="10" rx="5" fill="url(#logo-band)" />
        <circle cx="25" cy="15" r="10" fill="#ffc93c" stroke="var(--paper)" strokeWidth="2.5" />
      </svg>
      {withWord && <span className="logo-word">{BRAND.name}</span>}
    </span>
  );
}

/* ── Avatars ────────────────────────────────────────────────────────────── */

export function Avatar({
  emoji,
  color,
  name,
  size = 40,
  live = false,
  tint,
  ring,
}: {
  emoji: string;
  color: ColorName;
  name?: string;
  size?: number;
  live?: boolean;
  /** Background colour (a person's soft colour). */
  tint?: string;
  /** Ring colour (a person's main colour), so faces match their blocks of time. */
  ring?: string;
}) {
  const style: Record<string, string> = { ['--size']: `${size}px` };
  if (tint) style['--bg'] = tint;
  if (ring) style.boxShadow = `0 0 0 2.5px ${ring}, 0 0 0 4.5px var(--card)`;
  return (
    <span className="avatar" data-color={color} data-live={live || undefined} style={style} title={name} aria-hidden={name ? undefined : true} role={name ? 'img' : undefined} aria-label={name}>
      <span aria-hidden="true">{emoji}</span>
    </span>
  );
}

export function AvatarStack({ people, max = 5, size = 36, colors }: { people: { id: string; emoji: string; color: ColorName; name: string }[]; max?: number; size?: number; colors?: Map<string, { solid: string; soft: string }> }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="avatar-stack" role="img" aria-label={people.map((p) => p.name).join(', ')}>
      {shown.map((p) => (
        <Avatar key={p.id} emoji={p.emoji} color={p.color} size={size} tint={colors?.get(p.id)?.soft} ring={colors?.get(p.id)?.solid} />
      ))}
      {extra > 0 && (
        <span className="avatar" data-color="sun" style={{ ['--size' as string]: `${size}px`, fontSize: 13, fontWeight: 800 }} aria-hidden="true">
          +{extra}
        </span>
      )}
    </span>
  );
}

/* ── Sheet: a native modal dialog (focus trap and Escape for free) ────────── */

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  labelledBy,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  labelledBy?: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useRef(`sheet-${Math.random().toString(36).slice(2)}`).current;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const handle = () => onClose();
    d.addEventListener('close', handle);
    return () => d.removeEventListener('close', handle);
  }, [onClose]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      style={wide ? { width: 'min(720px, 100vw)' } : undefined}
      aria-labelledby={labelledBy ?? (title ? titleId : undefined)}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <>
          <div className="sheet-grip" aria-hidden="true" />
          {title && (
            <div className="sheet-head">
              <h2 id={titleId}>{title}</h2>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </div>
          )}
          <div className="sheet-body">{children}</div>
          {footer && <div className="sheet-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

/* ── Toasts and announcements ───────────────────────────────────────────── */

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
}
const ToastContext = createContext<(text: string, tone?: 'info' | 'error') => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((text: string, tone: 'info' | 'error' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 2600);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast" data-tone={t.tone}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

let announceEl: HTMLElement | null = null;
/** Say something to screen-reader users without showing it. */
export function announce(text: string): void {
  if (!announceEl) {
    announceEl = document.createElement('div');
    announceEl.className = 'sr-only';
    announceEl.setAttribute('aria-live', 'polite');
    announceEl.setAttribute('role', 'status');
    document.body.appendChild(announceEl);
  }
  announceEl.textContent = '';
  window.setTimeout(() => {
    if (announceEl) announceEl.textContent = text;
  }, 30);
}

/* ── Save status: honest, always ────────────────────────────────────────── */

export function SavePill({ state }: { state: SaveState }) {
  if (state === 'idle') return <span className="save-pill" data-state="idle"><span className="dot" aria-hidden="true" />Changes save automatically</span>;
  const text = state === 'saving' ? copy.paint.saving : state === 'saved' ? copy.paint.saved : state === 'offline' ? copy.paint.offline : copy.paint.failed;
  return (
    <span className="save-pill" data-state={state} role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      {text}
    </span>
  );
}

/* ── Copy to clipboard ──────────────────────────────────────────────────── */

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and insecure origins: fall back to a hidden textarea.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyField({ value, label, display }: { value: string; label: string; display?: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-field">
      <code aria-label={label}>{display ?? value}</code>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        onClick={async () => {
          const ok = await copyText(value);
          if (ok) {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          } else toast('Couldn’t copy. Press and hold the link to copy it.', 'error');
        }}
      >
        {copied ? `✓ ${copy.share.copied}` : 'Copy'}
      </button>
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="row" style={{ justifyContent: 'center', padding: 48 }}>
      <div className="spinner" role="progressbar" aria-label={label} />
    </div>
  );
}

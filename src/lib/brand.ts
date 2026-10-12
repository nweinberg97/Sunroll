/** The product's name and the few facts about it that appear in many places. Change it here. */
export const BRAND = {
  name: 'Sunroll',
  tagline: 'Find the time that works everywhere.',
  description:
    'Everyone marks when they’re free. Sunroll shows the whole group in your time zone, and the times that work for everyone glow.',
  retentionDays: 90,
} as const;

/** The public origin used in share links. Falls back to wherever the app is running. */
export function publicOrigin(): string {
  const configured = import.meta.env.VITE_PUBLIC_URL as string | undefined;
  if (configured) return configured.replace(/\/$/, '');
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}`;
}

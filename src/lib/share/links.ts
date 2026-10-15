/** Links people share and the messaging deep links that carry them. */
import { publicOrigin } from '../brand';

export function eventUrl(eventId: string): string {
  return `${publicOrigin()}${import.meta.env.VITE_ROUTER === 'hash' ? '/#' : ''}/e/${eventId}`;
}

/** The organizer link carries its secret in the fragment, which browsers never send to servers. */
export function organizerUrl(eventId: string, organizerToken: string): string {
  return `${eventUrl(eventId)}#o=${encodeURIComponent(organizerToken)}`;
}

export function messagingLinks(text: string, url: string) {
  const full = `${text}`;
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(full)}`,
    sms: `sms:?&body=${encodeURIComponent(full)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text.replace(url, '').trim())}`,
    email: `mailto:?subject=${encodeURIComponent('Find a time with us')}&body=${encodeURIComponent(full)}`,
  };
}

export function canNativeShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/** Share text (and optionally a file) through the OS share sheet. Returns false if it wasn't available or was cancelled. */
export async function nativeShare(data: { title?: string; text?: string; url?: string; files?: File[] }): Promise<boolean> {
  if (!canNativeShare()) return false;
  try {
    if (data.files && !(navigator.canShare?.({ files: data.files }) ?? false)) return false;
    await navigator.share(data);
    return true;
  } catch {
    return false;
  }
}

/** A full public URL for an app path ("/nadia/intro"), for copy buttons and display. */
export function pageUrl(path: string): string {
  return `${publicOrigin()}${import.meta.env.VITE_ROUTER === 'hash' ? '/#' : ''}${path}`;
}

/** The same URL without the protocol, for showing on screen. */
export function displayUrl(path: string): string {
  return pageUrl(path).replace(/^https?:\/\//, '');
}

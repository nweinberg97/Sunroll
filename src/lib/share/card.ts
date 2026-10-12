/**
 * The "It's on." share card, drawn on a canvas from the same palette as the product and
 * exported as a PNG: designed to be posted, never screenshotted.
 *
 * Each time zone gets a Sunband: a 24-hour strip, night → dawn → day → dusk, with the sun
 * sitting at that zone's local time for the meeting. Stack them and the group's shared
 * moment lines up in one glance.
 */
import { cityOf, wallTime, type Instant, type Zone } from '../time/zone';
import { formatDate, formatMinute, type Clock } from '../time/format';
import { BRAND } from '../brand';
import { copy } from '../copy';

export type CardFormat = 'square' | 'story';

export interface CardData {
  title: string;
  emoji: string;
  start: Instant;
  end: Instant;
  viewerZone: Zone;
  people: { name: string; emoji: string; zone: Zone }[];
  clock: Clock;
  locale: string;
}

const C = {
  night: '#15132b',
  night2: '#2a2550',
  sun: '#ffc93c',
  paper: '#fff8ec',
  text2: '#c3bedf',
  blue: '#2f4bff',
  coral: '#ff5c8a',
};

const DISPLAY = '"Bricolage Grotesque Variable", "Bricolage Grotesque", system-ui, sans-serif';
const BODY = '"Figtree Variable", "Figtree", system-ui, sans-serif';

/** Colour stops of a day, by local hour. */
const DAY_STOPS: [number, string][] = [
  [0, '#2a2550'],
  [4.5, '#3d3270'],
  [6, '#ff9f7a'],
  [7.5, '#ffd2b4'],
  [9.5, '#dbe7ff'],
  [15, '#cfe0ff'],
  [17.5, '#ffb38a'],
  [19.5, '#9b7bff'],
  [22, '#2a2550'],
  [24, '#2a2550'],
];

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, font: (size: number) => string, start: number, min: number): number {
  let size = start;
  ctx.font = font(size);
  while (size > min && ctx.measureText(text).width > maxWidth) {
    size -= 2;
    ctx.font = font(size);
  }
  return size;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

function sunband(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  for (const [hour, color] of DAY_STOPS) g.addColorStop(hour / 24, color);
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = g;
  ctx.fill();
}

export function drawCard(ctx: CanvasRenderingContext2D, format: CardFormat, d: CardData): void {
  const W = 1080;
  const H = format === 'story' ? 1920 : 1080;
  const pad = format === 'story' ? 96 : 80;
  ctx.canvas.width = W;
  ctx.canvas.height = H;

  // Night sky with a warm horizon.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, C.night);
  bg.addColorStop(0.62, '#221c4a');
  bg.addColorStop(1, '#3a2a5e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.78, H * 0.16, 10, W * 0.78, H * 0.16, W * 0.55);
  glow.addColorStop(0, 'rgba(255,201,60,0.38)');
  glow.addColorStop(1, 'rgba(255,201,60,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  let y = pad;
  // Wordmark.
  sunband(ctx, pad, y + 18, 54, 14);
  ctx.beginPath();
  ctx.arc(pad + 28, y + 14, 14, 0, Math.PI * 2);
  ctx.fillStyle = C.sun;
  ctx.fill();
  ctx.fillStyle = C.paper;
  ctx.font = `800 34px ${DISPLAY}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(BRAND.name, pad + 70, y + 20);

  // Emoji medallion.
  y += format === 'story' ? 170 : 110;
  const medal = format === 'story' ? 150 : 116;
  ctx.beginPath();
  ctx.arc(pad + medal / 2, y + medal / 2, medal / 2, 0, Math.PI * 2);
  ctx.fillStyle = C.sun;
  ctx.shadowColor = 'rgba(255,201,60,0.6)';
  ctx.shadowBlur = 40;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.font = `${Math.round(medal * 0.56)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(d.emoji, pad + medal / 2, y + medal / 2 + 4);
  ctx.textAlign = 'left';

  // "It's on."
  y += medal + (format === 'story' ? 70 : 40);
  ctx.fillStyle = C.paper;
  ctx.textBaseline = 'alphabetic';
  const headSize = format === 'story' ? 168 : 128;
  ctx.font = `800 ${headSize}px ${DISPLAY}`;
  ctx.fillText(copy.lock.moment, pad - 6, y + headSize * 0.8);
  y += headSize * 0.8 + (format === 'story' ? 40 : 26);

  // Title.
  ctx.fillStyle = C.text2;
  const titleSize = fitText(ctx, d.title, W - pad * 2, (s) => `700 ${s}px ${BODY}`, format === 'story' ? 56 : 46, 30);
  ctx.font = `700 ${titleSize}px ${BODY}`;
  ctx.fillText(ellipsize(ctx, d.title, W - pad * 2), pad, y + titleSize);
  y += titleSize + (format === 'story' ? 110 : 56);

  // The time, big, in the viewer's zone.
  const vw = wallTime(d.start, d.viewerZone);
  ctx.fillStyle = C.sun;
  const timeText = formatMinute(vw.minute, d.clock);
  const timeSize = format === 'story' ? 150 : 104;
  ctx.font = `800 ${timeSize}px ${DISPLAY}`;
  ctx.fillText(timeText, pad - 4, y + timeSize * 0.78);
  const timeW = ctx.measureText(timeText).width;
  ctx.fillStyle = C.paper;
  ctx.font = `700 ${format === 'story' ? 40 : 32}px ${BODY}`;
  ctx.fillText(formatDate(vw.date, d.locale), pad + timeW + 28, y + timeSize * 0.42);
  ctx.fillStyle = C.text2;
  ctx.font = `600 ${format === 'story' ? 32 : 26}px ${BODY}`;
  ctx.fillText(`${cityOf(d.viewerZone)} time`, pad + timeW + 28, y + timeSize * 0.78);
  y += timeSize + (format === 'story' ? 90 : 46);

  // One Sunband per zone, the sun at each zone's local time.
  const zones: Zone[] = [];
  for (const p of d.people) if (!zones.includes(p.zone)) zones.push(p.zone);
  const maxRows = format === 'story' ? 6 : 4;
  const shown = zones.slice(0, maxRows);
  const rowH = format === 'story' ? 118 : 86;
  const labelW = format === 'story' ? 330 : 300;
  const bandX = pad + labelW;
  const bandW = W - pad - bandX;
  const bandH = format === 'story' ? 30 : 24;
  for (const z of shown) {
    const w = wallTime(d.start, z);
    const cy = y + rowH / 2;
    ctx.fillStyle = C.paper;
    ctx.font = `800 ${format === 'story' ? 40 : 32}px ${DISPLAY}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(formatMinute(w.minute, d.clock), pad, cy - (format === 'story' ? 18 : 14));
    ctx.fillStyle = C.text2;
    ctx.font = `600 ${format === 'story' ? 28 : 22}px ${BODY}`;
    const shift = w.date === vw.date ? '' : w.date > vw.date ? ' · next day' : ' · day before';
    const names = d.people.filter((p) => p.zone === z).map((p) => p.emoji).join(' ');
    ctx.fillText(ellipsize(ctx, `${cityOf(z)}${shift}  ${names}`, labelW - 24), pad, cy + (format === 'story' ? 24 : 18));
    sunband(ctx, bandX, cy - bandH / 2, bandW, bandH);
    const sx = bandX + (w.minute / 1440) * bandW;
    ctx.beginPath();
    ctx.arc(sx, cy, bandH * 0.95, 0, Math.PI * 2);
    ctx.fillStyle = C.sun;
    ctx.shadowColor = 'rgba(255,201,60,0.8)';
    ctx.shadowBlur = 24;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 5;
    ctx.strokeStyle = C.night;
    ctx.stroke();
    y += rowH;
  }
  if (zones.length > shown.length) {
    ctx.fillStyle = C.text2;
    ctx.font = `600 26px ${BODY}`;
    ctx.fillText(`+ ${zones.length - shown.length} more time zone${zones.length - shown.length > 1 ? 's' : ''}`, pad, y + 20);
  }

  // Footer line.
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.paper;
  const line = copy.lock.cardLine(d.people.length, zones.length);
  const footSize = fitText(ctx, line, W - pad * 2, (s) => `800 ${s}px ${DISPLAY}`, format === 'story' ? 50 : 40, 24);
  ctx.font = `800 ${footSize}px ${DISPLAY}`;
  ctx.fillText(line, pad, H - pad);
}

/** Render the card to a PNG file, waiting for the brand fonts first. */
export async function renderCard(format: CardFormat, d: CardData): Promise<File> {
  try {
    await Promise.all([document.fonts.load(`800 64px ${DISPLAY}`), document.fonts.load(`700 32px ${BODY}`)]);
  } catch {
    /* fonts are a nicety; fall back to system fonts */
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  drawCard(ctx, format, d);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not render the card');
  const slug = d.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
  return new File([blob], `${slug}-${format}.png`, { type: 'image/png' });
}

export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

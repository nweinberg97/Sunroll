# Sunroll — Design

> Everyone marks when they're free, and Sunroll shows the whole group's availability in *your* time zone, so the times that work for everyone glow, and you can see what each slot costs each person.

This document is deliberately short. It sets the bar for every screen and is the reference for the copy, the brand and the data model. Individual decisions and their one-line reasons live in [`DECISIONS.md`](./DECISIONS.md).

---

## 1. The 11-star exercise

For each key moment: what 1, 5, 7 and 11 stars feel like, then **what we build** (the best feasible version).

### Creating an event
| ★ | Experience |
|---|---|
| 1 | Sign-up wall, a 12-field form, times in UTC. |
| 5 | A clean form, no account, a link at the end. |
| 7 | Name it, tap a few days, done in 15 seconds; the share step looks like something you want to send. |
| 11 | Sunroll already knows it's "Family call" because you said "Mom" — and has picked the window where Toronto and London are both awake. |
| **Build** | One screen. Smart defaults (next 7 days, 8am–10pm, 1 hour). Templates pre-fill everything. Time zone detected and shown in words. Share step is a moment: preview card, native share, QR, copy. |

### Opening the link (guest)
| ★ | Experience |
|---|---|
| 1 | A bare URL in the chat; the page asks you to make an account. |
| 5 | A page with the event name and a grid. |
| 7 | The preview in the chat already shows the emoji, who's in and the time zones. One tap, one obvious button: "Add your times". |
| 11 | It feels like the group is already in the room: you see their faces, their local clocks, and someone adding their times right now. |
| **Build** | Designed link preview (OG image). First screen: who invited you, who's in, a world strip of everyone's local time, one primary action. Name only. Time zone confirmed in plain words. |

### Marking availability
| ★ | Experience |
|---|---|
| 1 | Tiny cells, desktop-only, no save indication. |
| 5 | Drag to paint, autosave. |
| 7 | Big, thumb-friendly cells; paint "Free" or "If needed"; your night is softly shaded so you don't offer 3am by accident; it says *Saved* only when it is. |
| 11 | It feels like colouring in, not admin. |
| **Build** | Rectangle painting with pointer events (touch and mouse), brush toggle, honest save state, full keyboard and screen-reader support, sleep hours shaded. |

### Seeing the overlap
| ★ | Experience |
|---|---|
| 1 | A heatmap in the organizer's time zone. |
| 5 | A heatmap in your time zone. |
| 7 | The everyone-free slots glow. Tap one and see what it means for each person, "1:00 am Tom 😴". Best times explained in a sentence. |
| 11 | You see the planet's day at a glance: everyone's sun rising and setting across the same grid, and the window where it's daytime for all of you is lit. |
| **Build** | Heatmap in the viewer's zone with a golden glow for full overlap; per-person lanes coloured night → dawn → day → dusk in *their* local time; slot detail with each person's local time; Best times ranked by availability then fairness, each with a one-line reason; a world strip; live updates and presence; a table alternative. |

### Locking the time
| ★ | Experience |
|---|---|
| 1 | The organizer copies a time into the chat by hand. |
| 5 | A "Confirm" button and a notice. |
| 7 | "It's on." with the time in everyone's local time, and calendar buttons. |
| 11 | The group chat lights up. The share card shows "4 people · 3 time zones · 1 time that works" and people post it. |
| **Build** | Lock from a Best time or any slot. A full-screen "It's on." moment with the sun rolling into place (calm fallback for reduced motion), everyone's local time, reactions, share cards (1:1 and 9:16). |

### Getting it into your calendar
| ★ | Experience |
|---|---|
| 1 | Nothing; you type it in yourself, in the wrong time zone. |
| 5 | An .ics download. |
| 7 | Google, Outlook and Apple, one tap each, always right. |
| 11 | If the time changes, your calendar updates itself. |
| **Build** | Google and Outlook links, and an .ics in UTC with a stable UID and SEQUENCE, so re-importing after a change updates the same entry. |

---

## 2. Storyboards

### Organizer — Nadia in Vancouver, family call with Mom (Toronto) and Sam (London)
1. Taps "Start an event" on the landing page (or the "Family call" template).
2. Types "Family call", picks 📞, keeps "Next 7 days", sets 8am–10pm, 1 hour, types her name. Sees "Times are in Vancouver time. Everyone else sees their own."
3. **It's live.** A preview card of what guests will see. Taps *Share* → WhatsApp family group. Sunroll also shows her private organizer link: "Keep this one. It's how you lock the time."
4. Taps "Add my times", paints her evenings. *Saved.*
5. Later, the overlap view: Mom's lane is dusk-coloured where Sam's is night. One slot glows. Best time: "Sat 10:00 am · Everyone's free, and nobody's up before 8."
6. Taps *Lock it in*. **It's on.** Sends the share card to the chat. Taps *Google Calendar*.

### Guest — Sam in London, tapping the link from the group chat
1. Sees the preview in WhatsApp: 📞 Family call · Nadia, Mom are in · Vancouver, Toronto, London.
2. Opens it: "Nadia invited you to **Family call**", two faces, a world strip with their local clocks. One button: **Add your times**.
3. Types "Sam", picks 🦊. "Looks like you're in London. Times are shown in your time."
4. Paints Saturday afternoon. *Saved.* "Done — see the overlap".
5. Sees his Saturday 6pm glow; it's 10am for Nadia and 1pm for Mom.
6. A quiet card: "Wrangling another group? Start your own, it takes 20 seconds."
7. When Nadia locks it: **It's on.** Sat 6:00 pm, his time. Adds to Apple Calendar via .ics. Reacts ☕.

---

## 3. Copy deck

Voice: warm, a little witty, never cringe. Plain words. Never shame anyone. One idea per line.
The canonical strings live in [`src/lib/copy.ts`](./src/lib/copy.ts); this is the summary.

| Moment | Copy |
|---|---|
| Landing headline | Find the time that works everywhere. |
| Landing sub | Everyone marks when they're free. Sunroll shows the whole group in your time zone, and the times that work for everyone glow. |
| Primary CTA | Start an event |
| Name placeholders | Game night · Family call · Q4 planning · D&D, session 12 · Book club |
| Time zone line | Times are in {city} time. Everyone else sees their own. |
| Share heading | It's live. |
| Organizer link | Keep this one. It's how you lock the time. |
| Guest hero | {host} invited you to {event}. |
| Guest CTA | Add your times |
| Time zone confirm | Looks like you're in {city}. Times are shown in your time. |
| Painting hint | Drag to paint. Tap to toggle. |
| Saved states | Saving… · Saved · Couldn't save. Trying again… |
| No good times | None of these work for me |
| Overlap empty | Nobody's added times yet. You could be first. |
| One responder | Just you so far. The glow appears when others add theirs. |
| Presence | {name} is adding their times… |
| Everyone in | Everyone's in. |
| Best-time reasons | Everyone's free, and nobody's up before 8. · Everyone's free. {name} would be up early ({time}). · Everyone's free, though {name} marked it "if needed". · {n} of {m} free. |
| Night warning | {name} is going to need coffee for this one. |
| Lock CTA | Lock it in |
| Lock moment | It's on. |
| Share card line | {n} people · {z} time zones · 1 time that works. |
| Nudge | Still need your times for {event} 👀 It takes 20 seconds: {link} |
| Plan your own | Wrangling another group? Start your own. It takes 20 seconds. |
| Time changed | Heads up: the time changed. |
| Not found | This event has rolled off. It may have been deleted or expired. |

---

## 4. Brand system

### Name
**Sunroll** — the sun rolls around the world; Sunroll finds where it's up for everyone. Two syllables, says itself in a group chat ("just Sunroll it"). Kept in one constant: `src/lib/brand.ts`.

Alternatives considered (checked for obvious products in this space, October 2026):

| Name | One line | Existing products |
|---|---|---|
| **Sunroll** ✅ | The sun rolls round the world; we find where it's up for all of you. | No scheduling product found; an unrelated "Sun Rolls" iOS app exists. |
| Glim | The glimmer of the slot that works. | "Glim: Daily Self Care Rituals" on the App Store. |
| Venn | Overlapping circles, the overlap is the answer. | An iOS app named "Venn" exists; too literal and crowded. |
| Allset | "We're all set." | Allset was a restaurant-ordering app (now part of Relay). |
| Gloam | The glow at dusk. | No conflict found, but it reads gloomy. |

### Palette (each colour means one thing)
| Token | Hex | Meaning |
|---|---|---|
| `--sun` | `#FFC93C` | The glow. The time that works for everyone, the reward. |
| `--blue` | `#2F4BFF` | Free. Availability, potential. |
| `--ink` / night | `#15132B` | Night, sleep, seriousness. |
| `--coral` | `#FF5C8A` | People. Avatars, presence, reactions. |
| dawn | `#FFB38A` | Morning in someone's day. |
| day | `#CFE0FF` | Daytime in someone's day. |
| dusk | `#9B7BFF` | Evening in someone's day. |
| `--paper` | `#FFF8EC` | The warm page. |

"If needed" is blue **with diagonal stripes**, never just a lighter blue, so it reads without colour. Full overlap is sun-yellow **and** marked with a ✦, so it reads without colour too. Blue and yellow stay distinct under protanopia and deuteranopia.

### Type
- **Display:** Bricolage Grotesque (variable, 800 weight, optical size 96) for headlines and scoreboard numerals. Quirky, warm, confident.
- **Body:** Figtree. Friendly and very readable at small sizes; Sogo's body face, so the two products feel like siblings.
- Both bundled with the app through npm (`@fontsource-variable/*`); no runtime font requests.

### Signature shape: the Sunband
A rounded band that runs **night → dawn → day → dusk → night**, with a sun disc that rolls along it.
- **Logo:** a sun disc resting on a short band.
- **Overlap view:** each person's lane *is* a Sunband in their local time, so the group's bands line up and the window where it's day for everyone lights up gold.
- **Best-time chips, the lock moment and the share card** all reuse it: the sun rolls into place when the time is locked.

Why not the alternatives: overlapping circles say "overlap" but nothing about time; a plain golden band says "the answer" but not "across the world". The Sunband says both, and it carries the name.

### Shape, motion, numerals
- Radii 14 / 22 / 32px; soft, warm shadows.
- Springy but restrained motion (180–420ms, one overshoot max). Every animation has a calm fallback under `prefers-reduced-motion`.
- Scoreboard numerals: Bricolage 800, tabular, for people count, time zones and the locked time.

---

## 5. Data model

All instants are stored in **UTC** (`timestamptz`); every person stores an **IANA zone**, never an offset.

```
templates (slug PK, name, emoji, default_duration_minutes, default window …)        — referenced by events.template_slug
events (id PK [16-char random], title, emoji, color, timezone [IANA],
        dates date[]              — organizer-local calendar dates,
        window_start_min, window_end_min  — minutes after local midnight; end <= start means "crosses midnight",
        slot_minutes = 30, duration_minutes, expected_count?,
        organizer_token_hash, template_slug?, referred_by_event_id?,
        view_count, created_at, updated_at, expires_at)
participants (id PK uuid, event_id FK, name, emoji, color, timezone [IANA],
        sleep_start_min, sleep_end_min, work_start_min, work_end_min,
        is_organizer, token_hash, responded_at?, created_at, updated_at)
availability_blocks (id PK, event_id FK, participant_id FK, starts_at, ends_at, kind ['free' | 'if_needed'])
locked_times (event_id PK/FK, starts_at, ends_at, version, locked_at)
reactions (event_id FK, participant_id FK, emoji, created_at, PK(participant_id, emoji))
rate_limits (bucket, key_hash, window_start, count)    — no raw IPs stored
```

- **Secrets:** organizer and participant tokens are 128-bit random values, returned once, stored as SHA-256 hashes. The organizer token lives in the URL *fragment* (`/e/{id}#o={token}`), so it never reaches a server log or a link-preview crawler.
- **Access:** tables have RLS enabled with no policies for `anon`; every read and write goes through `SECURITY DEFINER` functions that check tokens. Real-time is a broadcast "changed" ping per event (no data on the wire), after which clients refetch through the same checked function.
- **Retention:** `expires_at` = last event date + 90 days. A daily `pg_cron` job deletes expired events (cascading to everything). Organizers can delete at any time; participants can remove themselves.
- **Loops measured** in SQL views (no third-party analytics): events created, guests per event, guest→organizer conversion (via `referred_by_event_id`), link-view→response conversion (`view_count`, an aggregate counter), and time from created to locked.

The client sees the same model through one interface, `DataStore` (`src/lib/data/store.ts`), with two adapters: `local` (browser storage + BroadcastChannel, for zero-setup development) and `supabase`.

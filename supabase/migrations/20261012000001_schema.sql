-- Sunroll schema.
--
-- Principles:
--   * Every instant is a timestamptz (UTC). Every person stores an IANA zone, never an offset.
--   * Tables are never readable or writable by the public API roles directly. RLS is on with no
--     policies for anon/authenticated, and all access goes through SECURITY DEFINER functions
--     (see 20261012000002_functions.sql) that check secret tokens.
--   * Secrets (organizer and participant tokens) are stored only as SHA-256 hashes.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Private helpers live outside the API-exposed schema.
create schema if not exists sunroll_private;
revoke all on schema sunroll_private from public;

-- ---------------------------------------------------------------------------------------------
-- Templates: the recurring use cases (game night, family call…). Code holds the copy; this
-- table gives events a real foreign key so template usage can be measured.
-- ---------------------------------------------------------------------------------------------
create table public.templates (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (char_length(name) between 1 and 60),
  emoji text not null check (char_length(emoji) between 1 and 16),
  description text not null default '',
  duration_minutes smallint not null check (duration_minutes between 15 and 480),
  window_start_min smallint not null check (window_start_min between 0 and 1439),
  window_end_min smallint not null check (window_end_min between 0 and 1440),
  day_pattern text not null check (day_pattern in ('next7', 'next14', 'weekdays', 'weekend')),
  sort smallint not null default 0
);

-- ---------------------------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------------------------
create table public.events (
  -- 14 base58 characters ≈ 82 bits: unguessable, and still short enough for a group chat.
  id text primary key check (id ~ '^[1-9A-HJ-NP-Za-km-z]{14}$'),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  emoji text not null default '☀️' check (char_length(emoji) between 1 and 16),
  color text not null default 'sun' check (color in ('sun', 'blue', 'coral', 'dusk', 'mint')),
  timezone text not null check (char_length(timezone) between 1 and 64),
  -- Organizer-local calendar dates the group can choose from.
  dates date[] not null check (cardinality(dates) between 1 and 14),
  -- Daily window in the organizer's wall-clock time; end <= start crosses midnight.
  window_start_min smallint not null check (window_start_min between 0 and 1439),
  window_end_min smallint not null check (window_end_min between 0 and 1440),
  slot_minutes smallint not null default 30 check (slot_minutes in (15, 30, 60)),
  duration_minutes smallint not null check (duration_minutes between 15 and 480),
  expected_count smallint check (expected_count between 2 and 50),
  organizer_token_hash bytea not null,
  template_slug text references public.templates (slug) on delete set null,
  -- The event whose link brought this organizer here ("plan your own"). No FK: it may be gone.
  referred_by_event_id text,
  -- Aggregate counter only; no per-visitor data.
  view_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint duration_fits_slots check (duration_minutes % slot_minutes = 0),
  constraint window_fits_slots check (window_start_min % slot_minutes = 0 and window_end_min % slot_minutes = 0)
);
create index events_expires_at_idx on public.events (expires_at);
create index events_referred_by_idx on public.events (referred_by_event_id) where referred_by_event_id is not null;

-- ---------------------------------------------------------------------------------------------
-- Participants: a display name and a time zone. Nothing else is required.
-- ---------------------------------------------------------------------------------------------
create table public.participants (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  emoji text not null default '🙂' check (char_length(emoji) between 1 and 16),
  color text not null default 'coral' check (color in ('sun', 'blue', 'coral', 'dusk', 'mint')),
  timezone text not null check (char_length(timezone) between 1 and 64),
  sleep_start_min smallint not null default 1380 check (sleep_start_min between 0 and 1439),
  sleep_end_min smallint not null default 420 check (sleep_end_min between 0 and 1440),
  work_start_min smallint not null default 540 check (work_start_min between 0 and 1439),
  work_end_min smallint not null default 1020 check (work_end_min between 0 and 1440),
  is_organizer boolean not null default false,
  token_hash bytea not null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index participants_event_id_idx on public.participants (event_id);
create unique index participants_one_organizer_idx on public.participants (event_id) where is_organizer;

-- ---------------------------------------------------------------------------------------------
-- Availability: merged [starts_at, ends_at) blocks per participant.
-- ---------------------------------------------------------------------------------------------
create table public.availability_blocks (
  id bigint generated always as identity primary key,
  event_id text not null references public.events (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null check (kind in ('free', 'if_needed')),
  constraint block_is_forward check (ends_at > starts_at),
  constraint block_is_bounded check (ends_at - starts_at <= interval '2 days')
);
create index availability_blocks_event_id_idx on public.availability_blocks (event_id);
create index availability_blocks_participant_id_idx on public.availability_blocks (participant_id);

-- ---------------------------------------------------------------------------------------------
-- The locked time. One row per event; `version` increases on every change so calendars update.
-- ---------------------------------------------------------------------------------------------
create table public.locked_times (
  event_id text primary key references public.events (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  version integer not null default 1,
  locked_at timestamptz not null default now(),
  constraint lock_is_forward check (ends_at > starts_at)
);

-- ---------------------------------------------------------------------------------------------
-- Reactions on the locked event.
-- ---------------------------------------------------------------------------------------------
create table public.reactions (
  event_id text not null references public.events (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  emoji text not null check (emoji in ('👍', '🎉', '😴', '☕')),
  created_at timestamptz not null default now(),
  primary key (participant_id, emoji)
);
create index reactions_event_id_idx on public.reactions (event_id);

-- ---------------------------------------------------------------------------------------------
-- Rate limiting. Keys are hashed; raw IP addresses are never stored.
-- ---------------------------------------------------------------------------------------------
create table sunroll_private.rate_limits (
  bucket text not null,
  key_hash bytea not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket, key_hash, window_start)
);

-- ---------------------------------------------------------------------------------------------
-- Lock everything down. RLS on, no policies for API roles, and no table privileges either.
-- ---------------------------------------------------------------------------------------------
alter table public.templates enable row level security;
alter table public.events enable row level security;
alter table public.participants enable row level security;
alter table public.availability_blocks enable row level security;
alter table public.locked_times enable row level security;
alter table public.reactions enable row level security;
alter table sunroll_private.rate_limits enable row level security;

revoke all on public.events, public.participants, public.availability_blocks, public.locked_times, public.reactions
  from anon, authenticated;
revoke all on public.templates from anon, authenticated;

-- Templates are public content: readable, never writable.
grant select on public.templates to anon, authenticated;
create policy templates_are_public on public.templates for select to anon, authenticated using (true);

insert into public.templates (slug, name, emoji, description, duration_minutes, window_start_min, window_end_min, day_pattern, sort) values
  ('game-night', 'Game night', '🎲', 'Board games, video games, or poker. Find the night that works for the whole table.', 180, 1080, 1380, 'next14', 1),
  ('family-call', 'Family call', '📞', 'Mom in Toronto, Sam in London. Find a time that''s daytime for everyone.', 60, 480, 1320, 'next7', 2),
  ('standup', 'Team standup', '☕', 'A recurring check-in for a distributed team, kind to every time zone.', 30, 420, 1140, 'weekdays', 3),
  ('study-group', 'Study group', '📚', 'Pick a session time before the exam that works for every study buddy.', 120, 540, 1320, 'next7', 4),
  ('dnd', 'D&D session', '🐉', 'Gather the party. Find the session slot where the whole table can roll.', 240, 1020, 1440, 'next14', 5),
  ('offsite', 'Offsite planning', '🗺️', 'Line up a planning call across offices before the offsite.', 90, 420, 1140, 'weekdays', 6),
  ('book-club', 'Book club', '📖', 'Pick the evening for the next chapter, wherever the club is reading from.', 90, 1020, 1320, 'next14', 7);

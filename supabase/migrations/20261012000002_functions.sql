-- Sunroll API: every read and write goes through these functions.
--
-- Public functions (schema `public`) are callable by the anon role via PostgREST RPC.
-- They are SECURITY DEFINER with an empty search_path and fully qualified names.
-- Errors are raised with a stable prefix the client maps to a code:
--   invalid: …      bad input
--   forbidden: …    wrong or missing token
--   not_found: …    no such event / participant
--   rate_limited: … too many requests

-- =============================================================================================
-- Private helpers
-- =============================================================================================

create or replace function sunroll_private.hash_token(p_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256');
$$;

-- 18 random bytes as base64url: 24 characters, 144 bits.
create or replace function sunroll_private.new_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_'), '=');
$$;

-- 14 base58 characters for public event ids.
create or replace function sunroll_private.new_event_id()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  bytes bytea := extensions.gen_random_bytes(32);
  result text := '';
  i int := 0;
  b int;
begin
  -- Rejection sampling keeps the distribution uniform (58 * 4 = 232 ≤ 256).
  while char_length(result) < 14 loop
    if i >= 32 then
      bytes := extensions.gen_random_bytes(32);
      i := 0;
    end if;
    b := get_byte(bytes, i);
    i := i + 1;
    if b < 232 then
      result := result || substr(alphabet, (b % 58) + 1, 1);
    end if;
  end loop;
  return result;
end;
$$;

create or replace function sunroll_private.is_valid_zone(p_zone text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_zone is not null
     and p_zone ~ '^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$'
     and exists (select 1 from pg_catalog.pg_timezone_names where name = p_zone);
$$;

create or replace function sunroll_private.client_key()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  headers jsonb;
begin
  begin
    headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    headers := null;
  end;
  return coalesce(
    headers ->> 'cf-connecting-ip',
    btrim(split_part(headers ->> 'x-forwarded-for', ',', 1)),
    headers ->> 'x-real-ip',
    'unknown'
  );
end;
$$;

-- Fixed-window rate limit. Raises rate_limited when the bucket is full.
create or replace function sunroll_private.check_rate(p_bucket text, p_limit int, p_window interval)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  win timestamptz := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window));
  k bytea := extensions.digest(convert_to(sunroll_private.client_key(), 'UTF8'), 'sha256');
  n int;
begin
  insert into sunroll_private.rate_limits as r (bucket, key_hash, window_start, count)
  values (p_bucket, k, win, 1)
  on conflict (bucket, key_hash, window_start) do update set count = r.count + 1
  returning r.count into n;
  if n > p_limit then
    raise exception 'rate_limited: slow down a little and try again soon';
  end if;
end;
$$;

-- Tell everyone watching an event that something changed. The payload carries no data:
-- clients refetch through get_event. A realtime hiccup must never fail a write.
create or replace function sunroll_private.notify(p_event_id text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  begin
    perform realtime.send(jsonb_build_object('at', now()), 'changed', 'event:' || p_event_id, false);
  exception when others then
    null;
  end;
end;
$$;

create or replace function sunroll_private.require_organizer(p_event_id text, p_token text)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  ok boolean;
begin
  select e.organizer_token_hash = sunroll_private.hash_token(p_token) into ok
  from public.events e where e.id = p_event_id;
  if ok is null then
    raise exception 'not_found: this event has rolled off';
  end if;
  if not ok then
    raise exception 'forbidden: only the organizer can do that';
  end if;
end;
$$;

-- Returns the participant's event id after checking their token.
create or replace function sunroll_private.require_participant(p_participant_id uuid, p_token text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  ev text;
  ok boolean;
begin
  select p.event_id, p.token_hash = sunroll_private.hash_token(p_token) into ev, ok
  from public.participants p where p.id = p_participant_id;
  if ev is null then
    raise exception 'not_found: we couldn''t find you in this event';
  end if;
  if not ok then
    raise exception 'forbidden: that isn''t you';
  end if;
  return ev;
end;
$$;

create or replace function sunroll_private.participant_json(p public.participants)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'eventId', p.event_id,
    'name', p.name,
    'emoji', p.emoji,
    'color', p.color,
    'timezone', p.timezone,
    'sleep', jsonb_build_object('start', p.sleep_start_min, 'end', p.sleep_end_min),
    'work', jsonb_build_object('start', p.work_start_min, 'end', p.work_end_min),
    'isOrganizer', p.is_organizer,
    'respondedAt', p.responded_at,
    'createdAt', p.created_at,
    'updatedAt', p.updated_at
  );
$$;

-- Validate and normalise a participant payload. Returns the cleaned fields.
create or replace function sunroll_private.clean_participant(p jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  nm text := btrim(coalesce(p ->> 'name', ''));
  tz text := p ->> 'timezone';
  em text := coalesce(nullif(btrim(p ->> 'emoji'), ''), '🙂');
  co text := coalesce(p ->> 'color', 'coral');
  ss int := coalesce((p -> 'sleep' ->> 'start')::int, 1380);
  se int := coalesce((p -> 'sleep' ->> 'end')::int, 420);
  ws int := coalesce((p -> 'work' ->> 'start')::int, 540);
  we int := coalesce((p -> 'work' ->> 'end')::int, 1020);
begin
  if char_length(nm) < 1 or char_length(nm) > 40 then raise exception 'invalid: name must be 1 to 40 characters'; end if;
  if not sunroll_private.is_valid_zone(tz) then raise exception 'invalid: unknown time zone'; end if;
  if char_length(em) > 16 then raise exception 'invalid: emoji'; end if;
  if co not in ('sun', 'blue', 'coral', 'dusk', 'mint') then raise exception 'invalid: color'; end if;
  if ss not between 0 and 1439 or se not between 0 and 1440 or ws not between 0 and 1439 or we not between 0 and 1440 then
    raise exception 'invalid: hours';
  end if;
  return jsonb_build_object('name', nm, 'timezone', tz, 'emoji', em, 'color', co,
    'sleep_start_min', ss, 'sleep_end_min', se, 'work_start_min', ws, 'work_end_min', we);
exception
  when invalid_text_representation then raise exception 'invalid: hours must be whole minutes';
end;
$$;

revoke all on all functions in schema sunroll_private from public;

-- =============================================================================================
-- Public API
-- =============================================================================================

-- Everything a client needs to render an event, without any secrets.
create or replace function public.get_event(p_event_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.events;
begin
  select * into e from public.events where id = p_event_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', e.id,
      'title', e.title,
      'emoji', e.emoji,
      'color', e.color,
      'timezone', e.timezone,
      'days', coalesce((
        select jsonb_agg(jsonb_build_object('date', d.day, 'startMin', d.window_start_min, 'endMin', d.window_end_min) order by d.day)
        from public.event_days d where d.event_id = e.id
      ), '[]'::jsonb),
      'slotMinutes', e.slot_minutes,
      'durationMinutes', e.duration_minutes,
      'expectedCount', e.expected_count,
      'templateSlug', e.template_slug,
      'createdAt', e.created_at,
      'updatedAt', e.updated_at,
      'expiresAt', e.expires_at
    ),
    'participants', coalesce((
      select jsonb_agg(sunroll_private.participant_json(p) order by p.created_at, p.id)
      from public.participants p where p.event_id = e.id
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object('participantId', b.participant_id, 'start', b.starts_at, 'end', b.ends_at, 'kind', b.kind)
                       order by b.participant_id, b.starts_at)
      from public.availability_blocks b where b.event_id = e.id
    ), '[]'::jsonb),
    'lock', (
      select jsonb_build_object('start', l.starts_at, 'end', l.ends_at, 'version', l.version, 'lockedAt', l.locked_at)
      from public.locked_times l where l.event_id = e.id
    ),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('participantId', r.participant_id, 'emoji', r.emoji, 'createdAt', r.created_at) order by r.created_at)
      from public.reactions r where r.event_id = e.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_event(p_event jsonb, p_host jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ev_id text := sunroll_private.new_event_id();
  org_token text := sunroll_private.new_token();
  part_token text := sunroll_private.new_token();
  title text := btrim(coalesce(p_event ->> 'title', ''));
  tz text := p_event ->> 'timezone';
  days_json jsonb := coalesce(p_event -> 'days', '[]'::jsonb);
  ds date[];
  slot int := coalesce((p_event ->> 'slotMinutes')::int, 30);
  dur int;
  expected int := (p_event ->> 'expectedCount')::int;
  tmpl text := nullif(p_event ->> 'templateSlug', '');
  referrer text := nullif(p_event ->> 'referredByEventId', '');
  host jsonb;
  pid uuid;
begin
  perform sunroll_private.check_rate('create_event', 20, interval '1 hour');

  if char_length(title) < 1 or char_length(title) > 80 then raise exception 'invalid: give it a name (up to 80 characters)'; end if;
  if not sunroll_private.is_valid_zone(tz) then raise exception 'invalid: unknown time zone'; end if;

  -- Parse the days straight from the JSON (no temp tables: hosted roles can't always create them).
  begin
    if jsonb_typeof(days_json) <> 'array' then raise exception 'not an array'; end if;
    select array_agg((d ->> 'date')::date order by (d ->> 'date')::date) into ds from jsonb_array_elements(days_json) d;
    perform (d ->> 'startMin')::int, (d ->> 'endMin')::int from jsonb_array_elements(days_json) d;
    dur := (p_event ->> 'durationMinutes')::int;
  exception when others then
    raise exception 'invalid: dates and times';
  end;

  if ds is null or cardinality(ds) < 1 or cardinality(ds) > 14 then raise exception 'invalid: pick between 1 and 14 days'; end if;
  if (select count(distinct (d ->> 'date')::date) from jsonb_array_elements(days_json) d) <> cardinality(ds) then raise exception 'invalid: each day can only appear once'; end if;
  if ds[cardinality(ds)] - ds[1] > 62 then raise exception 'invalid: keep the dates within two months'; end if;
  if ds[1] < (now() at time zone 'UTC')::date - 2 then raise exception 'invalid: those dates have passed'; end if;
  if slot not in (15, 30, 60) then raise exception 'invalid: slot length'; end if;
  if dur is null or dur < slot or dur > 480 or dur % slot <> 0 then raise exception 'invalid: meeting length'; end if;
  if exists (select 1 from (select (d ->> 'startMin')::int as s, (d ->> 'endMin')::int as e from jsonb_array_elements(days_json) d) nd where s is null or e is null or s not between 0 and 1439 or e not between 0 and 1440 or s % slot <> 0 or e % slot <> 0) then
    raise exception 'invalid: time window';
  end if;
  if exists (select 1 from (select (d ->> 'startMin')::int as s, (d ->> 'endMin')::int as e from jsonb_array_elements(days_json) d) nd where dur > (case when e > s then e - s else e + 1440 - s end)) then
    raise exception 'invalid: the meeting is longer than one of the days'' time ranges';
  end if;
  if expected is not null and expected not between 2 and 50 then raise exception 'invalid: group size'; end if;
  if tmpl is not null and not exists (select 1 from public.templates t where t.slug = tmpl) then tmpl := null; end if;
  if referrer is not null and referrer !~ '^[1-9A-HJ-NP-Za-km-z]{14}$' then referrer := null; end if;

  host := sunroll_private.clean_participant(p_host);

  insert into public.events (id, title, emoji, color, timezone,
                             slot_minutes, duration_minutes, expected_count, organizer_token_hash,
                             template_slug, referred_by_event_id, expires_at)
  values (ev_id, title,
          coalesce(nullif(btrim(p_event ->> 'emoji'), ''), '☀️'),
          coalesce(p_event ->> 'color', 'sun'),
          tz, slot, dur, expected, sunroll_private.hash_token(org_token),
          tmpl, referrer,
          (ds[cardinality(ds)] + 90)::timestamp at time zone 'UTC');
  insert into public.event_days (event_id, day, window_start_min, window_end_min)
  select ev_id, (d ->> 'date')::date, (d ->> 'startMin')::int, (d ->> 'endMin')::int from jsonb_array_elements(days_json) d;

  insert into public.participants (event_id, name, emoji, color, timezone, sleep_start_min, sleep_end_min,
                                   work_start_min, work_end_min, is_organizer, token_hash)
  values (ev_id, host ->> 'name', host ->> 'emoji', host ->> 'color', host ->> 'timezone',
          (host ->> 'sleep_start_min')::int, (host ->> 'sleep_end_min')::int,
          (host ->> 'work_start_min')::int, (host ->> 'work_end_min')::int, true,
          sunroll_private.hash_token(part_token))
  returning id into pid;

  return jsonb_build_object('eventId', ev_id, 'organizerToken', org_token, 'participantId', pid, 'participantToken', part_token);
exception
  when check_violation then raise exception 'invalid: %', sqlerrm;
end;
$$;

create or replace function public.verify_organizer(p_event_id text, p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select e.organizer_token_hash = sunroll_private.hash_token(p_token) from public.events e where e.id = p_event_id), false);
$$;

create or replace function public.update_event(p_event_id text, p_token text, p_patch jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t text := btrim(p_patch ->> 'title');
begin
  perform sunroll_private.require_organizer(p_event_id, p_token);
  if p_patch ? 'title' and (t is null or char_length(t) < 1 or char_length(t) > 80) then
    raise exception 'invalid: give it a name (up to 80 characters)';
  end if;
  update public.events set
    title = case when p_patch ? 'title' then t else title end,
    emoji = case when p_patch ? 'emoji' then coalesce(nullif(btrim(p_patch ->> 'emoji'), ''), emoji) else emoji end,
    color = case when p_patch ? 'color' then p_patch ->> 'color' else color end,
    expected_count = case when p_patch ? 'expectedCount' then (p_patch ->> 'expectedCount')::int else expected_count end,
    updated_at = now()
  where id = p_event_id;
  perform sunroll_private.notify(p_event_id);
exception
  when check_violation then raise exception 'invalid: %', sqlerrm;
end;
$$;

create or replace function public.delete_event(p_event_id text, p_token text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform sunroll_private.require_organizer(p_event_id, p_token);
  delete from public.events where id = p_event_id;
  perform sunroll_private.notify(p_event_id);
end;
$$;

create or replace function public.join_event(p_event_id text, p_participant jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  token text := sunroll_private.new_token();
  c jsonb;
  pid uuid;
  n int;
  row public.participants;
begin
  perform sunroll_private.check_rate('join_event', 60, interval '1 hour');
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'not_found: this event has rolled off';
  end if;
  select count(*) into n from public.participants where event_id = p_event_id;
  if n >= 50 then raise exception 'invalid: this event is full (50 people)'; end if;
  c := sunroll_private.clean_participant(p_participant);
  insert into public.participants (event_id, name, emoji, color, timezone, sleep_start_min, sleep_end_min,
                                   work_start_min, work_end_min, token_hash)
  values (p_event_id, c ->> 'name', c ->> 'emoji', c ->> 'color', c ->> 'timezone',
          (c ->> 'sleep_start_min')::int, (c ->> 'sleep_end_min')::int,
          (c ->> 'work_start_min')::int, (c ->> 'work_end_min')::int,
          sunroll_private.hash_token(token))
  returning * into row;
  pid := row.id;
  perform sunroll_private.notify(p_event_id);
  return jsonb_build_object('participant', sunroll_private.participant_json(row), 'token', token);
end;
$$;

create or replace function public.update_participant(p_participant_id uuid, p_token text, p_patch jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ev text := sunroll_private.require_participant(p_participant_id, p_token);
  cur public.participants;
  merged jsonb;
  c jsonb;
  row public.participants;
begin
  select * into cur from public.participants where id = p_participant_id;
  merged := sunroll_private.participant_json(cur) || coalesce(p_patch, '{}'::jsonb);
  c := sunroll_private.clean_participant(merged);
  update public.participants set
    name = c ->> 'name', emoji = c ->> 'emoji', color = c ->> 'color', timezone = c ->> 'timezone',
    sleep_start_min = (c ->> 'sleep_start_min')::int, sleep_end_min = (c ->> 'sleep_end_min')::int,
    work_start_min = (c ->> 'work_start_min')::int, work_end_min = (c ->> 'work_end_min')::int,
    updated_at = now()
  where id = p_participant_id
  returning * into row;
  perform sunroll_private.notify(ev);
  return sunroll_private.participant_json(row);
end;
$$;

create or replace function public.leave_event(p_participant_id uuid, p_token text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ev text := sunroll_private.require_participant(p_participant_id, p_token);
begin
  if exists (select 1 from public.participants where id = p_participant_id and is_organizer) then
    raise exception 'invalid: organizers delete the event instead';
  end if;
  delete from public.participants where id = p_participant_id;
  perform sunroll_private.notify(ev);
end;
$$;

create or replace function public.remove_participant(p_event_id text, p_token text, p_participant_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform sunroll_private.require_organizer(p_event_id, p_token);
  delete from public.participants where id = p_participant_id and event_id = p_event_id and not is_organizer;
  perform sunroll_private.notify(p_event_id);
end;
$$;

-- Replace a participant's availability in one transaction.
create or replace function public.set_availability(p_participant_id uuid, p_token text, p_blocks jsonb, p_responded boolean default true)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ev text := sunroll_private.require_participant(p_participant_id, p_token);
  lo timestamptz;
  hi timestamptz;
  n int;
begin
  perform sunroll_private.check_rate('set_availability', 600, interval '1 hour');
  if jsonb_typeof(coalesce(p_blocks, '[]'::jsonb)) <> 'array' then raise exception 'invalid: blocks'; end if;
  n := jsonb_array_length(coalesce(p_blocks, '[]'::jsonb));
  if n > 700 then raise exception 'invalid: too many blocks'; end if;

  -- Generous bounds around the event, wide enough for any zone on earth.
  select (min(day) - 2)::timestamp at time zone 'UTC', (max(day) + 3)::timestamp at time zone 'UTC' into lo, hi
  from public.event_days where event_id = ev;

  delete from public.availability_blocks where participant_id = p_participant_id;
  begin
    insert into public.availability_blocks (event_id, participant_id, starts_at, ends_at, kind)
    select ev, p_participant_id, (b ->> 'start')::timestamptz, (b ->> 'end')::timestamptz, b ->> 'kind'
    from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) b;
  exception
    when check_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception 'invalid: availability';
  end;
  if exists (select 1 from public.availability_blocks where participant_id = p_participant_id and (starts_at < lo or ends_at > hi)) then
    raise exception 'invalid: availability outside the event';
  end if;

  update public.participants
     set responded_at = case when p_responded then coalesce(responded_at, now()) else responded_at end,
         updated_at = now()
   where id = p_participant_id;
  perform sunroll_private.notify(ev);
end;
$$;

create or replace function public.lock_time(p_event_id text, p_token text, p_starts_at timestamptz, p_ends_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  l public.locked_times;
begin
  perform sunroll_private.require_organizer(p_event_id, p_token);
  if p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval '8 hours' then
    raise exception 'invalid: lock time';
  end if;
  insert into public.locked_times as x (event_id, starts_at, ends_at, version, locked_at)
  values (p_event_id, p_starts_at, p_ends_at, 1, now())
  on conflict (event_id) do update
    set starts_at = excluded.starts_at, ends_at = excluded.ends_at, version = x.version + 1, locked_at = now()
  returning * into l;
  update public.events set updated_at = now() where id = p_event_id;
  perform sunroll_private.notify(p_event_id);
  return jsonb_build_object('start', l.starts_at, 'end', l.ends_at, 'version', l.version, 'lockedAt', l.locked_at);
end;
$$;

create or replace function public.unlock_time(p_event_id text, p_token text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform sunroll_private.require_organizer(p_event_id, p_token);
  delete from public.locked_times where event_id = p_event_id;
  update public.events set updated_at = now() where id = p_event_id;
  perform sunroll_private.notify(p_event_id);
end;
$$;

-- Returns true if the reaction is now on, false if it was removed.
create or replace function public.toggle_reaction(p_participant_id uuid, p_token text, p_emoji text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ev text := sunroll_private.require_participant(p_participant_id, p_token);
  removed int;
begin
  if p_emoji not in ('👍', '🎉', '😴', '☕') then raise exception 'invalid: reaction'; end if;
  delete from public.reactions where participant_id = p_participant_id and emoji = p_emoji;
  get diagnostics removed = row_count;
  if removed = 0 then
    insert into public.reactions (event_id, participant_id, emoji) values (ev, p_participant_id, p_emoji);
  end if;
  perform sunroll_private.notify(ev);
  return removed = 0;
end;
$$;

-- An aggregate view counter, for measuring link → response conversion. No visitor data.
create or replace function public.record_view(p_event_id text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.events set view_count = view_count + 1 where id = p_event_id;
$$;

-- Lock down: only these functions are callable by the API roles.
revoke all on function
  public.get_event(text),
  public.create_event(jsonb, jsonb),
  public.verify_organizer(text, text),
  public.update_event(text, text, jsonb),
  public.delete_event(text, text),
  public.join_event(text, jsonb),
  public.update_participant(uuid, text, jsonb),
  public.leave_event(uuid, text),
  public.remove_participant(text, text, uuid),
  public.set_availability(uuid, text, jsonb, boolean),
  public.lock_time(text, text, timestamptz, timestamptz),
  public.unlock_time(text, text),
  public.toggle_reaction(uuid, text, text),
  public.record_view(text)
from public;

grant execute on function
  public.get_event(text),
  public.create_event(jsonb, jsonb),
  public.verify_organizer(text, text),
  public.update_event(text, text, jsonb),
  public.delete_event(text, text),
  public.join_event(text, jsonb),
  public.update_participant(uuid, text, jsonb),
  public.leave_event(uuid, text),
  public.remove_participant(text, text, uuid),
  public.set_availability(uuid, text, jsonb, boolean),
  public.lock_time(text, text, timestamptz, timestamptz),
  public.unlock_time(text, text),
  public.toggle_reaction(uuid, text, text),
  public.record_view(text)
to anon, authenticated;

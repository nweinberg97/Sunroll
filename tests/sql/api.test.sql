-- End-to-end tests of the Sunroll database API, run as the `anon` role like a browser would.
-- Any failed assertion aborts with a non-zero exit (psql -v ON_ERROR_STOP=1).

\set QUIET on
set client_min_messages = warning;

create temporary table t (k text primary key, v text);
grant all on t to anon;

set request.headers = '{"x-forwarded-for": "203.0.113.7, 10.0.0.1"}';
set role anon;

-- ── Tables are invisible to the API role ───────────────────────────────────────────────────
do $$
begin
  begin
    perform 1 from public.events limit 1;
    raise exception 'FAIL: anon can read events';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.events (id) values ('x');
    raise exception 'FAIL: anon can write events';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.participants limit 1;
    raise exception 'FAIL: anon can read participants';
  exception when insufficient_privilege then null;
  end;
  begin
    perform sunroll_private.new_token();
    raise exception 'FAIL: anon can call private helpers';
  exception when insufficient_privilege then null;
  end;
  -- Templates are public content.
  assert (select count(*) from public.templates) = 7, 'templates readable';
end;
$$;

-- ── Create an event ───────────────────────────────────────────────────────────────────────
do $$
declare
  r jsonb;
begin
  r := public.create_event(
    jsonb_build_object('title', '  Family call ', 'emoji', '📞', 'timezone', 'America/Vancouver',
      'dates', jsonb_build_array(to_char(current_date + 3, 'YYYY-MM-DD'), to_char(current_date + 1, 'YYYY-MM-DD'), to_char(current_date + 1, 'YYYY-MM-DD')),
      'windowStartMin', 480, 'windowEndMin', 1320, 'durationMinutes', 60, 'templateSlug', 'family-call'),
    jsonb_build_object('name', 'Nadia', 'emoji', '🌻', 'timezone', 'America/Vancouver'));
  assert r ->> 'eventId' ~ '^[1-9A-HJ-NP-Za-km-z]{14}$', 'event id is base58 x14';
  assert char_length(r ->> 'organizerToken') = 24, 'organizer token is 24 chars';
  insert into t values ('ev', r ->> 'eventId'), ('org', r ->> 'organizerToken'),
                       ('host', r ->> 'participantId'), ('hostTok', r ->> 'participantToken');
end;
$$;

do $$
declare
  ev text := (select v from t where k = 'ev');
  s jsonb := public.get_event(ev);
begin
  assert s -> 'event' ->> 'title' = 'Family call', 'title trimmed';
  assert jsonb_array_length(s -> 'event' -> 'dates') = 2, 'dates de-duplicated';
  assert (s -> 'event' -> 'dates' ->> 0) < (s -> 'event' -> 'dates' ->> 1), 'dates sorted';
  assert s -> 'event' ->> 'templateSlug' = 'family-call', 'template kept';
  assert jsonb_array_length(s -> 'participants') = 1, 'host is a participant';
  assert (s -> 'participants' -> 0 ->> 'isOrganizer')::boolean, 'host is organizer';
  assert s::text not like '%token%' and s::text not like '%hash%', 'no secrets in the snapshot';
  assert s -> 'lock' = 'null'::jsonb or s -> 'lock' is null, 'not locked yet';
  assert public.get_event('11111111111111') is null, 'unknown event is null';
end;
$$;

-- ── Validation ────────────────────────────────────────────────────────────────────────────
do $$
declare
  base jsonb := jsonb_build_object('title', 'x', 'timezone', 'Europe/London',
    'dates', jsonb_build_array(to_char(current_date + 1, 'YYYY-MM-DD')),
    'windowStartMin', 540, 'windowEndMin', 600, 'durationMinutes', 60);
  host jsonb := jsonb_build_object('name', 'A', 'timezone', 'Europe/London');
  bad jsonb[] := array[
    base || '{"title": "   "}',
    base || '{"timezone": "Mars/Base"}',
    base || '{"timezone": "+05:30"}',
    base || '{"windowStartMin": 545}',
    base || '{"durationMinutes": 120}',
    base || '{"dates": []}',
    base || jsonb_build_object('dates', jsonb_build_array('2020-01-01'))
  ];
  b jsonb;
  failed boolean;
begin
  foreach b in array bad loop
    failed := false;
    begin
      perform public.create_event(b, host);
    exception when others then
      failed := sqlerrm like 'invalid:%';
    end;
    assert failed, 'should reject ' || b::text;
  end loop;
  -- Crossing midnight is fine: 10pm–2am, 4-hour window.
  perform public.create_event(base || '{"windowStartMin": 1320, "windowEndMin": 120, "durationMinutes": 240}', host);
  -- Bad host name.
  failed := false;
  begin
    perform public.create_event(base, jsonb_build_object('name', '', 'timezone', 'Europe/London'));
  exception when others then failed := sqlerrm like 'invalid:%';
  end;
  assert failed, 'empty host name rejected';
end;
$$;

-- ── Guests join and paint ─────────────────────────────────────────────────────────────────
do $$
declare
  ev text := (select v from t where k = 'ev');
  r jsonb;
  d date := ((select public.get_event(ev)) -> 'event' -> 'dates' ->> 0)::date;
begin
  r := public.join_event(ev, jsonb_build_object('name', 'Sam', 'emoji', '🦊', 'timezone', 'Europe/London'));
  insert into t values ('sam', r -> 'participant' ->> 'id'), ('samTok', r ->> 'token');
  r := public.join_event(ev, jsonb_build_object('name', 'Tom', 'timezone', 'Australia/Sydney', 'sleep', jsonb_build_object('start', 1320, 'end', 360)));
  insert into t values ('tom', r -> 'participant' ->> 'id'), ('tomTok', r ->> 'token');
  assert (r -> 'participant' -> 'sleep' ->> 'start')::int = 1320, 'custom sleep hours kept';

  perform public.set_availability((select v from t where k = 'sam')::uuid, (select v from t where k = 'samTok'),
    jsonb_build_array(
      jsonb_build_object('start', (d::timestamp at time zone 'America/Vancouver') + interval '9 hours', 'end', (d::timestamp at time zone 'America/Vancouver') + interval '11 hours', 'kind', 'free'),
      jsonb_build_object('start', (d::timestamp at time zone 'America/Vancouver') + interval '11 hours', 'end', (d::timestamp at time zone 'America/Vancouver') + interval '12 hours', 'kind', 'if_needed')
    ), true);
  assert jsonb_array_length(public.get_event(ev) -> 'blocks') = 2, 'two blocks stored';
  assert (select p ->> 'respondedAt' from jsonb_array_elements(public.get_event(ev) -> 'participants') p where p ->> 'name' = 'Sam') is not null, 'responded';

  -- Replacing availability is atomic and total.
  perform public.set_availability((select v from t where k = 'sam')::uuid, (select v from t where k = 'samTok'),
    jsonb_build_array(jsonb_build_object('start', (d::timestamp at time zone 'America/Vancouver') + interval '10 hours', 'end', (d::timestamp at time zone 'America/Vancouver') + interval '11 hours', 'kind', 'free')), true);
  assert jsonb_array_length(public.get_event(ev) -> 'blocks') = 1, 'replaced';

  -- "None of these work" is a response with no blocks.
  perform public.set_availability((select v from t where k = 'tom')::uuid, (select v from t where k = 'tomTok'), '[]'::jsonb, true);
  assert (select p ->> 'respondedAt' from jsonb_array_elements(public.get_event(ev) -> 'participants') p where p ->> 'name' = 'Tom') is not null, 'empty response counts';
end;
$$;

-- ── Tokens are enforced ───────────────────────────────────────────────────────────────────
do $$
declare
  ev text := (select v from t where k = 'ev');
  sam uuid := (select v from t where k = 'sam')::uuid;
  ok boolean;
begin
  -- Wrong participant token.
  ok := false;
  begin
    perform public.set_availability(sam, (select v from t where k = 'tomTok'), '[]'::jsonb, true);
  exception when others then ok := sqlerrm like 'forbidden:%';
  end;
  assert ok, 'cannot paint as someone else';

  -- Guest cannot lock.
  ok := false;
  begin
    perform public.lock_time(ev, (select v from t where k = 'samTok'), now(), now() + interval '1 hour');
  exception when others then ok := sqlerrm like 'forbidden:%';
  end;
  assert ok, 'guest cannot lock';

  -- Guest cannot delete or edit.
  ok := false;
  begin perform public.delete_event(ev, 'nope'); exception when others then ok := sqlerrm like 'forbidden:%'; end;
  assert ok, 'guest cannot delete';
  ok := false;
  begin perform public.update_event(ev, null, '{"title":"hijacked"}'); exception when others then ok := sqlerrm like 'forbidden:%'; end;
  assert ok, 'null token cannot edit';

  assert public.verify_organizer(ev, (select v from t where k = 'org')), 'organizer verifies';
  assert not public.verify_organizer(ev, 'guess'), 'guess fails';
  assert not public.verify_organizer('11111111111111', 'guess'), 'unknown event fails';

  -- Availability far outside the event is rejected.
  ok := false;
  begin
    perform public.set_availability(sam, (select v from t where k = 'samTok'),
      jsonb_build_array(jsonb_build_object('start', '2030-01-01T00:00:00Z', 'end', '2030-01-01T01:00:00Z', 'kind', 'free')), true);
  exception when others then ok := sqlerrm like 'invalid:%';
  end;
  assert ok, 'out-of-range availability rejected';

  ok := false;
  begin
    perform public.set_availability(sam, (select v from t where k = 'samTok'),
      jsonb_build_array(jsonb_build_object('start', now(), 'end', now() - interval '1 hour', 'kind', 'free')), true);
  exception when others then ok := sqlerrm like 'invalid:%';
  end;
  assert ok, 'backwards block rejected';
end;
$$;

-- ── Lock, change, react ───────────────────────────────────────────────────────────────────
do $$
declare
  ev text := (select v from t where k = 'ev');
  org text := (select v from t where k = 'org');
  l jsonb;
  d date := ((select public.get_event(ev)) -> 'event' -> 'dates' ->> 0)::date;
  st timestamptz := (d::timestamp at time zone 'America/Vancouver') + interval '10 hours';
begin
  l := public.lock_time(ev, org, st, st + interval '1 hour');
  assert (l ->> 'version')::int = 1, 'first lock is version 1';
  l := public.lock_time(ev, org, st + interval '1 hour', st + interval '2 hours');
  assert (l ->> 'version')::int = 2, 'changing the time bumps the version';
  assert (public.get_event(ev) -> 'lock' ->> 'start')::timestamptz = st + interval '1 hour', 'lock visible to everyone';

  assert public.toggle_reaction((select v from t where k = 'sam')::uuid, (select v from t where k = 'samTok'), '☕'), 'reaction on';
  assert jsonb_array_length(public.get_event(ev) -> 'reactions') = 1, 'reaction visible';
  assert not public.toggle_reaction((select v from t where k = 'sam')::uuid, (select v from t where k = 'samTok'), '☕'), 'reaction off';
  begin
    perform public.toggle_reaction((select v from t where k = 'sam')::uuid, (select v from t where k = 'samTok'), '💩');
    raise exception 'FAIL: arbitrary reaction accepted';
  exception when others then
    if sqlerrm not like 'invalid:%' then raise; end if;
  end;

  perform public.update_event(ev, org, '{"title": "Family call 🎉", "expectedCount": 3}');
  assert public.get_event(ev) -> 'event' ->> 'title' = 'Family call 🎉', 'organizer can rename';

  perform public.record_view(ev);
  perform public.unlock_time(ev, org);
  assert public.get_event(ev) -> 'lock' = 'null'::jsonb or public.get_event(ev) -> 'lock' is null, 'reopened';
end;
$$;

-- ── Leaving and removal ───────────────────────────────────────────────────────────────────
do $$
declare
  ev text := (select v from t where k = 'ev');
  ok boolean := false;
begin
  begin
    perform public.leave_event((select v from t where k = 'host')::uuid, (select v from t where k = 'hostTok'));
  exception when others then ok := sqlerrm like 'invalid:%';
  end;
  assert ok, 'organizer cannot just leave';
  perform public.leave_event((select v from t where k = 'tom')::uuid, (select v from t where k = 'tomTok'));
  perform public.remove_participant(ev, (select v from t where k = 'org'), (select v from t where k = 'sam')::uuid);
  assert jsonb_array_length(public.get_event(ev) -> 'participants') = 1, 'only the host remains';
  assert jsonb_array_length(public.get_event(ev) -> 'blocks') = 0, 'their availability went with them';
end;
$$;

-- ── Real-time pings carry no data ─────────────────────────────────────────────────────────
reset role;
do $$
declare
  ev text := (select v from t where k = 'ev');
begin
  assert (select count(*) from realtime.sent where topic = 'event:' || ev and event = 'changed') >= 8, 'writes notify the event channel';
  assert not exists (select 1 from realtime.sent where payload::text ~ '(Sam|Tom|token|start)'), 'pings carry no personal data';
  assert not exists (select 1 from realtime.sent where private), 'public broadcast topic';
  assert (select view_count from public.events where id = ev) = 1, 'view counted';
  assert not exists (select 1 from sunroll_private.rate_limits where key_hash = convert_to('203.0.113.7', 'UTF8')), 'raw IPs never stored';
  assert exists (select 1 from sunroll_private.rate_limits where key_hash = extensions.digest('203.0.113.7', 'sha256')), 'first forwarded IP is the key';
end;
$$;

-- ── Rate limiting ─────────────────────────────────────────────────────────────────────────
set request.headers = '{"x-forwarded-for": "198.51.100.9"}';
set role anon;
do $$
declare
  ok boolean := false;
  i int;
begin
  for i in 1..21 loop
    perform public.create_event(jsonb_build_object('title', 'Spam ' || i, 'timezone', 'UTC',
      'dates', jsonb_build_array(to_char(current_date + 1, 'YYYY-MM-DD')), 'windowStartMin', 540, 'windowEndMin', 600, 'durationMinutes', 60),
      jsonb_build_object('name', 'S', 'timezone', 'UTC'));
  end loop;
exception when others then
  assert sqlerrm like 'rate_limited:%', 'expected a rate limit, got ' || sqlerrm;
  ok := true;
  insert into t values ('ratelimited', 'yes');
end;
$$;
do $$ begin assert exists (select 1 from t where k = 'ratelimited'), 'the 21st event in an hour is refused'; end; $$;

-- ── Deletion cascades and retention ───────────────────────────────────────────────────────
do $$
declare
  ev text := (select v from t where k = 'ev');
begin
  perform public.delete_event(ev, (select v from t where k = 'org'));
  assert public.get_event(ev) is null, 'deleted';
end;
$$;
reset role;
do $$
begin
  assert not exists (select 1 from public.participants p left join public.events e on e.id = p.event_id where e.id is null), 'no orphans';
  update public.events set expires_at = now() - interval '1 minute' where title like 'Spam%';
  perform sunroll_private.purge_expired();
  assert not exists (select 1 from public.events where title like 'Spam%'), 'expired events purged';
  assert (select count(*) from sunroll_metrics.daily) >= 1, 'metrics view works';
end;
$$;

\echo 'SQL API tests passed'

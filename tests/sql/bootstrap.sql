-- Minimal stand-ins for what a Supabase project provides, so the real migrations can be
-- tested against plain Postgres. Not used in production.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase's default privileges grant everything in public to the API roles. Reproduce that,
-- so the tests prove our explicit revokes and RLS hold even under Supabase's defaults.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema if not exists realtime;
create table if not exists realtime.sent (topic text, event text, payload jsonb, private boolean, at timestamptz default clock_timestamp());
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language sql as $$
  insert into realtime.sent (topic, event, payload, private) values (topic, event, payload, private);
$$;
grant usage on schema realtime to anon, authenticated;

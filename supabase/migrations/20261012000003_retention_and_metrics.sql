-- Retention: events (and everything about them) are deleted 90 days after their last date.
-- Rate-limit rows are kept for a day.

create or replace function sunroll_private.purge_expired()
returns void
language sql
volatile
set search_path = ''
as $$
  delete from public.events where expires_at < now();
  delete from sunroll_private.rate_limits where window_start < now() - interval '1 day';
$$;
revoke all on function sunroll_private.purge_expired() from public;

-- pg_cron is available on every Supabase project. Elsewhere, schedule purge_expired() yourself.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'sunroll-purge-expired';
    perform cron.schedule('sunroll-purge-expired', '17 4 * * *', 'select sunroll_private.purge_expired()');
  else
    raise notice 'pg_cron not available: schedule sunroll_private.purge_expired() daily';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Growth-loop metrics. Private schema: readable from the SQL editor / service role only.
-- ---------------------------------------------------------------------------------------------
create schema if not exists sunroll_metrics;
revoke all on schema sunroll_metrics from public;

create or replace view sunroll_metrics.daily as
select
  date_trunc('day', e.created_at)::date as day,
  count(*) as events_created,
  round(avg(p.guests), 2) as guests_per_event,
  round(avg(p.responders::numeric / nullif(e.view_count, 0)), 3) as views_to_response,
  count(*) filter (where e.referred_by_event_id is not null) as events_from_guests,
  count(*) filter (where e.template_slug is not null) as events_from_templates,
  count(l.event_id) as events_locked,
  percentile_cont(0.5) within group (order by extract(epoch from l.locked_at - e.created_at) / 3600)
    filter (where l.event_id is not null) as median_hours_to_lock
from public.events e
left join lateral (
  select count(*) filter (where not is_organizer) as guests,
         count(*) filter (where responded_at is not null) as responders
  from public.participants where event_id = e.id
) p on true
left join public.locked_times l on l.event_id = e.id
group by 1
order by 1 desc;

-- Share of guests who went on to organize their own event ("plan your own").
create or replace view sunroll_metrics.guest_to_organizer as
select
  count(distinct src.id) as events_with_guests,
  count(distinct child.id) as events_started_by_guests,
  round(count(distinct child.id)::numeric / nullif((select count(*) from public.participants where not is_organizer), 0), 4)
    as guest_conversion
from public.events src
left join public.events child on child.referred_by_event_id = src.id;

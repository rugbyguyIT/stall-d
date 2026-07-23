-- ============================================================================
-- Stall'd — Migration 00009: events (the organizing concept)
--
-- A portal (rodeo company) runs EVENTS over time. The master console creates an
-- event with its dates and the animal types shown, then assigns the physical
-- stalls the event uses. Reservations attach to an event: the dates come from
-- the event (no free-typed check-in/out), and the stall is chosen from the
-- event's pool. Animals carry structured, species-appropriate vet data.
--
-- Also in the consolidated supabase/schema.sql; this is the incremental step.
-- ============================================================================

-- ---- events ----------------------------------------------------------------
create table if not exists public.events (
  id           uuid primary key default gen_random_uuid(),
  portal_id    uuid not null references public.portals (id) on delete cascade,
  name         text not null,
  start_date   date not null,
  end_date     date not null,                    -- inclusive last day
  animal_types text[] not null default '{}',     -- e.g. {Horses,Cattle}
  notes        text,
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists idx_events_portal on public.events (portal_id, start_date);

-- ---- event_stalls: the physical stalls an event uses -----------------------
-- Denormalized dates (from the event) power a no-overlap exclusion so a stall
-- can't belong to two events whose dates overlap.
create table if not exists public.event_stalls (
  event_id    uuid not null references public.events (id) on delete cascade,
  stall_id    uuid not null references public.stalls (id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  primary key (event_id, stall_id),
  exclude using gist (
    stall_id with =, daterange(start_date, end_date, '[]') with &&
  )
);
create index if not exists idx_event_stalls_event on public.event_stalls (event_id);

-- fill event_stalls dates from the parent event on insert
create or replace function public.fill_event_stall_dates()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.start_date is null or new.end_date is null then
    select start_date, end_date into new.start_date, new.end_date
    from public.events where id = new.event_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_fill_event_stalls on public.event_stalls;
create trigger trg_fill_event_stalls before insert on public.event_stalls
  for each row execute function public.fill_event_stall_dates();

-- keep event_stalls dates in sync if the event's dates change
create or replace function public.sync_event_stall_dates()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.event_stalls set start_date = new.start_date, end_date = new.end_date
    where event_id = new.id;
  return new;
end $$;
drop trigger if exists trg_sync_event_stalls on public.events;
create trigger trg_sync_event_stalls after update of start_date, end_date on public.events
  for each row execute function public.sync_event_stall_dates();

-- ---- reservations link to an event -----------------------------------------
alter table public.reservations add column if not exists event_id uuid references public.events (id) on delete set null;
create index if not exists idx_reservations_event on public.reservations (event_id);

-- ---- structured animal + vet data on the contestant record -----------------
alter table public.contestants add column if not exists species    text;
alter table public.contestants add column if not exists breed      text;
alter table public.contestants add column if not exists sex        text;
alter table public.contestants add column if not exists birth_year int;
alter table public.contestants add column if not exists color      text;
alter table public.contestants add column if not exists id_number  text;   -- registration / tag / microchip
alter table public.contestants add column if not exists vet_data   jsonb not null default '{}';

-- ---- reservation validity: event pool OR legacy allocation -----------------
create or replace function public.check_reservation_allocation()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_start date; v_end date;
begin
  if new.status = 'cancelled' then return new; end if;

  if new.event_id is not null then
    select start_date, end_date into v_start, v_end from public.events where id = new.event_id;
    if not exists (select 1 from public.event_stalls es
                   where es.event_id = new.event_id and es.stall_id = new.stall_id) then
      raise exception 'That stall is not part of this event''s stall pool'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- legacy (no event): date-window allocation
  if not exists (select 1 from public.stall_allocations a
                 where a.portal_id = new.portal_id and a.stall_id = new.stall_id
                   and a.start_date <= new.check_in and a.end_date >= new.check_out) then
    raise exception 'Stall is not allocated to this company for %..%', new.check_in, new.check_out
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ---- RLS -------------------------------------------------------------------
alter table public.events enable row level security;
alter table public.event_stalls enable row level security;

drop policy if exists "events: portal staff read" on public.events;
create policy "events: portal staff read" on public.events for select using (public.has_portal_access(portal_id));
drop policy if exists "events: master insert" on public.events;
create policy "events: master insert" on public.events for insert with check (public.is_master_admin());
drop policy if exists "events: master update" on public.events;
create policy "events: master update" on public.events for update using (public.is_master_admin()) with check (public.is_master_admin());
drop policy if exists "events: master delete" on public.events;
create policy "events: master delete" on public.events for delete using (public.is_master_admin());

drop policy if exists "event_stalls: portal staff read" on public.event_stalls;
create policy "event_stalls: portal staff read" on public.event_stalls for select using (
  exists (select 1 from public.events e where e.id = event_id and public.has_portal_access(e.portal_id)));
drop policy if exists "event_stalls: master write" on public.event_stalls;
create policy "event_stalls: master write" on public.event_stalls for insert with check (public.is_master_admin());
drop policy if exists "event_stalls: master delete" on public.event_stalls;
create policy "event_stalls: master delete" on public.event_stalls for delete using (public.is_master_admin());

-- ---- RPCs ------------------------------------------------------------------
-- Stalls free to add to an event (not already in another event overlapping its dates).
create or replace function public.event_assignable_stalls(p_event_id uuid)
returns table (stall_id uuid, name text, barn_id uuid, barn text, sort_order int, taken boolean, in_event boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, b.id, b.name, b.sort_order,
    exists (select 1 from public.event_stalls es join public.events e2 on e2.id = es.event_id
            where es.stall_id = s.id and es.event_id <> p_event_id
              and daterange(es.start_date, es.end_date, '[]')
                  && daterange((select start_date from public.events where id = p_event_id),
                               (select end_date from public.events where id = p_event_id), '[]')) as taken,
    exists (select 1 from public.event_stalls es where es.stall_id = s.id and es.event_id = p_event_id) as in_event
  from public.stalls s join public.barns b on b.id = s.barn_id
  order by b.sort_order, b.name, s.name
$$;
grant execute on function public.event_assignable_stalls to authenticated;

-- The board for one event: its stalls + current reservation state.
create or replace function public.event_stall_board(p_event_id uuid)
returns table (stall_id uuid, name text, barn text, nightly_rate numeric, state text,
  reservation_id uuid, contestant_id uuid, animal_name text, owner_name text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, b.name,
    round(s.nightly_rate * (1 + coalesce(pt.stall_markup_pct,0)/100.0), 2) as nightly_rate,
    case when s.is_blocked then 'blocked'
         when r.id is null then 'available'
         when r.status = 'checked_in' then 'checked_in' else 'reserved' end as state,
    r.id, c.id, r.animal_name, r.owner_name
  from public.event_stalls es
  join public.events e on e.id = es.event_id
  join public.stalls s on s.id = es.stall_id
  join public.barns  b on b.id = s.barn_id
  cross join (select stall_markup_pct from public.portals pp
              join public.events ev on ev.portal_id = pp.id where ev.id = p_event_id) pt
  left join lateral (select r.* from public.reservations r
    where r.event_id = p_event_id and r.stall_id = s.id and r.status <> 'cancelled'
    order by r.created_at limit 1) r on true
  left join lateral (select c.id from public.contestants c where c.reservation_id = r.id limit 1) c on true
  where es.event_id = p_event_id
  order by b.sort_order, b.name, s.name
$$;
grant execute on function public.event_stall_board to authenticated, anon;

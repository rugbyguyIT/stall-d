-- ============================================================================
-- Stall'd — Migration 00003: physical barns + stall allocations
--
-- Model shift: barns and stalls are the PROPERTY's physical infrastructure,
-- managed by the master (property) admin. Companies (portals) are *allocated*
-- an entire barn or a block of stalls for a date window ("time-bound per
-- event"). The same physical stall can serve different companies at different
-- times, but never two at once.
--
--   properties ─< barns ─< stalls
--   portals ─< stall_allocations >─ stalls        (portal↔stall, date-bound)
--   reservations reference a physical stall AND the portal that booked it,
--   and must fall inside one of that portal's allocations for that stall.
--
-- Safe to run after real data exists: existing per-portal stalls are migrated
-- into physical barns, and each one's current portal becomes an open-ended
-- allocation so nothing that already worked stops working.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Barns (property-level, master-managed, addable over time)
-- ----------------------------------------------------------------------------
create table public.barns (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties (id) on delete cascade,
  name         text not null,
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now(),
  unique (property_id, name)
);
create index idx_barns_property on public.barns (property_id);

-- ----------------------------------------------------------------------------
-- 2. Repoint stalls: portal_id  ->  barn_id (physical)
-- ----------------------------------------------------------------------------
alter table public.stalls add column barn_id uuid references public.barns (id) on delete cascade;

-- Migrate any existing per-portal stalls into physical barns under the
-- portal's property, preserving the old "barn" text label.
do $$
declare
  r      record;
  v_barn uuid;
begin
  for r in
    select s.id, s.barn, s.available_from, s.available_to, s.portal_id, p.property_id
    from public.stalls s
    join public.portals p on p.id = s.portal_id
  loop
    select id into v_barn
    from public.barns
    where property_id = r.property_id and name = coalesce(r.barn, 'Barn A');

    if v_barn is null then
      insert into public.barns (property_id, name)
      values (r.property_id, coalesce(r.barn, 'Barn A'))
      returning id into v_barn;
    end if;

    update public.stalls set barn_id = v_barn where id = r.id;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Allocations (portal ↔ stall, date-bound, no double-allocation)
-- ----------------------------------------------------------------------------
create table public.stall_allocations (
  id          uuid primary key default gen_random_uuid(),
  portal_id   uuid not null references public.portals (id) on delete cascade,
  stall_id    uuid not null references public.stalls (id) on delete cascade,
  start_date  date not null,
  end_date    date not null,             -- exclusive: usable for nights start..end-1
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  check (end_date > start_date),
  -- A physical stall may belong to only ONE company at a time.
  exclude using gist (
    stall_id with =,
    daterange(start_date, end_date, '[)') with &&
  )
);
create index idx_alloc_portal on public.stall_allocations (portal_id, start_date);
create index idx_alloc_stall  on public.stall_allocations (stall_id);

-- Preserve current assignments: each existing stall's owning portal becomes an
-- allocation spanning the stall's old availability window (or a year default).
insert into public.stall_allocations (portal_id, stall_id, start_date, end_date)
select s.portal_id, s.id,
       coalesce(s.available_from, current_date),
       coalesce(s.available_to, (current_date + interval '1 year')::date)
from public.stalls s
where s.portal_id is not null;

-- ----------------------------------------------------------------------------
-- 4. Drop the old per-portal columns/constraints on stalls
--    (first drop every policy that references stalls.portal_id, or the column
--    drop is blocked by dependency).
-- ----------------------------------------------------------------------------
drop policy if exists "stalls: admins write"  on public.stalls;
drop policy if exists "stalls: admins update" on public.stalls;
drop policy if exists "stalls: admins delete" on public.stalls;
drop policy if exists "reservations: signed-in users create (RSVP) in the right portal"
  on public.reservations;

drop index if exists idx_stalls_portal;
alter table public.stalls drop constraint if exists stalls_portal_id_name_key;   -- unique(portal_id,name)
alter table public.stalls drop column if exists portal_id;
alter table public.stalls drop column if exists available_from;
alter table public.stalls drop column if exists available_to;
alter table public.stalls alter column barn_id set not null;
alter table public.stalls add constraint stalls_barn_name_key unique (barn_id, name);
create index idx_stalls_barn on public.stalls (barn_id);

-- ----------------------------------------------------------------------------
-- 5. Enforce: a reservation must sit inside one of its portal's allocations
--    for that physical stall. (Belt-and-suspenders with the RLS insert check.)
-- ----------------------------------------------------------------------------
create or replace function public.check_reservation_allocation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' then
    return new;
  end if;
  if not exists (
    select 1 from public.stall_allocations a
    where a.portal_id = new.portal_id
      and a.stall_id  = new.stall_id
      and a.start_date <= new.check_in
      and a.end_date   >= new.check_out
  ) then
    raise exception
      'Stall is not allocated to this company for %..%', new.check_in, new.check_out
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_reservation_allocation
  before insert or update on public.reservations
  for each row execute function public.check_reservation_allocation();

-- ----------------------------------------------------------------------------
-- 6. RLS for the new tables + repointed stall policies
-- ----------------------------------------------------------------------------
alter table public.barns enable row level security;
alter table public.stall_allocations enable row level security;

-- barns: public read (names aren't sensitive; needed by the board); master writes.
create policy "barns: public read" on public.barns for select using (true);
create policy "barns: master insert" on public.barns
  for insert with check (public.is_master_admin());
create policy "barns: master update" on public.barns
  for update using (public.is_master_admin()) with check (public.is_master_admin());
create policy "barns: master delete" on public.barns
  for delete using (public.is_master_admin());

-- stalls: physical infra is now master-managed. (Old portal-admin policies were
-- dropped in section 4 before the portal_id column went away.)
create policy "stalls: master insert" on public.stalls
  for insert with check (public.is_master_admin());
create policy "stalls: master update" on public.stalls
  for update using (public.is_master_admin()) with check (public.is_master_admin());
create policy "stalls: master delete" on public.stalls
  for delete using (public.is_master_admin());
-- ("stalls: public read" from 00001 stays — contestants need availability.)

-- allocations: staff of the portal (or master) can read; only master assigns.
create policy "allocations: portal staff or master read" on public.stall_allocations
  for select using (public.has_portal_access(portal_id));
create policy "allocations: master insert" on public.stall_allocations
  for insert with check (public.is_master_admin());
create policy "allocations: master update" on public.stall_allocations
  for update using (public.is_master_admin()) with check (public.is_master_admin());
create policy "allocations: master delete" on public.stall_allocations
  for delete using (public.is_master_admin());

-- reservations INSERT policy referenced stalls.portal_id (dropped in section 4).
-- Replace it with an allocation check.
create policy "reservations: create within an allocation"
  on public.reservations for insert with check (
    auth.uid() is not null
    and created_by = auth.uid()
    and exists (
      select 1 from public.stall_allocations a
      where a.portal_id = reservations.portal_id
        and a.stall_id  = reservations.stall_id
        and a.start_date <= reservations.check_in
        and a.end_date   >= reservations.check_out
    )
  );

-- ----------------------------------------------------------------------------
-- 7. Allocation-aware RPCs (same signatures — the app's board/form are unchanged)
-- ----------------------------------------------------------------------------
create or replace function public.stall_board(p_portal_id uuid, p_from date, p_to date)
returns table (
  stall_id uuid, name text, barn text, is_blocked boolean, nightly_rate numeric,
  state text, reservation_id uuid, animal_name text, owner_name text
)
language sql stable security definer set search_path = public
as $$
  -- Only stalls ALLOCATED to this portal for the date window appear. State is
  -- computed against all reservations on the physical stall (facility-wide, so
  -- no cross-company double-booking); names masked for non-staff callers.
  select
    s.id, s.name, b.name as barn, s.is_blocked, s.nightly_rate,
    case
      when s.is_blocked then 'blocked'
      when r.id is null then 'available'
      when r.status = 'checked_in' then 'checked_in'
      else 'reserved'
    end as state,
    case when public.is_portal_admin(p_portal_id) then r.id end,
    case when public.is_portal_admin(p_portal_id) then r.animal_name end,
    case when public.is_portal_admin(p_portal_id) then r.owner_name end
  from public.stall_allocations a
  join public.stalls s on s.id = a.stall_id
  join public.barns  b on b.id = s.barn_id
  left join lateral (
    select r.* from public.reservations r
    where r.stall_id = s.id
      and r.status <> 'cancelled'
      and daterange(r.check_in, r.check_out, '[)') && daterange(p_from, p_to, '[)')
    order by r.check_in limit 1
  ) r on true
  where a.portal_id = p_portal_id
    and daterange(a.start_date, a.end_date, '[)') && daterange(p_from, p_to, '[)')
  order by b.sort_order, b.name, s.name
$$;
grant execute on function public.stall_board to authenticated, anon;

create or replace function public.display_board(
  p_slug text, p_key uuid, p_from date default null, p_to date default null
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_portal public.portals%rowtype;
  v_from   date := coalesce(p_from, current_date);
  v_to     date := coalesce(p_to, current_date + 1);
  v_board  jsonb;
  v_res    jsonb;
begin
  select p.* into v_portal
  from public.portals p
  join public.portal_display_keys k on k.portal_id = p.id
  where p.slug = p_slug and k.key = p_key and p.is_active;

  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'stall_id', s.id, 'name', s.name, 'barn', b.name,
      'state', case
        when s.is_blocked then 'blocked'
        when r.id is null then 'available'
        when r.status = 'checked_in' then 'checked_in'
        else 'reserved' end,
      'animal_name', r.animal_name, 'owner_name', r.owner_name
    ) order by b.sort_order, b.name, s.name), '[]'::jsonb)
  into v_board
  from public.stall_allocations a
  join public.stalls s on s.id = a.stall_id
  join public.barns  b on b.id = s.barn_id
  left join lateral (
    select r.* from public.reservations r
    where r.stall_id = s.id and r.status <> 'cancelled'
      and daterange(r.check_in, r.check_out, '[)') && daterange(v_from, v_to, '[)')
    order by r.check_in limit 1
  ) r on true
  where a.portal_id = v_portal.id
    and daterange(a.start_date, a.end_date, '[)') && daterange(v_from, v_to, '[)');

  select coalesce(jsonb_agg(jsonb_build_object(
      'animal_name', r.animal_name, 'owner_name', r.owner_name,
      'stall', s.name, 'barn', b.name,
      'check_in', r.check_in, 'check_out', r.check_out, 'status', r.status
    ) order by r.check_in, s.name), '[]'::jsonb)
  into v_res
  from public.reservations r
  join public.stalls s on s.id = r.stall_id
  join public.barns  b on b.id = s.barn_id
  where r.portal_id = v_portal.id and r.status <> 'cancelled'
    and r.check_out >= v_from and r.check_in <= v_to + 7;

  return jsonb_build_object(
    'portal', jsonb_build_object(
      'name', v_portal.name, 'slug', v_portal.slug,
      'accent_color', v_portal.accent_color, 'logo_letter', v_portal.logo_letter),
    'generated_at', now(),
    'from', v_from, 'to', v_to,
    'stalls', v_board,
    'reservations', v_res
  );
end;
$$;
grant execute on function public.display_board to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8. Convenience: which stalls are free to allocate to a portal for a window
--    (used by the assign-stalls UI — excludes stalls already allocated to any
--    company on overlapping dates).
-- ----------------------------------------------------------------------------
create or replace function public.assignable_stalls(p_from date, p_to date)
returns table (stall_id uuid, name text, barn_id uuid, barn text, sort_order int, taken boolean)
language sql stable security definer set search_path = public
as $$
  select s.id, s.name, b.id, b.name, b.sort_order,
         exists (
           select 1 from public.stall_allocations a
           where a.stall_id = s.id
             and daterange(a.start_date, a.end_date, '[)') && daterange(p_from, p_to, '[)')
         ) as taken
  from public.stalls s
  join public.barns b on b.id = s.barn_id
  order by b.sort_order, b.name, s.name
$$;
grant execute on function public.assignable_stalls to authenticated;

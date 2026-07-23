-- ============================================================================
-- Stall'd — Migration 00004: configurable add-ons
--
-- Replaces the hardcoded stall_mat / shavings booleans (and their hardcoded
-- $15 / $18 prices in the app) with a master-managed catalog. The property
-- admin defines add-ons and their prices in the master console and can add new
-- ones anytime; each reservation records which add-ons it took, snapshotting
-- the price so later price changes don't rewrite past reservations.
--
--   properties ─< add_ons                          (the catalog)
--   reservations ─< reservation_addons >─ add_ons  (what each booking took)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Add-on catalog (property-level, master-managed)
-- ----------------------------------------------------------------------------
create table public.add_ons (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties (id) on delete cascade,
  name         text not null,
  description  text,
  price        numeric(8,2) not null default 0 check (price >= 0),
  is_active    boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  unique (property_id, name)
);
create index idx_addons_property on public.add_ons (property_id);

-- ----------------------------------------------------------------------------
-- 2. Which add-ons each reservation took (price snapshotted at booking)
-- ----------------------------------------------------------------------------
create table public.reservation_addons (
  reservation_id   uuid not null references public.reservations (id) on delete cascade,
  add_on_id        uuid not null references public.add_ons (id) on delete restrict,
  price_at_booking numeric(8,2) not null default 0,
  primary key (reservation_id, add_on_id)
);
create index idx_res_addons_res on public.reservation_addons (reservation_id);

-- ----------------------------------------------------------------------------
-- 3. Seed the two existing add-ons per property, then migrate the booleans
-- ----------------------------------------------------------------------------
insert into public.add_ons (property_id, name, description, price, sort_order)
select id, 'Stall mat',  '4'||chr(8242)||chr(215)||'6'||chr(8242)||' rubber mat installed before check-in.', 15.00, 1 from public.properties
union all
select id, 'Shavings', 'Two bags of pine shavings, restocked on request.', 18.00, 2 from public.properties;

-- Existing reservations that had the booleans set → junction rows.
insert into public.reservation_addons (reservation_id, add_on_id, price_at_booking)
select r.id, a.id, a.price
from public.reservations r
join public.portals p  on p.id = r.portal_id
join public.add_ons a  on a.property_id = p.property_id and a.name = 'Stall mat'
where r.stall_mat;

insert into public.reservation_addons (reservation_id, add_on_id, price_at_booking)
select r.id, a.id, a.price
from public.reservations r
join public.portals p  on p.id = r.portal_id
join public.add_ons a  on a.property_id = p.property_id and a.name = 'Shavings'
where r.shavings;

-- ----------------------------------------------------------------------------
-- 4. Drop the hardcoded boolean columns
-- ----------------------------------------------------------------------------
alter table public.reservations drop column if exists stall_mat;
alter table public.reservations drop column if exists shavings;

-- ----------------------------------------------------------------------------
-- 5. RLS
-- ----------------------------------------------------------------------------
alter table public.add_ons enable row level security;
alter table public.reservation_addons enable row level security;

-- Catalog: readable by any signed-in user (the reservation form needs it);
-- only master admin manages it.
create policy "add_ons: read for authenticated" on public.add_ons
  for select using (auth.role() = 'authenticated');
create policy "add_ons: master insert" on public.add_ons
  for insert with check (public.is_master_admin());
create policy "add_ons: master update" on public.add_ons
  for update using (public.is_master_admin()) with check (public.is_master_admin());
create policy "add_ons: master delete" on public.add_ons
  for delete using (public.is_master_admin());

-- Junction: visible to anyone who can see the parent reservation; writable by
-- the reservation's creator or portal staff (mirrors reservation permissions).
create or replace function public.can_touch_reservation(p_reservation_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.reservations r
    where r.id = p_reservation_id
      and (public.is_portal_admin(r.portal_id) or r.created_by = auth.uid())
  )
$$;
grant execute on function public.can_touch_reservation to authenticated;

create policy "reservation_addons: read via reservation" on public.reservation_addons
  for select using (
    exists (select 1 from public.reservations r
            where r.id = reservation_id
              and (public.is_portal_admin(r.portal_id) or r.created_by = auth.uid()))
  );
create policy "reservation_addons: write via reservation" on public.reservation_addons
  for insert with check (public.can_touch_reservation(reservation_id));
create policy "reservation_addons: delete via reservation" on public.reservation_addons
  for delete using (public.can_touch_reservation(reservation_id));

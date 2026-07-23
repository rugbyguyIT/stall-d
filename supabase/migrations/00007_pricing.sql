-- ============================================================================
-- Stall'd — Migration 00007: three-layer pricing
--
--  Layer 1 (master):  base prices — stalls.nightly_rate (per stall) and
--                     add_ons.price (per add-on). Editable in the console.
--  Layer 2 (portal):  each company marks those up — a % markup on stall rates
--                     and its own price for each add-on (mats, shavings, …).
--  Layer 3 (booking): every reservation snapshots the price it was made at, so
--                     later price/markup changes never rewrite past bookings.
-- ============================================================================

-- Portal-level stall markup (percentage on the base nightly rate).
alter table public.portals
  add column if not exists stall_markup_pct numeric(6,2) not null default 0
  check (stall_markup_pct >= 0 and stall_markup_pct <= 1000);

-- Per-portal price override for an add-on (absent = use the base catalog price).
create table public.portal_addon_prices (
  portal_id  uuid not null references public.portals (id) on delete cascade,
  add_on_id  uuid not null references public.add_ons (id) on delete cascade,
  price      numeric(8,2) not null check (price >= 0),
  primary key (portal_id, add_on_id)
);

-- Snapshot the (marked-up) nightly stall rate at booking time.
alter table public.reservations add column if not exists stall_rate numeric(8,2);

alter table public.portal_addon_prices enable row level security;
create policy "portal_addon_prices: portal staff read" on public.portal_addon_prices
  for select using (public.has_portal_access(portal_id));
create policy "portal_addon_prices: portal admin write" on public.portal_addon_prices
  for insert with check (public.is_portal_admin(portal_id));
create policy "portal_addon_prices: portal admin update" on public.portal_addon_prices
  for update using (public.is_portal_admin(portal_id)) with check (public.is_portal_admin(portal_id));
create policy "portal_addon_prices: portal admin delete" on public.portal_addon_prices
  for delete using (public.is_portal_admin(portal_id));

-- Portal admins set their own stall markup without being able to touch other
-- portal columns (branding stays master-only). SECURITY DEFINER + auth check.
create or replace function public.set_portal_stall_markup(p_portal_id uuid, p_pct numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_portal_admin(p_portal_id) then
    raise exception 'not authorized';
  end if;
  if p_pct < 0 or p_pct > 1000 then
    raise exception 'markup must be between 0 and 1000 percent';
  end if;
  update public.portals set stall_markup_pct = p_pct where id = p_portal_id;
end $$;
grant execute on function public.set_portal_stall_markup to authenticated;

-- ----------------------------------------------------------------------------
-- stall_board now returns the portal-EFFECTIVE nightly rate (base × markup),
-- so the board and reservation form show the company's price directly.
-- ----------------------------------------------------------------------------
create or replace function public.stall_board(p_portal_id uuid, p_from date, p_to date)
returns table (
  stall_id uuid, name text, barn text, is_blocked boolean, nightly_rate numeric,
  state text, reservation_id uuid, animal_name text, owner_name text
)
language sql stable security definer set search_path = public
as $$
  select
    s.id, s.name, b.name as barn, s.is_blocked,
    round(s.nightly_rate * (1 + coalesce(pt.stall_markup_pct, 0) / 100.0), 2) as nightly_rate,
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
  cross join (select stall_markup_pct from public.portals where id = p_portal_id) pt
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

-- Effective add-on prices for a portal (base overlaid with the portal's override).
create or replace function public.portal_addons(p_portal_id uuid)
returns table (id uuid, name text, description text, base_price numeric, price numeric, is_active boolean, sort_order int)
language sql stable security definer set search_path = public
as $$
  select a.id, a.name, a.description, a.price as base_price,
         coalesce(pap.price, a.price) as price, a.is_active, a.sort_order
  from public.add_ons a
  left join public.portal_addon_prices pap
    on pap.add_on_id = a.id and pap.portal_id = p_portal_id
  order by a.sort_order
$$;
grant execute on function public.portal_addons to authenticated, anon;

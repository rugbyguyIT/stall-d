-- ============================================================================
-- StallSide — Migration 00002: TV display boards
--
-- A TV in the rodeo office needs staff-level data (animal + owner names on
-- the stall map) without anyone staying signed in on the TV. Solution: each
-- portal gets a secret display key. The TV loads
--   /portal/<slug>/display?key=<uuid>
-- and the display_board() RPC returns full board data only when slug+key
-- match. Rotating the key instantly revokes every screen using the old URL.
--
-- The key lives in its own table (NOT a column on portals) because portals
-- are public-read for the login switcher — a column there would leak.
-- ============================================================================

create table public.portal_display_keys (
  portal_id   uuid primary key references public.portals (id) on delete cascade,
  key         uuid not null default gen_random_uuid(),
  rotated_at  timestamptz not null default now()
);

alter table public.portal_display_keys enable row level security;

-- Only portal staff (or master) may see or rotate a portal's display key.
create policy "display_keys: staff read" on public.portal_display_keys
  for select using (public.is_portal_admin(portal_id));
create policy "display_keys: staff rotate" on public.portal_display_keys
  for update using (public.is_portal_admin(portal_id))
  with check (public.is_portal_admin(portal_id));
create policy "display_keys: staff insert" on public.portal_display_keys
  for insert with check (public.is_portal_admin(portal_id));

-- Every portal gets a key automatically.
create or replace function public.handle_new_portal_display_key()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.portal_display_keys (portal_id) values (new.id)
  on conflict (portal_id) do nothing;
  return new;
end; $$;

create trigger on_portal_created_display_key
  after insert on public.portals
  for each row execute function public.handle_new_portal_display_key();

-- Backfill portals created before this migration.
insert into public.portal_display_keys (portal_id)
select id from public.portals
on conflict (portal_id) do nothing;

-- Rotate helper (staff only; RLS on the table also enforces this).
create or replace function public.rotate_display_key(p_portal_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_key uuid;
begin
  if not public.is_portal_admin(p_portal_id) then
    raise exception 'not authorized';
  end if;
  update public.portal_display_keys
     set key = gen_random_uuid(), rotated_at = now()
   where portal_id = p_portal_id
   returning key into new_key;
  return new_key;
end; $$;
grant execute on function public.rotate_display_key to authenticated;

-- ----------------------------------------------------------------------------
-- display_board: everything the TV needs in one call.
-- SECURITY DEFINER + key check — callable by anon, but useless without the key.
-- ----------------------------------------------------------------------------
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
    return null;  -- wrong slug or key: reveal nothing
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'stall_id', s.id, 'name', s.name, 'barn', s.barn,
      'state', case
        when s.is_blocked then 'blocked'
        when s.available_from is not null and v_from < s.available_from then 'blocked'
        when s.available_to   is not null and v_to   > s.available_to   then 'blocked'
        when r.id is null then 'available'
        when r.status = 'checked_in' then 'checked_in'
        else 'reserved' end,
      'animal_name', r.animal_name, 'owner_name', r.owner_name
    ) order by s.barn nulls last, s.name), '[]'::jsonb)
  into v_board
  from public.stalls s
  left join lateral (
    select r.* from public.reservations r
    where r.stall_id = s.id and r.status <> 'cancelled'
      and daterange(r.check_in, r.check_out, '[)') && daterange(v_from, v_to, '[)')
    order by r.check_in limit 1
  ) r on true
  where s.portal_id = v_portal.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'animal_name', r.animal_name, 'owner_name', r.owner_name,
      'stall', s.name, 'barn', s.barn,
      'check_in', r.check_in, 'check_out', r.check_out, 'status', r.status
    ) order by r.check_in, s.name), '[]'::jsonb)
  into v_res
  from public.reservations r
  join public.stalls s on s.id = r.stall_id
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

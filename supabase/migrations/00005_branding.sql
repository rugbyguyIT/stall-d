-- ============================================================================
-- Stall'd — Migration 00005: per-portal branding (color scheme + logo)
--
-- Each portal already carries an accent_color. This adds a named color scheme
-- (one of 7 presets, chosen in the master console) and an uploaded logo. The
-- logo lives in a PUBLIC storage bucket so it can render on the portal, the
-- reservation flow, and the (sign-in-free) TV display without a signed URL.
-- ============================================================================

alter table public.portals add column if not exists theme     text;
alter table public.portals add column if not exists logo_path  text;   -- portal-logos/<portal_id>/<file>

-- ----------------------------------------------------------------------------
-- Public bucket for portal logos (public read; master-only writes)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'portal-logos', 'portal-logos', true, 2097152,
  array['image/png','image/jpeg','image/webp','image/svg+xml']
)
on conflict (id) do nothing;

create policy "portal-logos: public read"
  on storage.objects for select using (bucket_id = 'portal-logos');
create policy "portal-logos: master insert"
  on storage.objects for insert with check (bucket_id = 'portal-logos' and public.is_master_admin());
create policy "portal-logos: master update"
  on storage.objects for update using (bucket_id = 'portal-logos' and public.is_master_admin());
create policy "portal-logos: master delete"
  on storage.objects for delete using (bucket_id = 'portal-logos' and public.is_master_admin());

-- ----------------------------------------------------------------------------
-- display_board: include logo_path so the TV can render the portal's logo.
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
      'accent_color', v_portal.accent_color, 'logo_letter', v_portal.logo_letter,
      'logo_path', v_portal.logo_path, 'theme', v_portal.theme),
    'generated_at', now(),
    'from', v_from, 'to', v_to,
    'stalls', v_board,
    'reservations', v_res
  );
end;
$$;
grant execute on function public.display_board to anon, authenticated;

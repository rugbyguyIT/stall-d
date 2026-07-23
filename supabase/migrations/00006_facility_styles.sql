-- ============================================================================
-- Stall'd — Migration 00006: facility branding + theme styles
--
-- Two things:
--  1. The property (master console + login page) gets its own logo and name,
--     just like portals do — brandable by the property admin.
--  2. A "theme style" (visual skin) that reskins the whole UI beyond the accent
--     color: minimalist (default), western, high-contrast, gray-blue. Set per
--     portal, and on the property for the master console / login.
--
-- The style is a separate axis from the accent color scheme: a portal can be
-- Western-styled with a Saddle Brown accent, or Gray-Blue with Classic Blue.
-- ============================================================================

alter table public.properties add column if not exists logo_path text;
alter table public.properties add column if not exists style     text not null default 'minimalist';
alter table public.portals    add column if not exists style     text not null default 'minimalist';

-- ----------------------------------------------------------------------------
-- Public branding for the login page (anon, pre-auth) and master console.
-- Exposes only name/logo/style — not owner_id or address.
-- ----------------------------------------------------------------------------
create or replace function public.facility_branding()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', id, 'name', name,
    'logo_path', logo_path,
    'style', coalesce(style, 'minimalist')
  )
  from public.properties
  order by created_at
  limit 1
$$;
grant execute on function public.facility_branding to anon, authenticated;

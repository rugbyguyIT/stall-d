-- ============================================================================
-- Stall'd — Migration 00008: portal archive
--
-- Disable (is_active=false) hides a portal from the login switcher but keeps it
-- in the master console. Archive moves it out of the active list entirely
-- (data preserved, reversible). Archived portals are hidden from public/login.
--
-- Note: the consolidated supabase/schema.sql already includes this. Use that
-- for a one-shot, order-independent setup; this file is the incremental step
-- for databases tracking numbered migrations.
-- ============================================================================

alter table public.portals add column if not exists archived_at timestamptz;
create index if not exists idx_portals_archived on public.portals (archived_at);

-- Hide archived (and disabled) portals from anon/login; members/master still see them.
drop policy if exists "portals: public read of active portals" on public.portals;
create policy "portals: public read of active portals" on public.portals
  for select using ((is_active and archived_at is null) or public.has_portal_access(id));

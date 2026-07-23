-- ============================================================================
-- Stall'd — Migration 00010: user administration
--
-- Adds a "force a password change at next login" flag to profiles. Masters set
-- it from the People & roles screen (or when they reset a password); the app
-- gates the user into a "set a new password" screen on their next visit and
-- clears the flag once they've chosen one.
--
-- Role changes are already permitted for masters by the profiles RLS policy, so
-- no new policy is needed — a master can update any profile's role or this flag.
-- Actually resetting another user's password requires the service role and is
-- done by the netlify/functions/admin-user function, never from the browser.
-- ============================================================================

alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

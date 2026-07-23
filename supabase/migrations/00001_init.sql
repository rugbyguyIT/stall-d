-- ============================================================================
-- StallSide — rodeo stall reservation platform
-- Migration 00001: schema, roles, RLS, storage, JWT claims hook
-- Target: Supabase (Postgres 15+)
-- ============================================================================

create extension if not exists btree_gist;   -- for no-double-booking exclusion
create extension if not exists "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. Roles
-- ----------------------------------------------------------------------------
create type public.app_role as enum ('master_admin', 'portal_admin', 'contestant');
create type public.reservation_status as enum ('confirmed', 'checked_in', 'cancelled');

-- ----------------------------------------------------------------------------
-- 2. Profiles (mirror of auth.users, carries the app role)
-- ----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  role        public.app_role not null default 'contestant',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Auto-create a profile when an auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce((new.raw_user_meta_data ->> 'role')::public.app_role, 'contestant')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 3. Core tables
-- ----------------------------------------------------------------------------
create table public.properties (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text,
  owner_id    uuid not null references public.profiles (id),
  created_at  timestamptz not null default now()
);

create table public.portals (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties (id) on delete cascade,
  name          text not null,
  slug          text not null unique
                check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  accent_color  text not null default '#2a78d6',
  logo_letter   text generated always as (upper(left(name, 1))) stored,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.portal_users (
  portal_id   uuid not null references public.portals (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  is_owner    boolean not null default false,   -- "portal admin · owner" badge
  created_at  timestamptz not null default now(),
  primary key (portal_id, user_id)
);

create table public.stalls (
  id              uuid primary key default gen_random_uuid(),
  portal_id       uuid not null references public.portals (id) on delete cascade,
  name            text not null,               -- e.g. "A4"
  barn            text,                        -- e.g. "Barn A"
  available_from  date,
  available_to    date,
  is_blocked      boolean not null default false,
  nightly_rate    numeric(8,2) not null default 35.00,
  created_at      timestamptz not null default now(),
  unique (portal_id, name),
  check (available_to is null or available_from is null or available_to >= available_from)
);

create table public.reservations (
  id            uuid primary key default gen_random_uuid(),
  portal_id     uuid not null references public.portals (id) on delete cascade,
  stall_id      uuid not null references public.stalls (id) on delete restrict,
  animal_name   text not null,
  owner_name    text not null,
  check_in      date not null,
  check_out     date not null,
  stall_mat     boolean not null default false,
  shavings      boolean not null default false,
  status        public.reservation_status not null default 'confirmed',
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (check_out > check_in),
  -- No double booking: two non-cancelled reservations may not overlap on a stall.
  exclude using gist (
    stall_id with =,
    daterange(check_in, check_out, '[)') with &&
  ) where (status <> 'cancelled')
);

create table public.contestants (
  id              uuid primary key default gen_random_uuid(),
  reservation_id  uuid not null references public.reservations (id) on delete cascade,
  user_id         uuid references public.profiles (id),  -- set when contestant has an account
  name            text not null,
  email           text,
  phone           text,
  notes           text,
  created_at      timestamptz not null default now()
);

create table public.vet_records (
  id             uuid primary key default gen_random_uuid(),
  contestant_id  uuid not null references public.contestants (id) on delete cascade,
  filename       text not null,
  storage_path   text not null unique,   -- vet-records/<portal_id>/<contestant_id>/<uuid>-<filename>
  mime_type      text not null check (
                   mime_type in ('application/pdf','image/jpeg','image/png','image/webp','image/heic')
                 ),
  size_bytes     bigint not null check (size_bytes > 0 and size_bytes <= 20 * 1024 * 1024),
  uploaded_by    uuid references public.profiles (id),
  uploaded_at    timestamptz not null default now()
);

create index idx_portals_slug          on public.portals (slug);
create index idx_stalls_portal         on public.stalls (portal_id);
create index idx_reservations_portal   on public.reservations (portal_id, check_in);
create index idx_reservations_stall    on public.reservations (stall_id);
create index idx_contestants_res       on public.contestants (reservation_id);
create index idx_vet_records_cont      on public.vet_records (contestant_id);
create index idx_portal_users_user     on public.portal_users (user_id);

-- updated_at maintenance
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger trg_touch_reservations before update on public.reservations
  for each row execute function public.touch_updated_at();
create trigger trg_touch_profiles before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 4. JWT custom claims — role + portal_ids ride in the access token.
--    Enable in Dashboard: Authentication → Hooks → Custom Access Token,
--    pointing at public.custom_access_token_hook.
-- ----------------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  claims     jsonb;
  user_role  public.app_role;
  portal_ids jsonb;
begin
  select role into user_role from public.profiles where id = (event ->> 'user_id')::uuid;

  select coalesce(jsonb_agg(portal_id), '[]'::jsonb) into portal_ids
  from public.portal_users where user_id = (event ->> 'user_id')::uuid;

  claims := coalesce(event -> 'claims', '{}'::jsonb);
  claims := jsonb_set(claims, '{app_role}',   to_jsonb(coalesce(user_role::text, 'contestant')));
  claims := jsonb_set(claims, '{portal_ids}', portal_ids);

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

-- ----------------------------------------------------------------------------
-- 5. RLS helper functions.
--    They read the JWT claims first (fast, no table hit) and fall back to the
--    tables so freshly-granted access works before the next token refresh.
--    SECURITY DEFINER so the fallback lookups aren't themselves blocked by RLS.
-- ----------------------------------------------------------------------------
create or replace function public.is_master_admin()
returns boolean language plpgsql stable security definer set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'app_role', '') = 'master_admin' then
    return true;
  end if;
  return exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'master_admin'
  );
end;
$$;

create or replace function public.has_portal_access(p_portal_id uuid)
returns boolean language plpgsql stable security definer set search_path = public
as $$
begin
  if public.is_master_admin() then
    return true;
  end if;
  if (auth.jwt() -> 'portal_ids') ? p_portal_id::text then
    return true;
  end if;
  return exists (
    select 1 from public.portal_users
    where portal_id = p_portal_id and user_id = auth.uid()
  );
end;
$$;

-- Portal admins (not contestants) with access to this portal.
create or replace function public.is_portal_admin(p_portal_id uuid)
returns boolean language plpgsql stable security definer set search_path = public
as $$
begin
  if public.is_master_admin() then
    return true;
  end if;
  return exists (
    select 1
    from public.portal_users pu
    join public.profiles pr on pr.id = pu.user_id
    where pu.portal_id = p_portal_id
      and pu.user_id = auth.uid()
      and pr.role = 'portal_admin'
  );
end;
$$;

grant execute on function public.is_master_admin, public.has_portal_access, public.is_portal_admin
  to authenticated, anon;

-- ----------------------------------------------------------------------------
-- 6. Row Level Security
--    Note: "master admin bypasses RLS" is implemented as an explicit
--    is_master_admin() OR-branch on every policy — Postgres has no per-user
--    bypass for the `authenticated` role, and the service_role key (server
--    only) bypasses RLS outright.
-- ----------------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.properties   enable row level security;
alter table public.portals      enable row level security;
alter table public.portal_users enable row level security;
alter table public.stalls       enable row level security;
alter table public.reservations enable row level security;
alter table public.contestants  enable row level security;
alter table public.vet_records  enable row level security;

-- profiles ------------------------------------------------------------------
create policy "profiles: read own or master or shared-portal admin"
  on public.profiles for select using (
    id = auth.uid()
    or public.is_master_admin()
    or exists (                       -- portal admins can see members of their portals
      select 1 from public.portal_users a
      join public.portal_users b on a.portal_id = b.portal_id
      where a.user_id = auth.uid() and b.user_id = profiles.id
    )
  );
create policy "profiles: update own" on public.profiles for update
  using (id = auth.uid() or public.is_master_admin())
  with check (
    id = auth.uid() and role = (select role from public.profiles p2 where p2.id = auth.uid())
    or public.is_master_admin()      -- only master can change roles
  );

-- properties ----------------------------------------------------------------
create policy "properties: master full access" on public.properties
  for all using (public.is_master_admin()) with check (public.is_master_admin());
create policy "properties: readable by any signed-in user" on public.properties
  for select using (auth.role() = 'authenticated');

-- portals -------------------------------------------------------------------
-- Public read: the login screen's portal switcher and /portal/[slug] resolution
-- need name/slug/accent before auth. Only master admin can write.
create policy "portals: public read of active portals" on public.portals
  for select using (is_active or public.has_portal_access(id));
create policy "portals: master insert" on public.portals
  for insert with check (public.is_master_admin());
create policy "portals: master update" on public.portals
  for update using (public.is_master_admin()) with check (public.is_master_admin());
create policy "portals: master delete" on public.portals
  for delete using (public.is_master_admin());

-- portal_users --------------------------------------------------------------
create policy "portal_users: visible to portal members + master" on public.portal_users
  for select using (public.has_portal_access(portal_id));
create policy "portal_users: portal admins manage their portal" on public.portal_users
  for insert with check (public.is_portal_admin(portal_id));
create policy "portal_users: portal admins update their portal" on public.portal_users
  for update using (public.is_portal_admin(portal_id)) with check (public.is_portal_admin(portal_id));
create policy "portal_users: portal admins remove (not the owner row)" on public.portal_users
  for delete using (public.is_portal_admin(portal_id) and (not is_owner or public.is_master_admin()));

-- stalls --------------------------------------------------------------------
-- Public read so contestants can see availability when RSVPing.
create policy "stalls: public read" on public.stalls for select using (true);
create policy "stalls: admins write" on public.stalls
  for insert with check (public.is_portal_admin(portal_id));
create policy "stalls: admins update" on public.stalls
  for update using (public.is_portal_admin(portal_id)) with check (public.is_portal_admin(portal_id));
create policy "stalls: admins delete" on public.stalls
  for delete using (public.is_portal_admin(portal_id));

-- reservations --------------------------------------------------------------
create policy "reservations: portal staff read all, contestants read own"
  on public.reservations for select using (
    public.is_portal_admin(portal_id) or created_by = auth.uid()
  );
create policy "reservations: signed-in users create (RSVP) in the right portal"
  on public.reservations for insert with check (
    auth.uid() is not null
    and created_by = auth.uid()
    and exists (        -- stall must belong to the same portal
      select 1 from public.stalls s
      where s.id = stall_id and s.portal_id = reservations.portal_id and not s.is_blocked
    )
  );
create policy "reservations: staff or creator update"
  on public.reservations for update
  using (public.is_portal_admin(portal_id) or created_by = auth.uid())
  with check (public.is_portal_admin(portal_id) or created_by = auth.uid());
create policy "reservations: staff delete" on public.reservations
  for delete using (public.is_portal_admin(portal_id));

-- contestants ---------------------------------------------------------------
create or replace function public.reservation_portal(p_reservation_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$ select portal_id from public.reservations where id = p_reservation_id $$;
grant execute on function public.reservation_portal to authenticated;

create policy "contestants: staff, linked user, or reservation creator read"
  on public.contestants for select using (
    public.is_portal_admin(public.reservation_portal(reservation_id))
    or user_id = auth.uid()
    or exists (select 1 from public.reservations r
               where r.id = reservation_id and r.created_by = auth.uid())
  );
create policy "contestants: staff or reservation creator insert"
  on public.contestants for insert with check (
    public.is_portal_admin(public.reservation_portal(reservation_id))
    or exists (select 1 from public.reservations r
               where r.id = reservation_id and r.created_by = auth.uid())
  );
create policy "contestants: staff or linked user update"
  on public.contestants for update using (
    public.is_portal_admin(public.reservation_portal(reservation_id))
    or user_id = auth.uid()
    or exists (select 1 from public.reservations r
               where r.id = reservation_id and r.created_by = auth.uid())
  );
create policy "contestants: staff delete" on public.contestants
  for delete using (public.is_portal_admin(public.reservation_portal(reservation_id)));

-- vet_records ---------------------------------------------------------------
create or replace function public.contestant_portal(p_contestant_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$
  select r.portal_id from public.contestants c
  join public.reservations r on r.id = c.reservation_id
  where c.id = p_contestant_id
$$;
create or replace function public.can_touch_contestant(p_contestant_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_portal_admin(public.contestant_portal(p_contestant_id))
      or exists (select 1 from public.contestants c
                 left join public.reservations r on r.id = c.reservation_id
                 where c.id = p_contestant_id
                   and (c.user_id = auth.uid() or r.created_by = auth.uid()))
$$;
grant execute on function public.contestant_portal, public.can_touch_contestant to authenticated;

create policy "vet_records: staff or owning contestant read"
  on public.vet_records for select using (public.can_touch_contestant(contestant_id));
create policy "vet_records: staff or owning contestant insert"
  on public.vet_records for insert with check (
    public.can_touch_contestant(contestant_id) and uploaded_by = auth.uid()
  );
create policy "vet_records: staff or uploader delete"
  on public.vet_records for delete using (
    public.is_portal_admin(public.contestant_portal(contestant_id)) or uploaded_by = auth.uid()
  );

-- ----------------------------------------------------------------------------
-- 7. Storage: private `vet-records` bucket.
--    Object path convention: <portal_id>/<contestant_id>/<uuid>-<filename>
--    Access via createSignedUrl only; policies gate by contestant.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vet-records', 'vet-records', false, 20971520,
  array['application/pdf','image/jpeg','image/png','image/webp','image/heic']
)
on conflict (id) do nothing;

create policy "vet-records: read own/staff files"
  on storage.objects for select using (
    bucket_id = 'vet-records'
    and public.can_touch_contestant(((storage.foldername(name))[2])::uuid)
  );
create policy "vet-records: upload own/staff files"
  on storage.objects for insert with check (
    bucket_id = 'vet-records'
    and public.can_touch_contestant(((storage.foldername(name))[2])::uuid)
  );
create policy "vet-records: delete own/staff files"
  on storage.objects for delete using (
    bucket_id = 'vet-records'
    and public.can_touch_contestant(((storage.foldername(name))[2])::uuid)
  );

-- ----------------------------------------------------------------------------
-- 8. Availability RPC — stalls free for a whole date range in one call
--    (used by the stall board and the reservation form's stall dropdown).
-- ----------------------------------------------------------------------------
create or replace function public.stall_board(p_portal_id uuid, p_from date, p_to date)
returns table (
  stall_id uuid, name text, barn text, is_blocked boolean, nightly_rate numeric,
  state text, reservation_id uuid, animal_name text, owner_name text
)
language sql stable security definer set search_path = public
as $$
  -- SECURITY DEFINER on purpose: availability (the *state*) must be computed
  -- against ALL reservations, even ones the caller's RLS would hide — otherwise
  -- a contestant would see a reserved stall as free. Identifying details are
  -- masked below unless the caller is portal staff.
  select
    s.id, s.name, s.barn, s.is_blocked, s.nightly_rate,
    case
      when s.is_blocked then 'blocked'
      when s.available_from is not null and p_from < s.available_from then 'blocked'
      when s.available_to   is not null and p_to   > s.available_to   then 'blocked'
      when r.id is null then 'available'
      when r.status = 'checked_in' then 'checked_in'
      else 'reserved'
    end as state,
    case when public.is_portal_admin(p_portal_id) then r.id end,
    case when public.is_portal_admin(p_portal_id) then r.animal_name end,
    case when public.is_portal_admin(p_portal_id) then r.owner_name end
  from public.stalls s
  left join lateral (
    select r.* from public.reservations r
    where r.stall_id = s.id
      and r.status <> 'cancelled'
      and daterange(r.check_in, r.check_out, '[)') && daterange(p_from, p_to, '[)')
    order by r.check_in limit 1
  ) r on true
  where s.portal_id = p_portal_id
  order by s.barn nulls last, s.name
$$;
grant execute on function public.stall_board to authenticated, anon;

-- ============================================================================
-- Post-migration manual steps (Supabase Dashboard):
--  1. Authentication → Hooks → enable "Custom Access Token" hook →
--     public.custom_access_token_hook  (puts app_role + portal_ids in the JWT)
--  2. Create the first master admin: sign the user up, then
--       update public.profiles set role='master_admin' where email='you@…';
--       insert into public.properties (name, owner_id) values ('Sandoval Ranch Arena', '<uuid>');
--  3. stall_board is SECURITY DEFINER so availability states are always
--     accurate; animal/owner names and reservation ids are masked for
--     everyone except portal staff / master admin.
-- ============================================================================

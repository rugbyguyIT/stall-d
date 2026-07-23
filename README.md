# Stall'd — rodeo stall reservation PWA

Multi-tenant stall reservations for a single facility hosting multiple rodeo
operators. React + Vite frontend, Supabase (Postgres/Auth/Storage/RLS)
backend, Netlify hosting + serverless functions. Installable PWA with offline
shell and last-loaded data caching.

## Stack

- **Frontend:** React 18 + Vite, react-router-dom (`/portal/:slug` routing)
- **Backend:** Supabase — Postgres with RLS, Auth (JWT custom claims
  `app_role` + `portal_ids`), private Storage bucket `vet-records`
- **Hosting:** Netlify — SPA `_redirects`, `portal-context` and
  `invite-admin` serverless functions

## Setup

### 1. Supabase

1. Create a project, then run `supabase/migrations/00001_init.sql` followed by
   `00002_display.sql` in the SQL editor (or `supabase db push`). They create
   the schema, RLS policies, the private `vet-records` bucket, the JWT claims
   hook, and the TV display keys.
2. **Authentication → Hooks → Custom Access Token** → select
   `public.custom_access_token_hook`. This puts `app_role` and `portal_ids`
   into every JWT.
3. Create your master admin: sign up through the app (or dashboard), then:
   ```sql
   update public.profiles set role = 'master_admin' where email = 'you@example.com';
   insert into public.properties (name, owner_id)
     values ('Sandoval Ranch Arena', (select id from public.profiles where email = 'you@example.com'));
   ```
4. Sign out/in once so your token picks up the new role.

### 2. Netlify

Set environment variables (Site settings → Environment):

| Variable | Used by |
|---|---|
| `SUPABASE_URL` | client bundle + functions |
| `SUPABASE_ANON_KEY` | client bundle + functions |
| `SUPABASE_SERVICE_ROLE_KEY` | **functions only** (admin invites) |

Deploy: connect the repo — `netlify.toml` sets `npm run build` → `dist`.

### 3. Local dev

```bash
npm install
cp .env.example .env   # fill in your keys
npm run dev            # app only
npx netlify dev        # app + functions (invite flow, /api/portal/*)
```

## Roles

| Role | Access |
|---|---|
| `master_admin` | All portals; every policy has an explicit master branch. Creates portals/stalls, switches portal context without re-auth (client-side context switch — same JWT). |
| `portal_admin` | Only portals listed in `portal_users` (enforced by RLS). Manages reservations, vet records, and portal admins. |
| `contestant` | Creates their own reservations (RSVP), sees only their own, uploads vet records for their own contestant rows. |

## Key design points

- **No double-booking:** Postgres exclusion constraint on
  `(stall_id, daterange(check_in, check_out))` for non-cancelled rows —
  race-proof at the database level.
- **Availability RPC** `stall_board(portal, from, to)` computes each stall's
  state for a date range; SECURITY DEFINER so states are always accurate, with
  animal/owner names masked unless the caller is portal staff.
- **Vet records** live in the private `vet-records` bucket at
  `portal_id/contestant_id/uuid-filename`; storage RLS reuses the same
  `can_touch_contestant()` predicate as the table, and files are served via
  short-lived signed URLs.
- **Portal switcher:** master admin opens any `/portal/:slug`; the sidebar
  shows "Back to master console". No re-authentication needed — the JWT
  already authorizes everything, only the UI context changes.
- **TV display board:** `/portal/<slug>/display?key=<display key>` renders a
  fullscreen, branded, auto-refreshing stall map + assignments list for an
  office TV. No sign-in on the TV: a secret per-portal display key (own table,
  staff-only RLS) authorizes read-only board data via the `display_board()`
  RPC; rotate the key from the dashboard's "TV display" menu to revoke old
  links. `?demo=1` previews with sample data.
- **PWA:** `manifest.json` (standalone, icons incl. maskable), `sw.js`
  precaches the shell, serves cache-first hashed assets, and network-first
  with cache fallback for Supabase reads so the last-loaded portal still
  renders offline.

## Structure

```
app/
├── netlify.toml                 # build, headers, env var docs
├── public/
│   ├── _redirects               # /api/portal/* → function, SPA fallback
│   ├── manifest.json            # PWA manifest
│   ├── sw.js                    # service worker
│   └── icons/                   # 192/512/maskable/apple-touch
├── netlify/functions/
│   ├── portal-context.mjs       # GET /api/portal/:slug (edge-cached)
│   └── invite-admin.mjs         # POST invite (service-role, authz-checked)
├── scripts/
│   └── gen-icons.mjs            # writes public/icons/ (predev/prebuild hook)
├── supabase/migrations/
│   ├── 00001_init.sql           # schema + RLS + storage + JWT hook
│   └── 00002_display.sql        # TV display keys + display_board RPC
└── src/
    ├── main.jsx / App.jsx       # routes: /login /master /portal/:slug/*
    ├── styles.css               # design system (shared with mockups)
    ├── lib/supabase.js          # client + JWT claim reader
    ├── lib/format.js            # date/money/etc. helpers
    ├── context/AuthContext.jsx  # session, profile, role, portal claims
    ├── context/PortalContext.jsx# slug → portal, per-portal theming
    ├── components/              # AppShell (sidebar), Protected
    └── pages/
        ├── Login.jsx                     # sign-in/up + portal switcher
        ├── master/MasterDashboard.jsx    # portal list + create portal
        └── portal/
            ├── PortalDashboard.jsx       # stall board + upcoming list
            ├── Reservations.jsx          # full list, search, cancelled
            ├── ReservationForm.jsx       # create/edit/cancel + add-ons
            ├── ContestantProfile.jsx     # vet records list + upload
            ├── PortalUsers.jsx           # admin management + invites
            └── DisplayBoard.jsx          # fullscreen branded TV board
```

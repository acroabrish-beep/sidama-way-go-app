-- ============================================================================
-- APPLIED TO STAGING - 2026-10-24
-- Gate A compatibility + Gate B citizen-reporting reconciliation
-- Target: the linked staging project (legacy public schema)
-- Date: 2026-10-24
-- ============================================================================
--
-- WHY THIS FILE EXISTS
--
-- Phase A0 observed that the deployed database still uses the legacy shapes:
--   * public.users has text role, last_login, first_name/last_name, etc.
--     It is NOT the canonical users table from
--     supabase/migrations/202610230001_core_schema.sql.
--   * public.citizen_reports is the legacy S1 table
--     (reporter_firebase_uid, status pending/in_progress/resolved, photo_url,
--      description, ai_* and final_* columns).
--   * The canonical migrations 202610230001 and 202610230002 are NOT applied.
--
-- The Gate A Edge Function is already implemented, but its README claim that
-- "no schema change is required" is only true for a database that already has
-- the canonical sync_user_profile RPC. The current project does not. This
-- proposal supplies a legacy-compatible version of that RPC.
--
-- Gate B cannot use direct Supabase reads/writes today because:
--   * public.citizen_reports only has a service_role policy, so the Flutter
--     client sees nothing with the authenticated role.
--   * public.users RLS uses auth.uid() = id (users_insert_own,
--     users_select_own, users_update_own). Under Supabase third-party Firebase
--     auth the identity key is auth.jwt()->>'sub' (the Firebase UID), and
--     auth.uid() may be NULL or raise a cast error for non-UUID Firebase UIDs.
--   * users_select_own/users_update_own also allow
--     (auth.jwt()->>'role') = 'admin'. That claim is the Postgres role
--     (normally 'authenticated'), not the application role, so it is not a
--     usable app-admin check.
--   * the live users table grants authenticated table INSERT/SELECT and
--     column-level UPDATE on ten columns, including email, city, and address.
--     A table-level REVOKE alone does not remove those column-level grants.
--
-- WHAT THIS PROPOSAL DOES
--   1. Adds private helper functions that resolve the caller from
--      auth.jwt()->>'sub' and read the app role from public.users.
--   2. Drops users_insert_own, users_select_own, and users_update_own;
--      replaces them with firebase_uid-based self-only SELECT/UPDATE policies;
--      removes the broad table grants and the ten pre-existing column-level
--      UPDATE grants; re-grants only the profile columns the client uses.
--      Client INSERT on users is removed; provisioning stays Edge-Function-only.
--   3. Adds the legacy-compatible service-role-only sync_user_profile RPC.
--   4. Ensures the legacy AI/final columns exist (idempotent), adds
--      citizen_reports RLS for own reads and inserts plus staff updates,
--      narrows grants, and adds updated_at polling indexes.
--
-- WHAT THIS PROPOSAL DOES NOT DO
--   * It does not drop or rename any table or column.
--   * It does not delete, rewrite, or backfill any existing row.
--   * It does not adopt the canonical title/priority/status enum model.
--     The legacy three-state report workflow remains authoritative here.
--   * It does not add report_events, station scoping, or storage policies.
--     Report photos continue to use Firebase Storage URLs.
--   * It does not let the client insert users rows. Account provisioning stays
--     with the service-role-only sync_user_profile RPC used by Gate A.
--   * It does not make the client able to update users.role or
--     citizen_reports.reporter_firebase_uid.
--
-- PREFLIGHT (run read-only first; STOP if any result differs)
--
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name in ('users', 'citizen_reports')
--   order by table_name, ordinal_position;
--
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('users', 'citizen_reports')
--   order by tablename, policyname;
--
--   select relname, relrowsecurity, relforcerowsecurity
--   from pg_class
--   where oid in ('public.users'::regclass, 'public.citizen_reports'::regclass);
--
--   select distinct role from public.users order by 1;
--
--   select tgname
--   from pg_trigger
--   where tgrelid = 'public.citizen_reports'::regclass
--     and not tgisinternal;
--
--   select nspname from pg_namespace where nspname = 'app_private';
--
--   select grantee, table_name, privilege_type, column_name
--   from information_schema.column_privileges
--   where table_schema = 'public'
--     and table_name in ('users', 'citizen_reports')
--     and grantee in ('anon', 'authenticated')
--   order by table_name, grantee, column_name;
--
-- PREFLIGHT RESULT - 2026-10-24, linked staging project
--
--   * users: 17 rows; 14 citizen, 2 admin, 1 taxi; all 17 have firebase_uid.
--     Columns include id, email, phone, first_name, last_name, avatar_url,
--     user_type, status, city, address, created_at, updated_at, firebase_uid,
--     full_name, role, photo, language, department, is_approved, is_active,
--     wallet_balance, membership_number, unread_notifications, last_login.
--     user_type is NOT NULL with no default and
--     CHECK (citizen|driver|business|admin|emergency|healthcare).
--     There is no last_login_at column.
--   * users policies: users_insert_own, users_select_own, users_update_own.
--     There is no "Service role can manage users" policy and no
--     "Users can view/update own profile" policy.
--   * users ACL: authenticated has table INSERT/SELECT and column-level UPDATE
--     on address, avatar_url, city, email, first_name, full_name, language,
--     last_name, phone, photo. postgres and service_role have all privileges.
--   * citizen_reports: 1 pending row. Legacy columns plus deleted_at. No AI or
--     final columns yet. Only the service-role policy exists. anon and
--     authenticated have full table privileges (RLS still denies them).
--     Trigger citizen_reports_set_updated_at is enabled.
--   * RLS is enabled and not forced on both tables.
--   * No app_private schema, no helper functions, and no
--     public.sync_user_profile(...) exist yet.
--   * auth.jwt() is executable by authenticated and anon; the auth schema is
--     usable by authenticated. postgres owns both tables and can create the
--     helper schema.
--
-- The two blocking differences from the first draft were the live policy names
-- and users.user_type NOT NULL without a default. Both are handled below:
-- the actual policies are dropped, and new rows set user_type = 'citizen'.
--
-- CLIENT PREREQUISITE (met): lib/services/auth_service.dart selects
-- last_login_at and falls back to last_login on PostgREST 42703. Verified with
-- dart analyze; full Flutter tests pass.
--
-- APPLICATION RECORD - 2026-10-24
--
-- Project ref: eolmukwhzuvscworgwwx. This is the only configured app project;
-- its .env.local is APP_ENV=development with staging payment/QR values. There
-- is no separately named staging project.
--
-- Applied to that linked project as postgres via
-- `supabase db query --linked --file ...`. Exit code 0.
--
-- Post-apply verification:
--   * Policies: users_select_self_firebase, users_update_self_firebase,
--     Service role can manage citizen reports,
--     citizen_reports_select_own_or_staff, citizen_reports_insert_own,
--     citizen_reports_update_staff.
--   * Functions: app_private.current_firebase_uid() (SECURITY INVOKER),
--     app_private.is_citizen_report_staff() (SECURITY DEFINER), and
--     public.sync_user_profile(...) (SECURITY DEFINER). All owned by postgres
--     with search_path = ''.
--   * Grants: authenticated users SELECT on 13 columns and UPDATE only on
--     avatar_url, full_name, phone; no INSERT. authenticated citizen_reports
--     SELECT all, INSERT on 6 columns, UPDATE on 5 columns. No anon
--     privileges on either table. Neither table has table-level privileges
--     for authenticated.
--   * Execute: authenticated can call both app_private helpers and the
--     citizen_reports policies resolve; anon cannot. Only service_role can
--     execute sync_user_profile.
--   * Row counts unchanged: 17 users, 1 citizen report (still pending),
--     0 probe rows persisted.
--   * Simulated RLS checks (set_config('request.jwt.claims', ...) +
--     set_local_role, rolled back): report owner sees 1 user + 1 report;
--     unrelated citizen sees 1 user + 0 reports; admin sees 1 user + 1
--     report; citizen status update is denied; admin status update succeeds;
--     citizen role update is denied by column grant.
--   * Service-role sync probe created a citizen row with user_type=citizen,
--     status=active, language=en; rolled back with zero rows persisted.
--
-- Real-token E2E - 2026-10-24:
--   * Enabled Firebase as a third-party auth provider in the linked Supabase
--     project's dashboard with Firebase project ID bekan-automotive-solution.
--     Before that, the same valid token was rejected with
--     401 "No suitable key or wrong key type".
--   * Created one disposable Firebase user in bekan-automotive-solution via
--     `firebase auth:import` with a random password and the custom claim
--     {"role":"authenticated"}. No service-account key was used.
--   * Exchanged the account for a genuine Firebase ID token through Identity
--     Toolkit. Claims: sub = test UID, aud = bekan-automotive-solution,
--     iss = https://securetoken.google.com/bekan-automotive-solution,
--     role = authenticated, email_verified = true.
--   * Citizen path against PostgREST passed: own profile read (200, citizen);
--     users query returned only the caller's row; report insert succeeded
--     (201, status pending, ai_status pending); own report read succeeded;
--     status update was denied by RLS (0 rows, report stayed pending); role
--     update was denied by column grants (403); anon reads of both tables
--     were denied (401).
--   * Staff path passed after temporarily setting the test profile role to
--     admin: all reports visible (2); status update succeeded (1 row,
--     in_progress); reporter_firebase_uid and ai_category updates were denied
--     by column grants (403).
--   * Cleanup restored baseline counts: 17 users, 1 report (still pending),
--     0 test rows. The disposable Firebase user
--     e2e.gateb.1792859062643@example.com (UID
--     e2e083d05a0ac5ba22c991ac1b9) still exists; its local password material
--     was deleted. Deleting the Firebase user requires Admin credentials or
--     the Firebase console.
--
-- Remaining verification gap: the Flutter UI and the Flutter client's call to
-- the Gate A Edge Function were not exercised on a device or emulator. Gate A
-- was subsequently deployed and verified with a real token (see the Gate A
-- deployment record in ../../functions/sync-profile/README.md). Direct
-- citizen-report inserts also no longer trigger the backend's Gemini AI
-- triage, so ai_status remains 'pending' until a server-side triage function
-- is implemented and approved.
--
-- ROLLBACK: see 20261024_gate_b_rollback_snapshot.sql. It records the exact
-- pre-change policies and grants; do not restore the auth.uid()-based
-- policies in a production database.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Private helpers
--
-- app_private is intentionally separate from the canonical "private" schema
-- used by the unapplied foundation migrations, so this legacy reconciliation
-- cannot silently replace canonical helpers if those are ever applied.
-- ---------------------------------------------------------------------------

create schema if not exists app_private;

revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;

-- The Firebase UID from the verified third-party JWT. Never auth.uid():
-- Firebase UIDs are not UUIDs.
create or replace function app_private.current_firebase_uid()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'sub', '')
$$;

revoke all on function app_private.current_firebase_uid()
  from public, anon, authenticated;
grant execute on function app_private.current_firebase_uid()
  to authenticated;

-- SECURITY DEFINER so role lookup is not blocked by users RLS. The function
-- only returns a boolean about the caller and pins search_path.
create or replace function app_private.is_citizen_report_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.firebase_uid = app_private.current_firebase_uid()
      and lower(coalesce(u.status, 'active')) = 'active'
      and coalesce(u.is_active, true)
      and lower(regexp_replace(coalesce(u.role, ''), '[^a-zA-Z]', '', 'g'))
          in (
            'superadmin',
            'cityadmin',
            'citizenreportsadmin',
            'emergencyadmin',
            'admin'
          )
  )
$$;

revoke all on function app_private.is_citizen_report_staff()
  from public, anon, authenticated;
grant execute on function app_private.is_citizen_report_staff()
  to authenticated;

-- ---------------------------------------------------------------------------
-- 2. public.users: safe self-access for the Flutter client
--
-- The live policies use auth.uid() = id, which is the wrong identity key for
-- Supabase third-party Firebase auth. users_insert_own is removed because
-- account provisioning is Edge-Function/service-role only.
-- Do not restore these policies after rollback in a production database.
-- ---------------------------------------------------------------------------

alter table public.users enable row level security;

drop policy if exists "Users can view own profile" on public.users;
drop policy if exists "Users can update own profile" on public.users;
drop policy if exists users_insert_own on public.users;
drop policy if exists users_select_own on public.users;
drop policy if exists users_update_own on public.users;
drop policy if exists users_select_self_firebase on public.users;
drop policy if exists users_update_self_firebase on public.users;

create policy users_select_self_firebase
on public.users
for select
to authenticated
using (firebase_uid = app_private.current_firebase_uid());

create policy users_update_self_firebase
on public.users
for update
to authenticated
using (firebase_uid = app_private.current_firebase_uid())
with check (firebase_uid = app_private.current_firebase_uid());

revoke all on table public.users from public, anon, authenticated;

-- Table-level REVOKE does not clear column-level grants. Preflight found these
-- ten column-level UPDATE grants on authenticated; remove them so the client
-- cannot edit its email, city, address, or other non-profile fields.
revoke update (
  address,
  avatar_url,
  city,
  email,
  first_name,
  full_name,
  language,
  last_name,
  phone,
  photo
) on table public.users from authenticated;

-- Explicit columns only. The client reads these; it must not read wallet or
-- other users' rows. last_login is the deployed column name (not last_login_at).
grant select (
  id,
  firebase_uid,
  email,
  full_name,
  phone,
  avatar_url,
  role,
  status,
  language,
  department,
  last_login,
  created_at,
  updated_at
) on table public.users to authenticated;

-- Profile edits only. Role, status, firebase_uid, and wallet columns are not
-- grantable to the client.
grant update (
  full_name,
  phone,
  avatar_url
) on table public.users to authenticated;

do $$
declare
  unexpected text;
begin
  select string_agg(policyname, ', ' order by policyname)
  into unexpected
  from pg_policies
  where schemaname = 'public'
    and tablename = 'users'
    and policyname not in (
      'Service role can manage users',
      'users_select_self_firebase',
      'users_update_self_firebase'
    );

  if unexpected is not null then
    raise exception 'Unexpected public.users policies: %', unexpected;
  end if;

  select string_agg(column_name, ', ' order by column_name)
  into unexpected
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'users'
    and grantee = 'authenticated'
    and privilege_type = 'UPDATE'
    and column_name not in ('full_name', 'phone', 'avatar_url');

  if unexpected is not null then
    raise exception 'Unexpected authenticated UPDATE columns on users: %',
      unexpected;
  end if;

  if has_table_privilege('authenticated', 'public.users', 'INSERT') then
    raise exception 'authenticated must not have INSERT on public.users';
  end if;

  if has_table_privilege('anon', 'public.users', 'SELECT')
     or has_table_privilege('anon', 'public.users', 'INSERT')
     or has_table_privilege('anon', 'public.users', 'UPDATE') then
    raise exception 'anon must not have privileges on public.users';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. sync_user_profile for the legacy users shape
--
-- Same signature as the Gate A Edge Function expects. It never accepts a
-- role. New rows are always citizen/active with user_type = 'citizen' because
-- the live users.user_type is NOT NULL without a default. Email is required
-- for new rows because users.email is NOT NULL.
--
-- p_email_verified is retained for signature compatibility with the canonical
-- RPC and the existing Next.js route. It is not used because the live users
-- table has no pre-provisioned rows with a null firebase_uid to link
-- (preflight: 0 of 17).
-- ---------------------------------------------------------------------------

create or replace function public.sync_user_profile(
  p_firebase_uid text,
  p_email text,
  p_email_verified boolean,
  p_full_name text default null,
  p_phone text default null,
  p_language text default 'en'
)
returns public.users
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.users;
  v_email text;
begin
  if p_firebase_uid is null or btrim(p_firebase_uid) = '' then
    raise exception 'firebase uid is required' using errcode = '22023';
  end if;

  v_email := nullif(lower(btrim(coalesce(p_email, ''))), '');

  select *
  into v_user
  from public.users
  where firebase_uid = p_firebase_uid
  for update;

  if found then
    update public.users
    set full_name = coalesce(nullif(btrim(p_full_name), ''), full_name),
        phone = coalesce(nullif(btrim(p_phone), ''), phone),
        language = coalesce(nullif(btrim(p_language), ''), language),
        last_login = now(),
        updated_at = now()
    where id = v_user.id
    returning * into v_user;

    return v_user;
  end if;

  if v_email is null then
    raise exception 'email is required for a new account' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.users
    where lower(email) = v_email
      and firebase_uid is distinct from p_firebase_uid
  ) then
    raise exception 'email is already linked to another account'
      using errcode = '23505';
  end if;

  insert into public.users (
    firebase_uid,
    email,
    full_name,
    phone,
    role,
    user_type,
    status,
    language,
    last_login
  )
  values (
    p_firebase_uid,
    v_email,
    coalesce(
      nullif(btrim(p_full_name), ''),
      nullif(split_part(v_email, '@', 1), ''),
      'Citizen'
    ),
    nullif(btrim(p_phone), ''),
    'citizen',
    'citizen',
    'active',
    coalesce(nullif(btrim(p_language), ''), 'en'),
    now()
  )
  returning * into v_user;

  return v_user;
exception
  when unique_violation then
    select *
    into v_user
    from public.users
    where firebase_uid = p_firebase_uid;

    if found then
      return v_user;
    end if;

    raise;
end;
$$;

revoke all on function public.sync_user_profile(
  text, text, boolean, text, text, text
) from public, anon, authenticated;

grant execute on function public.sync_user_profile(
  text, text, boolean, text, text, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 4. public.citizen_reports: legacy AI columns and direct-client access
--
-- Preflight found none of these AI/final columns on the live table. ADD COLUMN
-- IF NOT EXISTS keeps the statement safe if a previous partial migration added
-- one. If a column exists but is nullable/without a default, it is left
-- unchanged; the insert policy below allows NULL ai_status for that case.
-- ---------------------------------------------------------------------------

alter table public.citizen_reports
  add column if not exists ai_status text not null default 'pending'
    check (ai_status in ('pending', 'done', 'failed', 'skipped')),
  add column if not exists ai_category text
    check (ai_category in ('pothole', 'garbage', 'street_light', 'water', 'other')),
  add column if not exists ai_urgency text
    check (ai_urgency in ('low', 'medium', 'high')),
  add column if not exists ai_summary text,
  add column if not exists ai_language text,
  add column if not exists ai_confidence numeric
    check (ai_confidence between 0 and 1),
  add column if not exists ai_model text,
  add column if not exists triaged_at timestamptz,
  add column if not exists assigned_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists final_category text
    check (final_category in ('pothole', 'garbage', 'street_light', 'water', 'other')),
  add column if not exists final_urgency text
    check (final_urgency in ('low', 'medium', 'high'));

alter table public.citizen_reports enable row level security;

drop policy if exists citizen_reports_select_own_or_staff
  on public.citizen_reports;
drop policy if exists citizen_reports_insert_own
  on public.citizen_reports;
drop policy if exists citizen_reports_update_staff
  on public.citizen_reports;

create policy citizen_reports_select_own_or_staff
on public.citizen_reports
for select
to authenticated
using (
  reporter_firebase_uid = app_private.current_firebase_uid()
  or app_private.is_citizen_report_staff()
);

-- A citizen may create only an unassigned, untriaged, pending report for
-- themselves. Status and AI/final timestamps cannot be spoofed.
create policy citizen_reports_insert_own
on public.citizen_reports
for insert
to authenticated
with check (
  reporter_firebase_uid = app_private.current_firebase_uid()
  and status = 'pending'
  and assigned_at is null
  and resolved_at is null
  and triaged_at is null
  and (ai_status is null or ai_status = 'pending')
  and ai_category is null
  and ai_urgency is null
  and ai_summary is null
  and ai_confidence is null
  and ai_model is null
  and final_category is null
  and final_urgency is null
);

create policy citizen_reports_update_staff
on public.citizen_reports
for update
to authenticated
using (app_private.is_citizen_report_staff())
with check (app_private.is_citizen_report_staff());

revoke all on table public.citizen_reports from public, anon, authenticated;

grant select on table public.citizen_reports to authenticated;

-- Column-level insert: reporters cannot set their own status, AI fields,
-- assignment, resolution, or timestamps.
grant insert (
  reporter_firebase_uid,
  category,
  description,
  photo_url,
  latitude,
  longitude
) on table public.citizen_reports to authenticated;

-- Column-level staff update. updated_at is maintained by the live
-- citizen_reports_set_updated_at BEFORE UPDATE trigger (preflight confirmed
-- it is enabled).
grant update (
  status,
  final_category,
  final_urgency,
  assigned_at,
  resolved_at
) on table public.citizen_reports to authenticated;

create index if not exists idx_citizen_reports_updated_at
  on public.citizen_reports (updated_at desc);

create index if not exists idx_citizen_reports_reporter_updated_at
  on public.citizen_reports (reporter_firebase_uid, updated_at desc);

create index if not exists idx_citizen_reports_status_updated_at
  on public.citizen_reports (status, updated_at desc);

do $$
declare
  unexpected text;
begin
  select string_agg(policyname, ', ' order by policyname)
  into unexpected
  from pg_policies
  where schemaname = 'public'
    and tablename = 'citizen_reports'
    and policyname not in (
      'Service role can manage citizen reports',
      'citizen_reports_select_own_or_staff',
      'citizen_reports_insert_own',
      'citizen_reports_update_staff'
    );

  if unexpected is not null then
    raise exception 'Unexpected public.citizen_reports policies: %', unexpected;
  end if;

  select string_agg(column_name, ', ' order by column_name)
  into unexpected
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'citizen_reports'
    and grantee = 'authenticated'
    and privilege_type = 'UPDATE'
    and column_name not in (
      'status',
      'final_category',
      'final_urgency',
      'assigned_at',
      'resolved_at'
    );

  if unexpected is not null then
    raise exception
      'Unexpected authenticated UPDATE columns on citizen_reports: %',
      unexpected;
  end if;

  select string_agg(column_name, ', ' order by column_name)
  into unexpected
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'citizen_reports'
    and grantee = 'authenticated'
    and privilege_type = 'INSERT'
    and column_name not in (
      'reporter_firebase_uid',
      'category',
      'description',
      'photo_url',
      'latitude',
      'longitude'
    );

  if unexpected is not null then
    raise exception
      'Unexpected authenticated INSERT columns on citizen_reports: %',
      unexpected;
  end if;

  if has_table_privilege('anon', 'public.citizen_reports', 'SELECT') then
    raise exception 'anon must not have SELECT on public.citizen_reports';
  end if;
end
$$;

-- PostgREST must reload after the new columns and functions.
notify pgrst, 'reload schema';

commit;

-- ============================================================================
-- POST-APPLY VERIFICATION (staging; use disposable test accounts)
-- ============================================================================
--
-- Status 2026-10-24 (updated after Gate A deployment):
--
--   * Gate A: the sync-profile Edge Function was deployed to the linked
--     project as ACTIVE v1 with --no-verify-jwt, and verified with a genuine
--     Firebase ID token against the deployed function (21/21 checks). A new
--     Firebase user without the role claim was provisioned through the
--     function, role="authenticated" was set, the refreshed Firebase token was
--     accepted by PostgREST, a second call was idempotent, and invalid,
--     wrong-method, malformed, and oversized requests were rejected. Cleanup
--     restored 17 users and 1 citizen report.
--
--   * Items 1-3 below were run directly against PostgREST with a genuine
--     Firebase ID token after Firebase third-party auth was enabled for the
--     project: citizen path 9/9 and staff path 5/5 passed. Items 4 and 5 were
--     run and passed.
--
--   * The Flutter citizen-reporting service was then refactored to call
--     PostgREST directly, and the contract was re-verified end to end with a
--     genuine Firebase token: 23/23 checks passed (six-column insert returned
--     201 with status='pending' and ai_status='pending'; own-list and
--     cross-user isolation; incremental updated_at filter; citizen status
--     update denied; temporary staff role update with assigned_at and
--     category/urgency overrides; staff saw both reports; role reverted;
--     cleanup restored 17 users and 1 report).
--
--   * Remaining gaps: the Flutter UI was not exercised on a device or
--     emulator, and direct inserts no longer trigger the backend's Gemini AI
--     triage, so ai_status stays 'pending' until a server-side triage function
--     is implemented and approved.
--
-- 1. Real client path: sign in with Firebase, ensure the Gate A profile sync
--    returned a token with role="authenticated", then:
--    (The direct PostgREST portion was tested with a real token; the Gate A
--    profile sync was later verified separately against the deployed
--    function. See the status above.)
--      select from public.users where firebase_uid = <caller uid>  -> own row
--      insert a report -> succeeds with status='pending', ai_status='pending'
--      select own reports -> returns the new row
--      select another user's report id -> zero rows
--      update own report status -> permission denied
--
-- 2. Staff path: the live staff role is admin (2 rows). The helper also
--    accepts the canonical spellings super_admin, city_admin,
--    citizen_reports_admin, and emergency_admin:
--      select all reports -> succeeds
--      update status/final_category/final_urgency -> succeeds
--      update reporter_firebase_uid -> permission denied
--
-- 3. Anon path: no Authorization token:
--      select from public.citizen_reports -> permission denied
--      select from public.users -> permission denied
--
-- 4. RLS simulation inside a transaction (development/staging only; this is
--    not a substitute for a real Firebase token):
--      begin;
--      select set_config(
--        'request.jwt.claims',
--        json_build_object('sub', '<test-firebase-uid>', 'role', 'authenticated')::text,
--        true
--      );
--      set local role authenticated;
--      select count(*) from public.citizen_reports;
--      reset role;
--      rollback;
--
-- 5. Structural checks after apply:
--      users policies: users_select_self_firebase, users_update_self_firebase.
--      citizen_reports policies: Service role..., select own or staff,
--        insert own, update staff.
--      authenticated users: SELECT on the granted columns only, UPDATE on
--        full_name/phone/avatar_url only, no INSERT.
--      authenticated citizen_reports: SELECT all columns, INSERT on six,
--        UPDATE on five.
--      anon: no privileges on either table.
--      app_private functions exist; public.sync_user_profile exists and is
--        executable only by service_role.
--
-- ============================================================================
-- ROLLBACK NOTES
-- ============================================================================
--
-- Rollback is environment-specific. The exact pre-change policies, ACLs, and
-- column grants are recorded in
-- supabase/proposals/20261024_gate_b_rollback_snapshot.sql. Review before use;
-- do not blindly restore the live users policies:
--   * users_insert_own and users_update_own use auth.uid() = id, which is the
--     wrong identity key for Firebase third-party auth.
--   * users_select_own/users_update_own also treat auth.jwt()->>'role' =
--     'admin' as staff. That claim is the Postgres role, not the app role.
--   * authenticated holds column-level UPDATE on email, city, and address.
--
-- A safe rollback is to drop the new policies/functions and re-grant the
-- pre-change privileges recorded in the snapshot. The AI columns are left in
-- place: dropping them could discard triage data written after deployment.
--
-- The canonical migrations in supabase/migrations/202610230001 and
-- 202610230002 remain unapplied and are not a rollback path for this file.
-- ============================================================================

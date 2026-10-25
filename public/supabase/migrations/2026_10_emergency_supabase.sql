-- Phase 3: Emergency SOS on Supabase (additive).
--
-- Firebase ID tokens reach PostgREST with role = 'authenticated' and a text
-- `sub` claim that is a Firebase UID, not a UUID. The legacy emergency
-- policies compared auth.uid() (a uuid cast) with reporter_id, which raises
-- 22P02 for every Firebase caller. This migration:
--
--   * adds the Phase 3 client columns,
--   * backfills them from the legacy columns,
--   * keeps the legacy NOT NULL columns satisfied through a trigger so the
--     app can insert only the new columns,
--   * replaces the three broken policies with Firebase-UID policies,
--   * restricts grants to the API roles the app actually uses.
--
-- No table is dropped and no existing row is deleted.

begin;

-- ---------------------------------------------------------------------------
-- 1. Client columns
-- ---------------------------------------------------------------------------
alter table public.emergency_incidents
  add column if not exists requester_firebase_uid text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists emergency_type text,
  add column if not exists priority text,
  add column if not exists assignee_firebase_uid text,
  add column if not exists resolved_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Backfill existing rows (safe when empty)
-- ---------------------------------------------------------------------------
-- Re-runs must not fire an older version of the compatibility trigger while
-- backfilling. It is recreated at the end of this migration.
drop trigger if exists prepare_emergency_incident
  on public.emergency_incidents;

update public.emergency_incidents i
set requester_firebase_uid = coalesce(
      i.requester_firebase_uid,
      (select u.firebase_uid from public.users u where u.id = i.reporter_id)
    ),
    latitude = coalesce(i.latitude, st_y(i.location::geometry)),
    longitude = coalesce(i.longitude, st_x(i.location::geometry)),
    emergency_type = coalesce(i.emergency_type, i.incident_type),
    priority = coalesce(i.priority, i.severity),
    assignee_firebase_uid = coalesce(
      i.assignee_firebase_uid,
      (select u.firebase_uid from public.users u where u.id = i.responder_id)
    ),
    resolved_at = coalesce(
      i.resolved_at,
      case when i.status in ('resolved', 'closed') then i.updated_at end
    )
where i.requester_firebase_uid is null
   or i.latitude is null
   or i.longitude is null
   or i.emergency_type is null
   or i.priority is null
   or (i.assignee_firebase_uid is null and i.responder_id is not null)
   or (i.resolved_at is null and i.status in ('resolved', 'closed'));

-- ---------------------------------------------------------------------------
-- 3. Emergency staff helper
-- ---------------------------------------------------------------------------
create or replace function app_private.is_emergency_staff()
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
            'emergencyadmin',
            'emergency',
            'emergencystaff',
            'dispatcher',
            'emergencydispatcher',
            'admin'
          )
  )
$$;

revoke all on function app_private.is_emergency_staff() from public;
grant execute on function app_private.is_emergency_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Legacy-column compatibility + normalisation trigger
-- ---------------------------------------------------------------------------
create or replace function app_private.prepare_emergency_incident()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid text;
  v_reporter_id uuid;
  v_assignee_id uuid;
  v_type text;
  v_priority text;
begin
  v_uid := coalesce(
    nullif(btrim(new.requester_firebase_uid), ''),
    app_private.current_firebase_uid()
  );
  if v_uid is null then
    raise exception 'A signed-in requester is required'
      using errcode = '42501';
  end if;
  new.requester_firebase_uid := v_uid;

  select u.id into v_reporter_id
  from public.users u
  where u.firebase_uid = v_uid;

  if v_reporter_id is null then
    raise exception 'Your profile is not synced yet. Sign out and back in, then retry.'
      using errcode = '23503';
  end if;
  new.reporter_id := v_reporter_id;

  if new.latitude is null or new.longitude is null then
    raise exception 'GPS coordinates are required for an emergency request'
      using errcode = '23502';
  end if;
  if new.latitude < -90 or new.latitude > 90
     or new.longitude < -180 or new.longitude > 180 then
    raise exception 'GPS coordinates are out of range'
      using errcode = '22023';
  end if;
  new.location := public.st_setsrid(
    public.st_makepoint(new.longitude, new.latitude),
    4326
  )::public.geography;

  new.emergency_type := coalesce(
    nullif(btrim(new.emergency_type), ''),
    new.incident_type,
    'other'
  );
  v_type := lower(regexp_replace(new.emergency_type, '[^a-zA-Z]', '', 'g'));
  new.incident_type := case
    when v_type in ('medical', 'ambulance', 'health', 'hospital') then 'medical'
    when v_type in ('fire', 'flame', 'burning') then 'fire'
    when v_type in ('police', 'crime', 'security', 'theft', 'violence') then 'crime'
    when v_type in ('accident', 'trafficaccident', 'road', 'roadassist', 'roadside', 'vehicle') then 'accident'
    when v_type in ('disaster', 'flood', 'landslide', 'earthquake', 'naturaldisaster') then 'disaster'
    else 'other'
  end;

  v_priority := lower(regexp_replace(
    coalesce(nullif(btrim(new.priority), ''), new.severity, 'high'),
    '[^a-zA-Z]',
    '',
    'g'
  ));
  new.priority := case
    when v_priority in ('low', 'medium', 'high', 'critical') then v_priority
    else 'high'
  end;
  new.severity := new.priority;

  if new.description is null or btrim(new.description) = '' then
    new.description := 'Emergency ' || new.emergency_type || ' requested via SOS button.';
  end if;

  if new.assignee_firebase_uid is not null
     and btrim(new.assignee_firebase_uid) <> '' then
    select u.id into v_assignee_id
    from public.users u
    where u.firebase_uid = new.assignee_firebase_uid;

    if v_assignee_id is null then
      raise exception 'Assignee is not a registered user'
        using errcode = '23503';
    end if;
    new.responder_id := v_assignee_id;
  else
    new.assignee_firebase_uid := null;
  end if;

  if new.status in ('resolved', 'closed') then
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function app_private.prepare_emergency_incident() from public;
grant execute on function app_private.prepare_emergency_incident() to authenticated;

drop trigger if exists prepare_emergency_incident on public.emergency_incidents;
create trigger prepare_emergency_incident
before insert or update on public.emergency_incidents
for each row execute function app_private.prepare_emergency_incident();

-- ---------------------------------------------------------------------------
-- 5. Replace the uuid-based policies with Firebase-UID policies
-- ---------------------------------------------------------------------------
drop policy if exists emergency_incidents_select_own
  on public.emergency_incidents;
drop policy if exists emergency_incidents_insert_authenticated
  on public.emergency_incidents;
drop policy if exists emergency_incidents_update_admin
  on public.emergency_incidents;
drop policy if exists emergency_incidents_select_own_or_staff
  on public.emergency_incidents;
drop policy if exists emergency_incidents_insert_own
  on public.emergency_incidents;
drop policy if exists emergency_incidents_update_staff
  on public.emergency_incidents;

create policy emergency_incidents_select_own_or_staff
on public.emergency_incidents
for select
to authenticated
using (
  requester_firebase_uid = app_private.current_firebase_uid()
  or app_private.is_emergency_staff()
);

create policy emergency_incidents_insert_own
on public.emergency_incidents
for insert
to authenticated
with check (
  requester_firebase_uid = app_private.current_firebase_uid()
  and app_private.is_active_user()
);

create policy emergency_incidents_update_staff
on public.emergency_incidents
for update
to authenticated
using (app_private.is_emergency_staff())
with check (app_private.is_emergency_staff());

-- No DELETE policy: incidents are only ever resolved, never deleted.

-- ---------------------------------------------------------------------------
-- 6. Tighten API grants and add lookup indexes
-- ---------------------------------------------------------------------------
revoke all on table public.emergency_incidents from anon;
revoke delete, truncate, references, trigger
  on table public.emergency_incidents from authenticated;

create index if not exists emergency_incidents_requester_uid_idx
  on public.emergency_incidents (requester_firebase_uid, created_at desc);
create index if not exists emergency_incidents_status_idx
  on public.emergency_incidents (status, created_at desc);

commit;

notify pgrst, 'reload schema';

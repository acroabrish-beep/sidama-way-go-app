-- Gate C optional driver/vehicle setup for testing ticket verification.
-- NOT applied automatically by deploy.
-- Applied manually to eolmukwhzuvscworgwwx on 2026-10-24 for the taxi demo account.
--
-- Use this only on a test account. Replace every occurrence of
-- REPLACE_WITH_DRIVER_FIREBASE_UID with the driver account's Firebase UID.
-- The account must have signed in at least once so its public.users row exists.
--
-- Apply with:
--   supabase db query --linked --file public/supabase/seed_gate_c_demo_driver.sql

begin;

do $$
begin
  if not exists (
    select 1
    from public.users
    where firebase_uid = 'REPLACE_WITH_DRIVER_FIREBASE_UID'
  ) then
    raise exception
      'No public.users row for the driver UID. Sign in once to sync the profile, then retry.';
  end if;
end $$;

with driver_user as (
  update public.users
  set role = 'driver',
      user_type = 'driver',
      is_active = true,
      is_approved = true,
      status = 'active'
  where firebase_uid = 'REPLACE_WITH_DRIVER_FIREBASE_UID'
  returning id, firebase_uid
), demo_vehicle as (
  insert into public.vehicles (
    registration_number,
    vehicle_type,
    capacity,
    status,
    owner_id
  )
  select 'DEMO-TAXI-001', 'taxi', 4, 'active', driver_user.id
  from driver_user
  on conflict (registration_number) do update
    set vehicle_type = excluded.vehicle_type,
        capacity = excluded.capacity,
        status = excluded.status,
        owner_id = excluded.owner_id
  returning id
), demo_driver as (
  insert into public.drivers (
    user_id,
    license_number,
    license_expiry,
    vehicle_id,
    status
  )
  select
    driver_user.id,
    'DEMO-LICENSE-' || driver_user.firebase_uid,
    current_date + 365,
    demo_vehicle.id,
    'on_duty'
  from driver_user
  cross join demo_vehicle
  on conflict (user_id) do update
    set license_expiry = excluded.license_expiry,
        vehicle_id = excluded.vehicle_id,
        status = 'on_duty'
  returning id, user_id, vehicle_id, status
)
select
  driver_user.id as user_id,
  demo_vehicle.id as vehicle_id,
  'DEMO-TAXI-001' as registration_number,
  'taxi' as vehicle_type,
  demo_driver.status as driver_status
from driver_user
cross join demo_vehicle
cross join demo_driver;

commit;

-- Staging demo seed for the healthcare tables.
-- NOT applied automatically by deploy.
--
-- Every facility and doctor below is explicitly labeled "(Sample)" / "Sample".
-- These are NOT real institutions or clinicians, and no phone, email, website,
-- rating, or bed count is invented. The rows are unverified (verified = false).
--
-- Appointments are intentionally not seeded: they are created by the booking
-- flow for the signed-in patient. Seeding them would invent patient records.
--
-- Safe to re-run: fixed UUIDs with ON CONFLICT UPDATE.
--
-- Apply with:
--   supabase db query --linked --file public/supabase/seed_healthcare_demo.sql
--
-- Rollback (run only with explicit approval):
--   delete from public.healthcare_doctors
--    where id in (
--      '00000000-0000-4000-8000-00000000d101',
--      '00000000-0000-4000-8000-00000000d102',
--      '00000000-0000-4000-8000-00000000d103',
--      '00000000-0000-4000-8000-00000000d104',
--      '00000000-0000-4000-8000-00000000d105',
--      '00000000-0000-4000-8000-00000000d106',
--      '00000000-0000-4000-8000-00000000d107'
--    );
--   delete from public.healthcare_facilities
--    where id in (
--      '00000000-0000-4000-8000-00000000f101',
--      '00000000-0000-4000-8000-00000000f102',
--      '00000000-0000-4000-8000-00000000f103'
--    );

begin;

insert into public.healthcare_facilities (
  id,
  name,
  facility_type,
  location,
  address,
  opening_hours,
  verified
)
values
  (
    '00000000-0000-4000-8000-00000000f101',
    'Hawassa Referral Hospital (Sample)',
    'hospital',
    ST_SetSRID(ST_MakePoint(38.4750, 7.0520), 4326)::public.geography,
    'Sample Road, Hawassa',
    '24/7',
    false
  ),
  (
    '00000000-0000-4000-8000-00000000f102',
    'Adare General Hospital (Sample)',
    'hospital',
    ST_SetSRID(ST_MakePoint(38.4660, 7.0430), 4326)::public.geography,
    'Sample Avenue, Hawassa',
    '24/7',
    false
  ),
  (
    '00000000-0000-4000-8000-00000000f103',
    'Lakeview Family Clinic (Sample)',
    'clinic',
    ST_SetSRID(ST_MakePoint(38.4830, 7.0580), 4326)::public.geography,
    'Sample Street, Hawassa',
    '08:00-18:00',
    false
  )
on conflict (id) do update
  set name = excluded.name,
      facility_type = excluded.facility_type,
      location = excluded.location,
      address = excluded.address,
      opening_hours = excluded.opening_hours,
      verified = excluded.verified,
      updated_at = now();

insert into public.healthcare_doctors (
  id,
  facility_id,
  name,
  specialty,
  is_active,
  created_by_firebase_uid
)
values
  (
    '00000000-0000-4000-8000-00000000d101',
    '00000000-0000-4000-8000-00000000f101',
    'Dr. Sample Bekele',
    'General Medicine',
    true,
    'seed:healthcare-demo'
  ),
  (
    '00000000-0000-4000-8000-00000000d102',
    '00000000-0000-4000-8000-00000000f101',
    'Dr. Sample Hana',
    'Pediatrics',
    true,
    'seed:healthcare-demo'
  ),
  (
    '00000000-0000-4000-8000-00000000d103',
    '00000000-0000-4000-8000-00000000f101',
    'Dr. Sample Dawit',
    'Cardiology',
    true,
    'seed:healthcare-demo'
  ),
  (
    '00000000-0000-4000-8000-00000000d104',
    '00000000-0000-4000-8000-00000000f102',
    'Dr. Sample Meron',
    'Obstetrics and Gynecology',
    true,
    'seed:healthcare-demo'
  ),
  (
    '00000000-0000-4000-8000-00000000d105',
    '00000000-0000-4000-8000-00000000f102',
    'Dr. Sample Yonas',
    'Emergency Medicine',
    true,
    'seed:healthcare-demo'
  ),
  (
    '00000000-0000-4000-8000-00000000d106',
    '00000000-0000-4000-8000-00000000f103',
    'Dr. Sample Selam',
    'Family Medicine',
    true,
    'seed:healthcare-demo'
  ),
  (
    '00000000-0000-4000-8000-00000000d107',
    '00000000-0000-4000-8000-00000000f103',
    'Dr. Sample Lensa',
    'Dermatology',
    true,
    'seed:healthcare-demo'
  )
on conflict (id) do update
  set facility_id = excluded.facility_id,
      name = excluded.name,
      specialty = excluded.specialty,
      is_active = excluded.is_active;

commit;

-- Phase 2 demo data: three clearly labelled tourist sites in Hawassa.
-- Safe to re-run (fixed UUIDs + upserts). Coordinates are stored as PostGIS
-- geography; PostgREST reads them through public.tourist_sites_with_location.

begin;

insert into public.tourist_sites (
  id, name, description, category, location, address, opening_hours,
  website, phone, entrance_fee, rating, reviews_count, images_urls, verified
) values
  (
    'c1000000-0000-4000-8000-000000000001',
    'Lake Hawassa',
    '(Sample) The Rift Valley lake at the heart of Hawassa. Promenade walks, birdwatching, and boat trips.',
    'natural',
    st_setsrid(st_makepoint(38.4782, 7.0433), 4326)::geography,
    'Hawassa Lake Promenade, Hawassa',
    'Open daily 06:00-18:00',
    null,
    '+251 46 220 3000',
    0,
    4.7,
    1280,
    array[]::text[],
    true
  ),
  (
    'c1000000-0000-4000-8000-000000000002',
    'Amora Gedel',
    '(Sample) Lakeside recreation area and fish market known for fresh tilapia and sunset views.',
    'natural',
    st_setsrid(st_makepoint(38.4660, 7.0500), 4326)::geography,
    'Amora Gedel Park, Hawassa',
    'Open daily 07:00-19:00',
    null,
    null,
    20,
    4.3,
    456,
    array[]::text[],
    true
  ),
  (
    'c1000000-0000-4000-8000-000000000003',
    'Sidama Cultural Museum',
    '(Sample) Exhibits on Sidama history, traditional houses, music, and crafts, with rotating cultural performances.',
    'cultural',
    st_setsrid(st_makepoint(38.4750, 7.0550), 4326)::geography,
    'Sidama Cultural Centre, Hawassa',
    'Mon-Sat 09:00-17:00',
    null,
    '+251 46 220 4000',
    50,
    4.5,
    210,
    array[]::text[],
    true
  )
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  location = excluded.location,
  address = excluded.address,
  opening_hours = excluded.opening_hours,
  website = excluded.website,
  phone = excluded.phone,
  entrance_fee = excluded.entrance_fee,
  rating = excluded.rating,
  reviews_count = excluded.reviews_count,
  images_urls = excluded.images_urls,
  verified = excluded.verified,
  updated_at = now();

commit;

select name, category, address, latitude, longitude, verified
from public.tourist_sites_with_location
where id in (
  'c1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000002',
  'c1000000-0000-4000-8000-000000000003'
)
order by name;

-- Phase 2 demo data: two clearly labelled sample hotels with three rooms each.
-- Safe to re-run (fixed UUIDs + upserts). No reservations are seeded, because
-- those must come from real citizen bookings.
--
-- The owner value is a synthetic label, not an auth account. Published sample
-- hotels are readable by every signed-in user, and hotel staff can manage them.

begin;

insert into public.hotels (
  id, owner_firebase_uid, name, description, address, city, phone,
  latitude, longitude, star_rating, image_urls, status
) values
  (
    'a1000000-0000-4000-8000-000000000001',
    'seed:sample-hotel-owner',
    '(Sample) Hawassa Lakeview Hotel',
    'Demo record seeded for Phase 2 testing. Standard, deluxe, and suite rooms overlooking Lake Hawassa.',
    'Lake Hawassa Promenade, Hawassa',
    'Hawassa',
    '+251 46 220 1000',
    7.0433, 38.4782, 4,
    array[]::text[],
    'published'
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    'seed:sample-hotel-owner',
    '(Sample) Sidama Cultural Lodge',
    'Demo record seeded for Phase 2 testing. Rooms a short walk from the Sidama cultural centre.',
    'Tabor Sub-city, Hawassa',
    'Hawassa',
    '+251 46 220 2000',
    6.9988, 38.4700, 3,
    array[]::text[],
    'published'
  )
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  address = excluded.address,
  city = excluded.city,
  phone = excluded.phone,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  star_rating = excluded.star_rating,
  image_urls = excluded.image_urls,
  status = excluded.status;

insert into public.hotel_rooms (
  id, hotel_id, room_number, room_type, capacity, nightly_rate, currency, status
) values
  (
    'b1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    '101', 'Standard Double', 2, 1800.00, 'ETB', 'available'
  ),
  (
    'b1000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000001',
    '102', 'Deluxe Lake View', 2, 2500.00, 'ETB', 'available'
  ),
  (
    'b1000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000001',
    '201', 'Family Suite', 4, 4200.00, 'ETB', 'available'
  ),
  (
    'b1000000-0000-4000-8000-000000000004',
    'a1000000-0000-4000-8000-000000000002',
    '01', 'Standard Single', 1, 1200.00, 'ETB', 'available'
  ),
  (
    'b1000000-0000-4000-8000-000000000005',
    'a1000000-0000-4000-8000-000000000002',
    '02', 'Standard Double', 2, 1600.00, 'ETB', 'available'
  ),
  (
    'b1000000-0000-4000-8000-000000000006',
    'a1000000-0000-4000-8000-000000000002',
    '03', 'Garden Chalet', 3, 2800.00, 'ETB', 'available'
  )
on conflict (id) do update set
  hotel_id = excluded.hotel_id,
  room_number = excluded.room_number,
  room_type = excluded.room_type,
  capacity = excluded.capacity,
  nightly_rate = excluded.nightly_rate,
  currency = excluded.currency,
  status = excluded.status;

commit;

select h.name,
       h.city,
       h.star_rating,
       count(r.id)::int as rooms,
       min(r.nightly_rate) as lowest_rate,
       max(r.nightly_rate) as highest_rate
from public.hotels h
left join public.hotel_rooms r on r.hotel_id = h.id
where h.id in (
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002'
)
group by h.id, h.name, h.city, h.star_rating
order by h.name;

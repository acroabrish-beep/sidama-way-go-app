-- Sidama Way Go CityOS - Expo 2026 Demo Dataset (Hawassa Context)
-- Production Seeding Script for Supabase PostgreSQL
-- Bounded within Hawassa municipal area coordinates: 7°03'N 38°28'E

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- FLEET DATA (255 Vehicles)
-- ============================================

-- Taxis (100)
INSERT INTO vehicles (id, plate_number, type, capacity, current_location, status, fuel_level, created_at, updated_at) 
SELECT 
  uuid_generate_v4(),
  'TAXI-' || LPAD((row_number() OVER (ORDER BY random()))::text, 5, '0'),
  'taxi',
  4,
  jsonb_build_object(
    'lat', (7.0 + random() * 0.1)::numeric,
    'lng', (38.45 + random() * 0.1)::numeric
  ),
  CASE WHEN random() > 0.3 THEN 'online' ELSE 'offline' END,
  (random() * 100)::numeric(5,2),
  NOW(),
  NOW()
FROM generate_series(1, 100);

-- Bajajs (80)
INSERT INTO vehicles (id, plate_number, type, capacity, current_location, status, fuel_level, created_at, updated_at) 
SELECT 
  uuid_generate_v4(),
  'BAJAJ-' || LPAD((row_number() OVER (ORDER BY random()))::text, 5, '0'),
  'bajaj',
  3,
  jsonb_build_object(
    'lat', (7.0 + random() * 0.1)::numeric,
    'lng', (38.45 + random() * 0.1)::numeric
  ),
  CASE WHEN random() > 0.4 THEN 'online' ELSE 'offline' END,
  (random() * 80)::numeric(5,2),
  NOW(),
  NOW()
FROM generate_series(1, 80);

-- Minibuses (30)
INSERT INTO vehicles (id, plate_number, type, capacity, current_location, status, fuel_level, created_at, updated_at) 
SELECT 
  uuid_generate_v4(),
  'MINI-' || LPAD((row_number() OVER (ORDER BY random()))::text, 5, '0'),
  'bus',
  14,
  jsonb_build_object(
    'lat', (7.0 + random() * 0.1)::numeric,
    'lng', (38.45 + random() * 0.1)::numeric
  ),
  CASE WHEN random() > 0.5 THEN 'online' ELSE 'offline' END,
  (random() * 60)::numeric(5,2),
  NOW(),
  NOW()
FROM generate_series(1, 30);

-- Buses (10)
INSERT INTO vehicles (id, plate_number, type, capacity, current_location, status, fuel_level, created_at, updated_at) 
SELECT 
  uuid_generate_v4(),
  'BUS-' || LPAD((row_number() OVER (ORDER BY random()))::text, 5, '0'),
  'bus',
  40,
  jsonb_build_object(
    'lat', (7.0 + random() * 0.1)::numeric,
    'lng', (38.45 + random() * 0.1)::numeric
  ),
  CASE WHEN random() > 0.6 THEN 'online' ELSE 'offline' END,
  (random() * 80)::numeric(5,2),
  NOW(),
  NOW()
FROM generate_series(1, 10);

-- Ambulances (5)
INSERT INTO vehicles (id, plate_number, type, capacity, current_location, status, fuel_level, created_at, updated_at) 
SELECT 
  uuid_generate_v4(),
  'AMB-' || LPAD((row_number() OVER (ORDER BY random()))::text, 5, '0'),
  'emergency',
  2,
  jsonb_build_object(
    'lat', (7.05 + random() * 0.05)::numeric,
    'lng', (38.48 + random() * 0.05)::numeric
  ),
  'online',
  (random() * 90)::numeric(5,2),
  NOW(),
  NOW()
FROM generate_series(1, 5);

-- Police Vehicles (5)
INSERT INTO vehicles (id, plate_number, type, capacity, current_location, status, fuel_level, created_at, updated_at) 
SELECT 
  uuid_generate_v4(),
  'POL-' || LPAD((row_number() OVER (ORDER BY random()))::text, 5, '0'),
  'government',
  4,
  jsonb_build_object(
    'lat', (7.02 + random() * 0.08)::numeric,
    'lng', (38.46 + random() * 0.08)::numeric
  ),
  'online',
  (random() * 85)::numeric(5,2),
  NOW(),
  NOW()
FROM generate_series(1, 5);

-- Fire Trucks (5)
INSERT INTO vehicles (id, plate_number, type, capacity, current_location, status, fuel_level, created_at, updated_at) 
SELECT 
  uuid_generate_v4(),
  'FIRE-' || LPAD((row_number() OVER (ORDER BY random()))::text, 5, '0'),
  'emergency',
  3,
  jsonb_build_object(
    'lat', (7.03 + random() * 0.06)::numeric,
    'lng', (38.47 + random() * 0.06)::numeric
  ),
  'online',
  (random() * 95)::numeric(5,2),
  NOW(),
  NOW()
FROM generate_series(1, 5);

-- ============================================
-- INFRASTRUCTURE DATA
-- ============================================

-- Hotels (20)
INSERT INTO hotels (id, name, description, location, address, phone, email, star_rating, price_range, status, created_at, updated_at) 
SELECT 
  uuid_generate_v(),
  'Hawassa ' || (array['Lake View', 'Mountain View', 'City Center', 'Sidama Plaza', 'Sheba', 'Haile Resort', 'Tabor', 'Amora', 'Panafric', 'International', 'Soviet', 'Friendship', 'African', 'Paradise', 'Sunset', 'Sunrise', 'Grand', 'Royal', 'Luxury'])[row_number() OVER (ORDER BY random())],
  'Premium hotel in Hawassa with modern amenities and stunning views of Lake Hawassa.',
  jsonb_build_object(
    'lat', (7.0 + random() * 0.08)::numeric,
    'lng', (38.45 + random() * 0.08)::numeric
  ),
  'Main Street, Hawassa',
  '+251 461 ' || (array['1234', '5678', '9012', '3456', '7890'])[row_number() OVER ( ORDER BY random())],
  'info@hotel' || (row_number() OVER (ORDER BY random()))::text || '@hawassa.com',
  3 + (row_number() OVER (ORDER BY random()) % 3),
  CASE 
    WHEN row_number() OVER (ORDER BY random()) % 3 = 0 THEN 'Budget ($20-50)'
    WHEN row_number() OVER (ORDER BY random()) % 3 = 1 THEN 'Mid-range ($50-100)'
    ELSE 'Luxury ($100+)'
  END,
  'active',
  NOW(),
  NOW()
FROM generate_series(1, 20);

-- Hospitals (15)
INSERT INTO hospitals (id, name, type, location, address, phone, emergency_phone, beds_available, status, created_at, updated_at) 
SELECT 
  uuid_generate_v4(),
  'Hawassa ' || (array['General', 'Specialized', 'Teaching', 'Referral', 'Primary Care', 'Maternity', 'Pediatric', 'Eye', 'Dental', 'Orthopedic', 'Cardiac', 'Neurology', 'Oncology', 'Psychiatric'])[row_number() OVER (ORDER BY random())],
  jsonb_build_object(
    'lat', (7.02 + random() * 0.06)::numeric,
    'lng', (38.46 + random() * 0.06)::numeric
  ),
  'Hospital Road, Hawassa',
  '+251 461 ' || (array['1000', '2000', '3000', '4000', '5000', '6000', '7000', '8000', '9000'])[row_number() OVER ( ORDER BY random())],
  '+251 461 ' || (array['1001', '2001', '3001', '4001', '5001'])[row_number() OVER ( ORDER BY random())],
  (random() * 100 + 20)::integer,
  'active',
  NOW(),
  NOW()
FROM generate_series(1, 15);

-- Tourism Sites (25)
INSERT INTO tourism_sites (id, name, description, category, location, address, entrance_fee, rating, status, created_at, updated_at) 
SELECT 
  uuid_generate_v(),
  (array['Lake Hawassa', 'Amora Gedel', 'Tabor Mountain', 'Sidama New Year Festival Site', 'Fichee-Chambalaala Cultural Center', 'Sidama Cultural Museum', 'Hawassa Museum', 'St. Gabriel Church', 'Bole Sub-City Park', 'Haile Resort Beach', 'Gudumale Falls', 'Garamba Forest', 'Alebelo Cave', 'Tula Hot Springs', 'Shoa Sub-City Historic Site', 'Hawassa Stadium', 'Sidama Stadium', 'University of Hawassa Campus', 'Hawassa University Campus', 'Sidama Zone Conference Center', 'Millennium Hall', 'Lake Tana Viewpoint', 'Fish Market Tourist Site', 'Sidama Coffee Plantation', 'Maribo Village', 'Wondo Genet'])[row_number() OVER (ORDER BY random())],
  'One of the most popular tourist destinations in the Sidama Region.',
  (array['natural', 'cultural', 'historical', 'recreational'])[row_number() OVER (ORDER BY random())],
  jsonb build_object(
    'lat', (7.0 + random() * 0.1)::numeric,
    'lng', (38.45 + random() * 0.1)::numeric
  ),
  'Tourist Road, Hawassa',
  CASE 
    WHEN row_number() OVER (ORDER BY random()) % 2 = 0 THEN 50.00
    ELSE 0.00
  END,
  (random() * 2 + 3)::numeric(3,2),
  'active',
  NOW(),
  NOW()
FROM generate_series(1, 25);

-- ============================================
-- TAXI STATIONS (8 Main Stations)
-- ============================================

INSERT INTO taxi_stations (id, name, location, address, online_taxi_count, waiting_passengers, total_capacity, status, created_at, updated_at) 
SELECT 
  uuid_generate_v4(),
  (array['Piazza Station', 'Bus Terminal', 'Main Street', 'University Campus', 'Hospital Area', 'Market Place', 'Industrial Zone', 'Airport Road'])[row_number() OVER (ORDER BY random())],
  jsonb_build_object(
    'lat', (7.0 + random() * 0.05)::numeric,
    'lng', (38.45 + random() * 0.05)::numeric
  ),
  'Station ' || (row_number() OVER (ORDER BY random()))::text || ' Road, Hawassa',
  (random() * 10 + 5)::integer,
  (random() * 15)::integer,
  20,
  'active',
  NOW(),
  NOW()
FROM generate_series(1, 8);

-- ============================================
-- ANNOUNCEMENTS (5 Sample)
-- ============================================

INSERT INTO announcements (id, title, content, type, target_audience, is_active, priority, created_at, updated_at) 
SELECT 
  uuid_generate_v4(),
  (array['Welcome to Sidama Way Go', 'New Taxi Routes Added', 'Emergency Services Enhanced', 'Tourism Season Started', 'Fichee-Chambalaala Festival Announcement'])[row_number() OVER (ORDER BY random())],
  'Important announcement for all users of the Sidama Way Go CityOS platform.',
  'general',
  jsonb_build_array('citizen', 'driver', 'tourist', 'government'),
  true,
  (array['low', 'normal', 'high', 'urgent'])[row_number() OVER (ORDER BY random())],
  NOW(),
  NOW()
FROM generate_series(1, 5);

-- ============================================
-- EMERGENCY CENTERS (4)
-- ============================================

INSERT INTO emergency_centers (id, name, type, location, address, phone, jurisdiction, status, created_at, updated_at) 
SELECT 
  uuid_generate_v(),
  (array['Hawassa Police Station', 'Hawassa Fire Station', 'Hawassa Regional Hospital', 'Ambulance Dispatch Center'])[row_number() OVER (ORDER BY random())],
  (array['police', 'fire', 'medical', 'dispatch'])[row_number() OVER (ORDER BY random())],
  jsonb_build_object(
    'lat', (7.02 + random() * 0.05)::numeric,
    'lng', (38.46 + random() * 0.05)::numeric
  ),
  'Emergency Center ' || (row_number() OVER (ORDER BY random()))::text || ' Road, Hawassa',
  '+251 461 ' || (array['911', '912', '913', '914'])[row_number() OVER (ORDER BY random())],
  'Hawassa City',
  'active',
  NOW(),
  NOW()
FROM generate_series(1, 4);

-- ============================================
-- ADMIN USERS (1 Super Admin + Key Role Users)
-- ============================================

INSERT INTO users (id, firebase_uid, full_name, email, phone, role, status, is_approved, is_active, wallet_balance, membership_number, created_at, last_login, updated_at) 
VALUES
  (uuid_generate_v4(), 'super_admin_001', 'Super Admin', 'admin@sidamawaygo.com', '+2514610000', 'superAdmin', 'active', true, true, 0.00, 'SWG-SUPER-001', NOW(), NOW(), NOW()),
  (uuid_generate_v4(), 'taxi_admin_001', 'Taxi Admin', 'taxi@sidamawaygo.com', '+2514610001', 'taxiAdmin', 'active', true, true, 0.00, 'SWG-TAXI-001', NOW(), NOW(), NOW()),
  (uuid_generate_v4(), 'tourism_admin_001', 'Tourism Admin', 'tourism@sidamawaygo.com', '+2514610002', 'tourismAdmin', 'active', true, true, 0.00, 'SWG-TOURISM-001', NOW(), NOW(), NOW()),
  (uuid_generate_v4(), 'emergency_admin_001', 'Emergency Admin', 'emergency@sidamawaygo.com', '+2514610003', 'emergencyAdmin', 'active', true, true, 0.00, 'SWG-EMERGENCY-001', NOW(), NOW(), NOW()),
  (uuid_generate_v4(), 'health_admin_001', 'Health Admin', 'health@sidamawaygo.com', '+2514610004', 'healthAdmin', 'active', true, true, 0.00, 'SWG-HEALTH-001', NOW(), NOW(), NOW());

-- ============================================
-- SYSTEM CONFIGURATION
-- ============================================

INSERT INTO system_config (key, value, description, is_public, created_at, updated_at) VALUES
  ('app_version', '1.0.0', 'Current application version', true, NOW(), NOW()),
  ('maintenance_mode', 'false', 'System maintenance mode', false, NOW(), NOW()),
  ('min_app_version', '1.0.0', 'Minimum supported app version', true, NOW(), NOW()),
  ('emergency_contact', '911', 'Emergency contact number', true, NOW(), NOW()),
  ('support_email', 'support@sidamawaygo.com', 'Support email address', true, NOW(), NOW()),
  ('commission_rate_taxi', '15.00', 'Default commission rate for taxi services', false, NOW(), NOW()),
  ('commission_rate_bus', '10.00', 'Default commission rate for bus services', false, NOW(), NOW()),
  ('commission_rate_hotel', '12.00', 'Default commission rate for hotel bookings', false, NOW(), NOW()),
  ('commission_rate_tourism', '8.00', 'Default commission rate for tourism services', false, NOW(), NOW()),
  ('city_name', 'Hawassa', 'City name', true, NOW(), NOW()),
  ('region', 'Sidama', 'Region name', true, NOW(), NOW()),
  ('country', 'Ethiopia', 'Country name', true, NOW(), NOW()),
  ('coordinates', '7°03''N 38°28''E', 'City coordinates', true, NOW(), NOW()),
  ('timezone', 'EAT', 'Timezone', true, NOW(), NOW()),
  ('currency', 'ETB', 'Default currency', true, NOW(), NOW()),
  ('language', 'en', 'Default language', true, NOW(), NOW());

-- ============================================
-- COMMISSION RATES
-- ============================================

INSERT INTO commission_rates (service_type, base_rate, platform_fee, government_tax, effective_from, is_active, created_at, updated_at) VALUES
  ('taxi', 15.00, 2.00, 5.00, NOW() - INTERVAL '1 year', true, NOW(), NOW()),
  ('bajaj', 12.00, 2.00, 5.00, NOW() - INTERVAL '1 year', true, NOW(), NOW()),
  ('bus', 10.00, 2.00, 5.00, NOW() - INTERVAL '1 year', true, NOW(), NOW()),
  ('hotel', 12.00, 3.00, 5.00, NOW() - INTERVAL '1 year', true, NOW(), NOW()),
  ('tourism', 8.00, 2.00, 5.00, NOW() - INTERVAL '1 year', true, NOW(), NOW()),
  ('emergency', 0.00, 0.00, 0.00, NOW() - INTERVAL '1 year', true, NOW(), NOW());

-- ============================================
-- ANALYTICS DATA (Sample)
-- ============================================

INSERT INTO analytics (metric_name, metric_value, timestamp, metadata) VALUES
  ('daily_active_users', jsonb_build_object('count', 1250, 'date', CURRENT_DATE), NOW(), jsonb_build_object('region', 'Sidama')),
  ('total_trips_today', jsonb_build_object('count', 342, 'date', CURRENT_DATE), NOW(), jsonb_build_object('region', 'Sidama')),
  ('total_revenue_today', jsonb_object('amount', 45230.50, 'currency', 'ETB', 'date', CURRENT_DATE), NOW(), jsonb_build_object('region', 'Sidama')),
  ('active_vehicles', jsonb_build_object('count', 185, 'date', CURRENT_DATE), NOW(), jsonb_build_object('region', 'Sidama')),
  ('emergency_response_time_avg', jsonb_build_object('minutes', 8.5, 'date', CURRENT_DATE), NOW(), jsonb_build_object('region', 'Sidama')),
  ('user_satisfaction', jsonb_build_object('score', 4.7, 'max', 5.0, 'date', CURRENT_DATE), NOW(), jsonb_build_object('region', 'Sidama'));

-- ============================================
-- VERIFICATION DATA
-- ============================================

-- Verify seed data counts
DO $$
DECLARE
  vehicle_count INT;
  hotel_count INT;
  hospital_count INT;
  tourism_count INT;
  station_count INT;
BEGIN
  SELECT COUNT(*) INTO vehicle_count FROM vehicles;
  SELECT COUNT(*) INTO hotel_count FROM hotels;
  SELECT COUNT(*) INTO hospital_count FROM hospitals;
  SELECT COUNT(*) INTO tourism_count FROM tourism_sites;
  SELECT COUNT(*) INTO station_count FROM taxi_stations;
  
  RAISE NOTICE 'Seed Data Verification: Vehicles=%, Hotels=%, Hospitals=%, Tourism=%, Stations=%', 
    vehicle_count, hotel_count, hospital_count, tourism_count, station_count;
END $$;

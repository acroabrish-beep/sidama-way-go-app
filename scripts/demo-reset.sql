-- ============================================================================
-- DEMO RESET - STAGING DATABASE ONLY - NEVER RUN IN PRODUCTION
-- ============================================================================
-- This is NOT a migration and is not executed by the application or by tests.
-- Run it manually, in the SQL editor of the staging Supabase project only,
-- after confirming the project ref is the staging project.
--
-- What it deletes (and nothing else):
--   * st_payments for tickets on routes that touch a "TEST ONLY" station
--   * st_tickets on those routes
--   * st_queue rows at "TEST ONLY" stations
--   * st_tariffs whose source_reference is 'TEST ONLY' or belong to those routes
--   * st_routes that touch a "TEST ONLY" station
--   * st_stations whose name starts with 'TEST ONLY'
--
-- It does NOT delete:
--   * citizen_reports
--   * users, vehicles, audit logs
--   * any station, route, tariff, ticket, payment, or queue row that is not
--     linked to the TEST ONLY fixture created by scripts/staging-test-data.sql
--
-- Re-running is safe. After reset, re-apply scripts/staging-test-data.sql if
-- the demo needs the TEST ONLY fixtures again.
-- ============================================================================

BEGIN;

DELETE FROM st_payments
WHERE ticket_id IN (
  SELECT t.id
  FROM st_tickets t
  JOIN st_routes r ON r.id = t.route_id
  WHERE r.from_station_id IN (SELECT id FROM st_stations WHERE name LIKE 'TEST ONLY%')
     OR r.to_station_id IN (SELECT id FROM st_stations WHERE name LIKE 'TEST ONLY%')
);

DELETE FROM st_tickets
WHERE route_id IN (
  SELECT r.id
  FROM st_routes r
  WHERE r.from_station_id IN (SELECT id FROM st_stations WHERE name LIKE 'TEST ONLY%')
     OR r.to_station_id IN (SELECT id FROM st_stations WHERE name LIKE 'TEST ONLY%')
);

DELETE FROM st_queue
WHERE station_id IN (SELECT id FROM st_stations WHERE name LIKE 'TEST ONLY%');

DELETE FROM st_tariffs
WHERE source_reference = 'TEST ONLY'
   OR route_id IN (
     SELECT r.id
     FROM st_routes r
     WHERE r.from_station_id IN (SELECT id FROM st_stations WHERE name LIKE 'TEST ONLY%')
        OR r.to_station_id IN (SELECT id FROM st_stations WHERE name LIKE 'TEST ONLY%')
   );

DELETE FROM st_routes
WHERE from_station_id IN (SELECT id FROM st_stations WHERE name LIKE 'TEST ONLY%')
   OR to_station_id IN (SELECT id FROM st_stations WHERE name LIKE 'TEST ONLY%');

DELETE FROM st_stations
WHERE name LIKE 'TEST ONLY%';

COMMIT;

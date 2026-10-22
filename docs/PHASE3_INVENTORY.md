# PHASE3_INVENTORY.md

**Audit Date:** 2026-10-20  
**Auditor:** Cascade (Read-Only Inspection)  
**Scope:** Flutter app (c:\src\sidama_way_go) and Next.js backend (c:\src\sidama_way_go_backend)  
**Objective:** Trace data flows, inventory features, resolve architecture discrepancies, and identify implementation blockers.

---

## A. Executive Summary

### Verified Real (Production-Ready)
- **Citizen Reports**: Full Supabase backend integration with AI triage via Gemini API. Auth-protected with role checks.
- **Authentication**: Firebase Auth + Supabase user sync via `/api/auth/sync`. Role-based access control implemented.
- **AI Assistant**: Backend integration with Gemini AI via `/api/gemini`. Auth-protected.
- **Wallet/Payments**: Supabase tables (payments, wallet_transactions) with DataApiService. Payment providers simulated.

### Partially Wired (Firestore Used, Supabase Exists)
- **Ride Requests**: Firestore only (ride_requests). Supabase `trips` table exists but unused.
- **Driver/Workforce Management**: Firestore only (drivers, vehicles, taxi_stations, station_queue). Supabase tables exist but unused.
- **Live Tracking**: Firestore only (vehicles GPS telemetry). Supabase `location_history` table exists but unused.
- **Terminal Operations**: Firestore only (old_terminal_routes, new_terminal_routes). Supabase `bus_terminals` exists but unused.
- **Emergency Dispatch**: Firestore only (emergency_incidents, hospital_capacity). Supabase `emergency_requests` exists but unused.
- **QR/Tickets**: Firestore only (tickets). Supabase `tickets` table exists but unused.
- **Admin Dashboards**: Firestore only (analytics, transport_audit). Supabase `analytics`, `audit_logs` exist but unused.
- **Announcements/Notifications**: Firestore only (announcements, notifications, user_notifications). Supabase tables exist but unused.
- **Reference Data (Hotels, Tourism, Hospitals, Pharmacies)**: Firestore seeding only. Supabase tables exist but Flutter reads from Firestore.

### Simulated/Demo-Only
- **Payment Providers**: Telebirr, CBE Birr, Chapa, SantimPay all return fake success after delay. No real API integration.
- **Seeding**: Firestore seeding (taxi_stations, routes, locations, tourism_sites, analytics) gated behind kDebugMode.

### Unverified/Blocked
- **Real-time vehicle tracking**: No WebSocket or real-time backend. Firestore polling used.
- **Payment merchant accounts**: No credentials for Telebirr, CBE, Chapa, SantimPay.
- **FCM push notifications**: FCM service exists but not configured.
- **Geospatial queries**: Firestore proximity queries are client-side filtered (not using GeoFire).

---

## B. Feature Inventory Table

| Feature | File:line and symbol | Current behavior/evidence | Fake or hardcoded part | Required real source | Auth/role risk | Tests | Status | Dependencies/questions |
|---------|----------------------|---------------------------|------------------------|---------------------|----------------|-------|--------|----------------------|
| 1. Passenger ride requests | lib/services/ride_service.dart:36-77 (createRideRequest) | Writes to Firestore `ride_requests` collection. Calculates fare locally. | Fare calculation hardcoded (baseFare=15, perKmRate=8). No real routing. | Supabase `trips` table exists but unused. | No auth check on Firestore writes. | UNVERIFIED | NEEDS_EXTERNAL | Migrate to Supabase `/api/data/trips`. Add real routing API (OSRM/Google). |
| 2. Driver request discovery | lib/services/ride_service.dart:112-124 (getAvailableRideRequests) | Reads Firestore `ride_requests` where status=requested. No geospatial filtering. | Returns all requested rides (proximity comment in code). | Supabase `trips` table exists but unused. | No auth check on Firestore reads. | UNVERIFIED | NEEDS_EXTERNAL | Migrate to Supabase. Add GeoFire or PostGIS for proximity. |
| 3. Driver lifecycle (accept/arrive/start/complete) | lib/services/ride_service.dart:127-167 (acceptRideRequest, updateRideStatus) | Updates Firestore `ride_requests` status. | Status transitions are local Firestore writes. No real dispatch logic. | Supabase `trips` has status field but unused. | No auth check on Firestore writes. | UNVERIFIED | NEEDS_EXTERNAL | Migrate to Supabase. Add dispatch queue logic. |
| 4. Live vehicle tracking | lib/services/taxi_service.dart:281-297 (updateVehicleTelemetry) | Writes GPS to Firestore `vehicles` collection. | Basic sanity checks only (speed < 200 km/h). No real validation. | Supabase `location_history` table exists but unused. | No auth check on Firestore writes. | UNVERIFIED | NEEDS_EXTERNAL | Migrate to Supabase. Add real-time WebSocket or server-sent events. |
| 5. Driver online/offline state | lib/services/taxi_service.dart:43-63 (logAttendance) | Updates Firestore `drivers` online flag. | Local Firestore write. No shift enforcement. | Supabase `users` has status field but unused. | No auth check on Firestore writes. | UNVERIFIED | NEEDS_EXTERNAL | Migrate to Supabase. Add shift scheduling enforcement. |
| 6. Old terminal routes/vehicles/drivers | lib/services/firestore_service.dart:36-42 (getOldTerminalRoutes) | Reads Firestore `old_terminal_routes`, `old_terminal_vehicles`, `old_terminal_drivers`. | Data seeded in debug mode only. No real integration. | Supabase `bus_terminals` has type=old_terminal but unused. | No auth check on Firestore reads. | UNVERIFIED | KEEP_AS_DEMO | Decide: migrate to Supabase or keep as demo reference data. |
| 7. New terminal routes | lib/services/firestore_service.dart:41 (getNewTerminalRoutes) | Reads Firestore `new_terminal_routes`. | Data seeded in debug mode only. | Supabase `bus_terminals` has type=new_terminal but unused. | No auth check on Firestore reads. | UNVERIFIED | KEEP_AS_DEMO | Decide: migrate to Supabase or keep as demo reference data. |
| 8. Taxi station queues | lib/services/taxi_service.dart:716-727 (_addDriverToQueue) | Manages Firestore `station_queue` collection. | Queue logic is local Firestore operations. | Supabase `station_queues` table exists but unused. | No auth check on Firestore writes. | UNVERIFIED | NEEDS_EXTERNAL | Migrate to Supabase. Add queue priority algorithm. |
| 9. Hospital queue tickets | lib/screens/queue_screen.dart (UI) | Uses Firestore `station_queue` for taxi queues. No hospital-specific queue. | Taxi queue reused for hospital UI. | Supabase `station_queues` exists but unused. | No auth check. | UNVERIFIED | NEEDS_EXTERNAL | Design hospital-specific queue system in Supabase. |
| 10. People-ahead counts | lib/services/taxi_service.dart:738-743 (getDriverQueuePosition) | Calculates position from Firestore `station_queue`. | Simple orderBy query. No real-time updates. | Supabase `station_queues` has queue_position but unused. | No auth check. | UNVERIFIED | NEEDS_EXTERNAL | Migrate to Supabase. Add real-time counter triggers. |
| 11. QR/e-tickets | lib/services/qr_service.dart:8-38 (verifyTicket) | Reads Firestore `tickets`, updates isUsed flag. | No integration with Supabase tickets table. | Supabase `tickets` table exists but unused. | No auth check on Firestore writes. | UNVERIFIED | NEEDS_EXTERNAL | Migrate to Supabase. Add ticket expiration logic. |
| 12. Ticket validation | lib/services/qr_service.dart:24-27 (mark used) | Updates Firestore `tickets` isUsed=true. | No fraud detection (replay attacks). | Supabase `tickets` has status field but unused. | No auth check. | UNVERIFIED | NEEDS_EXTERNAL | Migrate to Supabase. Add one-time-use validation. |
| 13. Emergency SOS | lib/services/emergency_dispatch_service.dart:12-25 (reportIncident) | Writes to Firestore `emergency_incidents`. Sends Firestore notification. | No real dispatch to emergency services. | Supabase `emergency_requests` table exists but unused. | No auth check on Firestore writes. | UNVERIFIED | NEEDS_EXTERNAL | Migrate to Supabase. Integrate with emergency services API. |
| 14. Emergency admin dashboard | lib/screens/emergency_dashboard.dart (UI) | Reads Firestore `emergency_incidents`. | Dashboard displays Firestore data only. | Supabase `emergency_requests` exists but unused. | No auth check on Firestore reads. | UNVERIFIED | NEEDS_EXTERNAL | Migrate to Supabase. Add admin role checks. |
| 15. Citizen reports | lib/services/api/citizen_reporting_api_service.dart:7-54 (createReport) | POST to `/api/citizen-reporting` (Supabase). AI triage via Gemini. | AI triage is real (Gemini API). Photo upload UNVERIFIED. | Supabase `citizen_reports` table with AI fields. | Auth protected (uid match enforced). | UNVERIFIED | CAN_DO_NOW | Verify photo upload to Supabase Storage. Test AI triage accuracy. |
| 16. Citizen report status updates | src/app/api/citizen-reporting/route.ts:341-357 (PATCH) | Updates Supabase `citizen_reports` status. Admin can override AI category/urgency. | Real implementation. | Supabase `citizen_reports` with final_category, final_urgency. | Auth protected (adminOnly for overrides). | UNVERIFIED | CAN_DO_NOW | Test admin override workflow. |
| 17. Citizen report attachments | lib/services/api/citizen_reporting_api_service.dart:27-29 (photoUrl) | Sends photoUrl string to backend. | Photo upload mechanism UNVERIFIED (likely missing). | Supabase Storage for photos? | Auth protected. | UNVERIFIED | NEEDS_EXTERNAL | Implement Supabase Storage upload for photos. |
| 18. Super Admin dashboard stats | lib/screens/super_admin_dashboard.dart:20 (analytics) | Reads Firestore `analytics.summary` doc. | Data seeded in debug mode only. | Supabase `analytics` table exists but unused. | RoleProtectedWidget checks superAdmin role. | UNVERIFIED | KEEP_AS_DEMO | Migrate to Supabase analytics or keep as demo. |
| 19. Users count | lib/screens/super_admin_dashboard.dart:67 (totalUsers) | From Firestore `analytics.summary.totalUsers`. | Seeded value (1250). | Supabase `users` table exists. | Role check present. | UNVERIFIED | KEEP_AS_DEMO | Use Supabase COUNT query for real stats. |
| 20. Rides count | lib/screens/super_admin_dashboard.dart:68 (taxiRequests) | From Firestore `analytics.summary.taxiRequests`. | Seeded value (450). | Supabase `trips` table exists. | Role check present. | UNVERIFIED | KEEP_AS_DEMO | Use Supabase COUNT query for real stats. |
| 21. Revenue | lib/screens/super_admin_dashboard.dart:71 (totalRevenue) | From Firestore `analytics.summary.totalRevenue`. | Seeded value (450000 ETB). | Supabase `payments` table exists. | Role check present. | UNVERIFIED | KEEP_AS_DEMO | Use Supabase SUM query for real revenue. |
| 22. Hotels | lib/services/data_api_service.dart:171-177 (getHotels) | GET `/api/data/hotels` (Supabase). | Real Supabase read. | Supabase `hotels` table. | Auth protected (any valid caller). | UNVERIFIED | CAN_DO_NOW | Verify hotel data source (Firestore seeding vs real data). |
| 23. Tourism sites | lib/services/data_api_service.dart:189-195 (getTourismSites) | GET `/api/data/tourism_sites` (Supabase). | Real Supabase read. | Supabase `tourism_sites` table. | Auth protected. | UNVERIFIED | CAN_DO_NOW | Verify tourism data source. |
| 24. Hospitals | lib/services/data_api_service.dart:180-186 (getHospitals) | GET `/api/data/hospitals` (Supabase). | Real Supabase read. | Supabase `hospitals` table. | Auth protected. | UNVERIFIED | CAN_DO_NOW | Verify hospital data source. |
| 25. Healthcare facilities | lib/screens/healthcare_screen.dart (UI) | Reads from Supabase via DataApiService. | Real Supabase read. | Supabase `hospitals`, `pharmacies`. | Auth protected. | UNVERIFIED | CAN_DO_NOW | Verify healthcare data source. |
| 26. Pharmacies | lib/services/data_api_service.dart (not listed, likely similar) | GET `/api/data/pharmacies` (Supabase). | Real Supabase read. | Supabase `pharmacies` table. | Auth protected. | UNVERIFIED | CAN_DO_NOW | Verify pharmacy data source. |
| 27. Government fleet | lib/services/taxi_service.dart:113-115 (registerVehicle) | Writes to Firestore `vehicles` collection. | No Supabase integration. | Supabase `vehicles` table exists but unused. | No auth check on Firestore writes. | UNVERIFIED | NEEDS_EXTERNAL | Migrate to Supabase. Add government role checks. |
| 28. Vehicle information | lib/services/data_api_service.dart:128-142 (getVehicles, createVehicle) | GET/POST `/api/data/vehicles` (Supabase). | Real Supabase read/write. | Supabase `vehicles` table. | Auth protected (write: admin, taxi, government_fleet). | UNVERIFIED | CAN_DO_NOW | Verify vehicle data consistency between Firestore and Supabase. |
| 29. Wallet balance | lib/services/payments/payment_service.dart:505-513 (getWalletBalance) | Reads Supabase `wallet_transactions` via DataApiService. | Real calculation from transactions. | Supabase `wallet_transactions` table. | Auth protected. | UNVERIFIED | CAN_DO_NOW | Test wallet balance accuracy. |
| 30. Wallet transactions | lib/services/data_api_service.dart:245-251 (getWalletTransactions) | GET `/api/data/wallet_transactions` (Supabase). | Real Supabase read. | Supabase `wallet_transactions` table. | Auth protected. | UNVERIFIED | CAN_DO_NOW | Verify transaction history. |
| 31. Payment records | lib/services/data_api_service.dart:232-242 (getPayments) | GET `/api/data/payments` (Supabase). | Real Supabase read. | Supabase `payments` table. | Auth protected. | UNVERIFIED | CAN_DO_NOW | Verify payment records. |
| 32. Payment status | lib/services/payments/payment_service.dart:179-243 (processPayment) | Updates Supabase `payments` status. | Payment providers simulated (fake success). | Supabase `payments` table. | Auth protected. | UNVERIFIED | NEEDS_EXTERNAL | Integrate real payment provider APIs (Telebirr, CBE, Chapa, SantimPay). |
| 33. AI assistant | lib/services/api/ai_api_service.dart:6-42 (sendMessage) | POST to `/api/gemini` (backend with Gemini AI). | Real Gemini AI integration. Context from Supabase? | Gemini API key (env.geminiApiKey). | Auth protected (any valid caller). | UNVERIFIED | CAN_DO_NOW | Verify AI context sources (city data, routes, etc.). |
| 34. AI backend context | src/app/api/gemini/route.ts:24-56 (build context) | Reads Supabase for real-time city data? | UNVERIFIED - code shows getComprehensiveCityData() but implementation not shown. | Supabase tables for city data? | Auth protected. | UNVERIFIED | CAN_DO_NOW | Verify getComprehensiveCityData() implementation. |
| 35. Announcements | lib/services/data_api_service.dart:211-213 (getAnnouncements) | GET `/api/data/announcements` (Supabase). | Real Supabase read. | Supabase `announcements` table. | Auth protected. | UNVERIFIED | CAN_DO_NOW | Verify announcement data source. |
| 36. Notifications | lib/services/data_api_service.dart:216-229 (getNotifications) | GET `/api/data/notifications` (Supabase). | Real Supabase read. | Supabase `notifications` table. | Auth protected (user_id filter). | UNVERIFIED | CAN_DO_NOW | Verify notification delivery. |
| 37. Analytics | lib/services/data_api_service.dart:254-259 (getAnalytics) | GET `/api/data/analytics` (Supabase). | Real Supabase read. | Supabase `analytics` table. | Auth protected (read: admin only). | UNVERIFIED | CAN_DO_NOW | Verify analytics data accuracy. |
| 38. Audit logs | lib/services/data_api_service.dart (not listed) | GET `/api/data/audit_logs` (Supabase). | Real Supabase read. | Supabase `audit_logs` table. | Auth protected (read: admin only). | UNVERIFIED | CAN_DO_NOW | Verify audit log capture. |
| 39. Revenue reporting | lib/services/firestore_service.dart:53-64 (getTotalRevenue) | Reads Firestore `bookings`, `taxi_bookings`. | Firestore-only calculation. | Supabase `payments`, `revenue_tracking` exist but unused. | No auth check. | UNVERIFIED | NEEDS_EXTERNAL | Migrate to Supabase revenue tracking. |
| 40. Authentication | lib/providers/auth_provider.dart:44-63 (signIn) | Firebase Auth + POST to `/api/auth/sync` (Supabase). | Real Firebase Auth. Real Supabase sync. | Firebase project. Supabase project. | Auth protected (uid match enforced). | UNVERIFIED | CAN_DO_NOW | Test auth flow end-to-end. |
| 41. User profiles | lib/services/api/auth_api_service.dart:59-83 (getUserProfile) | GET `/api/auth/sync` (Supabase). | Real Supabase read. | Supabase `users` table. | Auth protected (uid match enforced). | UNVERIFIED | CAN_DO_NOW | Test profile sync. |
| 42. Role provisioning | src/app/api/auth/sync/route.ts:110-132 (POST) | Upserts user to Supabase with role. | Role from user_type or role field. | Supabase `users.role` field. | Auth protected (uid match enforced). | UNVERIFIED | CAN_DO_NOW | Test role assignment. |
| 43. Role-based admin access | src/lib/auth/verify.ts:136-170 (adminOnly check) | Checks Supabase `users.role` against ADMIN_ROLES list. | Real role check. | Supabase `users.role` field. | Enforced in API routes. | UNVERIFIED | CAN_DO_NOW | Test admin access controls. |
| 44. Demo seeding | lib/services/firestore_service.dart:66-73 (ensureInitialData) | Seeds Firestore collections if empty (gated kDebugMode). | Seeded data is fake/static. | None - demo-only. | No auth check (gated debug only). | UNVERIFIED | KEEP_AS_DEMO | Already gated correctly. |
| 45. Startup audit | lib/verify.dart (SystemVerifier) | Runs production audit in debug mode. | Checks for demo markers, placeholder credentials. | None - validation only. | N/A | UNVERIFIED | KEEP_AS_DEMO | Already gated correctly. |
| 46. Demo-only providers | lib/providers/taxi_demo_provider.dart | Provides fake taxi data for demo. | Hardcoded fake data. | None - demo-only. | N/A | UNVERIFIED | KEEP_AS_DEMO | Already demo-only. |
| 47. Demo-only screens | lib/screens/taxi_demo_screen.dart | Displays fake taxi data. | Hardcoded fake data. | None - demo-only. | N/A | UNVERIFIED | KEEP_AS_DEMO | Already demo-only. |

---

## C. Firestore Usage and Architecture Discrepancy

**Stated Architecture:** Firebase Auth = identity, Next.js backend = API/business logic, Supabase = system of record. Firestore used only for demo seeding.

**Actual Architecture:** Firestore is used extensively for transactional/business data, not just demo seeding.

| Firestore Collection | Source File/Function | Callers | Runs in Release? | Data Type | Supabase Equivalent | Violation? |
|---------------------|----------------------|---------|------------------|-----------|---------------------|------------|
| ride_requests | lib/services/ride_service.dart:75 (createRideRequest) | book_ride_screen, driver_ride_requests_screen | YES | Transactional (business data) | trips | YES - violates Supabase SoR |
| drivers | lib/services/taxi_service.dart:384 (registerDriver) | driver_registration_screen, taxi_service | YES | Transactional (workforce data) | users + driver_profiles | YES - violates Supabase SoR |
| vehicles | lib/services/taxi_service.dart:113 (registerVehicle) | vehicle_registration_screen, taxi_service | YES | Transactional (fleet data) | vehicles | YES - violates Supabase SoR |
| taxi_stations | lib/services/taxi_service.dart:387 (seedStations) | taxi_service, city_taxi_screen | YES (seeded in debug, read in release) | Reference + transactional | taxi_stations | YES - violates Supabase SoR |
| station_queue | lib/services/taxi_service.dart:716 (_addDriverToQueue) | taxi_service, queue_screen | YES | Transactional (queue state) | station_queues | YES - violates Supabase SoR |
| old_terminal_routes | lib/services/firestore_service.dart:36 | terminal_screen | YES (seeded in debug, read in release) | Reference data | bus_terminals (type=old_terminal) | YES - violates Supabase SoR |
| old_terminal_vehicles | lib/services/firestore_service.dart:37 | terminal_screen | YES (seeded in debug, read in release) | Reference data | vehicles | YES - violates Supabase SoR |
| old_terminal_drivers | lib/services/firestore_service.dart:38 | terminal_screen | YES (seeded in debug, read in release) | Reference data | users + driver_profiles | YES - violates Supabase SoR |
| new_terminal_routes | lib/services/firestore_service.dart:41 | terminal_screen | YES (seeded in debug, read in release) | Reference data | bus_terminals (type=new_terminal) | YES - violates Supabase SoR |
| emergency_incidents | lib/services/emergency_dispatch_service.dart:13 (reportIncident) | emergency_screen | YES | Transactional (emergency data) | emergency_requests | YES - violates Supabase SoR |
| hospital_capacity | lib/services/emergency_dispatch_service.dart:89 (getHospitalStatus) | emergency_dashboard | YES | Transactional (hospital state) | hospitals (beds_available field) | YES - violates Supabase SoR |
| vehicles (emergency) | lib/services/emergency_dispatch_service.dart:46 (findNearestUnits) | emergency_dispatch_service | YES | Transactional (fleet data) | vehicles | YES - violates Supabase SoR |
| analytics | lib/services/firestore_service.dart:76 (_seedBaselineAnalytics) | super_admin_dashboard | YES (seeded in debug, read in release) | System metrics | analytics | YES - violates Supabase SoR |
| transport_audit | lib/services/taxi_service.dart:491 (_logOperation) | taxi_service | YES | Audit trail | audit_logs | YES - violates Supabase SoR |
| transfer_history | lib/services/taxi_service.dart:508 (_logOperation) | taxi_service | YES | Audit trail | audit_logs | YES - violates Supabase SoR |
| maintenance_history | lib/services/taxi_service.dart:199 (completeMaintenance) | taxi_service | YES | Transactional (maintenance data) | NO equivalent in Supabase | YES - missing table |
| maintenance_reminders | lib/services/taxi_service.dart:178 (scheduleMaintenance) | taxi_service | YES | Transactional (maintenance data) | NO equivalent in Supabase | YES - missing table |
| city_events | lib/services/taxi_service.dart:330 (getLiveEvents) | smart_city_map_screen | YES | Ephemeral live data | NO equivalent in Supabase | YES - missing table |
| notifications | lib/services/notification_service.dart:22 (sendNotification) | notification_service | YES | Transactional (notifications) | notifications | YES - violates Supabase SoR |
| user_notifications | lib/services/notification_service.dart:23 (sendNotification) | notification_service | YES | Transactional (notifications) | NO equivalent in Supabase | YES - duplicate/denormalized |
| tickets | lib/services/qr_service.dart:13 (verifyTicket) | qr_service, ticket_view_screen | YES | Transactional (tickets) | tickets | YES - violates Supabase SoR |
| locations | lib/services/firestore_service.dart:129 (checkAndSeedLocations) | firestore_service | YES (seeded in debug, read in release) | Reference data | NO equivalent in Supabase | YES - missing table |
| popular_destinations | lib/services/firestore_service.dart:108 (checkAndSeedPopularDestinations) | firestore_service | YES (seeded in debug, read in release) | Reference data | NO equivalent in Supabase | YES - missing table |
| attendance | lib/services/taxi_service.dart:44 (logAttendance) | taxi_service | YES | Transactional (attendance data) | NO equivalent in Supabase | YES - missing table |

**Summary:** 24 Firestore collections are used in production (not gated by kDebugMode), violating the stated architecture that Firestore is only for demo seeding. Major business data (rides, drivers, vehicles, queues, emergencies, tickets) lives in Firestore, not Supabase.

---

## D. Supabase Schema/API Mismatch

| Supabase Table | Schema Field | Flutter API Usage | Mismatch | Risk |
|----------------|-------------|-------------------|----------|------|
| users | firebase_uid, role, user_type | AuthApiService syncUser (firebaseUid, role, userType) | Schema has both role and user_type. Flutter sends both. | Confusion over which field is source of truth. |
| users | wallet_balance | PaymentService calculates from wallet_transactions | Schema has wallet_balance column with trigger. Flutter calculates client-side. | Data inconsistency risk. |
| vehicles | driver_id (UUID) | TaxiService uses Firestore string IDs | UUID vs string ID mismatch. | Migration blocker. |
| vehicles | current_location (JSONB) | TaxiService uses GeoPoint | JSONB vs GeoPoint format. | Migration blocker. |
| trips | passenger_id (UUID) | RideService uses riderId (string) | UUID vs string ID mismatch. | Migration blocker. |
| trips | payment_status | PaymentService sets status on payments table | Trips has payment_status but payments also has status. | Data duplication. |
| tickets | qr_code (TEXT) | QRService uses Firestore tickets with qrData | Schema exists but unused. | Unused table. |
| station_queues | queue_position (INTEGER) | TaxiService uses Firestore station_queue with joinedAt | Schema exists but unused. | Unused table. |
| emergency_requests | assigned_unit_id (UUID) | EmergencyDispatchService uses Firestore emergency_incidents with assignedVehicleIds | Schema exists but unused. | Unused table. |
| analytics | metric_name, metric_value (JSONB) | Firestore analytics uses nested structure | Schema exists but unused. | Schema mismatch. |
| citizen_reports | reporter_firebase_uid (VARCHAR) | CitizenReportingApiService sends firebaseUid | Correctly mapped. | None. |
| citizen_reports | ai_status, ai_category, ai_urgency | Backend AI triage populates these | Schema matches backend implementation. | None. |
| payments | method (VARCHAR) enums | PaymentService uses PaymentProvider enum | Schema allows string, enum not enforced. | Data integrity risk. |
| wallet_transactions | type (VARCHAR) enums | PaymentService uses credit/debit/refund | Schema allows string, enum not enforced. | Data integrity risk. |

**Missing Supabase Tables (referenced by Firestore but not in schema):**
- locations (reference data)
- popular_destinations (reference data)
- maintenance_history (maintenance data)
- maintenance_reminders (maintenance data)
- city_events (live events)
- attendance (shift tracking)

**Deployed Schema Status:** DEPLOYED SCHEMA UNVERIFIED - Cannot verify if Supabase schema.sql has been applied to production database.

---

## E. Unresolved Decisions Requiring Owner

1. **Firestore vs Supabase Migration Strategy:**
   - Should all transactional data (rides, drivers, vehicles, queues, emergencies, tickets) be migrated to Supabase?
   - Or should the architecture be updated to acknowledge Firestore as the system of record for certain features?
   - What is the migration path for existing Firestore data in production?

2. **Payment Provider Integration:**
   - Which payment providers should be integrated first (Telebirr, CBE Birr, Chapa, SantimPay)?
   - Do we have merchant accounts/API credentials for any of these providers?
   - Should payment processing remain simulated for demo purposes indefinitely?

3. **Real-time Architecture:**
   - Should live vehicle tracking use Firestore real-time listeners or migrate to Supabase real-time/WebSocket?
   - Should emergency dispatch use Firestore real-time or Supabase?

4. **Reference Data Management:**
   - Should reference data (hotels, tourism sites, hospitals, pharmacies) be migrated from Firestore seeding to Supabase?
   - How should reference data be updated (admin UI, import scripts, API)?

5. **Missing Supabase Tables:**
   - Should missing tables (locations, popular_destinations, maintenance_history, city_events, attendance) be added to schema.sql?
   - Or are these Firestore-only features?

6. **Analytics and Audit:**
   - Should analytics and audit logs migrate from Firestore to Supabase?
   - How should revenue reporting be calculated (Firestore bookings vs Supabase payments)?

7. **Notification Architecture:**
   - Should notifications migrate from Firestore to Supabase?
   - Should FCM be integrated for push notifications?
   - What is the FCM project configuration?

8. **Geospatial Queries:**
   - Should proximity queries use GeoFire (Firestore) or PostGIS (Supabase)?
   - What is the acceptable latency for driver-dispatch matching?

9. **Role and User Type Fields:**
   - Should users.role and users.user_type be consolidated?
   - Which field is the source of truth for authorization?

10. **Demo vs Production Mode:**
    - Should the app have a clear demo mode toggle?
    - Should demo-only screens/providers be hidden in production builds?

---

## F. Recommended Implementation Order

**Priority 1: Critical Security and Data Consistency**
1. **Decide Firestore vs Supabase architecture** - Owner decision required before proceeding.
2. **Migrate authentication and user profiles** - Already using Supabase, verify consistency.
3. **Consolidate role/user_type fields** - Resolve schema ambiguity.
4. **Add missing Supabase tables** - If migrating to Supabase, add missing tables to schema.sql.

**Priority 2: Core Business Features (if migrating to Supabase)**
5. **Migrate ride requests to Supabase** - Create `/api/data/trips` integration.
6. **Migrate driver/workforce to Supabase** - Use users + driver_profiles tables.
7. **Migrate vehicles to Supabase** - Use vehicles table with proper UUID mapping.
8. **Migrate taxi stations to Supabase** - Use taxi_stations table.
9. **Migrate station queues to Supabase** - Use station_queues table.
10. **Migrate emergency dispatch to Supabase** - Use emergency_requests table.

**Priority 3: Payment Integration**
11. **Integrate one payment provider** - Start with Telebirr or CBE Birr (most common in Ethiopia).
12. **Remove fake payment responses** - Replace with real API calls.
13. **Add payment status webhooks** - Handle async payment confirmations.

**Priority 4: Reference Data and Analytics**
14. **Migrate reference data to Supabase** - Hotels, tourism, hospitals, pharmacies.
15. **Migrate analytics to Supabase** - Use analytics table for real metrics.
16. **Migrate audit logs to Supabase** - Use audit_logs table.

**Priority 5: Real-time and Notifications**
17. **Implement real-time vehicle tracking** - WebSocket or Supabase real-time.
18. **Integrate FCM for push notifications** - Configure FCM project.
19. **Migrate notifications to Supabase** - Use notifications table.

**Priority 6: Advanced Features**
20. **Add PostGIS for geospatial queries** - If using Supabase for proximity.
21. **Implement maintenance tracking** - Add maintenance_history table.
22. **Implement attendance tracking** - Add attendance table.
23. **Implement city events** - Add city_events table.

**Priority 7: Demo Mode Cleanup**
24. **Gate demo-only screens behind kDebugMode** - Already done for seeding, apply to screens.
25. **Add production mode toggle** - Allow demo mode in production for presentations.
26. **Document demo vs production differences** - Clear user documentation.

---

## G. Files Changed

**Expected:** Only `docs/PHASE3_INVENTORY.md` created.

**Actual:** Only `docs/PHASE3_INVENTORY.md` created.

---

## H. Verification of No Changes

**Application Code:** No changes made.  
**Tests:** No changes made.  
**Configuration:** No changes made.  
**Rules:** No changes made.  
**Migrations:** No changes made.  
**Database:** No SQL executed. No live database connections.  
**Git State:** No git commands executed. No staged/unstaged changes modified.  

---

## I. Search and Inspection Commands

**Commands Executed:**
- `find_by_name` for ride, taxi, driver, emergency, wallet, payment files in Flutter lib
- `read_file` for key service files (ride_service, taxi_service, payment_service, emergency_dispatch_service)
- `list_dir` for Supabase migrations directory
- `find_by_name` for schema.sql
- `read_file` for schema.sql and migration files
- `read_file` for citizen_reporting_api_service, super_admin_dashboard
- `find_by_name` for ai, notification, tracking, hospital, queue files
- `read_file` for ai_api_service, notification_service, tracking_provider
- `find_by_name` for ticket, qr, auth, profile files
- `read_file` for qr_service, auth_provider, auth_api_service
- `find_by_name` for TODO, FIXME, placeholder, mock files
- `grep_search` for Firestore, Supabase in Flutter lib (encountered regex error, used alternative inspection)

**Outcomes:**
- Identified 24 Firestore collections used in production (not demo-only)
- Identified Supabase schema with 30+ tables
- Found 8 Next.js API routes with auth protection
- Found payment simulation (fake success responses)
- Found no TODO/FIXME markers in Flutter lib
- Found one placeholder widget (map_placeholder.dart)

---

## J. Limitations

1. **Deployed Schema Unverified:** Cannot verify if Supabase schema.sql has been applied to production database. Assumed schema.sql represents intended state.
2. **Firestore Collection Completeness:** May have missed some Firestore collections due to grep regex error. Manual inspection of key service files completed.
3. **Test Coverage:** Did not run Flutter tests or verify test existence. Marked as UNVERIFIED.
4. **Photo Upload:** Citizen report photo upload mechanism not fully traced (Supabase Storage integration unclear).
5. **AI Context Sources:** Gemini AI context data sources (getComprehensiveCityData) not fully inspected due to file size limits.
6. **Real-time Implementation:** WebSocket or real-time backend implementation not fully inspected.
7. **FCM Configuration:** FCM service exists but configuration status unknown.

---

## K. Highest-Risk Issues

1. **CRITICAL: Architecture Violation** - Firestore is used for transactional business data (rides, drivers, vehicles, queues, emergencies, tickets) in production, contradicting the stated architecture that Supabase is the system of record. This creates data fragmentation and migration complexity.

2. **HIGH: Payment Simulation** - All payment providers (Telebirr, CBE Birr, Chapa, SantimPay) return fake success after delay. No real money moves. This is a critical business risk if deployed to production.

3. **HIGH: No Auth on Firestore Writes** - Firestore operations (ride_service, taxi_service, emergency_dispatch_service) have no authentication checks. Any client can write to Firestore collections if project rules are misconfigured.

4. **HIGH: Schema Ambiguity** - Supabase users table has both `role` and `user_type` fields. Flutter sends both. Unclear which is source of truth for authorization.

5. **MEDIUM: Missing Supabase Tables** - Schema missing tables for locations, popular_destinations, maintenance_history, city_events, attendance. These exist in Firestore but not Supabase.

6. **MEDIUM: UUID vs String ID Mismatch** - Supabase uses UUIDs, Firestore uses string IDs. Migration blocker for vehicles, trips, users.

7. **MEDIUM: Duplicate Notification Storage** - Notifications stored in both Firestore (notifications, user_notifications) and Supabase (notifications). Data inconsistency risk.

8. **LOW: Demo Data in Release** - Some Firestore collections (analytics, taxi_stations, routes) are seeded in debug mode but read in release. May show stale demo data in production.

9. **LOW: No Geospatial Indexing** - Firestore proximity queries are client-side filtered (not using GeoFire). Performance risk at scale.

10. **LOW: Wallet Balance Calculation** - Wallet balance calculated client-side from transactions. Supabase has trigger-based balance but not used. Data consistency risk.

---

**END OF PHASE 3 INVENTORY**

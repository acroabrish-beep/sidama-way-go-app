-- Sidama Way Go CityOS - Supabase Database Schema
-- This schema supports all 13 user roles and features

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (synced with Firebase Auth)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  firebase_uid VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(50),
  photo TEXT,
  role VARCHAR(50) NOT NULL DEFAULT 'citizen',
  language VARCHAR(10) DEFAULT 'en',
  department VARCHAR(255),
  status VARCHAR(50) DEFAULT 'active',
  is_approved BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  wallet_balance DECIMAL(10, 2) DEFAULT 0.00,
  membership_number VARCHAR(50),
  unread_notifications INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vehicles table
CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plate_number VARCHAR(50) UNIQUE NOT NULL,
  type VARCHAR(50) NOT NULL, -- taxi, bajaj, bus, government, emergency
  driver_id UUID REFERENCES users(id),
  capacity INTEGER,
  current_location JSONB,
  status VARCHAR(50) DEFAULT 'offline', -- online, offline, busy, maintenance
  fuel_level DECIMAL(5, 2),
  last_maintenance TIMESTAMP WITH TIME ZONE,
  route_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Taxi Stations
CREATE TABLE taxi_stations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  location JSONB NOT NULL,
  address TEXT,
  online_taxi_count INTEGER DEFAULT 0,
  waiting_passengers INTEGER DEFAULT 0,
  total_capacity INTEGER,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bus Terminals
CREATE TABLE bus_terminals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL, -- old_terminal, new_terminal
  location JSONB NOT NULL,
  address TEXT,
  online_buses INTEGER DEFAULT 0,
  waiting_passengers INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Routes
CREATE TABLE routes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  start_point JSONB NOT NULL,
  end_point JSONB NOT NULL,
  waypoints JSONB,
  distance_km DECIMAL(10, 2),
  estimated_time_minutes INTEGER,
  fare DECIMAL(10, 2),
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trips
CREATE TABLE trips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id),
  driver_id UUID REFERENCES users(id),
  route_id UUID REFERENCES routes(id),
  passenger_id UUID REFERENCES users(id),
  start_location JSONB NOT NULL,
  end_location JSONB NOT NULL,
  status VARCHAR(50) DEFAULT 'pending', -- pending, ongoing, completed, cancelled
  fare DECIMAL(10, 2),
  payment_status VARCHAR(50) DEFAULT 'pending',
  payment_method VARCHAR(50),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tickets
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID REFERENCES trips(id),
  user_id UUID REFERENCES users(id),
  qr_code TEXT,
  seat_number VARCHAR(10),
  price DECIMAL(10, 2),
  status VARCHAR(50) DEFAULT 'valid', -- valid, used, expired, cancelled
  issued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  used_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE
);

-- Hotels
CREATE TABLE hotels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  location JSONB NOT NULL,
  address TEXT,
  phone VARCHAR(50),
  email VARCHAR(255),
  star_rating INTEGER,
  amenities JSONB,
  room_types JSONB,
  price_range VARCHAR(50),
  images JSONB,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Hotel Bookings
CREATE TABLE hotel_bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID REFERENCES hotels(id),
  user_id UUID REFERENCES users(id),
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  room_type VARCHAR(100),
  guests INTEGER,
  total_price DECIMAL(10, 2),
  payment_status VARCHAR(50) DEFAULT 'pending',
  payment_method VARCHAR(50),
  status VARCHAR(50) DEFAULT 'confirmed',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Hospitals
CREATE TABLE hospitals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50), -- general, specialized, clinic
  location JSONB NOT NULL,
  address TEXT,
  phone VARCHAR(50),
  emergency_phone VARCHAR(50),
  services JSONB,
  doctors_count INTEGER,
  beds_available INTEGER,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pharmacies
CREATE TABLE pharmacies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  location JSONB NOT NULL,
  address TEXT,
  phone VARCHAR(50),
  operating_hours JSONB,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tourism Sites
CREATE TABLE tourism_sites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100), -- natural, cultural, historical, recreational
  location JSONB NOT NULL,
  address TEXT,
  images JSONB,
  entrance_fee DECIMAL(10, 2),
  operating_hours JSONB,
  rating DECIMAL(3, 2),
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tour Packages
CREATE TABLE tour_packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  duration_days INTEGER,
  sites JSONB, -- array of tourism site IDs
  price DECIMAL(10, 2),
  includes JSONB,
  max_participants INTEGER,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Emergency Requests
CREATE TABLE emergency_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  type VARCHAR(50) NOT NULL, -- medical, police, fire, accident
  location JSONB NOT NULL,
  description TEXT,
  severity VARCHAR(50) DEFAULT 'medium', -- low, medium, high, critical
  status VARCHAR(50) DEFAULT 'pending', -- pending, assigned, resolved, cancelled
  assigned_unit_id UUID REFERENCES vehicles(id),
  response_time_minutes INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Emergency Centers
CREATE TABLE emergency_centers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL, -- police, fire, medical
  location JSONB NOT NULL,
  address TEXT,
  phone VARCHAR(50),
  jurisdiction TEXT,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Announcements
CREATE TABLE announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'general', -- general, emergency, maintenance, promotion
  target_audience JSONB, -- array of roles
  is_active BOOLEAN DEFAULT true,
  priority VARCHAR(50) DEFAULT 'normal', -- low, normal, high, urgent
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE
);

-- Notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  type VARCHAR(50) NOT NULL, -- trip, payment, emergency, announcement, ai, admin
  data JSONB,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Payments
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'ETB',
  method VARCHAR(50) NOT NULL, -- telebirr, cbe_birr, chapa, santimpay, cash, wallet
  status VARCHAR(50) DEFAULT 'pending', -- pending, completed, failed, refunded
  reference_id VARCHAR(255),
  transaction_id VARCHAR(255),
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Wallet Transactions
CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  type VARCHAR(50) NOT NULL, -- credit, debit, refund
  amount DECIMAL(10, 2) NOT NULL,
  balance_after DECIMAL(10, 2),
  description TEXT,
  reference_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Government Offices
CREATE TABLE government_offices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,
  location JSONB NOT NULL,
  address TEXT,
  phone VARCHAR(50),
  email VARCHAR(255),
  operating_hours JSONB,
  services JSONB,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Churches
CREATE TABLE churches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  denomination VARCHAR(100),
  location JSONB NOT NULL,
  address TEXT,
  phone VARCHAR(50),
  service_times JSONB,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Eco-Shine Stations
CREATE TABLE eco_shine_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  location JSONB NOT NULL,
  address TEXT,
  phone VARCHAR(50),
  capacity INTEGER,
  current_usage INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Marketplace Providers
CREATE TABLE marketplace_providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  location JSONB NOT NULL,
  address TEXT,
  phone VARCHAR(50),
  services JSONB,
  rating DECIMAL(3, 2),
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Guest Houses
CREATE TABLE guest_houses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  location JSONB NOT NULL,
  address TEXT,
  phone VARCHAR(50),
  rooms_available INTEGER,
  price_range VARCHAR(50),
  amenities JSONB,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Analytics
CREATE TABLE analytics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  metric_name VARCHAR(255) NOT NULL,
  metric_value JSONB NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB
);

-- Audit Logs
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(255) NOT NULL,
  details TEXT,
  ip_address VARCHAR(50),
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Additional tables for production completeness

-- Driver Profiles (extended user info for drivers)
CREATE TABLE driver_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) UNIQUE NOT NULL,
  license_number VARCHAR(100) UNIQUE NOT NULL,
  license_expiry_date DATE NOT NULL,
  vehicle_type VARCHAR(50) NOT NULL,
  years_experience INTEGER DEFAULT 0,
  rating DECIMAL(3, 2) DEFAULT 5.0,
  total_trips INTEGER DEFAULT 0,
  total_revenue DECIMAL(10, 2) DEFAULT 0.00,
  is_verified BOOLEAN DEFAULT false,
  verification_date TIMESTAMP WITH TIME ZONE,
  documents JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Station Queues
CREATE TABLE station_queues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id UUID REFERENCES taxi_stations(id),
  user_id UUID REFERENCES users(id),
  queue_position INTEGER NOT NULL,
  status VARCHAR(50) DEFAULT 'waiting', -- waiting, assigned, cancelled, served
  vehicle_id UUID REFERENCES vehicles(id),
  estimated_wait_minutes INTEGER,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  assigned_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Revenue Tracking
CREATE TABLE revenue_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(50) NOT NULL, -- driver, station, government, system
  entity_id UUID NOT NULL,
  period_type VARCHAR(20) NOT NULL, -- daily, weekly, monthly, yearly
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  gross_revenue DECIMAL(10, 2) DEFAULT 0.00,
  commission DECIMAL(10, 2) DEFAULT 0.00,
  net_revenue DECIMAL(10, 2) DEFAULT 0.00,
  trip_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- System Configuration
CREATE TABLE system_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key VARCHAR(255) UNIQUE NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  is_public BOOLEAN DEFAULT false,
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Refund Requests
CREATE TABLE refund_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID REFERENCES payments(id),
  user_id UUID REFERENCES users(id),
  reason TEXT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending', -- pending, approved, rejected, processed
  processed_by UUID REFERENCES users(id),
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Commission Rates
CREATE TABLE commission_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_type VARCHAR(50) NOT NULL, -- taxi, bus, hotel, tourism
  base_rate DECIMAL(5, 2) NOT NULL, -- percentage
  platform_fee DECIMAL(5, 2) DEFAULT 0.00,
  government_tax DECIMAL(5, 2) DEFAULT 0.00,
  effective_from DATE NOT NULL,
  effective_to DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Support Tickets
CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  subject VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(50) NOT NULL, -- technical, payment, account, safety
  priority VARCHAR(50) DEFAULT 'normal', -- low, normal, high, urgent
  status VARCHAR(50) DEFAULT 'open', -- open, in_progress, resolved, closed
  assigned_to UUID REFERENCES users(id),
  resolution TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Promotions and Discounts
CREATE TABLE promotions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  discount_type VARCHAR(20) NOT NULL, -- percentage, fixed
  discount_value DECIMAL(10, 2) NOT NULL,
  max_discount DECIMAL(10, 2),
  min_order_value DECIMAL(10, 2) DEFAULT 0.00,
  usage_limit INTEGER,
  used_count INTEGER DEFAULT 0,
  valid_from TIMESTAMP WITH TIME ZONE NOT NULL,
  valid_until TIMESTAMP WITH TIME ZONE NOT NULL,
  applicable_services JSONB, -- array of service types
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User Promotions (redemption tracking)
CREATE TABLE user_promotions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  promotion_id UUID REFERENCES promotions(id),
  payment_id UUID REFERENCES payments(id),
  discount_applied DECIMAL(10, 2) NOT NULL,
  redeemed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Location History (for tracking and analytics)
CREATE TABLE location_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(50) NOT NULL, -- vehicle, user, emergency_unit
  entity_id UUID NOT NULL,
  location JSONB NOT NULL,
  speed DECIMAL(10, 2),
  heading DECIMAL(10, 2),
  accuracy DECIMAL(10, 2),
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Citizen Reports (for citizen reporting feature)
CREATE TABLE citizen_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_firebase_uid VARCHAR(255) NOT NULL REFERENCES users(firebase_uid),
  category VARCHAR(50) NOT NULL CHECK (category IN ('pothole', 'garbage', 'street_light', 'water', 'other')),
  description TEXT,
  photo_url TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Soft delete support
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE vehicles ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE trips ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE payments ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE citizen_reports ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE;

-- Create indexes for better performance
CREATE INDEX idx_users_firebase_uid ON users(firebase_uid);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_deleted_at ON users(deleted_at);
CREATE INDEX idx_vehicles_driver_id ON vehicles(driver_id);
CREATE INDEX idx_vehicles_status ON vehicles(status);
CREATE INDEX idx_vehicles_type ON vehicles(type);
CREATE INDEX idx_vehicles_deleted_at ON vehicles(deleted_at);
CREATE INDEX idx_trips_driver_id ON trips(driver_id);
CREATE INDEX idx_trips_passenger_id ON trips(passenger_id);
CREATE INDEX idx_trips_status ON trips(status);
CREATE INDEX idx_trips_created_at ON trips(created_at);
CREATE INDEX idx_trips_deleted_at ON trips(deleted_at);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);
CREATE INDEX idx_emergency_requests_status ON emergency_requests(status);
CREATE INDEX idx_emergency_requests_type ON emergency_requests(type);
CREATE INDEX idx_emergency_requests_severity ON emergency_requests(severity);
CREATE INDEX idx_emergency_requests_created_at ON emergency_requests(created_at);
CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_created_at ON payments(created_at);
CREATE INDEX idx_payments_deleted_at ON payments(deleted_at);
CREATE INDEX idx_wallet_transactions_user_id ON wallet_transactions(user_id);
CREATE INDEX idx_wallet_transactions_created_at ON wallet_transactions(created_at);
CREATE INDEX idx_driver_profiles_user_id ON driver_profiles(user_id);
CREATE INDEX idx_driver_profiles_is_verified ON driver_profiles(is_verified);
CREATE INDEX idx_station_queues_station_id ON station_queues(station_id);
CREATE INDEX idx_station_queues_status ON station_queues(status);
CREATE INDEX idx_station_queues_joined_at ON station_queues(joined_at);
CREATE INDEX idx_revenue_tracking_entity ON revenue_tracking(entity_type, entity_id);
CREATE INDEX idx_revenue_tracking_period ON revenue_tracking(period_type, period_start);
CREATE INDEX idx_location_history_entity ON location_history(entity_type, entity_id);
CREATE INDEX idx_location_history_recorded_at ON location_history(recorded_at);
CREATE INDEX idx_citizen_reports_reporter_firebase_uid ON citizen_reports(reporter_firebase_uid);
CREATE INDEX idx_citizen_reports_status ON citizen_reports(status);
CREATE INDEX idx_citizen_reports_category ON citizen_reports(category);
CREATE INDEX idx_citizen_reports_created_at ON citizen_reports(created_at);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE citizen_reports ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can view own profile
CREATE POLICY "Users can view own profile" ON users FOR SELECT USING (firebase_uid = auth.uid() OR auth.uid() IS NULL);
CREATE POLICY "Users can update own profile" ON users FOR UPDATE USING (firebase_uid = auth.uid());
CREATE POLICY "Service role can manage users" ON users FOR ALL USING (auth.role() = 'service_role');

-- Vehicles - drivers can view their own vehicles
CREATE POLICY "Drivers can view own vehicles" ON vehicles FOR SELECT USING (driver_id IN (SELECT id FROM users WHERE firebase_uid = auth.uid()));
CREATE POLICY "Service role can manage vehicles" ON vehicles FOR ALL USING (auth.role() = 'service_role');

-- Trips - users can view their own trips
CREATE POLICY "Users can view own trips" ON trips FOR SELECT USING (passenger_id IN (SELECT id FROM users WHERE firebase_uid = auth.uid()) OR driver_id IN (SELECT id FROM users WHERE firebase_uid = auth.uid()));
CREATE POLICY "Service role can manage trips" ON trips FOR ALL USING (auth.role() = 'service_role');

-- Notifications - users can view their own notifications
CREATE POLICY "Users can view own notifications" ON notifications FOR SELECT USING (user_id IN (SELECT id FROM users WHERE firebase_uid = auth.uid()));
CREATE POLICY "Service role can manage notifications" ON notifications FOR ALL USING (auth.role() = 'service_role');

-- Payments - users can view their own payments
CREATE POLICY "Users can view own payments" ON payments FOR SELECT USING (user_id IN (SELECT id FROM users WHERE firebase_uid = auth.uid()));
CREATE POLICY "Service role can manage payments" ON payments FOR ALL USING (auth.role() = 'service_role');

-- Wallet transactions - users can view their own transactions
CREATE POLICY "Users can view own wallet transactions" ON wallet_transactions FOR SELECT USING (user_id IN (SELECT id FROM users WHERE firebase_uid = auth.uid()));
CREATE POLICY "Service role can manage wallet transactions" ON wallet_transactions FOR ALL USING (auth.role() = 'service_role');

-- Emergency requests - users can view their own requests
CREATE POLICY "Users can view own emergency requests" ON emergency_requests FOR SELECT USING (user_id IN (SELECT id FROM users WHERE firebase_uid = auth.uid()));
CREATE POLICY "Emergency responders can view assigned requests" ON emergency_requests FOR SELECT USING (assigned_unit_id IN (SELECT id FROM vehicles WHERE driver_id IN (SELECT id FROM users WHERE firebase_uid = auth.uid())));
CREATE POLICY "Service role can manage emergency requests" ON emergency_requests FOR ALL USING (auth.role() = 'service_role');

-- Authorization (users can only see/create their own reports) is enforced in the Next.js API layer (service role bypasses RLS by design), not via RLS, since this project uses Firebase Auth rather than Supabase Auth.
CREATE POLICY "Service role can manage citizen reports" ON citizen_reports FOR ALL USING (auth.role() = 'service_role');

-- Functions for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Function for soft delete
CREATE OR REPLACE FUNCTION soft_delete()
RETURNS TRIGGER AS $$
BEGIN
    NEW.deleted_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to all tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_vehicles_updated_at BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_trips_updated_at BEFORE UPDATE ON trips FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_taxi_stations_updated_at BEFORE UPDATE ON taxi_stations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_bus_terminals_updated_at BEFORE UPDATE ON bus_terminals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_hotels_updated_at BEFORE UPDATE ON hotels FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_hospitals_updated_at BEFORE UPDATE ON hospitals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tourism_sites_updated_at BEFORE UPDATE ON tourism_sites FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_emergency_requests_updated_at BEFORE UPDATE ON emergency_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_announcements_updated_at BEFORE UPDATE ON announcements FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_driver_profiles_updated_at BEFORE UPDATE ON driver_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_revenue_tracking_updated_at BEFORE UPDATE ON revenue_tracking FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_system_config_updated_at BEFORE UPDATE ON system_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_refund_requests_updated_at BEFORE UPDATE ON refund_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_support_tickets_updated_at BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_promotions_updated_at BEFORE UPDATE ON promotions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_citizen_reports_updated_at BEFORE UPDATE ON citizen_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Apply soft delete triggers
CREATE TRIGGER soft_delete_users BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION soft_delete();
CREATE TRIGGER soft_delete_vehicles BEFORE DELETE ON vehicles FOR EACH ROW EXECUTE FUNCTION soft_delete();
CREATE TRIGGER soft_delete_trips BEFORE DELETE ON trips FOR EACH ROW EXECUTE FUNCTION soft_delete();
CREATE TRIGGER soft_delete_payments BEFORE DELETE ON payments FOR EACH ROW EXECUTE FUNCTION soft_delete();

-- Function to update wallet balance
CREATE OR REPLACE FUNCTION update_wallet_balance()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        -- Credit wallet for refunds
        IF NEW.type = 'credit' OR NEW.type = 'refund' THEN
            UPDATE users SET wallet_balance = wallet_balance + NEW.amount WHERE id = NEW.user_id;
        -- Debit wallet for payments
        ELSIF NEW.type = 'debit' THEN
            UPDATE users SET wallet_balance = wallet_balance - NEW.amount WHERE id = NEW.user_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_wallet_balance_trigger AFTER INSERT OR UPDATE ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION update_wallet_balance();

-- Function to update station counters
CREATE OR REPLACE FUNCTION update_station_counters()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_TABLE_NAME = 'trips' THEN
        IF NEW.status = 'ongoing' AND OLD.status != 'ongoing' THEN
            -- Increment waiting passengers when trip starts
            UPDATE taxi_stations SET waiting_passengers = waiting_passengers + 1 WHERE id = (
                SELECT id FROM taxi_stations WHERE ST_DWithin(location::geometry, NEW.start_location::geometry, 0.01) LIMIT 1
            );
        ELSIF NEW.status = 'completed' AND OLD.status != 'completed' THEN
            -- Decrement waiting passengers when trip completes
            UPDATE taxi_stations SET waiting_passengers = GREATEST(0, waiting_passengers - 1) WHERE id = (
                SELECT id FROM taxi_stations WHERE ST_DWithin(location::geometry, NEW.start_location::geometry, 0.01) LIMIT 1
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_station_counters_trigger AFTER INSERT OR UPDATE ON trips FOR EACH ROW EXECUTE FUNCTION update_station_counters();

-- Insert default system configuration
INSERT INTO system_config (key, value, description, is_public) VALUES
('app_version', '1.0.0', 'Current application version', true),
('maintenance_mode', 'false', 'System maintenance mode', false),
('min_app_version', '1.0.0', 'Minimum supported app version', true),
('emergency_contact', '911', 'Emergency contact number', true),
('support_email', 'support@sidamawaygo.com', 'Support email address', true),
('commission_rate_taxi', '15.00', 'Default commission rate for taxi services', false),
('commission_rate_bus', '10.00', 'Default commission rate for bus services', false),
('commission_rate_hotel', '12.00', 'Default commission rate for hotel bookings', false),
('commission_rate_tourism', '8.00', 'Default commission rate for tourism services', false)
ON CONFLICT (key) DO NOTHING;
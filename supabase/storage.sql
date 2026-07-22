-- Sidama Way Go CityOS - Storage Buckets Configuration
-- This script sets up Supabase Storage buckets for file management

-- Create storage buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
('user-avatars', 'user-avatars', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
('vehicle-images', 'vehicle-images', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
('hotel-images', 'hotel-images', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
('tourism-images', 'tourism-images', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
('documents', 'documents', false, 10485760, ARRAY['application/pdf', 'image/jpeg', 'image/png']),
('qr-codes', 'qr-codes', false, 1048576, ARRAY['image/png']),
('emergency-photos', 'emergency-photos', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
('temp-uploads', 'temp-uploads', false, 52428800, NULL)
ON CONFLICT (id) DO NOTHING;

-- Storage policies

-- User avatars bucket policies
CREATE POLICY "Public read access for user avatars" ON storage.objects FOR SELECT USING (bucket_id = 'user-avatars');
CREATE POLICY "Users can upload own avatar" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'user-avatars' AND 
  auth.uid()::text = (storage.foldername(name))[0]
);
CREATE POLICY "Users can update own avatar" ON storage.objects FOR UPDATE WITH CHECK (
  bucket_id = 'user-avatars' AND 
  auth.uid()::text = (storage.foldername(name))[0]
);
CREATE POLICY "Users can delete own avatar" ON storage.objects FOR DELETE WITH CHECK (
  bucket_id = 'user-avatars' AND 
  auth.uid()::text = (storage.foldername(name))[0]
);

-- Vehicle images bucket policies
CREATE POLICY "Public read access for vehicle images" ON storage.objects FOR SELECT USING (bucket_id = 'vehicle-images');
CREATE POLICY "Drivers can upload vehicle images" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'vehicle-images' AND 
  auth.uid() IN (SELECT driver_id FROM vehicles WHERE id::text = (storage.foldername(name))[0])
);
CREATE POLICY "Service role can manage vehicle images" ON storage.objects FOR ALL USING (bucket_id = 'vehicle-images' AND auth.role() = 'service_role');

-- Hotel images bucket policies
CREATE POLICY "Public read access for hotel images" ON storage.objects FOR SELECT USING (bucket_id = 'hotel-images');
CREATE POLICY "Hotel admins can upload hotel images" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'hotel-images' AND 
  auth.uid() IN (SELECT id FROM users WHERE role = 'hotelAdmin' OR role = 'superAdmin')
);
CREATE POLICY "Service role can manage hotel images" ON storage.objects FOR ALL USING (bucket_id = 'hotel-images' AND auth.role() = 'service_role');

-- Tourism images bucket policies
CREATE POLICY "Public read access for tourism images" ON storage.objects FOR SELECT USING (bucket_id = 'tourism-images');
CREATE POLICY "Tourism admins can upload tourism images" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'tourism-images' AND 
  auth.uid() IN (SELECT id FROM users WHERE role = 'tourismAdmin' OR role = 'superAdmin')
);
CREATE POLICY "Service role can manage tourism images" ON storage.objects FOR ALL USING (bucket_id = 'tourism-images' AND auth.role() = 'service_role');

-- Documents bucket policies
CREATE POLICY "Users can read own documents" ON storage.objects FOR SELECT WITH CHECK (
  bucket_id = 'documents' AND 
  auth.uid()::text = (storage.foldername(name))[0]
);
CREATE POLICY "Users can upload own documents" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'documents' AND 
  auth.uid()::text = (storage.foldername(name))[0]
);
CREATE POLICY "Users can delete own documents" ON storage.objects FOR DELETE WITH CHECK (
  bucket_id = 'documents' AND 
  auth.uid()::text = (storage.foldername(name))[0]
);
CREATE POLICY "Service role can manage documents" ON storage.objects FOR ALL USING (bucket_id = 'documents' AND auth.role() = 'service_role');

-- QR codes bucket policies
CREATE POLICY "Users can read own QR codes" ON storage.objects FOR SELECT WITH CHECK (
  bucket_id = 'qr-codes' AND 
  auth.uid()::text = (storage.foldername(name))[0]
);
CREATE POLICY "System can generate QR codes" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'qr-codes' AND auth.role() = 'service_role');
CREATE POLICY "Service role can manage QR codes" ON storage.objects FOR ALL USING (bucket_id = 'qr-codes' AND auth.role() = 'service_role');

-- Emergency photos bucket policies
CREATE POLICY "Emergency responders can read emergency photos" ON storage.objects FOR SELECT WITH CHECK (
  bucket_id = 'emergency-photos' AND 
  auth.uid() IN (SELECT id FROM users WHERE role IN ('emergencyAdmin', 'superAdmin'))
);
CREATE POLICY "Users can upload emergency photos" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'emergency-photos' AND 
  auth.uid() IN (SELECT id FROM users WHERE role IN ('citizen', 'emergencyAdmin', 'superAdmin'))
);
CREATE POLICY "Service role can manage emergency photos" ON storage.objects FOR ALL USING (bucket_id = 'emergency-photos' AND auth.role() = 'service_role');

-- Temp uploads bucket policies
CREATE POLICY "Users can manage temp uploads" ON storage.objects FOR ALL WITH CHECK (
  bucket_id = 'temp-uploads' AND 
  auth.uid()::text = (storage.foldername(name))[0]
);
CREATE POLICY "Clean up temp uploads after 1 hour" ON storage.objects FOR DELETE USING (
  bucket_id = 'temp-uploads' AND 
  created_at < NOW() - INTERVAL '1 hour'
);
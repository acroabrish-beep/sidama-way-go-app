-- Final alignment to match Next.js Backend logic and Flutter UserModel
-- Run this AFTER the previous migration if columns are still missing.

ALTER TABLE public.users
RENAME COLUMN phone_number TO phone;

ALTER TABLE public.users
RENAME COLUMN photo_url TO photo;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'en';

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS membership_number VARCHAR(50);

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS unread_notifications INTEGER DEFAULT 0;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS department VARCHAR(255);

import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';

// Validate required configuration for public client
if (!env.supabaseUrl) {
  throw new Error('Supabase initialization failed: env.supabaseUrl is missing.');
}
if (!env.supabaseAnonKey) {
  throw new Error('Supabase initialization failed: env.supabaseAnonKey is missing.');
}

// Create Supabase client for public API calls (uses anon key)
export const supabase = createClient(
  env.supabaseUrl,
  env.supabaseAnonKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
    },
  }
);

// Create Supabase client for admin operations (uses service role key)
// Note: This will only be fully functional if SUPABASE_SERVICE_ROLE_KEY is provided
export const supabaseAdmin = createClient(
  env.supabaseUrl,
  env.supabaseServiceRoleKey || 'placeholder-key',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

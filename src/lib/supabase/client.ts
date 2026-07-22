import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';

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
export const supabaseAdmin = createClient(
  env.supabaseUrl,
  env.supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
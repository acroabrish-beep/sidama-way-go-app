# Implementation Plan - Fix Supabase Environment Configuration

Fix the "supabaseUrl is required" error in the Next.js backend by correctly configuring environment variables and ensuring robust client initialization.

## User Review Required

> [!IMPORTANT]
> The Supabase project configuration provided by the user will be stored in a new `.env.local` file. This file is already ignored by Git in `.gitignore`.

## Proposed Changes

### Backend Subsystem

#### [NEW] [.env.local](file:///C:/src/sidama_way_go_backend/.env.local)
- Create this file with the required Supabase credentials.
- Configure both standard and `NEXT_PUBLIC_` prefixed variables to ensure compatibility with different parts of the Next.js lifecycle.

```env
SUPABASE_URL=https://eolmukwhzuvscworgwwx.supabase.co
SUPABASE_ANON_KEY=sb_publishable_rjhT_yH55d7pDOQTaxJdyw_ZaSF5Ulv

NEXT_PUBLIC_SUPABASE_URL=https://eolmukwhzuvscworgwwx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_rjhT_yH55d7pDOQTaxJdyw_ZaSF5Ulv
```

#### [MODIFY] [client.ts](file:///C:/src/sidama_way_go_backend/src/lib/supabase/client.ts)
- Add explicit validation for `env.supabaseUrl` and `env.supabaseAnonKey` before calling `createClient`.
- Provide a clear, actionable error message if the configuration is missing.

#### [MODIFY] [env.ts](file:///C:/src/sidama_way_go_backend/src/lib/config/env.ts)
- Call `validateEnv()` at the bottom of the file to ensure environment variables are checked as soon as the module is imported.

## Verification Plan

### Manual Verification
- Start the Next.js development server: `npm run dev`
- Verify the server starts without the "supabaseUrl is required" error.
- Test the endpoint: `curl http://localhost:3000/api/auth/sync?firebaseUid=test`
- Verify the HTTP status code and response body to ensure it's no longer failing due to missing configuration.

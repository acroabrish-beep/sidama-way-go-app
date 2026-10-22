import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';
import { requireCaller } from '@/lib/auth/verify';

export async function GET(request: NextRequest) {
  // Debug schema introspection reads the users table: always require an admin
  // token, regardless of the AUTH_ENFORCE rollout flag.
  const authResult = await requireCaller(request, { adminOnly: true });
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  try {
    // Try to select the most critical columns required by the sync logic
    const { error } = await supabase.from('users').select(`
      id,
      firebase_uid,
      full_name,
      email,
      role,
      status,
      is_approved,
      is_active,
      wallet_balance
    `).limit(1);

    if (error) {
      return NextResponse.json({
        aligned: false,
        message: error.message,
        code: error.code,
        hint: error.hint
      }, { status: 500 });
    }

    return NextResponse.json({
      aligned: true,
      message: "Required columns found in 'users' table."
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

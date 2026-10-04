import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';

export async function GET(request: NextRequest) {
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

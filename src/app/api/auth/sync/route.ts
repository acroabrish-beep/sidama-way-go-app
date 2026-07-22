import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { firebaseUid, email, fullName, phone, role = 'citizen', language = 'en' } = body;

    if (!firebaseUid || !email) {
      return NextResponse.json(
        { error: 'firebaseUid and email are required' },
        { status: 400 }
      );
    }

    // Check if user exists in Supabase
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('firebase_uid', firebaseUid)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 means no rows returned, which is expected for new users
      console.error('Error fetching user:', fetchError);
      return NextResponse.json(
        { error: 'Database error' },
        { status: 500 }
      );
    }

    if (existingUser) {
      // Update last login
      const { data: updatedUser, error: updateError } = await supabase
        .from('users')
        .update({ 
          last_login: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('firebase_uid', firebaseUid)
        .select()
        .single();

      if (updateError) {
        console.error('Error updating user:', updateError);
        return NextResponse.json(
          { error: 'Failed to update user' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        user: updatedUser,
        isNew: false,
      });
    }

    // Create new user in Supabase
    const membershipNumber = `SWG-${firebaseUid.substring(0, 8).toUpperCase()}`;

    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({
        firebase_uid: firebaseUid,
        email: email,
        full_name: fullName || email.split('@')[0],
        phone: phone || '',
        role: role,
        language: language,
        status: 'active',
        is_approved: true,
        is_active: true,
        wallet_balance: 0.00,
        membership_number: membershipNumber,
        unread_notifications: 0,
        created_at: new Date().toISOString(),
        last_login: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating user:', insertError);
      return NextResponse.json(
        { error: 'Failed to create user profile' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      user: newUser,
      isNew: true,
    });

  } catch (error) {
    console.error('Auth sync error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const firebaseUid = searchParams.get('firebaseUid');

    if (!firebaseUid) {
      return NextResponse.json(
        { error: 'firebaseUid is required' },
        { status: 400 }
      );
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('firebase_uid', firebaseUid)
      .single();

    if (error) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ user });

  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
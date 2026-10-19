import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';
import { requireCallerWithEnforce } from '@/lib/auth/verify';

// Generic data API endpoint for all Supabase queries
// Usage: /api/data/table_name or /api/data/table_name/id
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // Auth check: any valid caller
  const authResult = await requireCallerWithEnforce(request, {
    route: '/api/data/[...path]',
    method: 'GET',
  });

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.error },
      { status: authResult.status }
    );
  }

  try {
    const { path } = await params;
    const [table, id] = path;
    const searchParams = request.nextUrl.searchParams;

    if (!table) {
      return NextResponse.json(
        { error: 'Table name is required' },
        { status: 400 }
      );
    }

    // Validate table name to prevent SQL injection
    const validTables = [
      'users', 'vehicles', 'taxi_stations', 'bus_terminals', 'routes',
      'trips', 'tickets', 'hotels', 'hotel_bookings', 'hospitals',
      'pharmacies', 'tourism_sites', 'tour_packages', 'emergency_requests',
      'emergency_centers', 'announcements', 'notifications', 'payments',
      'wallet_transactions', 'government_offices', 'churches',
      'eco_shine_locations', 'marketplace_providers', 'guest_houses',
      'analytics', 'audit_logs'
    ];

    if (!validTables.includes(table)) {
      return NextResponse.json(
        { error: 'Invalid table name' },
        { status: 400 }
      );
    }

    let query = supabase.from(table).select('*');

    // Add filters from query parameters
    searchParams.forEach((value, key) => {
      if (key !== 'limit' && key !== 'offset' && key !== 'order') {
        query = query.eq(key, value);
      }
    });

    // Add limit
    const limit = searchParams.get('limit');
    if (limit) {
      query = query.limit(parseInt(limit));
    }

    // Add offset (Supabase uses range for pagination)
    const offset = searchParams.get('offset');
    if (offset) {
      const offsetNum = parseInt(offset);
      const limitNum = limit ? parseInt(limit) : 10;
      query = query.range(offsetNum, offsetNum + limitNum - 1);
    }

    // Add ordering
    const order = searchParams.get('order');
    if (order) {
      const [column, direction] = order.split(',');
      query = query.order(column, { ascending: direction !== 'desc' });
    }

    // If ID is provided, get single record
    if (id) {
      const { data: singleData, error: singleError } = await supabase
        .from(table)
        .select('*')
        .eq('id', id)
        .single();

      if (singleError) {
        console.error(`Error fetching single record from ${table}:`, singleError);
        return NextResponse.json(
          { error: singleError.message },
          { status: 500 }
        );
      }

      return NextResponse.json({ data: singleData });
    }

    const { data, error } = await query;

    if (error) {
      console.error(`Error fetching from ${table}:`, error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ data });

  } catch (error) {
    console.error('Data API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // Auth check: any valid caller
  const authResult = await requireCallerWithEnforce(request, {
    route: '/api/data/[...path]',
    method: 'POST',
  });

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.error },
      { status: authResult.status }
    );
  }

  try {
    const { path } = await params;
    const [table] = path;

    if (!table) {
      return NextResponse.json(
        { error: 'Table name is required' },
        { status: 400 }
      );
    }

    const validTables = [
      'users', 'vehicles', 'taxi_stations', 'bus_terminals', 'routes',
      'trips', 'tickets', 'hotels', 'hotel_bookings', 'hospitals',
      'pharmacies', 'tourism_sites', 'tour_packages', 'emergency_requests',
      'emergency_centers', 'announcements', 'notifications', 'payments',
      'wallet_transactions', 'government_offices', 'churches',
      'eco_shine_locations', 'marketplace_providers', 'guest_houses',
      'analytics', 'audit_logs'
    ];

    if (!validTables.includes(table)) {
      return NextResponse.json(
        { error: 'Invalid table name' },
        { status: 400 }
      );
    }

    const body = await request.json();

    const { data, error } = await supabase
      .from(table)
      .insert(body)
      .select()
      .single();

    if (error) {
      console.error(`Error inserting into ${table}:`, error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ data }, { status: 201 });

  } catch (error) {
    console.error('Data API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // Auth check: any valid caller
  const authResult = await requireCallerWithEnforce(request, {
    route: '/api/data/[...path]',
    method: 'PATCH',
  });

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.error },
      { status: authResult.status }
    );
  }

  try {
    const { path } = await params;
    const [table, id] = path;

    if (!table || !id) {
      return NextResponse.json(
        { error: 'Table name and ID are required' },
        { status: 400 }
      );
    }

    const validTables = [
      'users', 'vehicles', 'taxi_stations', 'bus_terminals', 'routes',
      'trips', 'tickets', 'hotels', 'hotel_bookings', 'hospitals',
      'pharmacies', 'tourism_sites', 'tour_packages', 'emergency_requests',
      'emergency_centers', 'announcements', 'notifications', 'payments',
      'wallet_transactions', 'government_offices', 'churches',
      'eco_shine_locations', 'marketplace_providers', 'guest_houses',
      'analytics', 'audit_logs'
    ];

    if (!validTables.includes(table)) {
      return NextResponse.json(
        { error: 'Invalid table name' },
        { status: 400 }
      );
    }

    const body = await request.json();

    const { data, error } = await supabase
      .from(table)
      .update(body)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error(`Error updating ${table}:`, error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ data });

  } catch (error) {
    console.error('Data API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // Auth check: any valid caller
  const authResult = await requireCallerWithEnforce(request, {
    route: '/api/data/[...path]',
    method: 'DELETE',
  });

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.error },
      { status: authResult.status }
    );
  }

  try {
    const { path } = await params;
    const [table, id] = path;

    if (!table || !id) {
      return NextResponse.json(
        { error: 'Table name and ID are required' },
        { status: 400 }
      );
    }

    const validTables = [
      'users', 'vehicles', 'taxi_stations', 'bus_terminals', 'routes',
      'trips', 'tickets', 'hotels', 'hotel_bookings', 'hospitals',
      'pharmacies', 'tourism_sites', 'tour_packages', 'emergency_requests',
      'emergency_centers', 'announcements', 'notifications', 'payments',
      'wallet_transactions', 'government_offices', 'churches',
      'eco_shine_locations', 'marketplace_providers', 'guest_houses',
      'analytics', 'audit_logs'
    ];

    if (!validTables.includes(table)) {
      return NextResponse.json(
        { error: 'Invalid table name' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from(table)
      .delete()
      .eq('id', id);

    if (error) {
      console.error(`Error deleting from ${table}:`, error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Data API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
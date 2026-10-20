import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';
import { requireCallerWithEnforce, getCaller } from '@/lib/auth/verify';

// Generic data API endpoint for all Supabase queries
// Usage: /api/data/table_name or /api/data/table_name/id

// Role-based table permissions
// Format: table -> { read: [roles], write: [roles] }
const TABLE_PERMISSIONS: Record<string, { read: string[]; write: string[] }> = {
  // Public read tables
  vehicles: { read: ['*'], write: ['admin', 'taxi', 'government_fleet'] },
  taxi_stations: { read: ['*'], write: ['admin', 'old_terminal', 'new_terminal'] },
  bus_terminals: { read: ['*'], write: ['admin', 'old_terminal', 'new_terminal'] },
  routes: { read: ['*'], write: ['admin', 'old_terminal', 'new_terminal'] },
  hotels: { read: ['*'], write: ['admin', 'tourism', 'hotel'] },
  hospitals: { read: ['*'], write: ['admin', 'health', 'hospital'] },
  pharmacies: { read: ['*'], write: ['admin', 'health', 'pharmacy'] },
  tourism_sites: { read: ['*'], write: ['admin', 'tourism'] },
  tour_packages: { read: ['*'], write: ['admin', 'tourism'] },
  emergency_centers: { read: ['*'], write: ['admin', 'emergency'] },
  announcements: { read: ['*'], write: ['admin'] },
  government_offices: { read: ['*'], write: ['admin', 'government_fleet'] },
  churches: { read: ['*'], write: ['admin'] },
  eco_shine_locations: { read: ['*'], write: ['admin'] },
  marketplace_providers: { read: ['*'], write: ['admin'] },
  guest_houses: { read: ['*'], write: ['admin', 'tourism'] },

  // User-specific tables (read own only, write restricted)
  users: { read: ['*'], write: ['admin'] }, // Never allow writes to users.role
  trips: { read: ['*'], write: ['admin', 'taxi', 'government_fleet'] },
  tickets: { read: ['*'], write: ['admin', 'old_terminal', 'new_terminal'] },
  hotel_bookings: { read: ['*'], write: ['admin', 'tourism', 'hotel'] },
  emergency_requests: { read: ['*'], write: ['admin', 'emergency'] },
  notifications: { read: ['*'], write: ['admin'] },
  payments: { read: ['*'], write: ['admin'] },
  wallet_transactions: { read: ['*'], write: ['admin'] },

  // System tables (admin only)
  analytics: { read: ['admin'], write: ['admin'] },
  audit_logs: { read: ['admin'], write: ['admin'] },
};

// Helper to check if role has permission
function hasPermission(table: string, operation: 'read' | 'write', userRole: string | null): boolean {
  const perms = TABLE_PERMISSIONS[table];
  if (!perms) return false;

  const allowedRoles = perms[operation];
  if (allowedRoles.includes('*')) return true;
  if (!userRole) return false;
  return allowedRoles.includes(userRole);
}

// Helper to get user role from Supabase
async function getUserRole(firebaseUid: string): Promise<string | null> {
  if (!firebaseUid) return null;
  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('firebase_uid', firebaseUid)
    .maybeSingle();
  if (error || !data) return null;
  return data.role;
}
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

    // Check table permissions
    const caller = authResult.caller;
    const userRole = caller ? await getUserRole(caller.uid) : null;
    if (!hasPermission(table, 'read', userRole)) {
      return NextResponse.json(
        { error: 'Forbidden: Insufficient permissions for this table' },
        { status: 403 }
      );
    }

    // Validate table name to prevent SQL injection
    const validTables = Object.keys(TABLE_PERMISSIONS);

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

    // Check table permissions
    const caller = authResult.caller;
    const userRole = caller ? await getUserRole(caller.uid) : null;
    if (!hasPermission(table, 'write', userRole)) {
      return NextResponse.json(
        { error: 'Forbidden: Insufficient permissions for this table' },
        { status: 403 }
      );
    }

    const validTables = Object.keys(TABLE_PERMISSIONS);

    if (!validTables.includes(table)) {
      return NextResponse.json(
        { error: 'Invalid table name' },
        { status: 400 }
      );
    }

    const body = await request.json();

    // Prevent writes to users.role
    if (table === 'users' && body.role !== undefined) {
      return NextResponse.json(
        { error: 'Forbidden: Cannot write to users.role' },
        { status: 403 }
      );
    }

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

    // Check table permissions
    const caller = authResult.caller;
    const userRole = caller ? await getUserRole(caller.uid) : null;
    if (!hasPermission(table, 'write', userRole)) {
      return NextResponse.json(
        { error: 'Forbidden: Insufficient permissions for this table' },
        { status: 403 }
      );
    }

    const validTables = Object.keys(TABLE_PERMISSIONS);

    if (!validTables.includes(table)) {
      return NextResponse.json(
        { error: 'Invalid table name' },
        { status: 400 }
      );
    }

    const body = await request.json();

    // Prevent writes to users.role
    if (table === 'users' && body.role !== undefined) {
      return NextResponse.json(
        { error: 'Forbidden: Cannot write to users.role' },
        { status: 403 }
      );
    }

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

    // Check table permissions
    const caller = authResult.caller;
    const userRole = caller ? await getUserRole(caller.uid) : null;
    if (!hasPermission(table, 'write', userRole)) {
      return NextResponse.json(
        { error: 'Forbidden: Insufficient permissions for this table' },
        { status: 403 }
      );
    }

    const validTables = Object.keys(TABLE_PERMISSIONS);

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
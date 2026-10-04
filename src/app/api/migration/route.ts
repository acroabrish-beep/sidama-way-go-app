import { NextRequest, NextResponse } from 'next/server';
import { DataMigrationService } from '@/lib/migration/data-migration';
import { supabaseAdmin } from '@/lib/supabase/client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action = 'migrate', table } = body;

    const migrationService = new DataMigrationService();

    switch (action) {
      case 'migrate':
        const report = await migrationService.migrateAllCollections();
        return NextResponse.json({ success: true, report });

      case 'validate':
        const isValid = await migrationService.validateMigration();
        return NextResponse.json({ success: true, isValid });

      case 'rollback':
        if (!table) {
          return NextResponse.json(
            { error: 'Table name is required for rollback' },
            { status: 400 }
          );
        }
        const rollbackSuccess = await migrationService.rollbackMigration(table);
        return NextResponse.json({ success: rollbackSuccess });

      case 'align-users':
        const alignResult = await alignUsersSchema();
        return NextResponse.json({ success: true, result: alignResult });

      case 'fix-test-roles':
        const fixRolesResult = await fixTestUserRoles();
        return NextResponse.json({ success: true, result: fixRolesResult });

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: migrate, validate, rollback, or align-users' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Migration API error:', error);
    return NextResponse.json(
      { error: 'Migration failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

async function alignUsersSchema() {
  const results: { column: string; status: string }[] = [];
  
  try {
    // Read the SQL migration file
    const sqlStatements = `
      -- Enable UUID extension
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      
      -- Ensure users table exists
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      -- Add firebase_uid column
      ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(255) UNIQUE;
      
      -- Add other required columns
      ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS photo TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'citizen';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'en';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT true;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance DECIMAL(10, 2) DEFAULT 0.00;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS membership_number VARCHAR(50);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS unread_notifications INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITH TIME ZONE DEFAULT NOW();
      ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
      
      -- Fill null full_names
      UPDATE users SET full_name = SPLIT_PART(email, '@', 1) WHERE full_name IS NULL;
      
      -- Create index on firebase_uid
      CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
    `;

    // Note: This returns the SQL statements to be executed manually via Supabase SQL Editor
    // since direct SQL execution from Next.js requires additional setup
    results.push({ column: 'migration', status: 'SQL statements generated for manual execution' });
    results.push({ column: 'instructions', status: 'Run these statements in Supabase SQL Editor' });

    return { success: true, results, sqlStatements };
  } catch (error) {
    console.error('Schema alignment error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error', results };
  }
}

async function fixTestUserRoles() {
  const results: { email: string; status: string; oldRole: string; newRole: string }[] = [];
  
  try {
    // Role mapping for test accounts
    const roleMapping: Record<string, string> = {
      'admin@sidamawaygo.com': 'superAdmin',
      'newterminal@sidamawaygo.com': 'newTerminalAdmin',
      'oldterminal@sidamawaygo.com': 'oldTerminalAdmin',
      'taxi@sidamawaygo.com': 'taxiAdmin',
      'tourism@sidamawaygo.com': 'tourismAdmin',
      'hotel@sidamawaygo.com': 'hotelAdmin',
      'health@sidamawaygo.com': 'healthAdmin',
      'pharmacy@sidamawaygo.com': 'pharmacyAdmin',
      'emergency@sidamawaygo.com': 'emergencyAdmin',
    };

    for (const [email, correctRole] of Object.entries(roleMapping)) {
      const { data: user, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('email', email)
        .maybeSingle();

      if (error) {
        results.push({ email, status: 'ERROR: ' + error.message, oldRole: 'N/A', newRole: correctRole });
        continue;
      }

      if (!user) {
        results.push({ email, status: 'NOT FOUND', oldRole: 'N/A', newRole: correctRole });
        continue;
      }

      const currentRole = user.role || user.user_type || 'citizen';
      
      // Only update if the role is incorrect
      if (currentRole !== correctRole) {
        const { error: updateError } = await supabaseAdmin
          .from('users')
          .update({ 
            role: correctRole,
            user_type: correctRole,
            updated_at: new Date().toISOString()
          })
          .eq('email', email);

        if (updateError) {
          results.push({ email, status: 'UPDATE FAILED: ' + updateError.message, oldRole: currentRole, newRole: correctRole });
        } else {
          results.push({ email, status: 'UPDATED', oldRole: currentRole, newRole: correctRole });
        }
      } else {
        results.push({ email, status: 'ALREADY CORRECT', oldRole: currentRole, newRole: correctRole });
      }
    }

    return { success: true, results };
  } catch (error) {
    console.error('Fix test user roles error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error', results: [] };
  }
}
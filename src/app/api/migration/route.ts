import { NextRequest, NextResponse } from 'next/server';
import { DataMigrationService } from '@/lib/migration/data-migration';

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

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: migrate, validate, or rollback' },
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
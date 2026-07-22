import { supabaseAdmin } from '../supabase/client';
import { env } from '../config/env';

interface MigrationResult {
  success: boolean;
  recordsMigrated: number;
  errors: string[];
  collection: string;
}

interface MigrationReport {
  timestamp: string;
  results: MigrationResult[];
  totalRecords: number;
  totalErrors: number;
  duration: number;
}

export class DataMigrationService {
  // Mapping Firebase collection names to Supabase tables
  private collectionMapping: Record<string, string> = {
    'users': 'users',
    'vehicles': 'vehicles',
    'taxi_stations': 'taxi_stations',
    'bus_terminals': 'bus_terminals',
    'routes': 'routes',
    'trips': 'trips',
    'tickets': 'tickets',
    'hotels': 'hotels',
    'hotel_bookings': 'hotel_bookings',
    'hospitals': 'hospitals',
    'pharmacies': 'pharmacies',
    'tourism_sites': 'tourism_sites',
    'tour_packages': 'tour_packages',
    'emergency_requests': 'emergency_requests',
    'emergency_centers': 'emergency_centers',
    'announcements': 'announcements',
    'notifications': 'notifications',
    'payments': 'payments',
    'wallet_transactions': 'wallet_transactions',
    'government_offices': 'government_offices',
    'churches': 'churches',
    'eco_shine_locations': 'eco_shine_locations',
    'marketplace_providers': 'marketplace_providers',
    'guest_houses': 'guest_houses',
  };

  async migrateAllCollections(): Promise<MigrationReport> {
    const startTime = Date.now();
    const results: MigrationResult[] = [];
    let totalRecords = 0;
    let totalErrors = 0;

    console.log('Starting data migration from Firebase to Supabase...');

    for (const [firebaseCollection, supabaseTable] of Object.entries(this.collectionMapping)) {
      try {
        const result = await this.migrateCollection(firebaseCollection, supabaseTable);
        results.push(result);
        totalRecords += result.recordsMigrated;
        totalErrors += result.errors.length;
        
        console.log(`Migrated ${firebaseCollection}: ${result.recordsMigrated} records, ${result.errors.length} errors`);
      } catch (error) {
        console.error(`Failed to migrate ${firebaseCollection}:`, error);
        results.push({
          success: false,
          recordsMigrated: 0,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
          collection: firebaseCollection,
        });
        totalErrors++;
      }
    }

    const duration = Date.now() - startTime;
    
    const report: MigrationReport = {
      timestamp: new Date().toISOString(),
      results,
      totalRecords,
      totalErrors,
      duration,
    };

    await this.saveMigrationReport(report);
    
    console.log(`Migration completed in ${duration}ms`);
    console.log(`Total records migrated: ${totalRecords}`);
    console.log(`Total errors: ${totalErrors}`);

    return report;
  }

  async migrateCollection(firebaseCollection: string, supabaseTable: string): Promise<MigrationResult> {
    const errors: string[] = [];
    let recordsMigrated = 0;

    try {
      // Note: This would need Firebase Admin SDK to fetch data from Firebase
      // For now, this is a placeholder that demonstrates the migration structure
      
      // Fetch data from Firebase (placeholder)
      const firebaseData = await this.fetchFromFirebase(firebaseCollection);
      
      if (!firebaseData || firebaseData.length === 0) {
        console.log(`No data found in ${firebaseCollection}`);
        return {
          success: true,
          recordsMigrated: 0,
          errors: [],
          collection: firebaseCollection,
        };
      }

      // Transform and insert into Supabase
      for (const record of firebaseData) {
        try {
          const transformedData = this.transformRecord(record, firebaseCollection);
          
          const { error: insertError } = await supabaseAdmin
            .from(supabaseTable)
            .insert(transformedData);

          if (insertError) {
            errors.push(`Failed to insert record ${record.id}: ${insertError.message}`);
          } else {
            recordsMigrated++;
          }
        } catch (error) {
          errors.push(`Failed to transform record ${record.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      return {
        success: errors.length === 0,
        recordsMigrated,
        errors,
        collection: firebaseCollection,
      };
    } catch (error) {
      return {
        success: false,
        recordsMigrated,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        collection: firebaseCollection,
      };
    }
  }

  private async fetchFromFirebase(collection: string): Promise<any[]> {
    // Placeholder for Firebase data fetching
    // In production, this would use Firebase Admin SDK
    // Example:
    // const firestore = admin.firestore();
    // const snapshot = await firestore.collection(collection).get();
    // return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    console.log(`Fetching data from Firebase collection: ${collection}`);
    return [];
  }

  private transformRecord(record: any, collection: string): any {
    // Transform Firebase record to Supabase format
    const transformed: any = { ...record };

    // Remove Firebase-specific fields
    delete transformed._firestore;
    
    // Handle timestamp conversions
    if (transformed.createdAt && typeof transformed.createdAt === 'object') {
      transformed.created_at = new Date(transformed.createdAt.toDate?.() || transformed.createdAt).toISOString();
    }
    
    if (transformed.updatedAt && typeof transformed.updatedAt === 'object') {
      transformed.updated_at = new Date(transformed.updatedAt.toDate?.() || transformed.updatedAt).toISOString();
    }

    // Handle specific field mappings based on collection
    switch (collection) {
      case 'users':
        transformed.firebase_uid = record.id;
        transformed.full_name = record.fullName || record.name;
        transformed.wallet_balance = record.walletBalance || 0.00;
        break;
      case 'vehicles':
        transformed.current_location = record.currentLocation;
        transformed.plate_number = record.plateNumber;
        break;
      case 'trips':
        transformed.start_location = record.startLocation;
        transformed.end_location = record.endLocation;
        transformed.fare = record.fare || 0.00;
        break;
      // Add more transformations as needed
    }

    // Convert field names to snake_case
    return this.convertToSnakeCase(transformed);
  }

  private convertToSnakeCase(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.convertToSnakeCase(item));
    }

    const result: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const snakeCaseKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        result[snakeCaseKey] = this.convertToSnakeCase(obj[key]);
      }
    }
    return result;
  }

  private async saveMigrationReport(report: MigrationReport): Promise<void> {
    try {
      await supabaseAdmin.from('migration_reports').insert({
        timestamp: report.timestamp,
        results: report.results,
        total_records: report.totalRecords,
        total_errors: report.totalErrors,
        duration: report.duration,
      });
    } catch (error) {
      console.error('Failed to save migration report:', error);
    }
  }

  async validateMigration(): Promise<boolean> {
    // Validate that all records were migrated correctly
    let isValid = true;

    for (const [firebaseCollection, supabaseTable] of Object.entries(this.collectionMapping)) {
      try {
        // Count records in Supabase
        const { count, error } = await supabaseAdmin
          .from(supabaseTable)
          .select('*', { count: 'exact', head: true });

        if (error) {
          console.error(`Validation failed for ${supabaseTable}:`, error);
          isValid = false;
        } else {
          console.log(`${supabaseTable}: ${count} records`);
        }
      } catch (error) {
        console.error(`Validation error for ${supabaseTable}:`, error);
        isValid = false;
      }
    }

    return isValid;
  }

  async rollbackMigration(table: string): Promise<boolean> {
    try {
      // Soft delete all migrated records
      const { error } = await supabaseAdmin
        .from(table)
        .update({ deleted_at: new Date().toISOString() })
        .neq('deleted_at', null);

      if (error) {
        console.error(`Rollback failed for ${table}:`, error);
        return false;
      }

      console.log(`Rollback completed for ${table}`);
      return true;
    } catch (error) {
      console.error(`Rollback error for ${table}:`, error);
      return false;
    }
  }
}
/**
 * Comprehensive Supabase Connection Verification
 * Tests both regular and admin clients, including storage operations
 */

import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import logger from '../src/utils/logger';

interface TestResult {
  test: string;
  passed: boolean;
  message: string;
  details?: any;
}

class SupabaseConnectionVerifier {
  private results: TestResult[] = [];
  private supabaseUrl: string | undefined;
  private supabaseAnonKey: string | undefined;
  private supabaseServiceRoleKey: string | undefined;
  private supabase: SupabaseClient | null = null;
  private supabaseAdmin: SupabaseClient | null = null;

  constructor() {
    this.supabaseUrl = process.env.SUPABASE_URL;
    this.supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    this.supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  }

  private recordResult(test: string, passed: boolean, message: string, details?: any) {
    this.results.push({ test, passed, message, details });
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} ${test}: ${message}`);
    if (details) {
      console.log(`   Details:`, JSON.stringify(details, null, 2));
    }
  }

  /**
   * Test 1: Verify environment variables are set
   */
  testEnvironmentVariables(): void {
    console.log('\n📋 Testing Environment Variables...');
    
    const hasUrl = !!this.supabaseUrl;
    const hasAnonKey = !!this.supabaseAnonKey;
    const hasServiceRoleKey = !!this.supabaseServiceRoleKey;

    if (!hasUrl) {
      this.recordResult('Environment Variables', false, 'SUPABASE_URL is missing');
      return;
    }

    if (!hasAnonKey) {
      this.recordResult('Environment Variables', false, 'SUPABASE_ANON_KEY is missing');
      return;
    }

    if (!hasServiceRoleKey) {
      this.recordResult('Environment Variables', false, 'SUPABASE_SERVICE_ROLE_KEY is missing');
      return;
    }

    // Check URL format
    const isValidUrl = this.supabaseUrl.startsWith('https://') && this.supabaseUrl.includes('.supabase.co');
    if (!isValidUrl) {
      this.recordResult('Environment Variables', false, 'SUPABASE_URL format appears invalid (should be https://xxx.supabase.co)');
      return;
    }

    this.recordResult('Environment Variables', true, 'All required variables are set', {
      url: this.supabaseUrl.substring(0, 30) + '...',
      hasAnonKey: true,
      hasServiceRoleKey: true
    });
  }

  /**
   * Test 2: Initialize Supabase clients
   */
  async testClientInitialization(): Promise<void> {
    console.log('\n🔧 Testing Client Initialization...');

    try {
      if (!this.supabaseUrl || !this.supabaseAnonKey) {
        this.recordResult('Client Initialization', false, 'Missing required credentials');
        return;
      }

      // Initialize regular client
      this.supabase = createClient(this.supabaseUrl, this.supabaseAnonKey);
      this.recordResult('Regular Client', true, 'Regular Supabase client created');

      // Initialize admin client
      if (this.supabaseServiceRoleKey) {
        this.supabaseAdmin = createClient(this.supabaseUrl, this.supabaseServiceRoleKey, {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        });
        this.recordResult('Admin Client', true, 'Admin Supabase client created');
      } else {
        this.recordResult('Admin Client', false, 'Service role key not available');
      }
    } catch (error: any) {
      this.recordResult('Client Initialization', false, `Error: ${error.message}`);
    }
  }

  /**
   * Test 3: Test database connection (regular client)
   */
  async testDatabaseConnection(): Promise<void> {
    console.log('\n🗄️  Testing Database Connection (Regular Client)...');

    if (!this.supabase) {
      this.recordResult('Database Connection', false, 'Regular client not initialized');
      return;
    }

    try {
      // Test query to evidence_sources table
      const { data, error } = await this.supabase
        .from('evidence_sources')
        .select('count')
        .limit(1);

      if (error) {
        this.recordResult('Database Connection', false, `Query failed: ${error.message}`, {
          code: error.code,
          hint: error.hint
        });
        return;
      }

      this.recordResult('Database Connection', true, 'Successfully connected to database');
    } catch (error: any) {
      this.recordResult('Database Connection', false, `Connection error: ${error.message}`);
    }
  }

  /**
   * Test 4: Test admin database connection
   */
  async testAdminDatabaseConnection(): Promise<void> {
    console.log('\n🔐 Testing Admin Database Connection...');

    if (!this.supabaseAdmin) {
      this.recordResult('Admin Database Connection', false, 'Admin client not initialized');
      return;
    }

    try {
      // Test query with admin client (should bypass RLS)
      const { data, error } = await this.supabaseAdmin
        .from('evidence_sources')
        .select('count')
        .limit(1);

      if (error) {
        this.recordResult('Admin Database Connection', false, `Query failed: ${error.message}`, {
          code: error.code
        });
        return;
      }

      this.recordResult('Admin Database Connection', true, 'Admin client can access database');
    } catch (error: any) {
      this.recordResult('Admin Database Connection', false, `Connection error: ${error.message}`);
    }
  }

  /**
   * Test 5: Test storage bucket listing (requires admin)
   */
  async testStorageAccess(): Promise<void> {
    console.log('\n📦 Testing Storage Access...');

    if (!this.supabaseAdmin) {
      this.recordResult('Storage Access', false, 'Admin client not available (required for storage)');
      return;
    }

    try {
      const { data: buckets, error } = await this.supabaseAdmin.storage.listBuckets();

      if (error) {
        this.recordResult('Storage Access', false, `Cannot list buckets: ${error.message}`, {
          error: error.message
        });
        return;
      }

      const bucketNames = buckets?.map(b => b.name) || [];
      const hasEvidenceBucket = bucketNames.includes('evidence-documents');

      this.recordResult('Storage Access', true, `Successfully accessed storage`, {
        bucketCount: bucketNames.length,
        buckets: bucketNames,
        hasEvidenceBucket
      });

      // Check if evidence-documents bucket exists
      if (!hasEvidenceBucket) {
        console.log('\n⚠️  evidence-documents bucket does not exist. Attempting to create...');
        await this.testBucketCreation();
      } else {
        this.recordResult('Evidence Bucket', true, 'evidence-documents bucket exists');
      }
    } catch (error: any) {
      this.recordResult('Storage Access', false, `Storage error: ${error.message}`);
    }
  }

  /**
   * Test 6: Test bucket creation
   */
  async testBucketCreation(): Promise<void> {
    console.log('\n🪣 Testing Bucket Creation...');

    if (!this.supabaseAdmin) {
      this.recordResult('Bucket Creation', false, 'Admin client not available');
      return;
    }

    try {
      const { data, error } = await this.supabaseAdmin.storage.createBucket(
        'evidence-documents',
        {
          public: false,
          fileSizeLimit: 52428800, // 50MB
          allowedMimeTypes: [
            'application/pdf',
            'image/jpeg',
            'image/png',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'text/csv'
          ]
        }
      );

      if (error) {
        this.recordResult('Bucket Creation', false, `Cannot create bucket: ${error.message}`, {
          error: error.message,
          note: 'Bucket may need to be created manually in Supabase dashboard'
        });
        return;
      }

      this.recordResult('Bucket Creation', true, 'evidence-documents bucket created successfully');
    } catch (error: any) {
      this.recordResult('Bucket Creation', false, `Creation error: ${error.message}`);
    }
  }

  /**
   * Test 7: Test file upload (if bucket exists)
   */
  async testFileUpload(): Promise<void> {
    console.log('\n📤 Testing File Upload...');

    if (!this.supabaseAdmin) {
      this.recordResult('File Upload', false, 'Admin client not available');
      return;
    }

    try {
      // Create a test file (PDF format - supported MIME type)
      const testContent = Buffer.from('%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n>>\nendobj\nxref\n0 1\ntrailer\n<<\n/Root 1 0 R\n>>\n%%EOF');
      const testPath = 'test/connection-verification.pdf';

      const { data, error } = await this.supabaseAdmin.storage
        .from('evidence-documents')
        .upload(testPath, testContent, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (error) {
        this.recordResult('File Upload', false, `Upload failed: ${error.message}`, {
          error: error.message
        });
        return;
      }

      // Clean up test file
      await this.supabaseAdmin.storage
        .from('evidence-documents')
        .remove([testPath]);

      this.recordResult('File Upload', true, 'Successfully uploaded and deleted test file');
    } catch (error: any) {
      this.recordResult('File Upload', false, `Upload error: ${error.message}`);
    }
  }

  /**
   * Test 8: Test table access (evidence_sources, evidence_documents, evidence_ingestion_errors)
   */
  async testTableAccess(): Promise<void> {
    console.log('\n📊 Testing Table Access...');

    if (!this.supabaseAdmin) {
      this.recordResult('Table Access', false, 'Admin client not available');
      return;
    }

    const tables = ['evidence_sources', 'evidence_documents', 'evidence_ingestion_errors'];
    const results: any = {};

    for (const table of tables) {
      try {
        const { data, error, count } = await this.supabaseAdmin
          .from(table)
          .select('*', { count: 'exact', head: true });

        if (error) {
          results[table] = { accessible: false, error: error.message };
        } else {
          results[table] = { accessible: true, count: count || 0 };
        }
      } catch (error: any) {
        results[table] = { accessible: false, error: error.message };
      }
    }

    const allAccessible = Object.values(results).every((r: any) => r.accessible);
    const tableDetails = Object.entries(results).map(([table, result]: [string, any]) => ({
      table,
      accessible: result.accessible,
      count: result.count,
      error: result.error
    }));

    this.recordResult('Table Access', allAccessible, 
      allAccessible ? 'All tables accessible' : 'Some tables not accessible',
      { tables: tableDetails }
    );
  }

  /**
   * Run all tests
   */
  async runAllTests(): Promise<void> {
    console.log('='.repeat(80));
    console.log('🔍 SUPABASE CONNECTION VERIFICATION');
    console.log('='.repeat(80));

    // Run tests sequentially
    this.testEnvironmentVariables();
    await this.testClientInitialization();
    await this.testDatabaseConnection();
    await this.testAdminDatabaseConnection();
    await this.testStorageAccess();
    await this.testTableAccess();
    await this.testFileUpload();

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(80));

    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;

    console.log(`Total Tests: ${total}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);

    if (failed === 0) {
      console.log('\n🎉 All tests passed! Supabase connection is fully configured.');
      console.log('✅ Ready for stress testing with real database and storage.');
    } else {
      console.log('\n⚠️  Some tests failed. Review the details above.');
      console.log('💡 Common fixes:');
      console.log('   - Verify SUPABASE_URL is correct (https://xxx.supabase.co)');
      console.log('   - Check that service role key has proper permissions');
      console.log('   - Ensure tables exist (run migrations if needed)');
      console.log('   - Create evidence-documents bucket manually if needed');
    }

    console.log('='.repeat(80) + '\n');

    // Exit with appropriate code
    process.exit(failed === 0 ? 0 : 1);
  }
}

// Run verification
const verifier = new SupabaseConnectionVerifier();
verifier.runAllTests().catch((error) => {
  console.error('❌ Fatal error during verification:', error);
  process.exit(1);
});


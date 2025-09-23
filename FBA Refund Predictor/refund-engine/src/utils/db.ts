import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'refund_engine',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

// Create connection pool
const pool = new Pool(dbConfig);

// Database connection class with RLS support
export class Database {
  private static instance: Database;
  private pool: Pool;

  private constructor() {
    this.pool = pool;
  }

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  // Get a client from the pool
  async getClient(): Promise<PoolClient> {
    return await this.pool.connect();
  }

  // Execute a query with RLS context
  async query(text: string, params?: any[], userId?: string): Promise<any> {
    const client = await this.getClient();
    try {
      // Set RLS context if userId is provided
      if (userId) {
        await client.query('SET LOCAL app.current_user_id = $1', [userId]);
      }
      
      const result = await client.query(text, params);
      return result;
    } finally {
      client.release();
    }
  }

  // Execute a transaction
  async transaction<T>(callback: (client: PoolClient) => Promise<T>, userId?: string): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      
      // Set RLS context if userId is provided
      if (userId) {
        await client.query('SET LOCAL app.current_user_id = $1', [userId]);
      }
      
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Test database connection
  async testConnection(): Promise<boolean> {
    try {
      const result = await this.query('SELECT NOW()');
      return !!result.rows[0];
    } catch (error) {
      console.error('Database connection test failed:', error);
      return false;
    }
  }

  // Close all connections
  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Export singleton instance
export const db = Database.getInstance();

// Database schema types
export interface RefundCase {
  id: string;
  user_id: string;
  case_number: string;
  claim_amount: number;
  customer_history_score: number;
  product_category: string;
  days_since_purchase: number;
  claim_description?: string;
  status: 'pending' | 'approved' | 'rejected' | 'processing' | 'paid';
  created_at: Date;
  updated_at: Date;
  ml_prediction?: number;
  ml_confidence?: number;
}

export interface LedgerEntry {
  id: string;
  case_id: string;
  user_id: string;
  entry_type: 'claim' | 'refund' | 'fee' | 'adjustment';
  amount: number;
  description: string;
  status: 'pending' | 'completed' | 'failed';
  created_at: Date;
  updated_at: Date;
}

// Initialize database tables (run once)
export async function initializeDatabase(): Promise<void> {
  const createTablesSQL = `
    -- Enable RLS extension
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    
    -- Create custom type for user context
    CREATE OR REPLACE FUNCTION app.set_user_id(user_id TEXT)
    RETURNS VOID AS $$
    BEGIN
      PERFORM set_config('app.current_user_id', user_id, false);
    END;
    $$ LANGUAGE plpgsql;
    
    -- Create refund_engine_cases table
    CREATE TABLE IF NOT EXISTS refund_engine_cases (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL,
      case_number VARCHAR(50) UNIQUE NOT NULL,
      claim_amount DECIMAL(10,2) NOT NULL,
      customer_history_score DECIMAL(3,2) NOT NULL,
      product_category VARCHAR(100) NOT NULL,
      days_since_purchase INTEGER NOT NULL,
      claim_description TEXT,
      status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'processing', 'paid')),
      ml_prediction DECIMAL(3,2),
      ml_confidence DECIMAL(3,2),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    
    -- Create ledger table
    CREATE TABLE IF NOT EXISTS refund_engine_ledger (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      case_id UUID REFERENCES refund_engine_cases(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('claim', 'refund', 'fee', 'adjustment')),
      amount DECIMAL(10,2) NOT NULL,
      description TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    
    -- Enable Row Level Security
    ALTER TABLE refund_engine_cases ENABLE ROW LEVEL SECURITY;
    ALTER TABLE refund_engine_ledger ENABLE ROW LEVEL SECURITY;
    
    -- Create RLS policies for refund_engine_cases
    DROP POLICY IF EXISTS cases_user_policy ON refund_engine_cases;
    CREATE POLICY cases_user_policy ON refund_engine_cases
      FOR ALL USING (user_id::text = current_setting('app.current_user_id', true));
    
    -- Create RLS policies for refund_engine_ledger
    DROP POLICY IF EXISTS ledger_user_policy ON refund_engine_ledger;
    CREATE POLICY ledger_user_policy ON refund_engine_ledger
      FOR ALL USING (user_id::text = current_setting('app.current_user_id', true));
    
    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_cases_user_id ON refund_engine_cases(user_id);
    CREATE INDEX IF NOT EXISTS idx_cases_status ON refund_engine_cases(status);
    CREATE INDEX IF NOT EXISTS idx_ledger_case_id ON refund_engine_ledger(case_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_user_id ON refund_engine_ledger(user_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_entry_type ON refund_engine_ledger(entry_type);
    
    -- Create updated_at trigger function
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ language 'plpgsql';
    
    -- Create triggers for updated_at
    DROP TRIGGER IF EXISTS update_cases_updated_at ON refund_engine_cases;
    CREATE TRIGGER update_cases_updated_at
      BEFORE UPDATE ON refund_engine_cases
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    
    DROP TRIGGER IF EXISTS update_ledger_updated_at ON refund_engine_ledger;
    CREATE TRIGGER update_ledger_updated_at
      BEFORE UPDATE ON refund_engine_ledger
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    -- Case submissions table for Amazon/SP-API auditability
    CREATE TABLE IF NOT EXISTS refund_engine_case_submissions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      case_id UUID REFERENCES refund_engine_cases(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      provider VARCHAR(50) NOT NULL, -- e.g., 'amazon'
      submission_id VARCHAR(100),
      status VARCHAR(30) NOT NULL, -- e.g., 'pending','submitted','acknowledged','failed','paid'
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_case_submissions_case_id ON refund_engine_case_submissions(case_id);
    CREATE INDEX IF NOT EXISTS idx_case_submissions_status ON refund_engine_case_submissions(status);
    CREATE INDEX IF NOT EXISTS idx_case_submissions_provider ON refund_engine_case_submissions(provider);

    DROP TRIGGER IF EXISTS update_case_submissions_updated_at ON refund_engine_case_submissions;
    CREATE TRIGGER update_case_submissions_updated_at
      BEFORE UPDATE ON refund_engine_case_submissions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    -- Billing events table for Stripe audit
    CREATE TABLE IF NOT EXISTS billing_events (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL,
      case_id UUID REFERENCES refund_engine_cases(id) ON DELETE SET NULL,
      claim_id UUID, -- optional external claim id
      event_type VARCHAR(50) NOT NULL, -- 'commission_charged','commission_failed'
      amount_cents INTEGER NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'usd',
      idempotency_key VARCHAR(200),
      payment_ref VARCHAR(200), -- e.g., stripe payment intent/charge id
      payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_billing_events_user_id ON billing_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_billing_events_case_id ON billing_events(case_id);
    CREATE INDEX IF NOT EXISTS idx_billing_events_type ON billing_events(event_type);
  `;

  try {
    await db.query(createTablesSQL);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
} 
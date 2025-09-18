import { db, LedgerEntry } from '../../utils/db';

export interface LedgerQueryParams {
  status?: 'pending' | 'completed' | 'failed';
  entry_type?: 'claim' | 'refund' | 'fee' | 'adjustment';
  date_from?: string;
  date_to?: string;
  case_id?: string;
  limit?: number;
  offset?: number;
  sort_by?: string;
  sort_order?: 'ASC' | 'DESC';
}

export interface LedgerStats {
  total_entries: number;
  total_amount: number;
  pending_amount: number;
  completed_amount: number;
  failed_amount: number;
  by_type: {
    claim: { count: number; amount: number };
    refund: { count: number; amount: number };
    fee: { count: number; amount: number };
    adjustment: { count: number; amount: number };
  };
}

export class LedgerService {
  /**
   * Get ledger entries with filtering and pagination
   */
  static async getLedgerEntries(userId: string, params: LedgerQueryParams = {}): Promise<{ entries: LedgerEntry[], total: number }> {
    const { 
      status, 
      entry_type, 
      date_from, 
      date_to, 
      case_id,
      limit = 10, 
      offset = 0, 
      sort_by = 'created_at', 
      sort_order = 'DESC' 
    } = params;

    let whereConditions = ['user_id = $1'];
    let queryParams = [userId];
    let paramIndex = 2;

    if (status) {
      whereConditions.push(`status = $${paramIndex}`);
      queryParams.push(status);
      paramIndex++;
    }

    if (entry_type) {
      whereConditions.push(`entry_type = $${paramIndex}`);
      queryParams.push(entry_type);
      paramIndex++;
    }

    if (case_id) {
      whereConditions.push(`case_id = $${paramIndex}`);
      queryParams.push(case_id);
      paramIndex++;
    }

    if (date_from) {
      whereConditions.push(`created_at >= $${paramIndex}`);
      queryParams.push(date_from);
      paramIndex++;
    }

    if (date_to) {
      whereConditions.push(`created_at <= $${paramIndex}`);
      queryParams.push(date_to);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) FROM refund_engine_ledger WHERE ${whereClause}`,
      queryParams,
      userId
    );
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    const entriesResult = await db.query(
      `SELECT * FROM refund_engine_ledger 
       WHERE ${whereClause}
       ORDER BY ${sort_by} ${sort_order}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...queryParams, limit, offset],
      userId
    );

    return {
      entries: entriesResult.rows,
      total
    };
  }

  /**
   * Get ledger entry by ID
   */
  static async getLedgerEntryById(userId: string, entryId: string): Promise<LedgerEntry | null> {
    const result = await db.query(
      'SELECT * FROM refund_engine_ledger WHERE id = $1',
      [entryId],
      userId
    );

    return result.rows[0] || null;
  }

  /**
   * Get ledger entries for a specific case
   */
  static async getLedgerEntriesByCase(userId: string, caseId: string): Promise<LedgerEntry[]> {
    const result = await db.query(
      `SELECT * FROM refund_engine_ledger 
       WHERE case_id = $1 
       ORDER BY created_at DESC`,
      [caseId],
      userId
    );

    return result.rows;
  }

  /**
   * Create a new ledger entry
   */
  static async createLedgerEntry(userId: string, entryData: {
    case_id: string;
    entry_type: 'claim' | 'refund' | 'fee' | 'adjustment';
    amount: number;
    description: string;
    status?: 'pending' | 'completed' | 'failed';
  }): Promise<LedgerEntry> {
    const { case_id, entry_type, amount, description, status = 'pending' } = entryData;

    const result = await db.query(
      `INSERT INTO refund_engine_ledger 
       (user_id, case_id, entry_type, amount, description, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, case_id, entry_type, amount, description, status],
      userId
    );

    return result.rows[0];
  }

  /**
   * Update ledger entry status
   */
  static async updateLedgerEntryStatus(userId: string, entryId: string, status: 'pending' | 'completed' | 'failed'): Promise<LedgerEntry | null> {
    const result = await db.query(
      `UPDATE refund_engine_ledger 
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, entryId],
      userId
    );

    return result.rows[0] || null;
  }

  /**
   * Get ledger statistics for a user
   */
  static async getLedgerStats(userId: string, dateFrom?: string, dateTo?: string): Promise<LedgerStats> {
    let whereConditions = ['user_id = $1'];
    let queryParams = [userId];
    let paramIndex = 2;

    if (dateFrom) {
      whereConditions.push(`created_at >= $${paramIndex}`);
      queryParams.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      whereConditions.push(`created_at <= $${paramIndex}`);
      queryParams.push(dateTo);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    const result = await db.query(
      `SELECT 
        COUNT(*) as total_entries,
        COALESCE(SUM(amount), 0) as total_amount,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) as pending_amount,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0) as completed_amount,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN amount ELSE 0 END), 0) as failed_amount,
        COUNT(CASE WHEN entry_type = 'claim' THEN 1 END) as claim_count,
        COALESCE(SUM(CASE WHEN entry_type = 'claim' THEN amount ELSE 0 END), 0) as claim_amount,
        COUNT(CASE WHEN entry_type = 'refund' THEN 1 END) as refund_count,
        COALESCE(SUM(CASE WHEN entry_type = 'refund' THEN amount ELSE 0 END), 0) as refund_amount,
        COUNT(CASE WHEN entry_type = 'fee' THEN 1 END) as fee_count,
        COALESCE(SUM(CASE WHEN entry_type = 'fee' THEN amount ELSE 0 END), 0) as fee_amount,
        COUNT(CASE WHEN entry_type = 'adjustment' THEN 1 END) as adjustment_count,
        COALESCE(SUM(CASE WHEN entry_type = 'adjustment' THEN amount ELSE 0 END), 0) as adjustment_amount
       FROM refund_engine_ledger
       WHERE ${whereClause}`,
      queryParams,
      userId
    );

    const row = result.rows[0];
    return {
      total_entries: parseInt(row.total_entries),
      total_amount: parseFloat(row.total_amount),
      pending_amount: parseFloat(row.pending_amount),
      completed_amount: parseFloat(row.completed_amount),
      failed_amount: parseFloat(row.failed_amount),
      by_type: {
        claim: { count: parseInt(row.claim_count), amount: parseFloat(row.claim_amount) },
        refund: { count: parseInt(row.refund_count), amount: parseFloat(row.refund_amount) },
        fee: { count: parseInt(row.fee_count), amount: parseFloat(row.fee_amount) },
        adjustment: { count: parseInt(row.adjustment_count), amount: parseFloat(row.adjustment_amount) }
      }
    };
  }

  /**
   * Get ledger entries with case information
   */
  static async getLedgerEntriesWithCaseInfo(userId: string, params: LedgerQueryParams = {}): Promise<any[]> {
    const { 
      status, 
      entry_type, 
      date_from, 
      date_to, 
      case_id,
      limit = 10, 
      offset = 0, 
      sort_by = 'l.created_at', 
      sort_order = 'DESC' 
    } = params;

    let whereConditions = ['l.user_id = $1'];
    let queryParams = [userId];
    let paramIndex = 2;

    if (status) {
      whereConditions.push(`l.status = $${paramIndex}`);
      queryParams.push(status);
      paramIndex++;
    }

    if (entry_type) {
      whereConditions.push(`l.entry_type = $${paramIndex}`);
      queryParams.push(entry_type);
      paramIndex++;
    }

    if (case_id) {
      whereConditions.push(`l.case_id = $${paramIndex}`);
      queryParams.push(case_id);
      paramIndex++;
    }

    if (date_from) {
      whereConditions.push(`l.created_at >= $${paramIndex}`);
      queryParams.push(date_from);
      paramIndex++;
    }

    if (date_to) {
      whereConditions.push(`l.created_at <= $${paramIndex}`);
      queryParams.push(date_to);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    const result = await db.query(
      `SELECT 
        l.*,
        c.case_number,
        c.claim_amount as case_claim_amount,
        c.product_category,
        c.status as case_status
       FROM refund_engine_ledger l
       LEFT JOIN refund_engine_cases c ON l.case_id = c.id
       WHERE ${whereClause}
       ORDER BY ${sort_by} ${sort_order}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...queryParams, limit, offset],
      userId
    );

    return result.rows;
  }

  /**
   * Search ledger entries by description
   */
  static async searchLedgerEntries(userId: string, searchTerm: string, limit: number = 10): Promise<LedgerEntry[]> {
    const result = await db.query(
      `SELECT * FROM refund_engine_ledger 
       WHERE user_id = $1 
       AND description ILIKE $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [userId, `%${searchTerm}%`, limit],
      userId
    );

    return result.rows;
  }
} 
import { db, RefundCase } from '../../utils/db';

export interface CreateClaimRequest {
  case_number: string;
  claim_amount: number;
  customer_history_score: number;
  product_category: string;
  days_since_purchase: number;
  claim_description?: string;
}

export interface UpdateClaimRequest {
  case_number?: string;
  claim_amount?: number;
  customer_history_score?: number;
  product_category?: string;
  days_since_purchase?: number;
  claim_description?: string;
  status?: 'pending' | 'approved' | 'rejected' | 'processing';
  ml_prediction?: number;
  ml_confidence?: number;
}

export interface ClaimsQueryParams {
  status?: string;
  product_category?: string;
  limit?: number;
  offset?: number;
  sort_by?: string;
  sort_order?: 'ASC' | 'DESC';
}

export class ClaimsService {
  /**
   * Create a new refund claim
   */
  static async createClaim(userId: string, claimData: CreateClaimRequest): Promise<RefundCase> {
    const { case_number, claim_amount, customer_history_score, product_category, days_since_purchase, claim_description } = claimData;

    // Check if case number already exists
    const existingCase = await db.query(
      'SELECT id FROM refund_engine_cases WHERE case_number = $1',
      [case_number],
      userId
    );

    if (existingCase.rows.length > 0) {
      throw new Error('Case number already exists');
    }

    const result = await db.query(
      `INSERT INTO refund_engine_cases 
       (user_id, case_number, claim_amount, customer_history_score, product_category, days_since_purchase, claim_description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, case_number, claim_amount, customer_history_score, product_category, days_since_purchase, claim_description],
      userId
    );

    return result.rows[0];
  }

  /**
   * Get all claims for a user with pagination and filtering
   */
  static async getClaims(userId: string, params: ClaimsQueryParams = {}): Promise<{ claims: RefundCase[], total: number }> {
    const { status, product_category, limit = 10, offset = 0, sort_by = 'created_at', sort_order = 'DESC' } = params;

    let whereConditions = ['user_id = $1'];
    let queryParams = [userId];
    let paramIndex = 2;

    if (status) {
      whereConditions.push(`status = $${paramIndex}`);
      queryParams.push(status);
      paramIndex++;
    }

    if (product_category) {
      whereConditions.push(`product_category = $${paramIndex}`);
      queryParams.push(product_category);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) FROM refund_engine_cases WHERE ${whereClause}`,
      queryParams,
      userId
    );
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    const claimsResult = await db.query(
      `SELECT * FROM refund_engine_cases 
       WHERE ${whereClause}
       ORDER BY ${sort_by} ${sort_order}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...queryParams, limit, offset],
      userId
    );

    return {
      claims: claimsResult.rows,
      total
    };
  }

  /**
   * Get a specific claim by ID
   */
  static async getClaimById(userId: string, claimId: string): Promise<RefundCase | null> {
    const result = await db.query(
      'SELECT * FROM refund_engine_cases WHERE id = $1',
      [claimId],
      userId
    );

    return result.rows[0] || null;
  }

  /**
   * Get a specific claim by case number
   */
  static async getClaimByCaseNumber(userId: string, caseNumber: string): Promise<RefundCase | null> {
    const result = await db.query(
      'SELECT * FROM refund_engine_cases WHERE case_number = $1',
      [caseNumber],
      userId
    );

    return result.rows[0] || null;
  }

  /**
   * Update a claim
   */
  static async updateClaim(userId: string, claimId: string, updateData: UpdateClaimRequest): Promise<RefundCase | null> {
    // Check if claim exists and belongs to user
    const existingClaim = await this.getClaimById(userId, claimId);
    if (!existingClaim) {
      return null;
    }

    // Build dynamic update query
    const updateFields: string[] = [];
    const queryParams: any[] = [];
    let paramIndex = 1;

    Object.entries(updateData).forEach(([key, value]) => {
      if (value !== undefined) {
        updateFields.push(`${key} = $${paramIndex}`);
        queryParams.push(value);
        paramIndex++;
      }
    });

    if (updateFields.length === 0) {
      return existingClaim;
    }

    queryParams.push(claimId);

    const result = await db.query(
      `UPDATE refund_engine_cases 
       SET ${updateFields.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING *`,
      queryParams,
      userId
    );

    return result.rows[0];
  }

  /**
   * Delete a claim
   */
  static async deleteClaim(userId: string, claimId: string): Promise<boolean> {
    const result = await db.query(
      'DELETE FROM refund_engine_cases WHERE id = $1',
      [claimId],
      userId
    );

    return result.rowCount > 0;
  }

  /**
   * Update ML prediction for a claim
   */
  static async updateMLPrediction(userId: string, claimId: string, prediction: number, confidence: number): Promise<RefundCase | null> {
    const result = await db.query(
      `UPDATE refund_engine_cases 
       SET ml_prediction = $1, ml_confidence = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [prediction, confidence, claimId],
      userId
    );

    return result.rows[0] || null;
  }

  /**
   * Get claims statistics for a user
   */
  static async getClaimsStats(userId: string): Promise<{
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    processing: number;
    total_amount: number;
    avg_prediction: number;
  }> {
    const result = await db.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
        COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
        COALESCE(SUM(claim_amount), 0) as total_amount,
        COALESCE(AVG(ml_prediction), 0) as avg_prediction
       FROM refund_engine_cases
       WHERE user_id = $1`,
      [userId],
      userId
    );

    return result.rows[0];
  }

  /**
   * Search claims by text (case number, description, product category)
   */
  static async searchClaims(userId: string, searchTerm: string, limit: number = 10): Promise<RefundCase[]> {
    const result = await db.query(
      `SELECT * FROM refund_engine_cases 
       WHERE user_id = $1 
       AND (case_number ILIKE $2 OR claim_description ILIKE $2 OR product_category ILIKE $2)
       ORDER BY created_at DESC
       LIMIT $3`,
      [userId, `%${searchTerm}%`, limit],
      userId
    );

    return result.rows;
  }

  /**
   * Create a submission record so the Amazon worker can process it
   */
  static async createSubmissionRecord(userId: string, caseId: string, provider: 'amazon'): Promise<void> {
    await db.query(
      `INSERT INTO refund_engine_case_submissions (case_id, user_id, provider, status, metadata)
       VALUES ($1, $2, $3, 'pending', $4)`,
      [caseId, userId, provider, {}],
      userId
    );
  }

  /**
   * Record a billing event for auditability
   */
  static async recordBillingEvent(
    userId: string,
    caseId: string,
    eventType: 'commission_charged' | 'commission_failed',
    amountCents: number,
    currency: string,
    idempotencyKey?: string,
    paymentRef?: string,
    payload?: any,
  ): Promise<void> {
    await db.query(
      `INSERT INTO billing_events (user_id, case_id, event_type, amount_cents, currency, idempotency_key, payment_ref, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, caseId, eventType, amountCents, currency, idempotencyKey, paymentRef, payload || {}],
      userId
    );
  }
} 
import { db } from '../utils/db';
import { AmazonSubmissionClient, ExternalStatus } from '../integrations/amazonSubmissionClient';

interface SubmissionRecord {
  id: string;
  case_id: string;
  user_id: string;
  provider: string;
  submission_id: string | null;
  status: string;
  attempts: number;
  last_error?: string;
  metadata: any;
}

export class AmazonSubmissionWorker {
  private intervalMs: number;
  private running = false;
  private client: AmazonSubmissionClient;

  constructor(intervalMs: number = 30000) {
    this.intervalMs = intervalMs;
    const baseUrl = process.env.AMAZON_HEADLESS_BASE_URL || '';
    const apiKey = process.env.AMAZON_HEADLESS_API_KEY || undefined;
    this.client = new AmazonSubmissionClient(baseUrl, apiKey, intervalMs);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
  }

  private async loop() {
    while (this.running) {
      try {
        await this.processPending();
      } catch (e) {
        console.error('AmazonSubmissionWorker loop error:', e);
      }
      await new Promise(r => setTimeout(r, this.intervalMs));
    }
  }

  private async processPending() {
    // Find pending or failed-with-retry submissions
    const res = await db.query(
      `SELECT * FROM refund_engine_case_submissions
       WHERE provider = 'amazon' AND (status = 'pending' OR status = 'failed') AND attempts < 5
       ORDER BY created_at ASC LIMIT 10`
    );
    const rows: SubmissionRecord[] = res.rows || [];

    for (const row of rows) {
      try {
        if (!row.submission_id) {
          await this.submitToAmazon(row);
        } else {
          await this.pollAmazon(row);
        }
      } catch (e: any) {
        await db.query(
          `UPDATE refund_engine_case_submissions
           SET attempts = attempts + 1, last_error = $1, status = 'failed', updated_at = NOW()
           WHERE id = $2`,
          [e?.message || 'Unknown error', row.id]
        );
      }
    }
  }

  private async submitToAmazon(row: SubmissionRecord) {
    // Prepare payload from case
    const caseRes = await db.query(
      `SELECT id, user_id, case_number, claim_amount FROM refund_engine_cases WHERE id = $1`,
      [row.case_id],
      row.user_id
    );
    const refundCase = caseRes.rows[0];
    if (!refundCase) throw new Error('Case not found');

    const payload = {
      caseId: refundCase.id,
      userId: refundCase.user_id,
      caseNumber: refundCase.case_number,
      amountCents: Math.round(Number(refundCase.claim_amount) * 100),
      currency: 'usd',
      description: 'Auto-submitted via Refund Engine',
    };

    const result = await this.client.submitClaim(payload);
    await db.query(
      `UPDATE refund_engine_case_submissions
       SET submission_id = $1, status = $2, attempts = attempts + 1, updated_at = NOW()
       WHERE id = $3`,
      [result.submissionId, this.mapExternal(result.status), row.id]
    );
  }

  private async pollAmazon(row: SubmissionRecord) {
    const status = await this.client.getSubmissionStatus(row.submission_id!);
    const internal = this.mapExternal(status.status);
    if (internal !== row.status) {
      await db.query(
        `UPDATE refund_engine_case_submissions SET status = $1, updated_at = NOW() WHERE id = $2`,
        [internal, row.id]
      );
      if (internal === 'paid') {
        await db.query(
          `UPDATE refund_engine_cases SET status = 'paid', updated_at = NOW() WHERE id = $1`,
          [row.case_id],
          row.user_id
        );
      }
    }
  }

  private mapExternal(status: ExternalStatus): string {
    switch (status) {
      case 'pending':
      case 'submitted':
        return 'pending';
      case 'acknowledged':
        return 'acknowledged';
      case 'paid':
        return 'paid';
      case 'failed':
      case 'rejected':
      case 'partial':
        return 'failed';
      default:
        return 'pending';
    }
  }
}



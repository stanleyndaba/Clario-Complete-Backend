import { Request, Response } from 'express';
import { db } from '../../utils/db';

export class AmazonSubmissionController {
  static async metrics(_req: Request, res: Response): Promise<void> {
    try {
      const total = await db.query(`SELECT COUNT(*)::int AS cnt FROM refund_engine_case_submissions`);
      const byStatus = await db.query(
        `SELECT status, COUNT(*)::int AS cnt FROM refund_engine_case_submissions GROUP BY status`
      );
      const failedAttempts = await db.query(
        `SELECT COALESCE(SUM(CASE WHEN status = 'failed' THEN attempts ELSE 0 END), 0)::int AS attempts FROM refund_engine_case_submissions`
      );
      const totalRetries = await db.query(
        `SELECT COALESCE(SUM(attempts), 0)::int AS attempts FROM refund_engine_case_submissions`
      );
      res.json({
        success: true,
        data: {
          total: total.rows[0]?.cnt || 0,
          byStatus: Object.fromEntries(byStatus.rows.map((r: any) => [r.status, r.cnt])),
          failedAttempts: failedAttempts.rows[0]?.attempts || 0,
          totalAttempts: totalRetries.rows[0]?.attempts || 0,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || 'Metrics failed' });
    }
  }

  static async health(_req: Request, res: Response): Promise<void> {
    try {
      const pending = await db.query(
        `SELECT COUNT(*)::int AS cnt FROM refund_engine_case_submissions WHERE status IN ('pending')`
      );
      const inProgress = await db.query(
        `SELECT COUNT(*)::int AS cnt FROM refund_engine_case_submissions WHERE status IN ('pending','acknowledged')`
      );
      const last = await db.query(
        `SELECT MAX(updated_at) AS lastUpdated FROM refund_engine_case_submissions`
      );
      res.json({
        success: true,
        data: {
          workerEnabled: process.env.ENABLE_AMAZON_SUBMISSION === 'true',
          pending: pending.rows[0]?.cnt || 0,
          inProgress: inProgress.rows[0]?.cnt || 0,
          lastUpdate: last.rows[0]?.lastupdated || null,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || 'Health failed' });
    }
  }

  static async inProgress(_req: Request, res: Response): Promise<void> {
    try {
      const rows = await db.query(
        `SELECT id, case_id, user_id, provider, submission_id, status, attempts, updated_at
         FROM refund_engine_case_submissions
         WHERE status IN ('pending','acknowledged')
         ORDER BY updated_at DESC LIMIT 100`
      );
      res.json({ success: true, data: rows.rows, timestamp: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || 'List failed' });
    }
  }
}

export default AmazonSubmissionController;



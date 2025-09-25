import { Router } from 'express';
import { telemetryService } from '../services/telemetryService';

const router = Router();

router.get('/radar', async (req, res) => {
  try {
    const userId = (req as any).user?.id || (req.query.userId as string) || '';
    if (!userId) return res.status(400).json({ success: false, error: 'userId required' });
    const rows = await telemetryService.latestByUser(userId);
    // Aggregate freshness per stream
    const byStream: Record<string, any> = {};
    for (const r of rows) {
      const key = `${r.stream_type}:${r.marketplace_id}`;
      byStream[key] = {
        lastSuccess: r.last_success,
        freshnessLagMs: r.freshness_lag_ms,
        records: r.records_ingested,
        expected: r.expected_records
      };
    }
    return res.json({ success: true, telemetry: byStream });
  } catch (e) {
    return res.status(500).json({ success: false, error: (e as any)?.message || 'internal_error' });
  }
});

export default router;


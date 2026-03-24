import 'dotenv/config';

import { isRealDatabaseConfigured, supabaseAdmin } from '../database/supabaseClient';
import detectionService from '../services/detectionService';

async function main() {
  if (!isRealDatabaseConfigured) {
    throw new Error('Real Supabase configuration is required');
  }

  const tenantId = process.env.AGENT3_TENANT_ID!;
  const userId = process.env.AGENT3_USER_ID!;

  if (!tenantId || !userId) {
    throw new Error('AGENT3_TENANT_ID and AGENT3_USER_ID are required');
  }

  const db = await supabaseAdmin
    .from('detection_results')
    .select('id, tenant_id, seller_id, anomaly_type, estimated_value, confidence_score, severity, evidence, status, created_at, sync_id, deadline_date, days_remaining')
    .eq('tenant_id', tenantId as any)
    .eq('seller_id', userId as any)
    .order('created_at', { ascending: false });

  if (db.error) throw db.error;

  const rows = db.data || [];
  const totalEstimated = rows.reduce((sum: number, row: any) => sum + (Number(row.estimated_value) || 0), 0);
  const byType = rows.reduce((acc: Record<string, number>, row: any) => {
    acc[row.anomaly_type] = (acc[row.anomaly_type] || 0) + 1;
    return acc;
  }, {});

  const fieldCompleteness = {
    missingConfidence: rows.filter((row: any) => typeof row.confidence_score !== 'number').length,
    missingEvidence: rows.filter((row: any) => !row.evidence).length,
    missingTenant: rows.filter((row: any) => !row.tenant_id).length,
    missingSeller: rows.filter((row: any) => !row.seller_id).length,
    missingDeadline: rows.filter((row: any) => !row.deadline_date).length,
  };

  const resultsApi = await detectionService.getDetectionResults(userId, undefined, undefined, 1000, 0, tenantId);
  const statsApi = await detectionService.getDetectionStatistics(userId, tenantId);

  console.log(JSON.stringify({
    dbTruth: {
      count: rows.length,
      totalEstimated,
      byType,
      fieldCompleteness,
      sample: rows.slice(0, 12),
    },
    apiTruth: {
      resultsCount: resultsApi.length,
      resultsTotalEstimated: resultsApi.reduce((sum: number, row: any) => sum + (Number(row.estimated_value) || 0), 0),
      resultsByType: resultsApi.reduce((acc: Record<string, number>, row: any) => {
        acc[row.anomaly_type] = (acc[row.anomaly_type] || 0) + 1;
        return acc;
      }, {}),
      statistics: statsApi,
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import 'dotenv/config';

import { isRealDatabaseConfigured, supabaseAdmin } from '../database/supabaseClient';

const CANONICAL_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const CANONICAL_SELLER_ID = 'cf6d8078-e83a-472a-baf5-d241eb7ab36e';

type DetectionRow = {
  id: string;
  tenant_id: string;
  seller_id: string;
  anomaly_type: string;
  estimated_value: number;
  created_at: string;
  evidence?: Record<string, any> | null;
  related_event_ids?: string[] | null;
};

function fingerprintFor(row: DetectionRow): string {
  switch (row.anomaly_type) {
    case 'warehouse_transfer_loss':
      return [
        row.seller_id,
        row.anomaly_type,
        row.evidence?.transfer_id || '-',
        row.evidence?.sku || '-',
        row.evidence?.loss_type || '-'
      ].join('|');
    case 'shipment_shortage':
    case 'shipment_missing':
    case 'carrier_damage':
    case 'receiving_error':
    case 'case_break_error':
    case 'prep_fee_error':
      return [
        row.seller_id,
        row.anomaly_type,
        row.evidence?.shipment_id || '-',
        row.evidence?.sku || '-'
      ].join('|');
    case 'damaged_warehouse':
    case 'damaged_inbound':
    case 'damaged_removal': {
      const relatedIds = Array.isArray(row.related_event_ids)
        ? [...row.related_event_ids].sort().join('|')
        : '-';
      return [
        row.seller_id,
        row.anomaly_type,
        row.evidence?.damage_event_id || relatedIds,
        row.evidence?.sku || '-',
        row.evidence?.fnsku || '-'
      ].join('|');
    }
    case 'refund_no_return':
      return [
        row.seller_id,
        row.anomaly_type,
        row.evidence?.refund_event_id || '-',
        row.evidence?.order_id || '-',
        row.evidence?.sku || '-'
      ].join('|');
    default:
      return [
        row.seller_id,
        row.anomaly_type,
        row.evidence?.reference_id || row.evidence?.fnsku || row.evidence?.sku || row.id
      ].join('|');
  }
}

async function main() {
  if (!isRealDatabaseConfigured) {
    throw new Error('Real Supabase configuration is required');
  }

  const tenantId = process.env.AGENT3_TENANT_ID || CANONICAL_TENANT_ID;
  const sellerId = process.env.AGENT3_USER_ID || CANONICAL_SELLER_ID;

  const { data, error } = await supabaseAdmin
    .from('detection_results')
    .select('id,tenant_id,seller_id,anomaly_type,estimated_value,created_at,evidence,related_event_ids')
    .eq('tenant_id', tenantId)
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  const rows = (data || []) as DetectionRow[];
  const seen = new Set<string>();
  const kept: DetectionRow[] = [];
  const removed: DetectionRow[] = [];

  for (const row of rows) {
    const fingerprint = fingerprintFor(row);
    if (seen.has(fingerprint)) {
      removed.push(row);
      continue;
    }
    seen.add(fingerprint);
    kept.push(row);
  }

  if (removed.length > 0) {
    const { error: deleteError } = await supabaseAdmin
      .from('detection_results')
      .delete()
      .in('id', removed.map((row) => row.id));

    if (deleteError) {
      throw deleteError;
    }
  }

  const keptValue = kept.reduce((sum, row) => sum + (Number(row.estimated_value) || 0), 0);
  const removedValue = removed.reduce((sum, row) => sum + (Number(row.estimated_value) || 0), 0);
  const removedByType = removed.reduce((acc: Record<string, number>, row) => {
    acc[row.anomaly_type] = (acc[row.anomaly_type] || 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    tenantId,
    sellerId,
    beforeCount: rows.length,
    afterCount: kept.length,
    removedCount: removed.length,
    keptValue,
    removedValue,
    removedByType,
    removedIds: removed.map((row) => row.id)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

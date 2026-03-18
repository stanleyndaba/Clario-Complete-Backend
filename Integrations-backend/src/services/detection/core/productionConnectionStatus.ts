import { supabaseAdmin } from '../../../database/supabaseClient';
import { relationExists, resolveTenantId } from './detectors/shared/tenantUtils';

export type Agent3AlgorithmStatus =
  | 'ACTIVE'
  | 'ACTIVE BUT NO QUALIFYING DATA'
  | 'DISABLED';

export interface Agent3AlgorithmAvailability {
  status: Agent3AlgorithmStatus;
  reason?: string;
}

async function countRows(table: string, tenantId: string, field: string, sellerId: string): Promise<number> {
  const exists = await relationExists(table);
  if (!exists) {
    return -1;
  }

  const { count, error } = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId as any)
    .eq(field as any, sellerId as any);

  if (error) {
    return -1;
  }

  return count || 0;
}

async function countMatchingReturnsForBrokenGoods(tenantId: string, sellerId: string): Promise<number> {
  if (!(await relationExists('returns'))) {
    return -1;
  }

  const { data, error } = await supabaseAdmin
    .from('returns')
    .select('items,metadata')
    .eq('tenant_id', tenantId as any)
    .eq('user_id', sellerId as any)
    .limit(100);

  if (error) {
    return -1;
  }

  return (data || []).filter((row: any) => {
    const disposition = String(row?.metadata?.disposition || '').toUpperCase();
    const items = Array.isArray(row?.items) ? row.items : [];
    return items.length > 0 && ['DAMAGED', 'UNSELLABLE', 'DEFECTIVE'].includes(disposition);
  }).length;
}

export async function getAgent3AlgorithmStatuses(
  sellerId: string
): Promise<Record<string, Agent3AlgorithmAvailability>> {
  const tenantId = await resolveTenantId(sellerId);

  const whaleInventoryLedgerEvents = await countRows('inventory_ledger_events', tenantId, 'user_id', sellerId);
  const whaleInventoryLedger = await countRows('inventory_ledger', tenantId, 'user_id', sellerId);
  const shipments = await countRows('shipments', tenantId, 'user_id', sellerId);
  const returns = await countRows('returns', tenantId, 'user_id', sellerId);
  const settlements = await countRows('settlements', tenantId, 'user_id', sellerId);
  const financialEvents = await countRows('financial_events', tenantId, 'seller_id', sellerId);
  const inventoryTransfers = await countRows('inventory_transfers', tenantId, 'seller_id', sellerId);
  const productCatalogExists = await relationExists('product_catalog');
  const feeEventsExists = await relationExists('fee_events');
  const brokenGoodsReadyRows = await countMatchingReturnsForBrokenGoods(tenantId, sellerId);

  const hasWhaleRail = whaleInventoryLedgerEvents >= 0 || whaleInventoryLedger >= 0;
  const whaleHasRows = (whaleInventoryLedgerEvents > 0) || (whaleInventoryLedger > 0);

  const hasFeeRail = feeEventsExists || financialEvents >= 0;
  const feeHasRows = financialEvents > 0;

  const sentinelHasLossRail = hasWhaleRail;
  const sentinelHasReimbursementRail = settlements >= 0 || financialEvents >= 0;
  const sentinelHasRows = whaleHasRows || settlements > 0 || financialEvents > 0;

  return {
    whaleHunter: !hasWhaleRail
      ? { status: 'DISABLED', reason: 'Missing inventory ledger source rail' }
      : whaleHasRows
        ? { status: 'ACTIVE' }
        : { status: 'ACTIVE BUT NO QUALIFYING DATA', reason: 'Inventory ledger rail exists but has no tenant-scoped rows' },
    transferLoss: inventoryTransfers < 0
      ? { status: 'DISABLED', reason: 'inventory_transfers source rail is not deployed' }
      : inventoryTransfers > 0
        ? { status: 'ACTIVE' }
        : { status: 'ACTIVE BUT NO QUALIFYING DATA', reason: 'Transfer rail exists but has no tenant-scoped rows' },
    inboundInspector: shipments < 0
      ? { status: 'DISABLED', reason: 'shipments source rail is not available' }
      : shipments > 0
        ? { status: 'ACTIVE' }
        : { status: 'ACTIVE BUT NO QUALIFYING DATA', reason: 'No tenant-scoped shipments available' },
    brokenGoodsHunter: returns < 0
      ? { status: 'DISABLED', reason: 'returns source rail is not available' }
      : returns === 0
        ? { status: 'ACTIVE BUT NO QUALIFYING DATA', reason: 'No tenant-scoped returns available' }
        : brokenGoodsReadyRows > 0
          ? { status: 'ACTIVE' }
          : { status: 'DISABLED', reason: 'Return rows lack the minimum damage fields (items + damaged disposition)' },
    refundTrap: returns < 0 || settlements < 0
      ? { status: 'DISABLED', reason: 'Refund Trap requires tenant-scoped returns and settlements rails' }
      : { status: returns > 0 || settlements > 0 ? 'ACTIVE' : 'ACTIVE BUT NO QUALIFYING DATA', reason: returns > 0 || settlements > 0 ? undefined : 'No tenant-scoped refund inputs available' },
    feePhantom: !hasFeeRail
      ? { status: 'DISABLED', reason: 'No fee source rail is available' }
      : feeHasRows
        ? { status: 'ACTIVE', reason: productCatalogExists ? undefined : 'Using financial_events fee rail without product_catalog enrichment' }
        : { status: 'ACTIVE BUT NO QUALIFYING DATA', reason: 'Fee rail is connected but no tenant-scoped fee rows are present' },
    sentinel: !sentinelHasLossRail || !sentinelHasReimbursementRail
      ? { status: 'DISABLED', reason: 'Sentinel requires both loss and reimbursement source rails' }
      : sentinelHasRows
        ? { status: 'ACTIVE' }
        : { status: 'ACTIVE BUT NO QUALIFYING DATA', reason: 'Sentinel rails exist but no tenant-scoped reconciliation cohort is present' },
  };
}

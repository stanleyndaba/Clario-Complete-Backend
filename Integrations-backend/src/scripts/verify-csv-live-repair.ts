import 'dotenv/config';
import { csvIngestionService, CSVType } from '../services/csvIngestionService';
import { supabaseAdmin } from '../database/supabaseClient';

type LiveResult = {
  type: string;
  success: boolean;
  rowsInserted: number;
  rowsSkipped: number;
  rowsFailed: number;
  errors: string[];
  queryCount: number;
};

async function main() {
  const membership = await supabaseAdmin
    .from('tenant_memberships')
    .select('tenant_id,user_id')
    .limit(1)
    .maybeSingle();

  if (membership.error || !membership.data) {
    throw new Error(`Could not resolve a live tenant membership: ${membership.error?.message || 'none found'}`);
  }

  const tenantId = membership.data.tenant_id;
  const userId = membership.data.user_id;
  const stamp = Date.now();

  const ids = {
    orderId: `CSV-VERIFY-ORD-${stamp}`,
    shipmentId: `CSV-VERIFY-SHP-${stamp}`,
    returnId: `CSV-VERIFY-RET-${stamp}`,
    settlementId: `CSV-VERIFY-SET-${stamp}`,
    sku: `CSV-VERIFY-SKU-${stamp}`,
  };

  const files: Array<{ type: CSVType; table: string; csv: string; countQuery: () => Promise<number> }> = [
    {
      type: 'orders',
      table: 'orders',
      csv: [
        'AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal,CurrencyCode',
        `${ids.orderId},2026-03-18T00:00:00Z,Shipped,19.99,USD`,
      ].join('\n'),
      countQuery: async () => {
        const { count, error } = await supabaseAdmin
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('user_id', userId)
          .eq('order_id', ids.orderId);
        if (error) throw error;
        return count || 0;
      },
    },
    {
      type: 'shipments',
      table: 'shipments',
      csv: [
        'ShipmentId,ShipmentDate,ShipmentStatus,QuantityShipped,QuantityReceived',
        `${ids.shipmentId},2026-03-18T00:00:00Z,RECEIVED,10,10`,
      ].join('\n'),
      countQuery: async () => {
        const { count, error } = await supabaseAdmin
          .from('shipments')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('user_id', userId)
          .eq('shipment_id', ids.shipmentId);
        if (error) throw error;
        return count || 0;
      },
    },
    {
      type: 'returns',
      table: 'returns',
      csv: [
        'ReturnId,ReturnDate,AmazonOrderId,ReturnReason,RefundAmount,ReturnStatus',
        `${ids.returnId},2026-03-18T00:00:00Z,${ids.orderId},DAMAGED,7.50,COMPLETED`,
      ].join('\n'),
      countQuery: async () => {
        const { count, error } = await supabaseAdmin
          .from('returns')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('user_id', userId)
          .eq('return_id', ids.returnId);
        if (error) throw error;
        return count || 0;
      },
    },
    {
      type: 'settlements',
      table: 'settlements',
      csv: [
        'SettlementId,TransactionType,PostedDate,Amount,CurrencyCode,AmazonOrderId',
        `${ids.settlementId},Order,2026-03-18T00:00:00Z,19.99,USD,${ids.orderId}`,
      ].join('\n'),
      countQuery: async () => {
        const { count, error } = await supabaseAdmin
          .from('settlements')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('user_id', userId)
          .eq('settlement_id', ids.settlementId);
        if (error) throw error;
        return count || 0;
      },
    },
    {
      type: 'financial_events',
      table: 'financial_events',
      csv: [
        'EventType,PostedDate,Amount,AmazonOrderId,SellerSKU,CurrencyCode',
        `AdjustmentEvent,2026-03-18T00:00:00Z,5.25,${ids.orderId},${ids.sku},USD`,
      ].join('\n'),
      countQuery: async () => {
        const { count, error } = await supabaseAdmin
          .from('financial_events')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('seller_id', userId)
          .eq('amazon_order_id', ids.orderId)
          .eq('source', 'csv_upload');
        if (error) throw error;
        return count || 0;
      },
    },
  ];

  const results: LiveResult[] = [];

  for (const file of files) {
    const batch = await csvIngestionService.ingestFiles(
      userId,
      [{ buffer: Buffer.from(file.csv), originalname: `${file.type}-${stamp}.csv`, mimetype: 'text/csv' }],
      { explicitType: file.type, triggerDetection: false, tenantId }
    );
    const result = batch.results[0];
    const queryCount = await file.countQuery();
    results.push({
      type: file.type,
      success: result.success,
      rowsInserted: result.rowsInserted,
      rowsSkipped: result.rowsSkipped,
      rowsFailed: result.rowsFailed,
      errors: result.errors,
      queryCount,
    });
  }

  const inventoryBatch = await csvIngestionService.ingestFiles(
    userId,
    [{
      buffer: Buffer.from(['SKU,ASIN,FNSKU,Quantity', `${ids.sku},ASIN-${stamp},FNSKU-${stamp},5`].join('\n')),
      originalname: `inventory-${stamp}.csv`,
      mimetype: 'text/csv',
    }],
    { explicitType: 'inventory', triggerDetection: false, tenantId }
  );

  const rerun = await csvIngestionService.ingestFiles(
    userId,
    [{ buffer: Buffer.from(files[0].csv), originalname: `orders-${stamp}.csv`, mimetype: 'text/csv' }],
    { explicitType: 'orders', triggerDetection: false, tenantId }
  );

  const rerunCount = await files[0].countQuery();

  console.log(JSON.stringify({
    tenantId,
    userId,
    results,
    inventory: inventoryBatch.results[0],
    rerun: {
      rowsInserted: rerun.results[0].rowsInserted,
      rowsSkipped: rerun.results[0].rowsSkipped,
      rowsFailed: rerun.results[0].rowsFailed,
      queryCount: rerunCount,
    },
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

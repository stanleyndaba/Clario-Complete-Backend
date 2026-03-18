import 'dotenv/config';
import fs from 'fs';
import path from 'path';

import { csvIngestionService, CSVType } from '../services/csvIngestionService';
import { supabaseAdmin, isRealDatabaseConfigured } from '../database/supabaseClient';

type FileSpec = {
  fileName: string;
  csvType: CSVType;
  table: string;
};

const FILES: FileSpec[] = [
  { fileName: 'orders.csv', csvType: 'orders', table: 'orders' },
  { fileName: 'shipments1.csv', csvType: 'shipments', table: 'shipments' },
  { fileName: 'returns.csv', csvType: 'returns', table: 'returns' },
  { fileName: 'settlements.csv', csvType: 'settlements', table: 'settlements' },
  { fileName: 'financial_events.csv', csvType: 'financial_events', table: 'financial_events' },
  { fileName: 'inventory_ledger_events.csv', csvType: 'inventory', table: 'inventory_ledger_events' },
  { fileName: 'inventory_transfers.csv', csvType: 'transfers', table: 'inventory_transfers' },
];

function readCsvLines(filePath: string): string[] {
  return fs
    .readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function pickIds(fileName: string, lines: string[]) {
  const dataLines = lines.slice(1);
  switch (fileName) {
    case 'orders.csv':
      return { orderIds: dataLines.map((line) => line.split(',')[0]) };
    case 'shipments1.csv':
      return { shipmentIds: dataLines.map((line) => line.split(',')[0]) };
    case 'returns.csv':
      return {
        returnIds: dataLines.map((line) => line.split(',')[0]),
        orderIds: dataLines.map((line) => line.split(',')[1]),
      };
    case 'settlements.csv':
      return {
        settlementIds: dataLines.map((line) => line.split(',')[0]),
        orderIds: dataLines.map((line) => line.split(',')[1]),
      };
    case 'financial_events.csv':
      return { skus: dataLines.map((line) => line.split(',')[1]) };
    case 'inventory_ledger_events.csv':
      return { skus: dataLines.map((line) => line.split(',')[1]) };
    case 'inventory_transfers.csv':
      return { transferIds: dataLines.map((line) => line.split(',')[0]) };
    default:
      return {};
  }
}

async function resolveContext() {
  const userId = process.env.CSV_TEST_USER_ID || 'cf6d8078-e83a-472a-baf5-d241eb7ab36e';
  const membership = await supabaseAdmin
    .from('tenant_memberships')
    .select('tenant_id,user_id,tenants(slug)')
    .eq('user_id', userId)
    .eq('tenant_id', process.env.CSV_TEST_TENANT_ID || '00000000-0000-0000-0000-000000000001')
    .maybeSingle();

  if (membership.error || !membership.data) {
    throw new Error(`Could not resolve membership for ${userId}: ${membership.error?.message || 'none found'}`);
  }

  return {
    userId: membership.data.user_id,
    tenantId: membership.data.tenant_id,
    tenantSlug: membership.data.tenants?.slug || null,
  };
}

async function countTable(table: string, tenantId: string, userId: string) {
  const sellerField = table === 'financial_events' || table === 'inventory_transfers' ? 'seller_id' : 'user_id';
  const result = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId as any)
    .eq(sellerField as any, userId as any);
  return { count: result.count || 0, error: result.error?.message || null };
}

async function countInsertedSubset(spec: FileSpec, tenantId: string, userId: string, keys: Record<string, string[]>, syncId?: string) {
  switch (spec.table) {
    case 'orders':
      return supabaseAdmin.from('orders').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId as any).eq('user_id', userId as any).in('order_id', keys.orderIds || []);
    case 'shipments':
      return supabaseAdmin.from('shipments').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId as any).eq('user_id', userId as any).in('shipment_id', keys.shipmentIds || []);
    case 'returns':
      return supabaseAdmin.from('returns').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId as any).eq('user_id', userId as any).in('return_id', keys.returnIds || []);
    case 'settlements':
      return supabaseAdmin.from('settlements').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId as any).eq('user_id', userId as any).in('settlement_id', keys.settlementIds || []);
    case 'financial_events':
      return supabaseAdmin.from('financial_events').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId as any).eq('seller_id', userId as any).eq('sync_id', syncId as any);
    case 'inventory_ledger_events':
      return supabaseAdmin.from('inventory_ledger_events').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId as any).eq('user_id', userId as any).eq('sync_id', syncId as any);
    case 'inventory_transfers':
      return supabaseAdmin.from('inventory_transfers').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId as any).eq('seller_id', userId as any).in('transfer_id', keys.transferIds || []);
    default:
      return { count: 0, error: 'unsupported table' } as any;
  }
}

async function nullTenantCount(table: string) {
  const sellerField = table === 'financial_events' || table === 'inventory_transfers' ? 'seller_id' : 'user_id';
  const query = supabaseAdmin.from(table).select('tenant_id', { count: 'exact', head: true }).is('tenant_id', null);
  return query.then((result: any) => ({ count: result.count || 0, error: result.error?.message || null, sellerField }));
}

async function main() {
  if (!isRealDatabaseConfigured) {
    throw new Error('Real database configuration is required');
  }

  const context = await resolveContext();
  const baseDir = path.resolve(process.cwd());
  const fileResults: any[] = [];
  const dbState: Record<string, number | string> = {};
  let tenantScopingPass = true;
  let schemaValidityPass = true;

  for (const spec of FILES) {
    const filePath = path.join(baseDir, spec.fileName);
    if (!fs.existsSync(filePath)) {
      fileResults.push({ fileName: spec.fileName, parsed: 0, inserted: 0, failed: 1, error: 'file not found' });
      schemaValidityPass = false;
      continue;
    }

    const lines = readCsvLines(filePath);
    const parsed = Math.max(0, lines.length - 1);
    const keys = pickIds(spec.fileName, lines);

    const result = await csvIngestionService.ingestFiles(
      context.userId,
      [{
        buffer: fs.readFileSync(filePath),
        originalname: spec.fileName,
        mimetype: 'text/csv',
      }],
      {
        explicitType: spec.csvType,
        triggerDetection: false,
        tenantId: context.tenantId,
      }
    );

    const single = result.results[0];
    const subsetQuery = await countInsertedSubset(spec, context.tenantId, context.userId, keys, result.syncId);
    const subsetCount = subsetQuery.count || 0;
    const subsetError = subsetQuery.error?.message || subsetQuery.error || null;

    fileResults.push({
      fileName: spec.fileName,
      parsed,
      inserted: single.rowsInserted,
      failed: single.rowsFailed,
      skipped: single.rowsSkipped,
      errors: single.errors,
      syncId: result.syncId,
      subsetCount,
      subsetError,
    });

    if (single.rowsInserted > 0) {
      const nullTenant = await supabaseAdmin
        .from(spec.table)
        .select('*', { count: 'exact', head: true })
        .eq('sync_id', result.syncId as any)
        .is('tenant_id', null);
      if ((nullTenant.count || 0) > 0 || nullTenant.error) {
        tenantScopingPass = false;
      }
    }

    if ((single.rowsInserted === 0 && single.rowsFailed > 0) || subsetError) {
      schemaValidityPass = false;
    }

    const tableCount = await countTable(spec.table, context.tenantId, context.userId);
    dbState[spec.table] = tableCount.error || tableCount.count;
  }

  const beforeOrders = await countTable('orders', context.tenantId, context.userId);
  const ordersPath = path.join(baseDir, 'orders.csv');
  const rerun = await csvIngestionService.ingestFiles(
    context.userId,
    [{ buffer: fs.readFileSync(ordersPath), originalname: 'orders.csv', mimetype: 'text/csv' }],
    { explicitType: 'orders', triggerDetection: false, tenantId: context.tenantId }
  );
  const afterOrders = await countTable('orders', context.tenantId, context.userId);
  const idempotencyPass = (beforeOrders.count || 0) === (afterOrders.count || 0) && rerun.results[0].rowsInserted === 0;

  const ordersRows = await supabaseAdmin.from('orders').select('order_id,sku:items').eq('tenant_id', context.tenantId as any).eq('user_id', context.userId as any).in('order_id', pickIds('orders.csv', readCsvLines(ordersPath)).orderIds || []);
  const returnsRows = await supabaseAdmin.from('returns').select('order_id,items,metadata').eq('tenant_id', context.tenantId as any).eq('user_id', context.userId as any);
  const settlementsRows = await supabaseAdmin.from('settlements').select('order_id').eq('tenant_id', context.tenantId as any).eq('user_id', context.userId as any);
  const ledgerRows = await supabaseAdmin.from('inventory_ledger_events').select('sku,fnsku,event_type').eq('tenant_id', context.tenantId as any).eq('user_id', context.userId as any);

  const orderIds = new Set((pickIds('orders.csv', readCsvLines(ordersPath)).orderIds || []));
  const returnOrderIds = new Set((returnsRows.data || []).map((row: any) => row.order_id).filter(Boolean));
  const settlementOrderIds = new Set((settlementsRows.data || []).map((row: any) => row.order_id).filter(Boolean));
  const ledgerSkus = new Set((ledgerRows.data || []).map((row: any) => row.sku || row.fnsku).filter(Boolean));
  const fileSkus = new Set([
    ...(pickIds('shipments1.csv', readCsvLines(path.join(baseDir, 'shipments1.csv'))).shipmentIds ? [] : []),
    ...(pickIds('financial_events.csv', readCsvLines(path.join(baseDir, 'financial_events.csv'))).skus || []),
    ...(pickIds('inventory_ledger_events.csv', readCsvLines(path.join(baseDir, 'inventory_ledger_events.csv'))).skus || []),
  ]);

  const crossTableConsistencyPass =
    [...returnOrderIds].every((id) => orderIds.has(id)) &&
    [...settlementOrderIds].every((id) => orderIds.has(id)) &&
    [...fileSkus].every((sku) => ledgerSkus.has(sku) || specMaybeMissingTransferSku(sku));

  console.log(JSON.stringify({
    context,
    fileResults,
    dbState,
    tenantScopingPass,
    idempotencyPass,
    schemaValidityPass,
    crossTableConsistencyPass,
  }, null, 2));
}

function specMaybeMissingTransferSku(_sku: string) {
  return false;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
